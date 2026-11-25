/** Rank products by abandonment. The last step suggests what to test, not why someone left. */
import { toNumber, type ProductBasket } from "./dashboard"
import { stageIndex, type FunnelStage } from "./stages"

export type OrderRow = {
  items?: Array<{
    product_id?: string | null
    variant_sku?: string | null
    quantity?: unknown
  }> | null
}

/** Promotions target a whole product: sales of any of its variants count. */
export const buildSoldProductIds = (orders: OrderRow[], baskets: ProductBasket[] = []): Set<string> => {
  const sold = new Set<string>()
  const unlinkedSkus = new Set<string>()
  for (const order of orders) {
    for (const item of order.items ?? []) {
      if (toNumber(item.quantity) <= 0) continue
      if (item.product_id) sold.add(item.product_id)
      else if (item.variant_sku?.trim()) unlinkedSkus.add(item.variant_sku.trim())
    }
  }
  // Older order rows may only have a SKU. If it identifies a basket variant,
  // disqualify the entire product, not just the matching variant/currency.
  if (unlinkedSkus.size > 0) {
    for (const { items } of baskets) {
      for (const item of items) {
        if (item.product_id && item.sku && unlinkedSkus.has(item.sku)) sold.add(item.product_id)
      }
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
  sessions: ProductBasket[]
  /** Catalog products purchased in the same window. */
  soldProductIds: ReadonlySet<string>
}

type ProductItem = ProductBasket["items"][number]

export const saleProductKey = (currency: string, item: ProductItem): string =>
  JSON.stringify([currency, item.product_id])

/** No free gifts, surcharges or other lines that cannot be targeted. */
export const isSaleProduct = (item: ProductItem): item is ProductItem & { product_id: string } =>
  !item.is_gift && !!item.product_id && item.unit_price > 0

export const buildSaleCandidates = ({
  sessions,
  soldProductIds,
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
      if (!isSaleProduct(item) || soldProductIds.has(item.product_id)) continue

      const key = saleProductKey(session.currency_code, item)

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
        sold_units: 0,
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
      if (draft.sku !== item.sku) draft.sku = null
      draft.thumbnail = draft.thumbnail ?? item.thumbnail
      drafts.set(key, draft)
    }
  }

  return [...drafts.values()]
    .filter(
      (draft) =>
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
