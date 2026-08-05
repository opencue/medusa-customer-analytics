import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Query } from "@medusajs/types"

import { CHECKOUT_TRACKING_MODULE } from "../../../modules/checkout_tracking"
import {
  REPEAT_WINDOW_ENV,
  resolveRepeatWindowMs,
} from "../../../modules/checkout_tracking/lib/visitors"
import type CheckoutTrackingModuleService from "../../../modules/checkout_tracking/service"
import {
  buildDashboard,
  type CartRow,
} from "../../../modules/checkout_tracking/lib/dashboard"
import {
  buildSaleCandidates,
  buildSoldUnitsBySku,
  type OrderRow,
} from "../../../modules/checkout_tracking/lib/sale-candidates"

/**
 * GET /admin/checkout-tracking
 *
 * Everything the checkout tracker page shows, in one call: the funnel, the
 * per-shopper session list, the products that keep getting abandoned, and the
 * pages shoppers left from.
 *
 * Query:
 *   days   window, 1-90 (default 7)
 */

const DEFAULT_DAYS = 7
const MAX_DAYS = 90

/**
 * Hard ceiling on carts examined per request. This is a CAP, not paging —
 * every cart lands in memory at once so the whole window can be aggregated in
 * one pass.
 *
 * Carts are fetched newest-first, so hitting the cap truncates the OLDEST end
 * of the window. That is reported back as `scan.capped` rather than being
 * hidden: a silently truncated funnel reads as "this is your whole shop" when
 * it is not.
 */
const CART_SCAN_CAP = 2000

/**
 * Same ceiling for the orders side. A shop always has far fewer orders than
 * carts, so this reaches much further back in time than the cart scan does —
 * which is the safe direction: under-counting sales would wrongly promote a
 * product onto the "never purchased" list.
 */
const ORDER_SCAN_CAP = 2000

const CART_FIELDS = [
  "id",
  "email",
  "customer_id",
  "currency_code",
  "total",
  "created_at",
  "updated_at",
  "completed_at",
  "items.id",
  "items.title",
  "items.product_id",
  "items.product_title",
  "items.variant_sku",
  "items.thumbnail",
  "items.quantity",
  "items.unit_price",
  // Carries the gift gate's `is_gift` flag, which keeps the auto-added free
  // gift out of the abandoned-product ranking.
  "items.metadata",
  "shipping_address.address_1",
  "shipping_address.city",
  "shipping_methods.id",
  "payment_collection.payment_sessions.id",
]

const parseDays = (raw: string | undefined): number => {
  const parsed = parseInt(raw ?? "", 10)
  if (!Number.isFinite(parsed)) return DEFAULT_DAYS
  return Math.min(Math.max(parsed, 1), MAX_DAYS)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const q = req.query as Record<string, string | undefined>
  const days = parseDays(q.days)

  const now = new Date()
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  const query = req.scope.resolve<Query>(ContainerRegistrationKeys.QUERY)

  // Windowed in JS, deliberately.
  //
  // `filters: { created_at: { $gte: since } }` is SILENTLY IGNORED by
  // query.graph on `cart` — verified against a dev database holding 0 carts
  // from the last 7 days, where the filtered query still returned the scan cap.
  // It does not error, it just returns everything, so a "days=7" funnel would
  // quietly be built from years of traffic. Newest-first ordering puts the
  // requested window at the head of the result, so slicing it here is correct;
  // it only costs the rows fetched between `since` and the cap.
  const { data } = await query.graph({
    entity: "cart",
    fields: CART_FIELDS,
    pagination: {
      take: CART_SCAN_CAP,
      skip: 0,
      order: { created_at: "DESC" },
    },
  })

  const scanned = (data ?? []) as CartRow[]
  const createdAt = (cart: CartRow): Date | null => {
    const value = cart.created_at ? new Date(cart.created_at) : null
    return value && !Number.isNaN(value.getTime()) ? value : null
  }

  const carts = scanned.filter((cart) => {
    const created = createdAt(cart)
    return !!created && created >= since
  })

  // The window is only truncated when the scan filled up AND its oldest row is
  // still inside the window — that is the case where older carts from the same
  // window exist but were never fetched. If the scan reached back past `since`,
  // coverage is complete however many rows it took.
  const oldestScanned = createdAt(scanned[scanned.length - 1] ?? ({} as CartRow))
  const capped =
    scanned.length >= CART_SCAN_CAP && !!oldestScanned && oldestScanned >= since

  const service = req.scope.resolve<CheckoutTrackingModuleService>(
    CHECKOUT_TRACKING_MODULE
  )
  const journeys = await service.listByCartIds(carts.map((cart) => cart.id))

  const dashboard = buildDashboard({
    carts,
    journeys,
    // How long after one anonymous cart an identical one still reads as the
    // same shopper retrying. Per-shop, because the right answer depends on the
    // catalogue rather than on this code.
    repeatWindowMs: resolveRepeatWindowMs(process.env[REPEAT_WINDOW_ENV]),
  })

  // Orders in the same window, so "never purchased" is measured over exactly
  // the period the funnel above describes. Same newest-first + JS window as the
  // carts — query.graph ignores a created_at filter here too.
  const { data: orderData } = await query.graph({
    entity: "order",
    fields: ["id", "created_at", "items.variant_sku", "items.quantity"],
    pagination: {
      take: ORDER_SCAN_CAP,
      skip: 0,
      order: { created_at: "DESC" },
    },
  })

  const orders = ((orderData ?? []) as OrderRow[]).filter((order) => {
    const created = order.created_at ? new Date(order.created_at) : null
    return !!created && !Number.isNaN(created.getTime()) && created >= since
  })

  const sale_candidates = buildSaleCandidates({
    sessions: dashboard.sessions,
    soldUnitsBySku: buildSoldUnitsBySku(orders),
  })

  res.json({
    range: { days, since: since.toISOString(), now: now.toISOString() },
    ...dashboard,
    sale_candidates,
    scan: {
      // Carts inside the window, not rows fetched — the fetched count is an
      // implementation detail the operator cannot act on.
      carts: carts.length,
      cap: CART_SCAN_CAP,
      capped,
    },
  })
}
