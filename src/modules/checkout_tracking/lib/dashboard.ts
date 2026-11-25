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
import { ABANDONMENT_MS, type JourneyRow } from "./journey"
import { activityAt, groupSessionsByVisitor, type VisitorGroup } from "./visitors"

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
  currency: string
}

export type ExitPath = { path: string; count: number }

export type CheckoutStatus = "active" | "abandoned" | "completed" | "recovered"
type DashboardVisitor = VisitorGroup & { status: CheckoutStatus }
type CurrencyTotals = { currency: string; lost_value: number; converted_value: number }
type ProductItem = SessionRow["items"][number]
export type ProductBasket = Pick<SessionRow, "currency_code" | "items" | "observed_by" | "stage">

export const checkoutItemKey = (currency: string, item: ProductItem): string => {
  if (item.sku) return JSON.stringify([currency, "sku", item.sku])
  if (item.product_id) return JSON.stringify([currency, "product", item.product_id])
  return JSON.stringify([currency, "title", item.title])
}

/** One basket's lines per shopper, product and currency; the furthest cart wins. */
export const abandonedProductBaskets = (
  visitors: DashboardVisitor[],
  eligible: (item: ProductItem) => boolean = (item) => !item.is_gift
): ProductBasket[] => visitors.flatMap((visitor) => {
  if (visitor.status !== "abandoned") return []
  const seen = new Set<string>()
  return visitor.carts.flatMap(({ currency_code, items, observed_by, stage }) => {
    const unique = items.filter((item) => eligible(item) && !seen.has(checkoutItemKey(currency_code, item)))
    for (const item of unique) seen.add(checkoutItemKey(currency_code, item))
    return unique.length ? [{ currency_code, items: unique, observed_by, stage }] : []
  })
})

export type DashboardTotals = {
  tracked: number
  completed: number
  active: number
  abandoned: number
  /** Subset of completed. */
  recovered: number
  conversion_rate: number
  /** Legacy scalars are null rather than mixing currencies. */
  lost_value: number | null
  converted_value: number | null
  currency: string | null
  by_currency: CurrencyTotals[]
  /** Journeys the storefront beacon contributed to (i.e. consented visitors). */
  with_storefront_data: number
  /** Carts folded into an earlier visitor by the grouping rules. */
  duplicate_carts: number
}

export type Dashboard = {
  funnel: FunnelRow[]
  totals: DashboardTotals
  /** One entry per shopper, each carrying every cart attributed to them. */
  visitors: DashboardVisitor[]
  /** Every cart, ungrouped — kept for exports and for auditing a merge. */
  sessions: SessionRow[]
  abandoned_products: AbandonedProduct[]
  exit_paths: ExitPath[]
}

const TOP_PRODUCTS = 10
const TOP_EXIT_PATHS = 8
export const ORDER_SCAN_CAP = 2000

export const analyticsWindow = (rawDays: unknown, now = new Date()) => {
  const requested = typeof rawDays === "string" ? parseInt(rawDays, 10) : NaN
  const days = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 90) : 7
  const since = new Date(now.getTime() - days * 86_400_000)
  return { days, since, now }
}

export const isInWindow = (
  value: Date | string | null | undefined,
  range: { since: Date; now: Date }
): boolean => {
  if (!value) return false
  const date = new Date(value)
  return date >= range.since && date <= range.now
}

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

const isRecovered = (session: SessionRow, journey: JourneyRow | undefined): boolean => {
  const completed = Date.parse(session.completed_at ?? "")
  if (!Number.isFinite(completed)) return false

  if (Date.parse(iso(journey?.returned_at) ?? "") <= completed) return true

  // The first visit to each stage doesn't tell us when the shopper was last
  // active. Only the most recent recorded activity can anchor a gap here.
  const seen = Date.parse(session.last_seen_at ?? "")
  if (seen >= completed) return false
  const updated = Date.parse(session.updated_at ?? "")
  const lastActivity = [seen, updated].filter((at) => at < completed)
  return lastActivity.length > 0 && completed - Math.max(...lastActivity) >= ABANDONMENT_MS
}

