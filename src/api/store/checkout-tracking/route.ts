import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Query } from "@medusajs/types"

import { CHECKOUT_TRACKING_MODULE } from "../../../modules/checkout_tracking"
import type CheckoutTrackingModuleService from "../../../modules/checkout_tracking/service"
import { CART_ACTIVITY_FIELDS, latestCartActivity, type CartActivity } from "../../../modules/checkout_tracking/lib/cart-activity"

/**
 * Storefront checkout beacon.
 *
 * Records the page-level half of a checkout journey — which step was opened,
 * from what device, and the last path seen before the visitor left. Everything
 * the cart row can already prove is derived at read time and is NOT accepted
 * here, so a forged beacon can never claim an order was placed or an address
 * filled: the admin tracker takes the FURTHEST of (cart-derived, beacon), and
 * the cart always wins on the rungs it can see.
 *
 * The write is bounded by cart existence — a beacon for an id that is not a
 * real cart is dropped before touching the module, so a public endpoint cannot
 * be used to grow the table. `/store/*` already requires a publishable API key.
 *
 * Always answers 204 with no body: there is nothing for a beacon to read, and
 * a differentiated response would let a caller probe which cart ids exist.
 */

// Medusa ids are `cart_` + ULID. Shape-checked before any query so obvious junk
// costs nothing.
const CART_ID_PATTERN = /^cart_[0-9A-Za-z]{10,60}$/

type Body = {
  cart_id?: unknown
  stage?: unknown
  path?: unknown
  locale?: unknown
  device?: unknown
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as Body

  const cartId = typeof body.cart_id === "string" ? body.cart_id.trim() : ""
  const stage = typeof body.stage === "string" ? body.stage.trim() : ""

  if (!CART_ID_PATTERN.test(cartId) || !stage) {
    res.status(204).send()
    return
  }

  try {
    const query = req.scope.resolve<Query>(ContainerRegistrationKeys.QUERY)
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: ["id", "completed_at"],
      filters: { id: cartId },
    })

    const cart = carts?.[0]
    if (!cart?.id || cart.completed_at) {
      res.status(204).send()
      return
    }

    const service = req.scope.resolve<CheckoutTrackingModuleService>(
      CHECKOUT_TRACKING_MODULE
    )
    await service.track({
      cart_id: cartId,
      stage,
      path: typeof body.path === "string" ? body.path : null,
      locale: typeof body.locale === "string" ? body.locale : null,
      device: typeof body.device === "string" ? body.device : null,
    }, new Date(), async () => {
      try {
        const [{ data }, [lastAdd]] = await Promise.all([
          query.graph({ entity: "cart", fields: ["id", "completed_at", ...CART_ACTIVITY_FIELDS], filters: { id: cartId } }),
          service.listCheckoutCartAdds(
            { cart_id: cartId },
            { select: ["created_at"], order: { created_at: "DESC" }, take: 1 }
          ),
        ])
        const snapshot = data?.[0] as (CartActivity & { completed_at?: Date | string | null }) | undefined
        return snapshot && !snapshot.completed_at ? latestCartActivity(snapshot, lastAdd?.created_at) : null
      } catch {
        console.warn("[checkout-tracking] server activity unavailable for return check")
        return null // Keep the page beacon without confirming a return.
      }
    })
  } catch (error) {
    // A dropped beacon costs one row of analytics; it must never surface to a
    // shopper mid-checkout or turn into a retry storm from `sendBeacon`.
    console.warn(
      "[checkout-tracking] beacon dropped:",
      error instanceof Error ? error.message : error
    )
  }

  res.status(204).send()
}
