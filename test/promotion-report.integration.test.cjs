const assert = require("node:assert/strict")
const test = require("node:test")

const baseUrl = process.env.MEDUSA_ANALYTICS_TEST_URL

test("Medusa order report attributes item and shipping adjustments and excludes tax", { skip: !baseUrl }, async () => {
  const base = new URL(baseUrl)
  assert.ok(["127.0.0.1", "[::1]", "localhost"].includes(base.hostname), "Use a disposable local Medusa app")
  const code = process.env.MEDUSA_ANALYTICS_TEST_CODE
  const token = process.env.MEDUSA_ANALYTICS_TEST_TOKEN
  assert.ok(code && token, "Seed the fixture and pass its code and an admin token")

  const url = new URL("/admin/checkout-tracking/promotions", base)
  url.searchParams.set("code", code)
  assert.equal((await fetch(url)).status, 401)

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.code, code)
  assert.equal(result.orders, 2)
  assert.equal(result.scan.capped, false)
  assert.deepEqual(result.by_currency, [
    { currency: "eur", orders: 1, discount_value: 15, order_value_ex_tax: 103 },
    { currency: "huf", orders: 1, discount_value: 1500, order_value_ex_tax: 10300 },
  ])
})
