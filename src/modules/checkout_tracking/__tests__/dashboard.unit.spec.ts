import { buildDashboard, type CartRow } from "../lib/dashboard"
import type { JourneyRow } from "../lib/journey"

const cart = (over: Partial<CartRow> & { id: string }): CartRow => ({
  email: null,
  currency_code: "eur",
  total: 100,
  created_at: "2026-08-03T10:00:00.000Z",
  updated_at: "2026-08-03T10:05:00.000Z",
  items: [
    {
      id: "li_1",
      product_title: "Činka 20kg",
      variant_sku: "CINKA-20",
      quantity: 1,
      unit_price: 100,
    },
  ],
  ...over,
})

const journey = (over: Partial<JourneyRow> & { cart_id: string }): JourneyRow => ({
  id: `cj_${over.cart_id}`,
  stage: "checkout_entered",
  locale: "sk",
  device: "mobile",
  last_path: "/sk/checkout",
  stage_at: null,
  first_seen_at: "2026-08-03T10:00:00.000Z",
  last_seen_at: "2026-08-03T10:04:00.000Z",
  ...over,
})

describe("buildDashboard — merging the two observers", () => {
  it("keeps a shopper with no beacon on the funnel", () => {
    // The point of the hybrid: a visitor who refused analytics consent still
    // shows up, measured by the cart alone.
    const out = buildDashboard({
      carts: [cart({ id: "cart_1", shipping_methods: [{ id: "sm_1" }] })],
      journeys: [],
    })

    expect(out.sessions).toHaveLength(1)
    expect(out.sessions[0].stage).toBe("delivery")
    expect(out.sessions[0].observed_by).toBe("cart")
    expect(out.totals.with_storefront_data).toBe(0)
  })

  it("lets the beacon supply a rung the cart cannot prove", () => {
    const out = buildDashboard({
      carts: [cart({ id: "cart_1" })],
      journeys: [journey({ cart_id: "cart_1", stage: "review" })],
    })

    expect(out.sessions[0].stage).toBe("review")
    expect(out.sessions[0].observed_by).toBe("both")
    expect(out.totals.with_storefront_data).toBe(1)
  })

  it("does not let a forged beacon outrank the cart backwards", () => {
    // A beacon claiming "cart" for someone who already paid must not demote
    // them; the merge takes the furthest rung, so the cart wins.
    const out = buildDashboard({
      carts: [
        cart({
          id: "cart_1",
          payment_collection: { payment_sessions: [{ id: "ps_1" }] },
        }),
      ],
      journeys: [journey({ cart_id: "cart_1", stage: "cart" })],
    })

    expect(out.sessions[0].stage).toBe("payment")
  })

  it("skips empty carts entirely", () => {
    const out = buildDashboard({
      carts: [cart({ id: "cart_1", items: [] }), cart({ id: "cart_2" })],
      journeys: [],
    })

    expect(out.sessions.map((s) => s.cart_id)).toEqual(["cart_2"])
    expect(out.totals.tracked).toBe(1)
  })

  it("does not count an empty cart's exit beacon as an add-to-cart", () => {
    const out = buildDashboard({
      carts: [cart({ id: "empty", items: [] }), cart({ id: "emptied_after_review", items: [] })],
      journeys: [
        journey({ cart_id: "empty", stage: "cart" }),
        journey({ cart_id: "emptied_after_review", stage: "review" }),
      ],
    })
    expect(out.sessions.map((s) => s.cart_id)).toEqual(["emptied_after_review"])
    expect(out.funnel[0]).toMatchObject({ stage: "cart", reached: 1 })
  })
})

