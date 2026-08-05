# medusa-customer-analytics

Answers one question about your storefront: **how far did each shopper get, and
where did they stop?**

A shopper's progress is measured on a single seven-rung ladder:

```
cart → checkout_entered → address → delivery → payment → review → completed
```

## Why two observers

Neither of the two things that can watch a checkout sees the whole ladder, so
the plugin reads both and keeps the furthest rung either one reached.

| | sees | misses | coverage |
|---|---|---|---|
| **Cart row** (server) | address, delivery, payment, completed — each writes to the cart | `checkout_entered` and `review`: opening a page writes nothing | every cart |
| **Storefront beacon** (client) | every rung, including the two page-only ones | — | consent-gated, so biased low on its own |

A server-only visitor still lands on the ladder, just without the two page-only
rungs. That is why the funnel is complete for every cart while the page-level
detail is opt-in.

## Install

```bash
npm install medusa-customer-analytics
```

Register it in `medusa-config.ts`:

```ts
module.exports = defineConfig({
  plugins: ["medusa-customer-analytics"],
})
```

Then generate and run the module's migration:

```bash
npx medusa db:generate checkout_tracking
npx medusa db:migrate
```

## What you get

- **Admin page** — funnel by stage, session table, and win-back candidates,
  under the dashboard's route for this plugin.
- **`GET /admin/checkout-tracking`** — the dashboard payload: stage counts,
  sessions, and sale candidates for a date range.
- **`POST /admin/checkout-tracking/promotions`** — act on a win-back candidate.
- **`POST /store/checkout-tracking`** — the storefront beacon. Takes
  `{ cart_id, stage, path, locale, device }` and always answers `204`.
- **Retention job** — `checkout-tracking-retention`, hourly at `:30`, drops
  journeys past the retention window.

### The beacon refuses to be lied to

The store endpoint accepts only the page-level half of a journey. Anything the
cart row can prove on its own is derived at read time and is **not** accepted
over HTTP, so a forged beacon cannot claim an order was placed or an address
filled — the reader takes the furthest of (cart-derived, beacon), and the cart
always wins on the rungs it can see.

Writes are bounded by cart existence: a beacon naming an id that is not a real
cart is dropped before it reaches the module, so a public endpoint cannot be
used to grow the table. Responses never differ, so a caller cannot probe which
cart ids exist.

## Storefront wiring

Post a beacon whenever the shopper reaches a checkout step:

```ts
navigator.sendBeacon(
  `${BACKEND_URL}/store/checkout-tracking`,
  new Blob(
    [JSON.stringify({ cart_id: cart.id, stage: "checkout_entered", path: location.pathname })],
    { type: "application/json" }
  )
)
```

Gate it behind your analytics consent — the funnel stays complete without it.

## Development

```bash
pnpm install --ignore-workspace   # a parent workspace lockfile would be picked up otherwise
pnpm build                        # medusa plugin:build
pnpm test                         # 73 unit tests, no database needed
```

The funnel ladder, journey merge, dashboard aggregation, and candidate scoring
are all pure functions under `src/modules/checkout_tracking/lib/`, which is why
the test suite runs without a database.

## License

MIT
