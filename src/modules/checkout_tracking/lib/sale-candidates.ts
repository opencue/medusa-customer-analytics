/** Rank products by abandonment. The last step suggests what to test, not why someone left. */
import { toNumber, type SessionRow } from "./dashboard"
import { stageIndex, type FunnelStage } from "./stages"

export type OrderRow = {
  created_at?: string | Date | null
  status?: string | null
  items?: Array<{
    variant_sku?: string | null
    quantity?: number | null
  }> | null
}

/**
 * Units sold per SKU across the given orders.
 *
 * This is what turns "most abandoned" into "most abandoned AND never bought".
 * Without it the list is topped by whatever is popular, and the merchant ends
 * up discounting the best-seller.
 */
export const buildSoldUnitsBySku = (
  orders: OrderRow[]
): Record<string, number> => {
  const sold: Record<string, number> = {}
  for (const order of orders) {
    for (const item of order.items ?? []) {
      const sku = (item.variant_sku || "").trim()
      if (!sku) continue
      sold[sku] = (sold[sku] ?? 0) + toNumber(item.quantity)
    }
  }
  return sold
}

export type RecommendedAction = "discount" | "free_shipping" | "investigate"

export type SaleCandidate = {
  key: string
  title: string
  sku: string | null
  thumbnail: string | null
  /** Never null: a line that cannot be targeted is not a candidate at all. */
  product_id: string
  /** Abandoned carts this product sat in — the demand signal. */
  abandoned_carts: number
  units: number
  /** Value of this product's lines across those carts. */
  stranded_value: number
  currency: string
  /** Units sold in the same window. Candidates are those with zero. */
  sold_units: number
  /** Where those shoppers stopped, most common first. */
  stage_mix: Array<{ stage: FunnelStage; carts: number }>
  action: RecommendedAction
  /** Strength of the observed stage pattern, not confidence in its cause. */
  action_confidence: "low" | "high"
  /** Sessions behind this row that reported page-level data. */
  observed_sessions: number
  observed_coverage: number
}

/**
 * Minimum abandoned carts before a product is worth acting on. One shopper
 * changing their mind is not a signal, and a shop-wide discount aimed at a
 * single cart costs more than it can recover.
 */
export const MIN_ABANDONED_CARTS = 2

const TOP_CANDIDATES = 12

/**
 * Steps whose objection is the product itself: everything up to and including
 * the address, i.e. before any shipping price or payment method is shown.
 */
const PRODUCT_OBJECTION_STAGES: FunnelStage[] = [
  "cart",
  "checkout_entered",
  "address",
]

const decideAction = (
  observedStages: Map<FunnelStage, number>,
  observedSessions: number,
  abandonedCarts: number
): { action: RecommendedAction; confidence: "low" | "high" } => {
  if (observedSessions < 3 || observedSessions / abandonedCarts < 0.5) {
    return { action: "investigate", confidence: "low" }
  }

  const at = (stages: FunnelStage[]): number =>
    stages.reduce((sum, stage) => sum + (observedStages.get(stage) ?? 0), 0)

  const product = at(PRODUCT_OBJECTION_STAGES)
  const delivery = at(["delivery"])
  const payment = at(["payment", "review"])

  // Strict majority, not a plurality: recommending free shipping off a 40/30/30
  // split would be picking a lever on noise.
  if (delivery > observedSessions / 2) return { action: "free_shipping", confidence: "high" }
  if (payment > observedSessions / 2) return { action: "investigate", confidence: "high" }
  if (product > observedSessions / 2) return { action: "discount", confidence: "high" }
  return { action: "investigate", confidence: "low" }
}

export type BuildSaleCandidatesInput = {
  sessions: SessionRow[]
  /** Units sold per SKU in the same window, from completed orders. */
  soldUnitsBySku: Record<string, number>
}

export const buildSaleCandidates = ({
  sessions,
  soldUnitsBySku,
}: BuildSaleCandidatesInput): SaleCandidate[] => {
  type Draft = Omit<SaleCandidate, "action" | "action_confidence" | "stage_mix" | "observed_coverage"> & {
    stages: Map<FunnelStage, number>
    observedStages: Map<FunnelStage, number>
  }

  const drafts = new Map<string, Draft>()

  for (const session of sessions) {
    // A converted cart is not an abandonment — including it would rank the
    // best-seller top and send the merchant discounting what already sells.
    if (session.stage === "completed") continue

    const seen = new Set<string>()

    for (const item of session.items) {
      // Skip anything that is not a sellable catalogue line.
      //
      // Carts here carry auto-added lines the shopper never chose: a free gift
      // and the cash-on-delivery surcharge. Both ride along on most abandoned
      // baskets, so left in they dominate the ranking — and both are nonsense
      // to discount (15% of a €0 gift is €0; the COD fee is not a product).
      //
      // The two tests are structural rather than name matches, so they keep
      // working when the gift changes or a new fee line is introduced:
      //   - no product id  → it is a synthetic line, and a promotion cannot
      //     target it even in principle;
      //   - no price       → there is nothing for a percentage to act on.
      if (!item.product_id) continue
      if (item.unit_price <= 0) continue

      const key = JSON.stringify([session.currency_code, item.sku ?? `title:${item.title}`])

      const draft: Draft = drafts.get(key) ?? {
        key,
        title: item.title,
        sku: item.sku,
        thumbnail: item.thumbnail,
        product_id: item.product_id,
        abandoned_carts: 0,
        units: 0,
        stranded_value: 0,
        currency: session.currency_code,
        sold_units: item.sku ? (soldUnitsBySku[item.sku] ?? 0) : 0,
        observed_sessions: 0,
        stages: new Map<FunnelStage, number>(),
        observedStages: new Map<FunnelStage, number>(),
      }

      // Once per cart, so `abandoned_carts` stays a cart count even when a
      // product appears on two lines of the same basket.
      if (!seen.has(key)) {
        seen.add(key)
        draft.abandoned_carts += 1
        draft.stages.set(
          session.stage,
          (draft.stages.get(session.stage) ?? 0) + 1
        )
        if (session.observed_by !== "cart") {
          draft.observed_sessions += 1
          draft.observedStages.set(
            session.stage,
            (draft.observedStages.get(session.stage) ?? 0) + 1
          )
        }
      }

      draft.units += item.quantity
      draft.stranded_value += item.quantity * item.unit_price
      draft.thumbnail = draft.thumbnail ?? item.thumbnail
      drafts.set(key, draft)
    }
  }

  return [...drafts.values()]
    .filter(
      (draft) =>
        // "Most added, never purchased" — a product that also sold in this
        // window is converting for someone, so it is not the blocker.
        draft.sold_units === 0 &&
        draft.abandoned_carts >= MIN_ABANDONED_CARTS
    )
    .map((draft) => {
      const stage_mix = [...draft.stages.entries()]
        .map(([stage, carts]) => ({ stage, carts }))
        .sort(
          (a, b) => b.carts - a.carts || stageIndex(b.stage) - stageIndex(a.stage)
        )

      const { action, confidence } = decideAction(
        draft.observedStages,
        draft.observed_sessions,
        draft.abandoned_carts
      )

      const { stages: _stages, observedStages: _observedStages, ...rest } = draft
      return {
        ...rest,
        stage_mix,
        observed_coverage: draft.observed_sessions / draft.abandoned_carts,
        action,
        action_confidence: confidence,
      }
    })
    .sort(
      (a, b) =>
        b.abandoned_carts - a.abandoned_carts ||
        a.currency.localeCompare(b.currency) ||
        b.stranded_value - a.stranded_value
    )
    .slice(0, TOP_CANDIDATES)
}
