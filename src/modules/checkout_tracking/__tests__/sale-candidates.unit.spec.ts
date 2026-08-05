import { buildSaleCandidates, MIN_ABANDONED_CARTS } from "../lib/sale-candidates"
import type { SessionRow } from "../lib/dashboard"
import type { FunnelStage } from "../lib/stages"

let seq = 0

const item = (
  over: Partial<SessionRow["items"][number]> = {}
): SessionRow["items"][number] => ({
  title: "Činka 20kg",
  sku: "CINKA-20",
  product_id: "prod_cinka",
  thumbnail: null,
  quantity: 1,
  unit_price: 100,
  // A real product, so not the auto-added gift. Gift lines are already kept off
  // this list structurally — they carry no product id and no price — but the
  // field is part of the row, so the factory has to say which it is.
  is_gift: false,
  ...over,
})

const session = (
  stage: FunnelStage,
  over: Partial<SessionRow> = {}
): SessionRow => ({
  cart_id: `cart_${++seq}`,
  email: null,
  customer_id: null,
  stage,
  observed_by: "cart",
  items: [item()],
  item_count: 1,
  total: 100,
  currency_code: "eur",
  created_at: "2026-08-03T10:00:00.000Z",
  updated_at: null,
  last_seen_at: null,
  last_path: null,
  device: null,
  locale: null,
  stage_at: null,
  completed_at: null,
  ...over,
})

/** N abandoned carts holding the default product, all at the same step. */
const carts = (n: number, stage: FunnelStage = "cart", over = {}) =>
  Array.from({ length: n }, () => session(stage, over))

describe("buildSaleCandidates — what gets on the list", () => {
  it("ranks a never-sold product by how many carts it blocked", () => {
    const rows = buildSaleCandidates({
      sessions: carts(4),
      soldUnitsBySku: {},
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sku: "CINKA-20",
      product_id: "prod_cinka",
      abandoned_carts: 4,
      units: 4,
      stranded_value: 400,
      sold_units: 0,
    })
  })

  it("drops a product that sold in the same window", () => {
    // It converts for someone, so it is not the blocker — discounting it would
    // hand money to buyers who were going to purchase anyway.
    const rows = buildSaleCandidates({
      sessions: carts(5),
      soldUnitsBySku: { "CINKA-20": 1 },
    })
    expect(rows).toEqual([])
  })

  it("ignores a product only one shopper abandoned", () => {
    expect(
      buildSaleCandidates({ sessions: carts(1), soldUnitsBySku: {} })
    ).toEqual([])
    expect(
      buildSaleCandidates({
        sessions: carts(MIN_ABANDONED_CARTS),
        soldUnitsBySku: {},
      })
    ).toHaveLength(1)
  })

  it("never lists a product from a converted cart", () => {
    const rows = buildSaleCandidates({
      sessions: [...carts(2), session("completed"), session("completed")],
      soldUnitsBySku: {},
    })
    // The two completed carts must not inflate the count.
    expect(rows[0].abandoned_carts).toBe(2)
  })

  it("counts a product once per cart across duplicate lines", () => {
    const rows = buildSaleCandidates({
      sessions: [
        session("cart", { items: [item(), item({ quantity: 2 })] }),
        session("cart"),
      ],
      soldUnitsBySku: {},
    })
    expect(rows[0].abandoned_carts).toBe(2)
    expect(rows[0].units).toBe(4)
  })

  it("orders by carts blocked, then by money left behind", () => {
    const a = () => item({ sku: "A", title: "A", product_id: "p_a" })
    const b = () => item({ sku: "B", title: "B", product_id: "p_b", unit_price: 900 })

    const rows = buildSaleCandidates({
      sessions: [
        session("cart", { items: [a()] }),
        session("cart", { items: [a()] }),
        session("cart", { items: [a(), b()] }),
        session("cart", { items: [b()] }),
      ],
      soldUnitsBySku: {},
    })
    expect(rows.map((r) => r.sku)).toEqual(["A", "B"])
  })

  it("excludes synthetic lines that carry no product id", () => {
    // The cash-on-delivery surcharge is a line item, not a product — a
    // promotion cannot target it even in principle.
    const rows = buildSaleCandidates({
      sessions: [
        session("cart", {
          items: [item({ sku: null, title: "Poplatok za dobierku", product_id: null, unit_price: 1.9 })],
        }),
        session("cart", {
          items: [item({ sku: null, title: "Poplatok za dobierku", product_id: null, unit_price: 1.9 })],
        }),
      ],
      soldUnitsBySku: {},
    })
    expect(rows).toEqual([])
  })

  it("excludes free lines — a percentage of zero is zero", () => {
    // The auto-added gift rides along on most abandoned baskets, so left in it
    // tops the ranking while being meaningless to discount.
    const rows = buildSaleCandidates({
      sessions: [
        session("cart", { items: [item({ sku: "GIFT", title: "Darček", unit_price: 0 })] }),
        session("cart", { items: [item({ sku: "GIFT", title: "Darček", unit_price: 0 })] }),
      ],
      soldUnitsBySku: {},
    })
    expect(rows).toEqual([])
  })

  it("keeps the real product when a gift and a fee share the basket", () => {
    const withNoise = () => ({
      items: [
        item(),
        item({ sku: "GIFT", title: "Darček", unit_price: 0 }),
        item({ sku: null, title: "Poplatok za dobierku", product_id: null, unit_price: 1.9 }),
      ],
    })
    const rows = buildSaleCandidates({
      sessions: [session("cart", withNoise()), session("cart", withNoise())],
      soldUnitsBySku: {},
    })
    expect(rows.map((r) => r.sku)).toEqual(["CINKA-20"])
  })
})

