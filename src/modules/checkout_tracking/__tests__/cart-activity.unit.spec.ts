import { recordCheckoutCartAdd } from "../../../api/checkout-cart-activity"
import { latestCartActivity } from "../lib/cart-activity"

describe("successful store cart adds", () => {
  it.each([200, 201, 400, 404, 500])("records only 2xx responses (%i)", async (statusCode) => {
    const createCheckoutCartAdds = jest.fn().mockResolvedValue({})
    const req = {
      params: { id: "cart_fixture" },
      scope: { resolve: jest.fn().mockReturnValue({ createCheckoutCartAdds }) },
    }
    const res = { statusCode, once: jest.fn() }
    const next = jest.fn()
    recordCheckoutCartAdd(req as never, res as never, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(createCheckoutCartAdds).not.toHaveBeenCalled()
    expect(res.once).toHaveBeenCalledWith("finish", expect.any(Function))
    await res.once.mock.calls[0][1]()
    expect(createCheckoutCartAdds).toHaveBeenCalledTimes(statusCode < 300 ? 1 : 0)
    if (statusCode < 300) expect(createCheckoutCartAdds).toHaveBeenCalledWith({ cart_id: "cart_fixture" })
  })
})

it("uses newer child activity even when the parent cart did not change", () => {
  const latest = "2026-11-25T11:55:00.000Z"
  expect(latestCartActivity({
    updated_at: "2026-11-25T10:00:00.000Z",
    items: [{ updated_at: latest }],
    shipping_methods: [{ updated_at: "2026-11-25T11:30:00.000Z" }],
  })?.toISOString()).toBe(latest)
})
