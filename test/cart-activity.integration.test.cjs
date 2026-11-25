const assert = require("node:assert/strict")
const { setTimeout } = require("node:timers/promises")
const test = require("node:test")

const baseUrl = process.env.MEDUSA_ANALYTICS_TEST_URL
const storeKey = process.env.MEDUSA_ANALYTICS_TEST_STORE_KEY

test("native Store API records successful adds without counting failed requests or removals", {
  skip: !baseUrl || !storeKey,
}, async () => {
  const base = new URL(baseUrl)
  assert.ok(["127.0.0.1", "[::1]", "localhost"].includes(base.hostname), "Use a disposable local Medusa app")
  const region = process.env.MEDUSA_ANALYTICS_TEST_REGION_ID
  const variant = process.env.MEDUSA_ANALYTICS_TEST_VARIANT_ID
  const token = process.env.MEDUSA_ANALYTICS_TEST_TOKEN
  assert.ok(region && variant && token, "Provide a fixture region, purchasable variant, and admin token")

  const call = async (path, method, body, admin = false) => {
    const response = await fetch(new URL(path, base), {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(admin ? { Authorization: `Bearer ${token}` } : { "x-publishable-api-key": storeKey }),
      },
      body: body && JSON.stringify(body),
    })
    return [response.status, await response.json()]
  }
  const stats = async () => {
    const [status, data] = await call("/admin/checkout-tracking?days=7", "GET", undefined, true)
    assert.equal(status, 200)
    assert.equal(data.add_to_cart.retention_hours, 72)
    return data.add_to_cart
  }
  const createCart = async () => {
    const [status, data] = await call("/store/carts", "POST", { region_id: region })
    assert.equal(status, 200, JSON.stringify(data))
    return `/store/carts/${data.cart.id}/line-items`
  }
  const baseline = await stats()
  const firstCart = await createCart()
  const secondCart = await createCart()
  let itemId
  for (const cart of [firstCart, firstCart, secondCart]) {
    const [status, data] = await call(cart, "POST", { variant_id: variant, quantity: 2 })
    assert.equal(status, 200, JSON.stringify(data))
    if (cart === firstCart) itemId = data.cart.items[0].id
  }
  const [failure] = await call(firstCart, "POST", { variant_id: "variant_intentionally_missing", quantity: 1 })
  assert.ok(failure >= 400 && failure < 500)
  const [remove] = await call(`${firstCart}/${itemId}`, "DELETE")
  assert.equal(remove, 200)

  // The middleware is fail-open and persists after Medusa's response finishes.
  let actual
  for (let attempt = 0; attempt < 20; attempt++) {
    actual = await stats()
    if (actual.adds >= baseline.adds + 3) break
    await setTimeout(100)
  }
  assert.deepEqual(actual, { adds: baseline.adds + 3, carts: baseline.carts + 2, retention_hours: 72 })
})
