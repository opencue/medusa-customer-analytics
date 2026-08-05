import {
  buildFunnel,
  deriveServerStage,
  FUNNEL_STAGES,
  isFunnelStage,
  maxStage,
  stageIndex,
  type CartLike,
  type FunnelStage,
} from "../lib/stages"

const cart = (over: Partial<CartLike> = {}): CartLike => ({
  items: [{ id: "li_1" }],
  ...over,
})

describe("deriveServerStage", () => {
  it("returns null for a cart with no items — no intent to lose yet", () => {
    expect(deriveServerStage({ items: [] })).toBeNull()
    expect(deriveServerStage({})).toBeNull()
  })

  it("returns cart once a line item exists", () => {
    expect(deriveServerStage(cart())).toBe("cart")
  })

  it("ignores a region-created address with no street line", () => {
    // Medusa writes a shipping_address as soon as the country is picked, so a
    // country-only row must NOT count as the address step.
    expect(
      deriveServerStage(cart({ shipping_address: { city: null } }))
    ).toBe("cart")
    expect(
      deriveServerStage(cart({ shipping_address: { address_1: "   " } }))
    ).toBe("cart")
  })

  it("returns address for a real street line", () => {
    expect(
      deriveServerStage(cart({ shipping_address: { address_1: "Hlavná 1" } }))
    ).toBe("address")
  })

  it("returns delivery once a shipping method is chosen", () => {
    expect(
      deriveServerStage(
        cart({
          shipping_address: { address_1: "Hlavná 1" },
          shipping_methods: [{ id: "sm_1" }],
        })
      )
    ).toBe("delivery")
  })

  it("returns payment once a payment session exists", () => {
    expect(
      deriveServerStage(
        cart({
          shipping_methods: [{ id: "sm_1" }],
          payment_collection: { payment_sessions: [{ id: "ps_1" }] },
        })
      )
    ).toBe("payment")
  })

  it("returns completed even though every earlier condition also holds", () => {
    expect(
      deriveServerStage(
        cart({
          completed_at: "2026-08-03T10:00:00.000Z",
          shipping_address: { address_1: "Hlavná 1" },
          shipping_methods: [{ id: "sm_1" }],
          payment_collection: { payment_sessions: [{ id: "ps_1" }] },
        })
      )
    ).toBe("completed")
  })

  it("never reports the two page-only rungs", () => {
    const reachable = FUNNEL_STAGES.filter(
      (s) => s !== "checkout_entered" && s !== "review"
    )
    const derived = [
      deriveServerStage(cart()),
      deriveServerStage(cart({ shipping_address: { address_1: "x" } })),
      deriveServerStage(cart({ shipping_methods: [{}] })),
      deriveServerStage(
        cart({ payment_collection: { payment_sessions: [{}] } })
      ),
      deriveServerStage(cart({ completed_at: new Date() })),
    ]
    for (const stage of derived) {
      expect(reachable).toContain(stage)
    }
  })
})

describe("stageIndex / isFunnelStage", () => {
  it("orders the ladder as declared", () => {
    expect(stageIndex("cart")).toBe(0)
    expect(stageIndex("completed")).toBe(FUNNEL_STAGES.length - 1)
    expect(stageIndex("payment")).toBeGreaterThan(stageIndex("delivery"))
  })

  it("rejects anything off the ladder", () => {
    expect(isFunnelStage("bogus")).toBe(false)
    expect(isFunnelStage(null)).toBe(false)
    expect(isFunnelStage(3)).toBe(false)
    expect(stageIndex("bogus")).toBe(-1)
  })
})

describe("maxStage", () => {
  it("takes the further rung regardless of argument order", () => {
    expect(maxStage("cart", "payment")).toBe("payment")
    expect(maxStage("payment", "cart")).toBe("payment")
  })

  it("lets a real stage beat a missing observation", () => {
    // The whole point of the merge: a consent-less visitor is still measured
    // by the server, and a client-only rung still counts when the cart is mute.
    expect(maxStage(null, "review")).toBe("review")
    expect(maxStage("delivery", undefined)).toBe("delivery")
  })

  it("returns null only when neither observer saw anything", () => {
    expect(maxStage(null, undefined)).toBeNull()
    expect(maxStage("bogus" as FunnelStage, null)).toBeNull()
  })
})

describe("buildFunnel", () => {
  it("is cumulative — a payment session counts on every earlier rung", () => {
    const rows = buildFunnel(["payment"])
    const byStage = Object.fromEntries(rows.map((r) => [r.stage, r]))

    expect(byStage.cart.reached).toBe(1)
    expect(byStage.checkout_entered.reached).toBe(1)
    expect(byStage.address.reached).toBe(1)
    expect(byStage.payment.reached).toBe(1)
    // ...but not on rungs it never got to.
    expect(byStage.review.reached).toBe(0)
    expect(byStage.completed.reached).toBe(0)
  })

  it("attributes the drop to the exact rung the session stopped on", () => {
    const rows = buildFunnel(["cart", "cart", "address", "completed"])
    const byStage = Object.fromEntries(rows.map((r) => [r.stage, r]))

    expect(byStage.cart.reached).toBe(4)
    expect(byStage.cart.dropped).toBe(2)
    expect(byStage.cart.drop_rate).toBeCloseTo(0.5)

    expect(byStage.address.reached).toBe(2)
    expect(byStage.address.dropped).toBe(1)
    expect(byStage.address.drop_rate).toBeCloseTo(0.5)

    expect(byStage.completed.reached).toBe(1)
    expect(byStage.completed.dropped).toBe(1)
  })

  it("keeps reached monotonically non-increasing down the ladder", () => {
    const rows = buildFunnel([
      "cart",
      "checkout_entered",
      "checkout_entered",
      "delivery",
      "payment",
      "completed",
      "completed",
    ])
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].reached).toBeLessThanOrEqual(rows[i - 1].reached)
    }
    expect(rows[0].reach_rate).toBe(1)
  })

  it("skips unmeasurable sessions instead of counting them as cart", () => {
    // A null furthest stage means "empty cart" — including it would inflate the
    // top of the funnel and make every conversion rate read artificially low.
    const rows = buildFunnel([null, undefined, "cart"])
    expect(rows[0].reached).toBe(1)
    expect(rows[0].reach_rate).toBe(1)
  })

  it("returns a zeroed ladder for no sessions, not NaN", () => {
    const rows = buildFunnel([])
    expect(rows).toHaveLength(FUNNEL_STAGES.length)
    for (const row of rows) {
      expect(row.reached).toBe(0)
      expect(row.drop_rate).toBe(0)
      expect(row.reach_rate).toBe(0)
    }
  })
})
