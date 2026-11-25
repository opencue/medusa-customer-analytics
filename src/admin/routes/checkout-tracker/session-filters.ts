import type { CheckoutStatus, SessionRow, Stage } from "./types"

export const matchesSessionFilters = (
  visitor: { status: CheckoutStatus; lead: Pick<SessionRow, "stage" | "email"> },
  stage: Stage | null,
  status: CheckoutStatus | null,
  emailOnly: boolean
): boolean =>
  (!stage || visitor.lead.stage === stage) &&
  (!status || visitor.status === status) &&
  (!emailOnly || Boolean(visitor.lead.email))
