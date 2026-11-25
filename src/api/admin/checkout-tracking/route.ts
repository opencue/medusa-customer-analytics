import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService, Query } from "@medusajs/types"

import { CHECKOUT_TRACKING_MODULE } from "../../../modules/checkout_tracking"
import {
  REPEAT_WINDOW_ENV,
  resolveRepeatWindowMs,
} from "../../../modules/checkout_tracking/lib/visitors"
import type CheckoutTrackingModuleService from "../../../modules/checkout_tracking/service"
import {
  ABANDONMENT_MINUTES,
  ORDER_SCAN_CAP,
  analyticsWindow,
  buildDashboard,
  isInWindow,
  type CartRow,
} from "../../../modules/checkout_tracking/lib/dashboard"
import {
  buildSaleCandidates,
  buildSoldUnitsBySku,
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

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const range = analyticsWindow(req.query.days)
  const { days, since, now } = range

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
      take: CART_SCAN_CAP + 1,
      skip: 0,
      order: { created_at: "DESC" },
    },
  })

  const scanned = ((data ?? []) as CartRow[]).filter((cart) => isInWindow(cart.created_at, range))
  const carts = scanned.slice(0, CART_SCAN_CAP)
  const capped = scanned.length > CART_SCAN_CAP

  const service = req.scope.resolve<CheckoutTrackingModuleService>(
    CHECKOUT_TRACKING_MODULE
  )
  const journeys = await service.listByCartIds(carts.map((cart) => cart.id))

  const dashboard = buildDashboard({
    carts,
    journeys,
    now,
    // How long after one anonymous cart an identical one still reads as the
    // same shopper retrying. Per-shop, because the right answer depends on the
    // catalogue rather than on this code.
    repeatWindowMs: resolveRepeatWindowMs(process.env[REPEAT_WINDOW_ENV]),
  })

  // Orders in the same window, so "never purchased" is measured over exactly
  // the period the funnel above describes. The Order Module can date-filter
  // directly and returns the formatted line-item quantities.
  const orderService = req.scope.resolve<IOrderModuleService>(Modules.ORDER)
  const orders = await orderService.listOrders(
    { created_at: { $gte: since.toISOString(), $lte: now.toISOString() } },
    {
      select: ["id", "status"],
      relations: ["items"],
      take: ORDER_SCAN_CAP + 1,
      order: { created_at: "DESC", id: "DESC" },
    }
  )
  const ordersCapped = orders.length > ORDER_SCAN_CAP

  const sale_candidates = capped || ordersCapped ? [] : buildSaleCandidates({
    sessions: dashboard.visitors.filter((v) => v.status === "abandoned").map((v) => v.lead),
    soldUnitsBySku: buildSoldUnitsBySku(
      orders.filter((order) => order.status !== "canceled" && order.status !== "draft")
    ),
  })

  res.json({
    range: { days, since: since.toISOString(), now: now.toISOString() },
    abandonment_minutes: ABANDONMENT_MINUTES,
    ...dashboard,
    sale_candidates,
    scan: {
      // Carts inside the window, not rows fetched — the fetched count is an
      // implementation detail the operator cannot act on.
      carts: carts.length,
      cap: CART_SCAN_CAP,
      capped,
      orders_capped: ordersCapped,
    },
  })
}
