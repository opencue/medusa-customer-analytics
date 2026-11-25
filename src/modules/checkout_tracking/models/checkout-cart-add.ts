import { model } from "@medusajs/framework/utils"

// An operation, not a click or item quantity. No customer, product or page
// data is copied; the cart reference is hard-deleted by the existing 72h job.
const CheckoutCartAdd = model.define("checkout_cart_add", {
  id: model.id().primaryKey(),
  cart_id: model.text(),
}).indexes([
  { name: "IDX_checkout_cart_add_created_at", on: ["created_at"] },
  { name: "IDX_checkout_cart_add_cart_id_created_at", on: ["cart_id", "created_at"] },
])

export default CheckoutCartAdd
