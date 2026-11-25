import { buildPromotionPerformance, type PromotionOrder } from "../lib/promotion-performance"

const order = (id: string, over: Partial<PromotionOrder> = {}): PromotionOrder => ({
  id,
  currency_code: "eur",
  total: { numeric: 120 },
  tax_total: 20,
  items: [{ adjustments: [{ code: "WIN", amount: "10.5" }, { code: "OTHER", amount: 70 }] }],
  ...over,
})

it("counts an order once and attributes only the selected code's adjustments", () => {
  const eur = order("eur", { shipping_methods: [{ adjustments: [{ code: "WIN", amount: 5.5 }] }] })
  const huf = order("huf", { currency_code: "huf", total: 12000, tax_total: 2000 })
  const other = order("other", { items: [{ adjustments: [{ code: "WINTER", amount: 1 }] }] })
  const canceled = order("canceled", { status: "canceled" })
  const draft = order("draft", { status: "draft" })

  expect(buildPromotionPerformance("WIN", [eur, huf, other, canceled, draft])).toEqual({
    code: "WIN",
    orders: 2,
    by_currency: [
      { currency: "eur", orders: 1, discount_value: 16, order_value_ex_tax: 100 },
      { currency: "huf", orders: 1, discount_value: 10.5, order_value_ex_tax: 10000 },
    ],
  })
})

it("does not invent a net value when the query did not return the order totals", () => {
  const out = buildPromotionPerformance("WIN", [order("missing", { tax_total: null })])
  expect(out.by_currency[0].order_value_ex_tax).toBeNull()
  expect(buildPromotionPerformance("NO-MATCH", []).orders).toBe(0)
})