describe("buildDashboard — totals", () => {
  it("excludes active carts from abandonment and keeps currencies separate", () => {
    const out = buildDashboard({
      now: new Date("2026-08-03T12:00:00Z"),
      carts: [
        cart({ id: "old-eur" }),
        cart({ id: "old-huf", currency_code: "huf", total: 12000 }),
        cart({ id: "in-progress" }),
      ],
      journeys: [journey({ cart_id: "in-progress", last_seen_at: "2026-08-03T11:55:00Z" })],
    })

    expect(out.totals).toMatchObject({ active: 1, abandoned: 2, lost_value: null })
    expect(out.totals.by_currency).toEqual([
      { currency: "eur", lost_value: 100, converted_value: 0 },
      { currency: "huf", lost_value: 12000, converted_value: 0 },
    ])
    expect(out.funnel.find((row) => row.stage === "checkout_entered")?.dropped).toBe(0)
    expect(out.abandoned_products.map((row) => row.currency)).toEqual(["eur", "huf"])
  })

  it("does not infer a return from an old beacon and a later completion", () => {
    const out = buildDashboard({
      now: new Date("2026-08-03T12:00:00Z"),
      carts: [
        cart({ id: "recovered", updated_at: "2026-08-03T11:35:00Z",
          completed_at: "2026-08-03T11:35:00Z" }),
        cart({ id: "normal", completed_at: "2026-08-03T10:10:00Z" }),
      ],
      journeys: [journey({ cart_id: "recovered", last_seen_at: "2026-08-03T10:11:00Z" })],
    })
    expect(out.totals).toMatchObject({ completed: 2, recovered: 0, abandoned: 0 })
    expect(out.visitors.find((v) => v.lead.cart_id === "recovered")?.status).toBe("completed")
  })

  it("recognizes a quiet period even if the shopper is active again before paying", () => {
    const out = buildDashboard({
      now: new Date("2026-08-03T12:30:00Z"),
      carts: [cart({
        id: "returned",
        updated_at: "2026-08-03T12:05:00Z",
        completed_at: "2026-08-03T12:05:00Z",
      })],
      journeys: [journey({
        cart_id: "returned",
        last_seen_at: "2026-08-03T12:00:00Z",
        confirmed_returned_at: "2026-08-03T11:50:00Z",
      })],
    })
    expect(out.visitors[0].status).toBe("recovered")
  })

  it("does not infer a quiet period from first-stage timestamps", () => {
    const out = buildDashboard({
      carts: [cart({
        id: "continuous",
        updated_at: "2026-08-03T12:05:00Z",
        completed_at: "2026-08-03T12:05:00Z",
      })],
      journeys: [journey({
        cart_id: "continuous",
        last_seen_at: "2026-08-03T12:00:00Z",
        stage_at: { checkout_entered: "2026-08-03T10:00:00Z" },
      })],
    })
    expect(out.visitors[0].status).toBe("completed")
  })

  it("does not merge different SKU-less products with the same title", () => {
    const out = buildDashboard({
      now: new Date("2026-08-03T12:00:00Z"),
      carts: ["prod_first", "prod_second"].map((id, i) => cart({
        id,
        email: "shopper@example.test",
        items: [{ product_id: id, product_title: "Same name", quantity: 1, unit_price: 20 + i }],
      })),
      journeys: [],
    })
    expect(out.totals.abandoned).toBe(1)
    expect(out.abandoned_products.map((p) => [p.carts, p.value])).toEqual([[1, 21], [1, 20]])
    expect(new Set(out.abandoned_products.map((p) => p.key)).size).toBe(2)
  })

  it("keeps distinct products across one shopper's inactive baskets", () => {
    const base = cart({ id: "old", email: "shopper@example.test" })
    const out = buildDashboard({
      now: new Date("2026-08-03T12:00:00Z"),
      carts: [
        { ...base, items: [...(base.items ?? []), { title: "Other", variant_sku: "OTHER", quantity: 1, unit_price: 20 }] },
        cart({ id: "new", email: base.email, updated_at: "2026-08-03T10:10:00Z" }),
      ],
      journeys: [],
    })
    expect(out.totals.abandoned).toBe(1)
    expect(out.abandoned_products.map((row) => [row.sku, row.carts, row.value])).toEqual([
      ["CINKA-20", 1, 100], ["OTHER", 1, 20],
    ])
  })

  const mixed = () =>
    buildDashboard({
      carts: [
        cart({ id: "cart_1", total: 100, email: "a@x.sk" }),
        cart({
          id: "cart_2",
          total: 250,
          email: "b@x.sk",
          shipping_methods: [{ id: "sm" }],
        }),
        cart({
          id: "cart_3",
          total: 400,
          email: "c@x.sk",
          completed_at: "2026-08-03T10:10:00.000Z",
        }),
      ],
      journeys: [],
    })

  it("counts a shopper once however many carts they left behind", () => {
    // Same email, three carts. Counting carts made this one person look like
    // three abandonments worth 3x the money, and divided the conversion rate
    // by three.
    const out = buildDashboard({
      carts: [
        cart({ id: "cart_1", email: "anna@x.sk", total: 100 }),
        cart({ id: "cart_2", email: "anna@x.sk", total: 100 }),
        cart({
          id: "cart_3",
          email: "anna@x.sk",
          total: 100,
          shipping_methods: [{ id: "sm" }],
        }),
      ],
      journeys: [],
    })

    expect(out.totals.tracked).toBe(1)
    expect(out.totals.abandoned).toBe(1)
    expect(out.totals.lost_value).toBe(100)
    expect(out.totals.duplicate_carts).toBe(2)
    expect(out.visitors).toHaveLength(1)
    // The cart that got furthest leads, so the operator calls about that one.
    expect(out.visitors[0].lead.cart_id).toBe("cart_3")
    expect(out.visitors[0].cart_count).toBe(3)
    // Every cart is still there to audit the merge.
    expect(out.sessions).toHaveLength(3)
  })

  it("does not count one product twice because a shopper re-added it", () => {
    const out = buildDashboard({
      carts: [
        cart({ id: "cart_1", email: "anna@x.sk" }),
        cart({ id: "cart_2", email: "anna@x.sk" }),
      ],
      journeys: [],
    })

    expect(out.abandoned_products).toHaveLength(1)
    expect(out.abandoned_products[0].carts).toBe(1)
  })

  it("an order anywhere in the group makes the shopper converted", () => {
    const out = buildDashboard({
      carts: [
        cart({ id: "cart_1", email: "anna@x.sk", total: 100 }),
        cart({
          id: "cart_2",
          email: "anna@x.sk",
          total: 400,
          completed_at: "2026-08-03T10:10:00.000Z",
        }),
      ],
      journeys: [],
    })

    expect(out.totals.completed).toBe(1)
    expect(out.totals.abandoned).toBe(0)
    expect(out.totals.lost_value).toBe(0)
    expect(out.totals.converted_value).toBe(400)
    expect(out.totals.conversion_rate).toBe(1)
  })

  it("splits converted from lost value", () => {
    const { totals } = mixed()
    expect(totals.tracked).toBe(3)
    expect(totals.completed).toBe(1)
    expect(totals.abandoned).toBe(2)
    expect(totals.lost_value).toBe(350)
    expect(totals.converted_value).toBe(400)
    expect(totals.conversion_rate).toBeCloseTo(1 / 3)
  })

  it("reports zero rates rather than NaN on an empty window", () => {
    const out = buildDashboard({ carts: [], journeys: [] })
    expect(out.totals.conversion_rate).toBe(0)
    expect(out.totals.lost_value).toBe(0)
    expect(out.funnel.every((row) => row.reached === 0)).toBe(true)
    expect(out.sessions).toEqual([])
  })

  it("falls back to a default currency when no cart declares one", () => {
    const out = buildDashboard({ carts: [], journeys: [], defaultCurrency: "huf" })
    expect(out.totals.currency).toBe("huf")
  })
})

