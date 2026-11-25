exports.default = async ({ container }) => {
  const code = process.env.MEDUSA_ANALYTICS_TEST_CODE
  if (!/^ANALYTICS-TEST-[A-Z0-9]+$/.test(code ?? "")) {
    throw new Error("Set MEDUSA_ANALYTICS_TEST_CODE to a fresh ANALYTICS-TEST-* code in a disposable Medusa app")
  }

  const orders = container.resolve("order")
  const fixture = (currency_code, scale) => ({
    currency_code,
    items: [{
      title: "Promo reporting test item",
      quantity: 1,
      unit_price: 100 * scale,
      tax_lines: [{ code: "VAT", rate: 20 }],
      adjustments: [{ code, amount: 10 * scale }, { code: "UNRELATED", amount: 2 * scale }],
    }],
    shipping_methods: [{
      name: "Promo reporting test shipping",
      amount: 20 * scale,
      tax_lines: [{ code: "VAT", rate: 20 }],
      adjustments: [{ code, amount: 5 * scale }],
    }],
  })

  await orders.createOrders([
    fixture("eur", 1),
    fixture("huf", 100),
    { ...fixture("eur", 1), status: "draft", is_draft_order: true },
  ])
}
