/**
 * Everything the admin tracker shows, derived in one pure pass.
 *
 * The route's only job is to fetch carts + journeys and hand them here, so the
 * whole shape of the dashboard — the funnel, who is stuck where, which products
 * keep getting abandoned, which page they left from — is unit-testable without
 * a database.
 */
import {
  buildFunnel,
  deriveServerStage,
  maxStage,
  stageIndex,
  type CartLike,
  type FunnelRow,
  type FunnelStage,
} from "./stages"
import type { JourneyRow } from "./journey"

export type CartItemRow = {
  id?: string | null
  title?: string | null
  /** Needed to target a promotion at this product, not just name it. */
  product_id?: string | null
  product_title?: string | null
  product_handle?: string | null
  variant_sku?: string | null
  thumbnail?: string | null
  quantity?: number | null
  unit_price?: number | null
  metadata?: Record<string, unknown> | null
}

// `items` is re-declared rather than intersected: CartLike only needs to know
// a cart HAS items to place it on the ladder, while the dashboard needs each
// item's fields. Intersecting the two would leave `items` as
// `Array<unknown> & CartItemRow[]`, which reads back as `unknown`.
export type CartRow = Omit<CartLike, "items"> & {
  id: string
  email?: string | null
  customer_id?: string | null
  currency_code?: string | null
  total?: number | null
  created_at?: string | Date | null
  updated_at?: string | Date | null
  items?: CartItemRow[] | null
}

export type SessionRow = {
  cart_id: string
  /** Present only once the shopper typed it into checkout. */
  email: string | null
  customer_id: string | null
  stage: FunnelStage
  /** Which observer proved the furthest rung — useful when a number looks off. */
  observed_by: "cart" | "storefront" | "both"
  items: Array<{
    title: string
    sku: string | null
    product_id: string | null
    thumbnail: string | null
    quantity: number
    unit_price: number
    /** Auto-added free gift, not something the shopper chose. */
    is_gift: boolean
  }>
  item_count: number
  total: number
  currency_code: string
  created_at: string | null
  updated_at: string | null
  /** Storefront-only fields — null for shoppers without analytics consent. */
  last_seen_at: string | null
  last_path: string | null
  device: string | null
  locale: string | null
  stage_at: Record<string, string> | null
  completed_at: string | null
}

export type AbandonedProduct = {
  key: string
  title: string
  sku: string | null
  thumbnail: string | null
  /** Number of abandoned carts this product sat in. */
  carts: number
  units: number
  /** Line value stranded in those carts. */
  value: number
}

export type ExitPath = { path: string; count: number }

export type DashboardTotals = {
  tracked: number
  completed: number
  abandoned: number
  conversion_rate: number
  /** Cart value that did NOT convert — the size of the problem, in currency. */
  lost_value: number
  converted_value: number
  currency: string
  /** Journeys the storefront beacon contributed to (i.e. consented visitors). */
  with_storefront_data: number
}

export type Dashboard = {
  funnel: FunnelRow[]
  totals: DashboardTotals
  sessions: SessionRow[]
  abandoned_products: AbandonedProduct[]
  exit_paths: ExitPath[]
}

const TOP_PRODUCTS = 10
const TOP_EXIT_PATHS = 8

const iso = (value: string | Date | null | undefined): string | null => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Money as a number, whatever wrapper it arrives in.
 *
 * Medusa v2 money fields (`cart.total`, `items.unit_price`) come out of
 * `query.graph` as **BigNumber instances**, not numbers — `typeof` is
 * "object", even though `JSON.stringify` renders them as `47790` and they look
 * like plain numbers in any logged payload. A typeof-number guard therefore
 * zeroes every price silently, which is exactly how "stratená hodnota" first
 * read €0 against a database full of priced carts. Verified against a live
 * cart: `typeof unit_price === "object"`, `constructor.name === "BigNumber"`.
 *
 * Strings are handled too, since Postgres hands `numeric` back as text on the
 * paths that bypass the BigNumber wrapper.
 */
export const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0

  if (typeof value === "string") {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (value && typeof value === "object") {
    // BigNumber exposes the plain value here; prefer it over coercion.
    const numeric = (value as { numeric?: unknown }).numeric
    if (typeof numeric === "number" && Number.isFinite(numeric)) return numeric

    // Falls through to valueOf()/toString() for any other numeric wrapper.
    const coerced = Number(value)
    if (Number.isFinite(coerced)) return coerced
  }

  return 0
}

const itemTitle = (item: CartItemRow): string =>
  (item.product_title || item.title || "").trim() || "—"

/**
 * The free gift ("darcek") the storefront auto-adds over the order threshold.
 *
 * Detected the same way the storefront does (`lib/constants/gift.ts`): the flag
 * the gift gate stamps on the line, with the variant SKU as the fallback for
 * lines added any other way.
 */
const GIFT_VARIANT_SKU = "LF-DARCEK01"

const isGiftItem = (item: CartItemRow): boolean => {
  if ((item.metadata as { is_gift?: unknown } | null)?.is_gift === true) {
    return true
  }
  return (item.variant_sku || "").trim().toUpperCase() === GIFT_VARIANT_SKU
}