describe("buildDashboard — money coming off the wire", () => {
  /** Stand-in for Medusa's BigNumber: an object that only *looks* numeric. */
  const bigNumber = (value: number) =>
    ({
      numeric: value,
      valueOf: () => value,
      toJSON: () => value,
    }) as unknown as number

  it("unwraps Medusa BigNumber money fields", () => {
    // query.graph returns cart.total / items.unit_price as BigNumber objects.
    // They serialise to a bare number, so this bug is invisible in any logged
    // payload — only `typeof` reveals it.
    const out = buildDashboard({
      carts: [
        cart({
          id: "cart_1",
          total: bigNumber(47790),
          items: [
            {
              product_title: "Vertikálny stojan",
              variant_sku: "AKC-001",
              quantity: 1,
              unit_price: bigNumber(47790),
            },
          ],
        }),
      ],
      journeys: [],
    })

    expect(out.sessions[0].total).toBe(47790)
    expect(out.sessions[0].items[0].unit_price).toBe(47790)
    expect(out.totals.lost_value).toBe(47790)
    expect(out.abandoned_products[0].value).toBe(47790)
  })

  it("treats a non-numeric object as zero rather than NaN", () => {
    const out = buildDashboard({
      carts: [
        cart({
          id: "cart_1",
          total: {} as unknown as number,
          items: [
            {
              product_title: "A",
              variant_sku: "A",
              quantity: 1,
              unit_price: {} as unknown as number,
            },
          ],
        }),
      ],
      journeys: [],
    })
    expect(out.sessions[0].total).toBe(0)
    expect(out.totals.lost_value).toBe(0)
  })

  it("reads Postgres numeric columns that arrive as strings", () => {
    // pg hands `numeric` back as a string. A typeof-number guard silently
    // zeroed every price, which made "lost value" read €0 on a shop full of
    // abandoned carts.
    const out = buildDashboard({
      carts: [
        cart({
          id: "cart_1",
          total: null,
          items: [
            {
              product_title: "Biceps Curl",
              variant_sku: "STR-01",
              quantity: "2" as unknown as number,
              unit_price: "785169" as unknown as number,
            },
          ],
        }),
      ],
      journeys: [],
    })

    expect(out.sessions[0].total).toBe(1570338)
    expect(out.sessions[0].item_count).toBe(2)
    expect(out.totals.lost_value).toBe(1570338)
  })

  it("falls back to the line sum when the computed cart total is absent", () => {
    // `cart.total` is computed in Medusa v2 and comes back 0 through
    // query.graph; the goods value is the honest floor.
    const out = buildDashboard({
      carts: [
        cart({
          id: "cart_1",
          total: 0,
          items: [
            { product_title: "A", variant_sku: "A", quantity: 3, unit_price: 50 },
          ],
        }),
      ],
      journeys: [],
    })
    expect(out.sessions[0].total).toBe(150)
  })

  it("prefers a real stored total over the line sum", () => {
    const out = buildDashboard({
      carts: [
        cart({
          id: "cart_1",
          total: 175,
          items: [
            { product_title: "A", variant_sku: "A", quantity: 3, unit_price: 50 },
          ],
        }),
      ],
      journeys: [],
    })
    // 175 includes shipping; the line sum (150) must not overwrite it.
    expect(out.sessions[0].total).toBe(175)
  })
})

