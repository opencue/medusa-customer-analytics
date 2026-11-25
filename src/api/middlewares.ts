import { defineMiddlewares } from "@medusajs/framework/http"
import { recordCheckoutCartAdd } from "./checkout-cart-activity"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/carts/:id/line-items",
      method: "POST",
      middlewares: [recordCheckoutCartAdd],
    },
  ],
})
