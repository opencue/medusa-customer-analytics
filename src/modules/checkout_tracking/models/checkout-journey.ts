import { model } from "@medusajs/framework/utils"

/**
 * The page-level half of one shopper's checkout journey.
 *
 * Deliberately keyed on `cart_id` and nothing else. The cart id already exists
 * in the storefront's storage for the shop to function, so tracking introduces
 * NO new identifier, no extra cookie, and no cross-visit profile — a returning
 * shopper on a fresh cart is simply a fresh journey, which is also the honest
 * reading of "abandoned this checkout". Everything the cart row can already
 * prove (address / delivery / payment / completed) is derived at read time and
 * is NOT duplicated here; this table only holds what a cart cannot say:
 * which pages were opened, in what order, from what device, and when the
 * shopper was last seen.
 *
 * Retention: 72h from `last_seen_at`, enforced by the
 * `checkout-tracking-retention` job. That matches the window the published
 * privacy document already declares for abandoned-cart data — this table must
 * not outlive it.
 *
 * `stage` is plain text, not a DB enum, on purpose: the ladder is defined once
 * in `../lib/stages` and validated at the service boundary. A Postgres enum
 * would be a second source of truth that needs a migration every time a
 * checkout step is added.
 */
const CheckoutJourney = model
  .define("checkout_journey", {
    id: model.id().primaryKey(),
    /** Medusa cart id — the journey's only identity. */
    cart_id: model.text(),
    /** Furthest rung the STOREFRONT observed. See lib/stages FUNNEL_STAGES. */
    stage: model.text().default("cart"),
    /** "sk" | "hu" — which locale the shopper checked out in. */
    locale: model.text().nullable(),
    /** "mobile" | "tablet" | "desktop", from the storefront viewport. */
    device: model.text().nullable(),
    /** Route path of the last page seen — the "where did they leave" answer. */
    last_path: model.text().nullable(),
    /** { [stage]: ISO } — first time each rung was reached, for step timings. */
    stage_at: model.json().nullable(),
    first_seen_at: model.dateTime(),
    last_seen_at: model.dateTime(),
  })
  .indexes([
    // One journey per cart. Conditional on deleted_at so a purged cart's id
    // can be reused, matching the lead/translations modules' pattern.
    {
      name: "IDX_checkout_journey_cart_id_unique",
      on: ["cart_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    // The retention sweep filters on this every run.
    {
      name: "IDX_checkout_journey_last_seen_at",
      on: ["last_seen_at"],
    },
  ])

export default CheckoutJourney