describe("buildDashboard — abandoned products", () => {
  it("counts a product once per cart even across duplicate lines", () => {
    const out = buildDashboard({
      carts: [
        cart({
          id: "cart_1",
          items: [
            {
              product_title: "Činka 20kg",
              variant_sku: "CINKA-20",
              quantity: 1,
              unit_price: 100,
            },
            {
              product_title: "Činka 20kg",
              variant_sku: "CINKA-20",
              quantity: 2,
              unit_price: 100,
            },
          ],
        }),
      ],
      journeys: [],
    })

    const row = out.abandoned_products[0]
    expect(row.sku).toBe("CINKA-20")
    expect(row.carts).toBe(1)
    expect(row.units).toBe(3)
    expect(row.value).toBe(300)
  })

  it("excludes products from carts that converted", () => {
    // A sold product is not an abandonment problem; listing it would send the
    // merchant chasing the best-seller instead of the blocker.
    const out = buildDashboard({
      carts: [
        cart({ id: "cart_1", completed_at: "2026-08-03T10:10:00.000Z" }),
      ],
      journeys: [],
    })
    expect(out.abandoned_products).toEqual([])
  })

  it("keeps the auto-added free gift out of the ranking", () => {
    // The gift is attached to every cart over the threshold, so left in it
    // would rank first in every window while naming no real blocker. It stays
    // in the session's basket — the operator should still see what was there.
    const out = buildDashboard({
      carts: [
        cart({
          id: "cart_1",
          items: [
            {
              product_title: "Činka 20kg",
              variant_sku: "CINKA-20",
              quantity: 1,
              unit_price: 100,
            },
            {
              product_title: "darcek",
              variant_sku: "LF-DARCEK01",
              quantity: 1,
              unit_price: 0,
            },
          ],
        }),
      ],
      journeys: [],
    })

    expect(out.abandoned_products.map((p) => p.sku)).toEqual(["CINKA-20"])
    expect(out.sessions[0].items).toHaveLength(2)
    expect(out.sessions[0].items.map((i) => i.is_gift)).toEqual([false, true])
  })

  it("recognises a gift line by its metadata flag when the SKU differs", () => {
    const out = buildDashboard({
      carts: [
        cart({
          id: "cart_1",
          items: [
            {
              product_title: "Darček k objednávke",
              variant_sku: "OTHER-GIFT",
              quantity: 1,
              unit_price: 0,
              metadata: { is_gift: true },
            },
          ],
        }),
      ],
      journeys: [],
    })

    expect(out.abandoned_products).toEqual([])
  })

  it("groups the same variant across different carts", () => {
    const out = buildDashboard({
      carts: [
        cart({ id: "cart_1", email: "a@x.sk" }),
        cart({ id: "cart_2", email: "b@x.sk" }),
      ],
      journeys: [],
    })
    expect(out.abandoned_products).toHaveLength(1)
    expect(out.abandoned_products[0].carts).toBe(2)
  })

  it("ranks by how many carts a product blocked", () => {
    const withSku = (sku: string, title: string) => ({
      product_title: title,
      variant_sku: sku,
      quantity: 1,
      unit_price: 10,
    })
    const out = buildDashboard({
      carts: [
        cart({
          id: "cart_1",
          email: "a@x.sk",
          items: [withSku("A", "A"), withSku("B", "B")],
        }),
        cart({ id: "cart_2", email: "b@x.sk", items: [withSku("B", "B")] }),
        cart({ id: "cart_3", email: "c@x.sk", items: [withSku("B", "B")] }),
      ],
      journeys: [],
    })
    expect(out.abandoned_products.map((p) => p.sku)).toEqual(["B", "A"])
  })
})

