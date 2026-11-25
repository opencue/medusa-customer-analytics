# medusa-customer-analytics

**Checkout funnel analytics for Medusa v2.** Answers one question about your
storefront: **how far did each shopper get, and where did they stop?**

[![npm version](https://img.shields.io/npm/v/medusa-customer-analytics?color=cb3837&logo=npm)](https://www.npmjs.com/package/medusa-customer-analytics)
[![downloads](https://img.shields.io/npm/dm/medusa-customer-analytics?color=0b7285&label=downloads%2Fmonth)](https://www.npmjs.com/package/medusa-customer-analytics)
[![Medusa](https://img.shields.io/badge/Medusa-v2-8b5cf6)](https://docs.medusajs.com/)
[![license](https://img.shields.io/npm/l/medusa-customer-analytics?color=444)](./LICENSE)

`medusa-customer-analytics` is a **third-party, community-maintained,
open-source (MIT) plugin for [Medusa v2](https://medusajs.com)**. It adds a
checkout-funnel dashboard, an abandoned-cart product ranking, and win-back
promotion drafts to the Medusa Admin. It is **not an official Medusa product**
and is **not affiliated with, endorsed by, or maintained by Medusa** — see
[Relationship to Medusa](#relationship-to-medusa).

---

## Table of contents

- [What it does](#what-it-does)
- [Dashboard preview and example data](#dashboard-preview-and-example-data)
- [Facts at a glance](#facts-at-a-glance)
- [Why two observers](#why-two-observers)
- [Requirements](#requirements)
- [Install](#install)
- [Configuration](#configuration)
- [Connect your storefront](#connect-your-storefront)
- [API reference](#api-reference)
- [Scheduled job](#scheduled-job)
- [Privacy and data retention](#privacy-and-data-retention)
- [Security model](#security-model)
- [Limitations](#limitations)
- [Glossary](#glossary)
- [FAQ](#faq)
- [Development](#development)
- [Relationship to Medusa](#relationship-to-medusa)
- [License](#license)

---

## What it does

A shopper's progress through checkout is measured on a single seven-rung ladder:

```
cart → checkout_entered → address → delivery → payment → review → completed
```

From that ladder the plugin produces these views in the Medusa Admin:

| Output | What it answers |
|---|---|
| **Successful adds to cart** | How many successful Store API adds occurred, and in how many distinct carts; a later removal does not change these counts |
| **Funnel** | How many shoppers reached each rung, and how many abandoned there, excluding active checkouts |
| **Session table** | Where each shopper got to, plus active, abandoned, completed, or completed after a return |
| **Abandoned products** | Which products keep getting added to carts that never convert |
| **Checkout diagnostics** | Where to investigate, with the sample size and storefront observation coverage |
| **Win-back results** | Orders, discounts and order value for a promotion code, by currency |

An unfinished shopper is **active** until there has been 60 minutes without
recorded activity on any of their carts. A completed cart is classified as
**recovered** only if a beacon previously arrived after at least 60 minutes
without an observed beacon, cart change, or successful add. The plugin checks
cart and related line-item, shipping and payment timestamps at the time of the
beacon; it does not infer recovery from completion or old beacon-only markers.
This can miss returns without storefront observation or after journey data expires.
Recovery is a subset of completed checkouts and is not attributed to a promotion.

Recommendations count abandoned shoppers per product and currency and exclude
products with a recorded order for any of their variants in the same window.
Recommendations default to **investigate**. A pattern is marked high confidence
only if at least three abandoned shoppers had storefront observations, those
observations cover at least half the sample, and a strict majority of the
observed shoppers stopped in the same group of steps. Stopping early suggests
checking the product and possibly testing a discount; stopping at delivery
suggests checking shipping options and costs; stopping at payment suggests
checking payment friction. These are hypotheses, not causes. No products are
selected for a promotion automatically.

## Dashboard preview and example data

These screenshots show the real Medusa Admin in English with fictional demo data. No
customer records or live-shop metrics are shown.

### Checkout overview

![Checkout tracker with successful adds, distinct carts, checkout statuses and the seven-step funnel](docs/images/checkout-overview.webp)

The demo shows **68 successful adds across 41 distinct carts**: 4 active,
27 abandoned, and 10 completed, including 2 with an observed return. The funnel
counts shoppers rather than add events; active carts are not treated as abandonment.

### Product recommendations and win-back

![Abandoned-product recommendations by checkout step and promo-code results for EUR and HUF](docs/images/checkout-win-back.webp)

| Example | What to look for |
|---|---|
| **Commuter Backpack** | Different variants stalled at delivery. The recommendation groups the variants under one product and suggests checking shipping. |
| **Desk Mat** | Several EUR shoppers stopped at the address step, while HUF carts show a different pattern. Read recommendations per currency. |
| **Studio Lamp** | It appears in abandoned baskets, but a different variant sold. It is excluded from the never-sold recommendation list. |
| **`WELCOME-BACK`** | Five example orders used this promotion code. EUR and HUF amounts are reported separately, not added together. |

### Shopper sessions

![Example sessions with anonymous and email-identified shoppers, different checkout stages and multiple currencies](docs/images/checkout-sessions.webp)

The demo includes active, abandoned, completed, and completed-after-return
sessions, plus anonymous shoppers and carts without page-level observations.

---

## Facts at a glance

| | |
|---|---|
| **Package** | [`medusa-customer-analytics`](https://www.npmjs.com/package/medusa-customer-analytics) |
| **Type** | Third-party Medusa v2 plugin (not official) |
| **License** | MIT |
| **Medusa version** | 2.13.4 (peer dependency) |
| **Node** | >= 20 |
| **Module name** | `checkout_tracking` |
| **Database tables** | `checkout_journey` (one row per cart) and `checkout_cart_add` (one row per recorded successful add) |
| **Admin route** | `/app/checkout-tracker`, labelled "Checkout tracker" |
| **Admin API** | `GET /admin/checkout-tracking`, `GET` and `POST /admin/checkout-tracking/promotions` |
| **Store API** | `POST /store/checkout-tracking` (the beacon) |
| **Scheduled job** | `checkout-tracking-retention`, hourly at `:30` |
| **Retention** | 72 hours from `last_seen_at`, hard delete |
| **Plugin options** | None — the plugin reads no configuration |
| **Third-party services** | None. No external analytics vendor, no outbound requests |
| **New identifiers** | None. Keyed on the Medusa `cart_id` that already exists |
| **Tests** | Unit tests, no database required |

---

## Why two observers

Neither of the two things that can watch a checkout sees the whole ladder, so
the plugin reads both and keeps the furthest rung either one reached.

```mermaid
flowchart LR
  A["Cart row (server)<br/>every cart, durable"] -->|"address, delivery,<br/>payment, completed"| M{"furthest<br/>rung wins"}
  B["Storefront beacon (client)<br/>72h, consent-gated"] -->|"all 7 rungs, incl.<br/>checkout_entered, review"| M
  M --> F["One funnel,<br/>complete for every cart"]
```

| | sees | misses | coverage |
|---|---|---|---|
| **Cart row** (server) | address, delivery, payment, completed — each writes to the cart | `checkout_entered` and `review`: opening a page writes nothing | every cart |
| **Storefront beacon** (client) | every rung, including the two page-only ones | — | consent-gated, so biased low on its own |

A server-only visitor still lands on the ladder, just without the two page-only
rungs. That is why the funnel is complete for every cart while the page-level
detail is opt-in. Each session reports which observers saw it via
`observed_by: "cart" | "storefront" | "both"`.

The ladder is cumulative: a session that reached `payment` counts as reached at
`cart`, `checkout_entered`, `address`, `delivery` *and* `payment`. Without that,
a server-only session would punch a hole in `checkout_entered` — nobody pays
without opening checkout.

---

## Requirements

- A [Medusa v2](https://docs.medusajs.com/learn) application on **2.13.4**
- **Node.js 20+**
- **PostgreSQL** (the plugin adds one table)
- A [publishable API key](https://docs.medusajs.com/resources/commerce-modules/sales-channel/publishable-api-keys)
  for your storefront — required by every `/store` route, including the beacon

---

## Install

### 1. Install the package

```bash
npm install medusa-customer-analytics
# or
pnpm add medusa-customer-analytics
# or
yarn add medusa-customer-analytics
```

### 2. Register it in `medusa-config.ts`

```ts
module.exports = defineConfig({
  plugins: [
    {
      resolve: "medusa-customer-analytics",
      options: {},
    },
  ],
})
```

The plugin reads no options today; `options: {}` is the shape Medusa expects.
The shorthand `plugins: ["medusa-customer-analytics"]` works too — see
[Medusa's plugin configuration docs](https://docs.medusajs.com/learn/configurations/medusa-config).

### 3. Run the migration

The migration **ships with the plugin** — you do not generate it. In your Medusa
application:

```bash
npx medusa db:migrate
```

That creates the `checkout_journey` table with its two indexes. See
[`db:migrate`](https://docs.medusajs.com/resources/medusa-cli/commands/db).

> `npx medusa plugin:db:generate` is the *plugin author's* command, run inside
> this repository after a data-model change. It is not part of installing the
> plugin.

### 4. Open the dashboard

Start Medusa and go to **`/app/checkout-tracker`** in the Admin — "Checkout
tracker" in the sidebar, funnel icon.

The funnel populates from cart data immediately, with no storefront changes.
[Wiring the beacon](#connect-your-storefront) adds the two page-only rungs plus
device, locale, and exit-path detail.

The tracker and its sidebar label follow the [Medusa Admin language setting](https://docs.medusajs.com/user-guide/tips/languages).
The plugin ships translations for all 35 Admin languages in Medusa v2.23.0
(including all languages in v2.13.4) and for Admins that expose Slovak.
Unavailable translations fall back to English.
Changing the Admin language does not change the storefront language or the
currency of stored amounts.

If pnpm cannot resolve the translation hook or the tracker shows translation
keys, add `react-i18next` and `i18next` to your Medusa app at the same
versions used by its `@medusajs/dashboard`. The plugin must share the Admin's
translation instance (for example, `13.5.0` and `23.7.11` in Medusa v2.13.4;
`18.0.1` and `27.1.1` in v2.23.0).

---

## Configuration

| Env | Default | What it does |
|---|---|---|
| `CHECKOUT_TRACKING_REPEAT_WINDOW_MINUTES` | `15` | How long after one anonymous cart an identical one still reads as the same shopper retrying. |

Carts are grouped into visitors on two levels of evidence. A customer id, or an
email typed into checkout, is certain and groups the carts regardless of how far
apart they are. Two **anonymous** carts holding the same items, from the same
device and locale, are merged only if they fall inside this window.

The right value is a property of your catalogue, not of this code. A phone
accessory is re-added within a minute; a truck tyre is reconsidered an hour
later. Set it too wide and two different shoppers who both picked your most
popular item fold into one "visitor"; too narrow and one shopper's retries
inflate the abandoned count and the lost value, and divide your conversion rate
by the duplicates.

Start at the default and read the session list. If the same basket keeps
appearing as separate rows minutes or hours apart, widen it. The row shows why
each merge happened, so a merge you disagree with is visible rather than
silent.

Anything that is not a positive number is ignored and the default applies — a
typo cannot switch grouping off by accident.

---

## Connect your storefront

Post a beacon whenever the shopper reaches a checkout step. Gate it behind your
analytics consent — the funnel stays complete without it.

```ts
const trackCheckout = (cartId: string, stage: string) =>
  fetch(`${BACKEND_URL}/store/checkout-tracking`, {
    method: "POST",
    // Survives the page unload the way navigator.sendBeacon does, but unlike
    // sendBeacon it can carry the publishable-key header /store/* requires.
    keepalive: true,
    headers: {
      "content-type": "application/json",
      "x-publishable-api-key": PUBLISHABLE_KEY,
    },
    body: JSON.stringify({
      cart_id: cartId,
      stage,
      path: location.pathname,
      locale: "en",
      device: window.innerWidth < 768 ? "mobile" : "desktop",
    }),
  }).catch(() => {})
```

> **Do not use `navigator.sendBeacon` here.** It cannot set request headers, and
> every Medusa `/store` route requires `x-publishable-api-key`. `fetch` with
> `keepalive: true` gives you the same survives-unload behaviour *and* the header.

Which stages to send, and when:

| Stage | Send when |
|---|---|
| `cart` | An item is added to the cart |
| `checkout_entered` | The `/checkout` page mounts — **only the beacon can see this** |
| `address` | The address step is submitted |
| `delivery` | A shipping method is chosen |
| `payment` | A payment method is chosen |
| `review` | The final review step mounts — **only the beacon can see this** |
| `completed` | Order placed |

Sending only `checkout_entered` and `review` is a perfectly good minimal
integration: the cart row already proves the other five. Beacons arrive out of
order and refire on tab restore — the plugin keeps the furthest rung regardless,
so duplicates and late arrivals are harmless.

---

## API reference

### `GET /admin/checkout-tracking`

Everything the dashboard shows, in one authenticated call.

**Query parameters**

| Name | Type | Default | Notes |
|---|---|---|---|
| `days` | integer | `7` | Clamped to `1`–`90`. Unparseable values fall back to the default |

**Response**

```jsonc
{
  "range":   { "days": 7, "since": "2026-…Z", "now": "2026-…Z" },
  "abandonment_minutes": 60,
  "funnel":  [{ "stage": "cart", "reached": 0, "dropped": 0, "drop_rate": 0, "reach_rate": 0 }],
  "totals":  {
    "tracked": 0, "completed": 0, "active": 0, "abandoned": 0, "recovered": 0,
    "conversion_rate": 0, "lost_value": 0, "converted_value": 0,
    "currency": "eur", "by_currency": [],
    "with_storefront_data": 0    // sessions the beacon also saw
  },
  "visitors": [], // grouped shoppers, each with a status, lead cart and all grouped carts
  "sessions": [{
    "cart_id": "cart_…", "email": null, "customer_id": null,
    "stage": "payment", "observed_by": "both",
    "items": [{ "title": "…", "sku": null, "thumbnail": null,
                "quantity": 1, "unit_price": 0, "is_gift": false }],
    "item_count": 1, "total": 0, "currency_code": "eur",
    "created_at": null, "updated_at": null, "completed_at": null,
    "last_seen_at": null, "last_path": null,
    "device": null, "locale": null,
    "stage_at": { "cart": "2026-…Z" }   // first time each rung was reached
  }],
  "abandoned_products": [{ "key": "…", "title": "…", "sku": null,
                           "thumbnail": null, "carts": 0, "units": 0, "value": 0, "currency": "eur" }],
  "exit_paths":      [{ "path": "/checkout", "count": 0 }],
  "sale_candidates": [{
    "key": "…", "title": "…", "sku": null, "thumbnail": null,
    "product_id": "prod_…", "abandoned_carts": 0, "units": 0,
    "stranded_value": 0, "currency": "eur", "sold_units": 0,
    "stage_mix": [{ "stage": "delivery", "carts": 0 }],
    "action": "investigate", "action_confidence": "low",
    "observed_sessions": 0, "observed_coverage": 0
  }],
  "scan": { "carts": 0, "cap": 2000, "capped": false, "orders_capped": false }
}
```

Sessions are newest-first. `abandoned_products` is capped at 10, `exit_paths` at
8, `sale_candidates` at 12. Product values are separated by currency. Use
`totals.by_currency` for `{currency, lost_value, converted_value}` rows; the
legacy scalar amounts and currency are `null` in a multi-currency window.
Checkout totals use one lead cart per shopper. Product rankings include all
distinct products from that shopper's abandoned carts, counted once per currency.

**About the scan flags.** The report uses at most 2,000 carts and 2,000 orders,
newest first. `capped` and `orders_capped` flag truncated cart and order windows
respectively. Recommendations are omitted if either scan is incomplete.

### `GET /admin/checkout-tracking/promotions?code=AKCIA-…&days=7`

Looks up an exact promotion code in the selected order creation window. The Admin
fills in the code when it creates a draft; you can also look up an existing code.
Counts each non-canceled, non-draft order with a positive matching adjustment
once. Only the selected code's item and shipping adjustments contribute to
`discount_value`; stacked promotions are not included in that amount.

Returns `{ code, orders, by_currency, scan }`. Currency rows carry
`currency`, `orders`, `discount_value` and `order_value_ex_tax`. Order value is
the Medusa order total minus tax, after discounts and before refunds; it is not
cash collected, incremental revenue, or a claim about what would have happened
without the promotion. When `scan.capped` is true, results cover only the newest
2,000 orders; use a shorter window.

### `POST /admin/checkout-tracking/promotions`

Creates a percentage promotion targeting the products the tracker flagged.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `product_ids` | `string[]` | yes | Deduplicated, capped at 50. Empty → `400` |
| `percentage` | number | yes | `1`–`90`. Out of range is **refused, not clamped** |
| `code` | string | no | Uppercased, max 40 chars. Defaults to a random `AKCIA-` code |
| `currency_code` | string | no | Defaults to `eur` |

**The promotion is always created as a `draft`, never active**, and never
automatic. This endpoint spends real money from a dashboard whose whole job is
to make a problem feel urgent — a draft costs nothing to discard, while an
active discount cannot be un-granted from the orders it already applied to. You
review it and flip it live in Medusa's own
[Promotions](https://docs.medusajs.com/resources/commerce-modules/promotion)
screen.

Responds `201` with
`{ promotion, created: { code, percentage, product_count, status: "draft" } }`.

### `POST /store/checkout-tracking`

The storefront beacon. Requires `x-publishable-api-key`, like every Medusa
`/store` route.

**Body:** `{ cart_id, stage, path?, locale?, device? }`

**Always responds `204` with no body** — including for a malformed cart id, an
unknown stage, a cart that does not exist, and an internal error. There is
nothing for a beacon to read, and a differentiated response would let a caller
probe which cart ids exist.

---

## Scheduled job

| Name | Schedule | Does |
|---|---|---|
| `checkout-tracking-retention` | `30 * * * *` (hourly, on the half hour) | Hard-deletes journeys whose last beacon and add events whose timestamp are older than 72 hours |

It runs on the half hour so it interleaves with typical abandoned-cart reminder
jobs (top of the hour) rather than competing for the same connection pool while
the storefront is being served. A failed sweep is logged, not rethrown, so it
retries next hour instead of marking the
[scheduled job](https://docs.medusajs.com/learn/fundamentals/scheduled-jobs)
permanently failed.

---

## Privacy and data retention

- **No new identifier.** The `checkout_journey` table is keyed on `cart_id` and
  nothing else. The cart id already exists in your storefront's storage for the
  shop to function, so tracking introduces no extra cookie and no cross-visit
  profile. A returning shopper on a fresh cart is simply a fresh journey — which
  is also the honest reading of "abandoned *this* checkout".
- **No duplication of cart data.** Address, delivery, payment and completion are
  derived at read time from the cart. They are never copied into this table.
- **Server-side adds.** A successful `POST /store/carts/:id/line-items` records
  one add, regardless of quantity, with only the existing cart ID and timestamps.
  Failed responses, quantity edits, removals and internal workflows do not count.
  The card is independent of the funnel and reports adds recorded since deployment
  in the selected period, capped at 72 hours. There is no historical backfill.
- **72-hour hard delete**, enforced hourly — not a soft delete, because a
  soft-deleted row still links a cart (and therefore an e-mail) to a browsing
  trail.
- **Nothing leaves your server.** No third-party analytics vendor, no outbound
  request, no pixel.
- **Consent-gated by you.** The beacon only fires if your storefront calls it.
  Gate it behind your analytics consent; the funnel remains complete without it,
  and the Admin marks missing page activity as "No page data" rather than leaving a blank that
  could be misread as a shopper who did nothing.

---

## Security model

### The beacon refuses to be lied to

The store endpoint accepts only the page-level half of a journey. Anything the
cart row can prove on its own is derived at read time and is **not** accepted
over HTTP, so a forged beacon cannot claim an order was placed or an address
filled — the reader takes the furthest of (cart-derived, beacon), and the cart
always wins on the rungs it can see.

Writes are bounded by cart existence: a beacon naming an id that is not a real
cart is dropped before it reaches the module, so a public endpoint cannot be
used to grow the table. Cart ids are shape-checked (`cart_` + ULID) before any
query, so obvious junk costs nothing. Responses never differ, so a caller cannot
probe which cart ids exist.

Concurrent beacons for the same cart are safe: the unique index on `cart_id`
rejects the loser of a double-insert race, and the write is retried through the
update path rather than silently dropping that stage.

---

## Limitations

Known and deliberate, listed so you can decide before installing:

- **2000-cart scan cap per request**, with no paging. Very high-volume shops will
  see `scan.capped: true` on long windows; the response says so rather than
  pretending otherwise.
- **The cart date window is applied in JavaScript, not SQL.** Medusa's `query.graph`
  silently ignores a `created_at` filter on `cart`, so filtering server-side
  would quietly build a "last 7 days" funnel from years of traffic. Rows are
  fetched newest-first and windowed in memory instead.
- **Retention is fixed at 72 hours** and is not configurable.
- **The plugin accepts no options.**
- **`GET /admin/checkout-tracking` is a single unpaginated call** — sized for a
  dashboard read, not for bulk export.

---

## Glossary

| Term | Meaning |
|---|---|
| **Rung / stage** | One of the seven ordered checkout steps, from `cart` to `completed` |
| **Journey** | One shopper's page-level trail through checkout — one row per cart |
| **Session** | One tracked cart in the dashboard, cart-derived and beacon data merged |
| **Beacon** | The `POST /store/checkout-tracking` call your storefront makes |
| **`observed_by`** | Which observers saw a session: `cart`, `storefront`, or `both` |
| **`reached`** | Sessions that got *at least* this far (cumulative, non-increasing) |
| **`dropped`** | Sessions whose journey ended *exactly* here. On `completed` this is conversions, not losses |
| **`stranded_value`** | Value of a product's lines across the abandoned carts it sat in |
| **Sale candidate** | A product repeatedly added to carts that never converted, with zero units sold in the window |

---

## FAQ

**Is this an official Medusa plugin?**
No. `medusa-customer-analytics` is a third-party, community-maintained plugin.
It is not affiliated with or endorsed by Medusa.

**Does it work without any storefront changes?**
Yes. The funnel is built for every cart from cart data alone. Wiring the beacon
adds the two page-only rungs (`checkout_entered`, `review`) plus device, locale
and exit-path detail.

**Does it send data to a third party?**
No. Everything stays in your Medusa database. There is no external analytics
vendor and no outbound request.

**Do I need to generate a migration?**
No. The migration ships with the plugin. Run `npx medusa db:migrate` in your
Medusa application.

**Why can't I use `navigator.sendBeacon`?**
It cannot set request headers, and every Medusa `/store` route requires
`x-publishable-api-key`. Use `fetch` with `keepalive: true` instead — same
survives-unload behaviour, and it can carry the header.

**Can someone fake a conversion by posting to the store endpoint?**
No. The endpoint only records page-level stages; `address`, `delivery`,
`payment` and `completed` are derived from the cart at read time, and the cart
always wins on those rungs.

**Why is my data disappearing after three days?**
That is the retention job. Page-level journey rows are hard-deleted 72 hours
after `last_seen_at`. Cart-derived funnel data is not affected — it lives on your
carts.

**Does it create discounts automatically?**
No. Promotions are created as **drafts** and are never automatic. You review and
activate them in Medusa's Promotions screen.

**Is it GDPR-friendly?**
It introduces no new identifier, stores no cross-visit profile, keeps page-level
data for 72 hours, and sends nothing off your server. Consent gating is your
storefront's responsibility — the plugin only records what you send it.

**Which Medusa version does it support?**
Medusa v2, pinned to `2.13.4` as a peer dependency.

---

## Development

```bash
pnpm install --ignore-workspace   # a parent workspace lockfile would be picked up otherwise
pnpm build                        # medusa plugin:build
pnpm test                         # unit tests, no database needed
```

The funnel ladder, journey merge, dashboard aggregation, and candidate scoring
are all pure functions under `src/modules/checkout_tracking/lib/`, which is why
the unit tests run without a database.

To check promotion totals against Medusa, use a **disposable local Medusa app**
with this plugin built, installed and migrated. Set a fresh
`MEDUSA_ANALYTICS_TEST_CODE` (for example `ANALYTICS-TEST-LOCAL1`) and run
`medusa exec /absolute/path/to/test/fixtures/seed-promotion-report.cjs` in that
app. Then run `node --test test/promotion-report.integration.test.cjs` in this
repo with the same code, `MEDUSA_ANALYTICS_TEST_URL` set to the local app URL and
`MEDUSA_ANALYTICS_TEST_TOKEN` set to a local admin bearer token. Do not run the
seed against a shared or production database.

```
src/
├── admin/routes/checkout-tracker/   Admin UI route → /app/checkout-tracker
├── api/
│   ├── admin/checkout-tracking/     Dashboard payload + promotion drafts
│   └── store/checkout-tracking/     The beacon
├── jobs/                            checkout-tracking-retention
└── modules/checkout_tracking/
    ├── lib/                         stages · journey · dashboard · sale-candidates (pure)
    ├── models/                      checkout_journey
    ├── migrations/
    └── service.ts
```

After changing a data model, regenerate the migration from **inside this repo**
(not the consuming app) with `npx medusa plugin:db:generate`, then commit it.

Issues and pull requests:
[github.com/opencue/medusa-customer-analytics](https://github.com/opencue/medusa-customer-analytics).

---

## Relationship to Medusa

[Medusa](https://medusajs.com) is an open-source commerce platform. This package
is an independent, third-party plugin built on Medusa's public extension points —
it does not patch or fork Medusa core.

| Resource | Link |
|---|---|
| Medusa website | [medusajs.com](https://medusajs.com) |
| Medusa documentation | [docs.medusajs.com](https://docs.medusajs.com) |
| Medusa on GitHub | [github.com/medusajs/medusa](https://github.com/medusajs/medusa) |
| Building Medusa plugins | [docs.medusajs.com/learn/fundamentals/plugins](https://docs.medusajs.com/learn/fundamentals/plugins) |
| Medusa modules | [docs.medusajs.com/learn/fundamentals/modules](https://docs.medusajs.com/learn/fundamentals/modules) |
| Admin UI routes | [docs.medusajs.com/learn/fundamentals/admin/ui-routes](https://docs.medusajs.com/learn/fundamentals/admin/ui-routes) |
| Scheduled jobs | [docs.medusajs.com/learn/fundamentals/scheduled-jobs](https://docs.medusajs.com/learn/fundamentals/scheduled-jobs) |
| Publishable API keys | [docs.medusajs.com/resources/commerce-modules/sales-channel/publishable-api-keys](https://docs.medusajs.com/resources/commerce-modules/sales-channel/publishable-api-keys) |
| Medusa CLI `db` commands | [docs.medusajs.com/resources/medusa-cli/commands/db](https://docs.medusajs.com/resources/medusa-cli/commands/db) |

"Medusa" is a trademark of its respective owner. This project is not affiliated
with, endorsed by, or sponsored by Medusa.

---

## License

[MIT](./LICENSE) © 2026 [Webu](https://webu.sk)
