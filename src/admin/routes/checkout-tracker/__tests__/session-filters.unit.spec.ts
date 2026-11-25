import { matchesSessionFilters } from "../session-filters"
import type { CheckoutStatus, SessionRow } from "../types"

const visitor = (status: CheckoutStatus, stage: SessionRow["stage"], email: string | null) =>
  ({ status, lead: { stage, email } })

const visitors = [
  visitor("active", "review", "active@example.test"),
  visitor("abandoned", "delivery", "abandoned@example.test"),
  visitor("abandoned", "delivery", null),
  visitor("abandoned", "cart", "cart@example.test"),
  visitor("completed", "completed", "completed@example.test"),
  visitor("recovered", "completed", "recovered@example.test"),
]

test.each(["active", "abandoned", "completed", "recovered"] as const)(
  "matches only %s when it is selected without a stage or email filter",
  (status) => {
    expect(visitors.filter((row) => matchesSessionFilters(row, null, status, false)))
      .toEqual(visitors.filter((row) => row.status === status))
  }
)

test("combines the last stage, status and email filters without changing unfiltered rows", () => {
  expect(visitors.filter((row) => matchesSessionFilters(row, "delivery", "abandoned", true)))
    .toEqual([visitors[1]])
  expect(visitors.filter((row) => matchesSessionFilters(row, "delivery", "recovered", true)))
    .toEqual([])
  expect(visitors.filter((row) => matchesSessionFilters(row, null, null, false)))
    .toEqual(visitors)
})