describe("buildSaleCandidates — which lever it recommends", () => {
  const observed = { observed_by: "both" as const }

  it("recommends a discount when they quit before seeing shipping", () => {
    const rows = buildSaleCandidates({
      sessions: carts(3, "checkout_entered", observed),
      soldUnitsBySku: {},
    })
    expect(rows[0].action).toBe("discount")
    expect(rows[0].action_confidence).toBe("high")
  })

  it("recommends free shipping when they quit choosing delivery", () => {
    // They accepted the product price and refused the shipping cost. A product
    // discount here spends money on the wrong objection.
    const rows = buildSaleCandidates({
      sessions: carts(3, "delivery", observed),
      soldUnitsBySku: {},
    })
    expect(rows[0].action).toBe("free_shipping")
    expect(rows[0].action_confidence).toBe("high")
  })

  it("recommends investigating when they quit at payment", () => {
    // Price and shipping were both accepted, so this is friction, not cost.
    const rows = buildSaleCandidates({
      sessions: carts(3, "payment", observed),
      soldUnitsBySku: {},
    })
    expect(rows[0].action).toBe("investigate")
  })

  it("requires a majority, not a plurality, before picking a lever", () => {
    // 2 delivery / 2 payment / 2 cart: real demand, no established reason.
    // Acting on the largest bucket here would be acting on noise.
    const rows = buildSaleCandidates({
      sessions: [
        ...carts(2, "delivery", observed),
        ...carts(2, "payment", observed),
        ...carts(2, "cart", observed),
      ],
      soldUnitsBySku: {},
    })
    expect(rows[0].action_confidence).toBe("low")
  })

  it("marks the recommendation low-confidence with no storefront data", () => {
    // Every session observed by the cart alone: the "step" is really just
    // "it was in a basket". Saying otherwise would dress a gap up as insight.
    const rows = buildSaleCandidates({
      sessions: carts(5, "cart"),
      soldUnitsBySku: {},
    })
    expect(rows[0].observed_sessions).toBe(0)
    expect(rows[0].action).toBe("discount")
    expect(rows[0].action_confidence).toBe("low")
  })

  it("reports the step mix most common first", () => {
    const rows = buildSaleCandidates({
      sessions: [
        ...carts(1, "cart", observed),
        ...carts(3, "delivery", observed),
      ],
      soldUnitsBySku: {},
    })
    expect(rows[0].stage_mix).toEqual([
      { stage: "delivery", carts: 3 },
      { stage: "cart", carts: 1 },
    ])
  })
})

describe("buildSaleCandidates — edges", () => {
  it("returns nothing for an empty window", () => {
    expect(buildSaleCandidates({ sessions: [], soldUnitsBySku: {} })).toEqual([])
  })

  it("groups a product with no SKU by title instead of merging them all", () => {
    const rows = buildSaleCandidates({
      sessions: [
        session("cart", { items: [item({ sku: null, title: "Bez SKU A" })] }),
        session("cart", { items: [item({ sku: null, title: "Bez SKU A" })] }),
        session("cart", { items: [item({ sku: null, title: "Bez SKU B" })] }),
        session("cart", { items: [item({ sku: null, title: "Bez SKU B" })] }),
      ],
      soldUnitsBySku: {},
    })
    expect(rows.map((r) => r.title).sort()).toEqual(["Bez SKU A", "Bez SKU B"])
  })
})