const visitorStatus = (
  visitor: VisitorGroup,
  now: number,
  journeys: Map<string, JourneyRow>
): CheckoutStatus => {
  if (visitor.lead.stage === "completed") {
    return visitor.carts.some((cart) => isRecovered(cart, journeys.get(cart.cart_id)))
      ? "recovered" : "completed"
  }
  return visitor.carts.some((cart) => {
    const at = activityAt(cart)
    return !at || now - at < ABANDONMENT_MS
  }) ? "active" : "abandoned"
}

export type BuildDashboardInput = {
  carts: CartRow[]
  journeys: JourneyRow[]
  /** Fallback currency when no cart in the window declares one. */
  defaultCurrency?: string
  /**
   * How close two anonymous carts must be to read as one shopper retrying.
   * Shops differ: a phone accessory is re-added within a minute, a truck tyre
   * is reconsidered an hour later. Omit to use the module default.
   */
  repeatWindowMs?: number
  now?: Date
}

export const buildDashboard = ({
  carts,
  journeys,
  defaultCurrency = "eur",
  repeatWindowMs,
  now = new Date(),
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
      currency_code: (cart.currency_code?.trim() || defaultCurrency).toLowerCase(),
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

  // Everything below counts VISITORS, not carts. One shopper who rebuilt the
  // same cart three times is one abandonment worth one call-back, not three —
  // counting carts inflated the abandoned total and the lost value, and
  // divided the conversion rate by the duplicates.
  const visitors = groupSessionsByVisitor(sessions, { repeatWindowMs }).map((v) => ({
    ...v,
    status: visitorStatus(v, now.getTime(), byCart),
  }))
  const abandonedVisitors = visitors.filter((v) => v.status === "abandoned")
  const activeVisitors = visitors.filter((v) => v.status === "active")
  const completedVisitors = visitors.filter((v) => v.lead.stage === "completed")
  const abandoned = abandonedVisitors.map((v) => v.lead)
  const completed = completedVisitors.map((v) => v.lead)

  const products = new Map<string, AbandonedProduct>()
  for (const session of abandonedProductBaskets(visitors)) {
    // Count a product once per cart even if it appears on two lines, so
    // "carts" stays an honest cart count rather than a line count.
    const seen = new Set<string>()
    for (const item of session.items) {
      const key = checkoutItemKey(session.currency_code, item)
      const row = products.get(key) ?? {
        key,
        title: item.title,
        sku: item.sku,
        thumbnail: item.thumbnail,
        carts: 0,
        units: 0,
        value: 0,
        currency: session.currency_code,
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

  const money = new Map<string, CurrencyTotals>()
  for (const { currency_code: currency } of sessions) {
    if (!money.has(currency)) money.set(currency, { currency, lost_value: 0, converted_value: 0 })
  }
  for (const session of abandoned) money.get(session.currency_code)!.lost_value += session.total
  for (const session of completed) money.get(session.currency_code)!.converted_value += session.total
  const byCurrency = [...money.values()].sort((a, b) => a.currency.localeCompare(b.currency))
  const single = byCurrency.length === 1 ? byCurrency[0] : null

  return {
    funnel: buildFunnel(
      visitors.map((v) => v.lead.stage),
      activeVisitors.map((v) => v.lead.stage)
    ),
    visitors,
    totals: {
      tracked: visitors.length,
      completed: completedVisitors.length,
      active: activeVisitors.length,
      abandoned: abandonedVisitors.length,
      recovered: completedVisitors.filter((v) => v.status === "recovered").length,
      conversion_rate: visitors.length
        ? completedVisitors.length / visitors.length
        : 0,
      lost_value: single?.lost_value ?? (byCurrency.length ? null : 0),
      converted_value: single?.converted_value ?? (byCurrency.length ? null : 0),
      currency: single?.currency ?? (byCurrency.length ? null : defaultCurrency),
      by_currency: byCurrency,
      with_storefront_data: visitors.filter((v) =>
        v.carts.some((c) => c.observed_by !== "cart")
      ).length,
      /** Carts folded into an earlier visitor — how much noise was removed. */
      duplicate_carts: sessions.length - visitors.length,
    },
    sessions,
    abandoned_products: [...products.values()]
      .sort((a, b) => b.carts - a.carts || a.currency.localeCompare(b.currency) || b.value - a.value)
      .slice(0, TOP_PRODUCTS),
    exit_paths: [...paths.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_EXIT_PATHS),
  }
}

export type { FunnelRow }
