import {
  MAX_PATH_LENGTH,
  nextJourneyState,
  normalizeDevice,
  normalizeLocale,
  normalizePath,
  type JourneyRow,
} from "../lib/journey"

const NOW = new Date("2026-08-03T12:00:00.000Z")
const EARLIER = new Date("2026-08-03T11:00:00.000Z")

const row = (over: Partial<JourneyRow> = {}): JourneyRow => ({
  id: "cj_1",
  cart_id: "cart_1",
  stage: "cart",
  locale: "sk",
  device: "mobile",
  last_path: "/sk/cart",
  stage_at: { cart: EARLIER.toISOString() },
  first_seen_at: EARLIER,
  last_seen_at: EARLIER,
  ...over,
})

describe("normalizePath", () => {
  it("drops the query string and fragment", () => {
    // ?cart_id= and ad click ids ride on real storefront URLs — storing them
    // would turn this column into an identifier nobody consented to.
    expect(normalizePath("/sk/cart?cart_id=cart_123&gclid=abc")).toBe("/sk/cart")
    expect(normalizePath("/sk/checkout#payment")).toBe("/sk/checkout")
  })

  it("rejects absolute URLs and non-paths", () => {
    expect(normalizePath("https://evil.example/x")).toBeNull()
    expect(normalizePath("sk/cart")).toBeNull()
    expect(normalizePath("")).toBeNull()
    expect(normalizePath(null)).toBeNull()
    expect(normalizePath(42)).toBeNull()
  })

  it("caps the stored length", () => {
    const long = "/" + "a".repeat(500)
    expect(normalizePath(long)).toHaveLength(MAX_PATH_LENGTH)
  })
})

describe("normalizeLocale / normalizeDevice", () => {
  it("accepts only the known values", () => {
    expect(normalizeLocale("sk")).toBe("sk")
    expect(normalizeLocale("hu")).toBe("hu")
    expect(normalizeLocale("de")).toBeNull()
    expect(normalizeDevice("desktop")).toBe("desktop")
    expect(normalizeDevice("watch")).toBeNull()
    expect(normalizeDevice(undefined)).toBeNull()
  })
})

describe("nextJourneyState", () => {
  it("ignores a beacon carrying an unknown stage", () => {
    expect(
      nextJourneyState(null, { cart_id: "cart_1", stage: "bogus" }, NOW)
    ).toBeNull()
  })

  it("creates a first journey stamped at now", () => {
    const patch = nextJourneyState(
      null,
      {
        cart_id: "cart_1",
        stage: "checkout_entered",
        path: "/sk/checkout",
        locale: "sk",
        device: "mobile",
      },
      NOW
    )

    expect(patch).toMatchObject({
      cart_id: "cart_1",
      stage: "checkout_entered",
      locale: "sk",
      device: "mobile",
      last_path: "/sk/checkout",
      first_seen_at: NOW,
      last_seen_at: NOW,
    })
    expect(patch?.stage_at).toEqual({
      checkout_entered: NOW.toISOString(),
    })
  })

  it("never walks the stage backwards on an out-of-order beacon", () => {
    // sendBeacon gives no ordering guarantee and refires on tab restore, so a
    // late "checkout_entered" must not demote a shopper who reached review.
    const patch = nextJourneyState(
      row({ stage: "review" }),
      { cart_id: "cart_1", stage: "checkout_entered" },
      NOW
    )
    expect(patch?.stage).toBe("review")
  })

  it("advances the stage when the beacon is genuinely further", () => {
    const patch = nextJourneyState(
      row({ stage: "cart" }),
      { cart_id: "cart_1", stage: "review" },
      NOW
    )
    expect(patch?.stage).toBe("review")
  })

  it("keeps the first timestamp for a stage that is seen twice", () => {
    const patch = nextJourneyState(
      row({ stage_at: { cart: EARLIER.toISOString() } }),
      { cart_id: "cart_1", stage: "cart" },
      NOW
    )
    expect(patch?.stage_at.cart).toBe(EARLIER.toISOString())
  })

  it("still records a newly reached stage alongside the old ones", () => {
    const patch = nextJourneyState(
      row({ stage_at: { cart: EARLIER.toISOString() } }),
      { cart_id: "cart_1", stage: "review" },
      NOW
    )
    expect(patch?.stage_at).toEqual({
      cart: EARLIER.toISOString(),
      review: NOW.toISOString(),
    })
  })

  it("preserves first_seen_at and moves last_seen_at forward", () => {
    const patch = nextJourneyState(
      row(),
      { cart_id: "cart_1", stage: "review" },
      NOW
    )
    expect(patch?.first_seen_at).toEqual(EARLIER)
    expect(patch?.last_seen_at).toBe(NOW)
  })

  it("does not blank known fields when a later beacon omits them", () => {
    // The exit beacon carries stage + path only.
    const patch = nextJourneyState(
      row({ locale: "hu", device: "desktop" }),
      { cart_id: "cart_1", stage: "review", path: "/hu/checkout" },
      NOW
    )
    expect(patch?.locale).toBe("hu")
    expect(patch?.device).toBe("desktop")
    expect(patch?.last_path).toBe("/hu/checkout")
  })

  it("does update last_path — that is the 'where did they leave' answer", () => {
    const patch = nextJourneyState(
      row({ last_path: "/sk/cart" }),
      { cart_id: "cart_1", stage: "cart", path: "/sk/produkty/cinka" },
      NOW
    )
    expect(patch?.last_path).toBe("/sk/produkty/cinka")
  })

  it("drops a garbage stage_at blob rather than persisting it", () => {
    const patch = nextJourneyState(
      row({ stage_at: { bogus: "x", cart: 5 } as never }),
      { cart_id: "cart_1", stage: "cart" },
      NOW
    )
    expect(patch?.stage_at).toEqual({ cart: NOW.toISOString() })
  })

  it("recovers when first_seen_at is an ISO string from the DB driver", () => {
    const patch = nextJourneyState(
      row({ first_seen_at: EARLIER.toISOString() }),
      { cart_id: "cart_1", stage: "cart" },
      NOW
    )
    expect(patch?.first_seen_at).toEqual(EARLIER)
  })
})
