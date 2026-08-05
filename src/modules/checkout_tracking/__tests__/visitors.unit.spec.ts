import {
  groupSessionsByVisitor,
  REPEAT_WINDOW_MS,
} from "../lib/visitors"
import type { SessionRow } from "../lib/dashboard"
import type { FunnelStage } from "../lib/stages"

const BASE = new Date("2026-08-05T10:00:00.000Z").getTime()
const at = (minutes: number) => new Date(BASE + minutes * 60_000).toISOString()

const cart = (over: Partial<SessionRow> & { cart_id: string }): SessionRow => ({
  email: null,
  customer_id: null,
  stage: "cart" as FunnelStage,
  observed_by: "cart",
  items: [],
  item_count: 1,
  total: 100,
  currency_code: "eur",
  created_at: at(0),
  updated_at: null,
  last_seen_at: null,
  last_path: null,
  device: "mobile",
  locale: "sk",
  stage_at: null,
  completed_at: null,
  ...over,
})

const item = (sku: string, over: Partial<SessionRow["items"][number]> = {}) => ({
  title: sku,
  sku,
  product_id: `prod_${sku}`,
  thumbnail: null,
  quantity: 1,
  unit_price: 100,
  is_gift: false,
  ...over,
})

describe("groupSessionsByVisitor", () => {
  test("a lone cart stays its own visitor", () => {
    const groups = groupSessionsByVisitor([cart({ cart_id: "cart_a" })])

    expect(groups).toHaveLength(1)
    expect(groups[0].cart_count).toBe(1)
    expect(groups[0].matched_by).toBe("single")
  })

  test("carts sharing an email are one visitor however far apart", () => {
    const groups = groupSessionsByVisitor([
      cart({ cart_id: "cart_a", email: "ANNA@example.sk", created_at: at(0) }),
      cart({ cart_id: "cart_b", email: "anna@example.sk", created_at: at(4000) }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].matched_by).toBe("email")
    expect(groups[0].cart_count).toBe(2)
  })

  test("a customer id groups carts even when the emails differ", () => {
    const groups = groupSessionsByVisitor([
      cart({ cart_id: "cart_a", customer_id: "cus_1", email: "work@x.sk" }),
      cart({ cart_id: "cart_b", customer_id: "cus_1", email: "home@x.sk" }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].matched_by).toBe("customer")
  })

  test("the same basket re-added minutes later is one visitor", () => {
    const groups = groupSessionsByVisitor([
      cart({ cart_id: "cart_a", items: [item("RACK-01")], created_at: at(0) }),
      cart({ cart_id: "cart_b", items: [item("RACK-01")], created_at: at(1) }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].matched_by).toBe("repeat_cart")
    expect(groups[0].cart_count).toBe(2)
  })

  test("the same basket outside the window is a different visitor", () => {
    const past = REPEAT_WINDOW_MS / 60_000 + 5
    const groups = groupSessionsByVisitor([
      cart({ cart_id: "cart_a", items: [item("RACK-01")], created_at: at(0) }),
      cart({ cart_id: "cart_b", items: [item("RACK-01")], created_at: at(past) }),
    ])

    expect(groups).toHaveLength(2)
  })

  test("a different device is a different visitor even with the same basket", () => {
    const groups = groupSessionsByVisitor([
      cart({ cart_id: "cart_a", items: [item("RACK-01")], device: "mobile" }),
      cart({
        cart_id: "cart_b",
        items: [item("RACK-01")],
        device: "desktop",
        created_at: at(1),
      }),
    ])

    expect(groups).toHaveLength(2)
  })

  test("different baskets never merge", () => {
    const groups = groupSessionsByVisitor([
      cart({ cart_id: "cart_a", items: [item("RACK-01")], created_at: at(0) }),
      cart({ cart_id: "cart_b", items: [item("BENCH-02")], created_at: at(1) }),
    ])

    expect(groups).toHaveLength(2)
  })

  test("empty carts never merge — an empty basket identifies nobody", () => {
    const groups = groupSessionsByVisitor([
      cart({ cart_id: "cart_a", items: [], created_at: at(0) }),
      cart({ cart_id: "cart_b", items: [], created_at: at(1) }),
    ])

    expect(groups).toHaveLength(2)
  })

  test("the free gift does not make two different baskets look alike", () => {
    const gift = item("GIFT", { is_gift: true, unit_price: 0 })
    const groups = groupSessionsByVisitor([
      cart({ cart_id: "cart_a", items: [item("RACK-01"), gift], created_at: at(0) }),
      cart({ cart_id: "cart_b", items: [item("BENCH-02"), gift], created_at: at(1) }),
    ])

    expect(groups).toHaveLength(2)
  })

  test("the lead is the cart that got furthest, not the newest", () => {
    const groups = groupSessionsByVisitor([
      cart({
        cart_id: "cart_far",
        email: "anna@x.sk",
        stage: "payment",
        created_at: at(0),
      }),
      cart({
        cart_id: "cart_new",
        email: "anna@x.sk",
        stage: "cart",
        created_at: at(30),
      }),
    ])

    expect(groups[0].lead.cart_id).toBe("cart_far")
    expect(groups[0].carts.map((c) => c.cart_id)).toEqual([
      "cart_far",
      "cart_new",
    ])
  })

  test("among carts at the same rung the most recently touched leads", () => {
    const groups = groupSessionsByVisitor([
      cart({ cart_id: "cart_old", email: "anna@x.sk", created_at: at(0) }),
      cart({
        cart_id: "cart_touched",
        email: "anna@x.sk",
        created_at: at(1),
        last_seen_at: at(90),
      }),
    ])

    expect(groups[0].lead.cart_id).toBe("cart_touched")
  })

  test("a completed cart leads its visitor, so the order is not hidden", () => {
    const groups = groupSessionsByVisitor([
      cart({
        cart_id: "cart_done",
        email: "anna@x.sk",
        stage: "completed",
        created_at: at(0),
      }),
      cart({ cart_id: "cart_left", email: "anna@x.sk", created_at: at(50) }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].lead.stage).toBe("completed")
  })

  test("groups are returned newest first", () => {
    const groups = groupSessionsByVisitor([
      cart({ cart_id: "cart_old", email: "a@x.sk", created_at: at(0) }),
      cart({ cart_id: "cart_new", email: "b@x.sk", created_at: at(120) }),
    ])

    expect(groups.map((g) => g.lead.cart_id)).toEqual(["cart_new", "cart_old"])
  })

  test("a chain of repeats inside the window stays one visitor", () => {
    // Each cart lands within the window of the previous one, so the bucket
    // keeps extending rather than splitting at the first gap.
    const groups = groupSessionsByVisitor(
      [0, 40, 80, 120].map((m) =>
        cart({
          cart_id: `cart_${m}`,
          items: [item("RACK-01")],
          created_at: at(m),
        })
      ),
      { repeatWindowMs: 45 * 60_000 }
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].cart_count).toBe(4)
  })
})
