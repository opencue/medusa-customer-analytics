/**
 * The checkout funnel ladder — one ordered list, two independent observers.
 *
 * A shopper's progress is measured on a single ladder, but the two things that
 * can see it disagree about which rungs they can observe:
 *
 *   - The **cart row** (server, durable, complete). It proves address /
 *     delivery / payment / completed, because reaching those steps writes to
 *     the cart. It cannot prove `checkout_entered` or `review` — opening a page
 *     writes nothing.
 *   - The **storefront beacon** (client, 72h, consent-gated). It sees every
 *     rung including the two page-only ones, but only for visitors who granted
 *     analytics consent, so its counts alone are biased low.
 *
 * So neither source is authoritative on its own: the funnel takes the FURTHEST
 * rung either one saw (`maxStage`). Server-only visitors still land on the
 * ladder — just without the two page-only rungs — which is why the funnel is
 * complete for every cart while the page-level detail is opt-in.
 *
 * Everything here is pure so the ladder can be unit-tested without a database.
 */

export const FUNNEL_STAGES = [
  /** ≥1 line item on the cart. The tracker starts here — before this there is
   *  no shopper intent to lose. */
  "cart",
  /** Opened /checkout. Page-only: no cart field changes, so client-observed. */
  "checkout_entered",
  /** Shipping address saved on the cart. */
  "address",
  /** A shipping method was chosen. */
  "delivery",
  /** A payment session exists (card / bank transfer / COD selected). */
  "payment",
  /** Reached the final review step. Page-only, client-observed. */
  "review",
  /** Order placed — the cart is completed. */
  "completed",
] as const

export type FunnelStage = (typeof FUNNEL_STAGES)[number]

/** Rungs the cart row can never prove — only the storefront beacon reports them. */
export const CLIENT_ONLY_STAGES: readonly FunnelStage[] = [
  "checkout_entered",
  "review",
]

const INDEX = new Map<string, number>(
  FUNNEL_STAGES.map((stage, i) => [stage, i])
)

export const isFunnelStage = (value: unknown): value is FunnelStage =>
  typeof value === "string" && INDEX.has(value)

/** Position on the ladder, or -1 for anything not on it. */
export const stageIndex = (value: unknown): number =>
  isFunnelStage(value) ? (INDEX.get(value) as number) : -1

/**
 * The further of two observations. `null` means "this observer saw nothing",
 * which loses to any real stage — that is the whole point of merging a
 * complete-but-blunt source with a detailed-but-partial one.
 */
export const maxStage = (
  a: FunnelStage | null | undefined,
  b: FunnelStage | null | undefined
): FunnelStage | null => {
  const ia = stageIndex(a)
  const ib = stageIndex(b)
  if (ia < 0 && ib < 0) return null
  return ia >= ib ? (a as FunnelStage) : (b as FunnelStage)
}

// ─── server-side derivation (from the cart row) ────────────────────────────

export type CartLike = {
  completed_at?: string | Date | null
  items?: Array<unknown> | null
  shipping_address?: {
    address_1?: string | null
    city?: string | null
    postal_code?: string | null
  } | null
  shipping_methods?: Array<unknown> | null
  payment_collection?: {
    payment_sessions?: Array<unknown> | null
  } | null
}

const hasRows = (value: Array<unknown> | null | undefined): boolean =>
  Array.isArray(value) && value.length > 0

/**
 * An address counts as filled only when a street line is present. Medusa
 * creates a shipping_address row as soon as the country is picked from the
 * region selector, so `shipping_address != null` would promote every visitor
 * who merely opened checkout to the "address done" rung and hide the single
 * biggest real drop-off.
 */
const hasAddress = (cart: CartLike): boolean =>
  typeof cart.shipping_address?.address_1 === "string" &&
  cart.shipping_address.address_1.trim().length > 0

/**
 * Furthest rung provable from the cart alone, or null when there is nothing to
 * measure yet (empty cart — no intent to lose).
 *
 * Checked top-down: a completed order stays "completed" even though its cart
 * also satisfies every earlier condition.
 */
export const deriveServerStage = (cart: CartLike): FunnelStage | null => {
  if (cart.completed_at) return "completed"
  if (hasRows(cart.payment_collection?.payment_sessions)) return "payment"
  if (hasRows(cart.shipping_methods)) return "delivery"
  if (hasAddress(cart)) return "address"
  if (hasRows(cart.items)) return "cart"
  return null
}

// ─── funnel aggregation ────────────────────────────────────────────────────

export type FunnelRow = {
  stage: FunnelStage
  /** Sessions that got at least this far. Monotonically non-increasing. */
  reached: number
  /**
   * Sessions whose journey ended exactly here.
   *
   * On the LAST stage (`completed`) this is not a loss — it is the conversions.
   * The arithmetic is deliberately uniform; the caller labels the final row.
   */
  dropped: number
  /** Share of the sessions that reached this stage and then stopped, 0-1. */
  drop_rate: number
  /** Share of ALL tracked sessions that got this far, 0-1. */
  reach_rate: number
}

/**
 * Turn a list of furthest-reached stages into the cumulative funnel.
 *
 * A session that reached `payment` counts as reached at cart, checkout_entered,
 * address, delivery AND payment — the ladder is cumulative even though the
 * server can only observe the rung the cart proves. Without that, a
 * server-only session would punch a hole in `checkout_entered` (nobody can
 * pay without opening checkout) and the drop-off between the two page-only
 * rungs and their neighbours would be pure noise.
 */
export const buildFunnel = (
  furthest: Array<FunnelStage | null | undefined>
): FunnelRow[] => {
  const endedAt = new Array<number>(FUNNEL_STAGES.length).fill(0)
  let total = 0

  for (const stage of furthest) {
    const i = stageIndex(stage)
    if (i < 0) continue
    endedAt[i] += 1
    total += 1
  }

  // Walk backwards so `reached` accumulates the tail in one pass.
  const reached = new Array<number>(FUNNEL_STAGES.length).fill(0)
  let running = 0
  for (let i = FUNNEL_STAGES.length - 1; i >= 0; i--) {
    running += endedAt[i]
    reached[i] = running
  }

  return FUNNEL_STAGES.map((stage, i) => ({
    stage,
    reached: reached[i],
    dropped: endedAt[i],
    drop_rate: reached[i] > 0 ? endedAt[i] / reached[i] : 0,
    reach_rate: total > 0 ? reached[i] / total : 0,
  }))
}
