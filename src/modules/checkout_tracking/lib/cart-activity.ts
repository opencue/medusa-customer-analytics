type Dated = { updated_at?: Date | string | null }
export type CartActivity = Dated & {
  items?: Dated[] | null
  shipping_methods?: Dated[] | null
  payment_collection?: (Dated & { payment_sessions?: Dated[] | null }) | null
}

export const CART_ACTIVITY_FIELDS = [
  "updated_at",
  "items.updated_at",
  "shipping_methods.updated_at",
  "payment_collection.updated_at",
  "payment_collection.payment_sessions.updated_at",
]

/** In Medusa v2, a child can change without updating the parent cart. */
export const latestCartActivity = (cart: CartActivity, lastAdd?: Date | string): Date | null => {
  let latest = -Infinity
  for (const value of [
    cart.updated_at,
    ...cart.items?.map((item) => item.updated_at) ?? [],
    ...cart.shipping_methods?.map((method) => method.updated_at) ?? [],
    cart.payment_collection?.updated_at,
    ...cart.payment_collection?.payment_sessions?.map((session) => session.updated_at) ?? [],
    lastAdd,
  ]) {
    if (!value) continue
    const at = new Date(value).getTime()
    if (Number.isFinite(at)) latest = Math.max(latest, at)
  }
  return Number.isFinite(latest) ? new Date(latest) : null
}
