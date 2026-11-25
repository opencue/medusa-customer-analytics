import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CHECKOUT_TRACKING_MODULE } from "../modules/checkout_tracking"
import type CheckoutTrackingModuleService from "../modules/checkout_tracking/service"

export const recordCheckoutCartAdd = (
  req: MedusaRequest,
  res: MedusaResponse,
  next: () => void
): void => {
  const cartId = req.params.id
  // The native route responds only after the workflow succeeds. Register once
  // and write after the response so analytics cannot block the shopper.
  res.once("finish", async () => {
    if (!cartId || res.statusCode < 200 || res.statusCode >= 300) return
    try {
      const service = req.scope.resolve<CheckoutTrackingModuleService>(CHECKOUT_TRACKING_MODULE)
      await service.createCheckoutCartAdds({ cart_id: cartId })
    } catch {
      console.warn("[checkout-tracking] successful cart add was not recorded")
    }
  })
  next()
}