/**
 * Cart value, falling back to the line-item sum.
 *
 * `cart.total` is a COMPUTED field in Medusa v2, not a stored column — reading
 * a cart through `query.graph` returns 0 for it. Trusting it as-is made every
 * abandoned cart worth nothing and the "lost value" KPI a flat €0, which is the
 * single number this page exists to show. The line sum omits shipping and tax,
 * which is the honest floor: it is the value of the goods left behind.
 */
const cartValue = (cart: CartRow, items: Array<{
  quantity: number
  unit_price: number
}>): number => {
  const stored = toNumber(cart.total)
  if (stored > 0) return stored
  return items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
}

/**
 * Identity used to group a product across carts. The SKU is preferred because
 * two carts holding the same variant must collapse into one row; the title is
 * only a fallback for legacy items saved before SKUs were mandatory.
 */
const productKey = (item: CartItemRow): string =>
  (item.variant_sku || "").trim() || `title:${itemTitle(item)}`

export type BuildDashboardInput = {
  carts: CartRow[]
  journeys: JourneyRow[]
  /** Fallback currency when no cart in the window declares one. */
  defaultCurrency?: string
}

export const buildDashboard = ({
  carts,
  journeys,
  defaultCurrency = "eur",
}: BuildDashboardInput): Dashboard => {
  const byCart = new Map<string, JourneyRow>()
  for (const journey of journeys) byCart.set(journey.cart_id, journey)

  const sessions: SessionRow[] = []

  for (const cart of carts) {
    const serverStage = deriveServerStage(cart)
    const journey = byCart.get(cart.id)
    const clientStage = (journey?.stage ?? null) as FunnelStage | null
    const stage = maxStage(serverStage, clientStage)

    // No stage at all means an empty cart that was never filled — there is no
    // abandonment to report, and counting it would depress every rate below.
    if (!stage) continue

    const items = (cart.items ?? []).map((item) => ({
      title: itemTitle(item),
      sku: (item.variant_sku || "").trim() || null,
      product_id: (item.product_id || "").trim() || null,
      thumbnail: item.thumbnail ?? null,
      quantity: toNumber(item.quantity),
      unit_price: toNumber(item.unit_price),
      is_gift: isGiftItem(item),
    }))

    const si = stageIndex(serverStage)
    const ci = stageIndex(clientStage)
    const observed_by: SessionRow["observed_by"] =
      si >= 0 && ci >= 0 ? "both" : ci >= 0 ? "storefront" : "cart"

    sessions.push({
      cart_id: cart.id,
      email: (cart.email || "").trim() || null,
      customer_id: cart.customer_id ?? null,
      stage,
      observed_by,
      items,
      item_count: items.reduce((sum, item) => sum + item.quantity, 0),
      total: cartValue(cart, items),
      currency_code: (cart.currency_code || defaultCurrency).toLowerCase(),
      created_at: iso(cart.created_at),
      updated_at: iso(cart.updated_at),
      last_seen_at: iso(journey?.last_seen_at ?? null),
      last_path: journey?.last_path ?? null,
      device: journey?.device ?? null,
      locale: journey?.locale ?? null,
      stage_at: journey?.stage_at ?? null,
      completed_at: iso(cart.completed_at),
    })
  }

  // Newest first — the merchant reads this list top-down to decide who to
  // call back, and the freshest abandonment is the one still worth saving.
  sessions.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))

  const abandoned = sessions.filter((s) => s.stage !== "completed")
  const completed = sessions.filter((s) => s.stage === "completed")

  const products = new Map<string, AbandonedProduct>()
  for (const session of abandoned) {
    // Count a product once per cart even if it appears on two lines, so
    // "carts" stays an honest cart count rather than a line count.
    const seen = new Set<string>()
    for (const item of session.items) {
      // The free gift rides along in every cart over the threshold, so it would
      // top this ranking in every window while telling the operator nothing —
      // nobody abandons a checkout over a €0 item they did not pick.
      if (item.is_gift) continue

      const key = item.sku ?? `title:${item.title}`
      const row = products.get(key) ?? {
        key,
        title: item.title,
        sku: item.sku,
        thumbnail: item.thumbnail,
        carts: 0,
        units: 0,
        value: 0,
      }
      if (!seen.has(key)) {
        row.carts += 1
        seen.add(key)
      }
      row.units += item.quantity
      row.value += item.quantity * item.unit_price
      row.thumbnail = row.thumbnail ?? item.thumbnail
      products.set(key, row)
    }
  }

  const paths = new Map<string, number>()
  for (const session of abandoned) {
    if (!session.last_path) continue
    paths.set(session.last_path, (paths.get(session.last_path) ?? 0) + 1)
  }

  const currency =
    sessions.find((s) => s.currency_code)?.currency_code ?? defaultCurrency

  return {
    funnel: buildFunnel(sessions.map((s) => s.stage)),
    totals: {
      tracked: sessions.length,
      completed: completed.length,
      abandoned: abandoned.length,
      conversion_rate: sessions.length
        ? completed.length / sessions.length
        : 0,
      lost_value: abandoned.reduce((sum, s) => sum + s.total, 0),
      converted_value: completed.reduce((sum, s) => sum + s.total, 0),
      currency,
      with_storefront_data: sessions.filter((s) => s.observed_by !== "cart")
        .length,
    },
    sessions,
    abandoned_products: [...products.values()]
      .sort((a, b) => b.carts - a.carts || b.value - a.value)
      .slice(0, TOP_PRODUCTS),
    exit_paths: [...paths.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_EXIT_PATHS),
  }
}

export type { FunnelRow }