describe("buildDashboard — exit paths", () => {
  it("ranks the pages abandoned shoppers were last seen on", () => {
    const out = buildDashboard({
      carts: [
        cart({ id: "cart_1", email: "a@x.sk" }),
        cart({ id: "cart_2", email: "b@x.sk" }),
        cart({ id: "cart_3", email: "c@x.sk" }),
      ],
      journeys: [
        journey({ cart_id: "cart_1", last_path: "/sk/checkout" }),
        journey({ cart_id: "cart_2", last_path: "/sk/checkout" }),
        journey({ cart_id: "cart_3", last_path: "/sk/cart" }),
      ],
    })

    expect(out.exit_paths).toEqual([
      { path: "/sk/checkout", count: 2 },
      { path: "/sk/cart", count: 1 },
    ])
  })

  it("ignores the exit page of a shopper who converted", () => {
    const out = buildDashboard({
      carts: [cart({ id: "cart_1", completed_at: "2026-08-03T10:10:00.000Z" })],
      journeys: [journey({ cart_id: "cart_1", last_path: "/sk/order/confirmed" })],
    })
    expect(out.exit_paths).toEqual([])
  })
})

describe("buildDashboard — session list", () => {
  it("sorts newest first so the freshest abandonment is actionable", () => {
    const out = buildDashboard({
      carts: [
        cart({ id: "cart_old", created_at: "2026-08-01T10:00:00.000Z" }),
        cart({ id: "cart_new", created_at: "2026-08-03T10:00:00.000Z" }),
      ],
      journeys: [],
    })
    expect(out.sessions.map((s) => s.cart_id)).toEqual(["cart_new", "cart_old"])
  })

  it("surfaces the e-mail only when the shopper actually entered one", () => {
    const out = buildDashboard({
      carts: [
        cart({ id: "cart_1", email: "  jan@example.sk " }),
        cart({ id: "cart_2", email: "   " }),
      ],
      journeys: [],
    })
    const byId = Object.fromEntries(out.sessions.map((s) => [s.cart_id, s]))
    expect(byId.cart_1.email).toBe("jan@example.sk")
    expect(byId.cart_2.email).toBeNull()
  })

  it("leaves storefront-only fields null without a beacon", () => {
    const out = buildDashboard({ carts: [cart({ id: "cart_1" })], journeys: [] })
    expect(out.sessions[0].device).toBeNull()
    expect(out.sessions[0].last_path).toBeNull()
    expect(out.sessions[0].last_seen_at).toBeNull()
  })
})
