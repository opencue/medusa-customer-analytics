/**
 * Wire shape of `GET /admin/checkout-tracking`.
 *
 * Declared here rather than imported from the backend module so the admin
 * bundle never pulls a server file (and its transitive Medusa imports) into
 * the browser. Kept in sync by hand with
 * `src/modules/checkout_tracking/lib/dashboard.ts`.
 */

export const STAGES = [
  "cart",
  "checkout_entered",
  "address",
  "delivery",
  "payment",
  "review",
  "completed",
] as const

export type Stage = (typeof STAGES)[number]

export type FunnelRow = {
  stage: Stage
  reached: number
  dropped: number
  drop_rate: number
  reach_rate: number
}

export type SessionItem = {
  title: string
  sku: string | null
  thumbnail: string | null
  quantity: number
  unit_price: number
  /** Auto-added free gift, not something the shopper chose. */
  is_gift: boolean
}

export type SessionRow = {
  cart_id: string
  email: string | null
  customer_id: string | null
  stage: Stage
  observed_by: "cart" | "storefront" | "both"
  items: SessionItem[]
  item_count: number
  total: number
  currency_code: string
  created_at: string | null
  updated_at: string | null
  last_seen_at: string | null
  last_path: string | null
  device: string | null
  locale: string | null
  stage_at: Record<string, string> | null
  completed_at: string | null
}

export type AbandonedProduct = {
  key: string
  title: string
  sku: string | null
  thumbnail: string | null
  carts: number
  units: number
  value: number
}

export type TrackerResponse = {
  range: { days: number; since: string; now: string }
  funnel: FunnelRow[]
  totals: {
    tracked: number
    completed: number
    abandoned: number
    conversion_rate: number
    lost_value: number
    converted_value: number
    currency: string
    with_storefront_data: number
  }
  sessions: SessionRow[]
  abandoned_products: AbandonedProduct[]
  exit_paths: Array<{ path: string; count: number }>
  sale_candidates: SaleCandidate[]
  scan: { carts: number; cap: number; capped: boolean }
}

/** Slovak labels + the one-line explanation of what each rung means. */
export const STAGE_LABEL: Record<Stage, string> = {
  cart: "Pridal do košíka",
  checkout_entered: "Otvoril checkout",
  address: "Vyplnil adresu",
  delivery: "Zvolil dopravu",
  payment: "Zvolil platbu",
  review: "Súhrn objednávky",
  completed: "Objednal",
}

export const STAGE_HINT: Record<Stage, string> = {
  cart: "Košík má aspoň jednu položku",
  checkout_entered: "Otvoril stránku /checkout",
  address: "Uložená dodacia adresa",
  delivery: "Vybraný spôsob dopravy",
  payment: "Založená platobná relácia",
  review: "Dostal sa na posledný krok",
  completed: "Objednávka dokončená",
}

/**
 * Indigo → violet down the ladder, green at the end. The colour ramp is the
 * fastest read of "how deep did they get"; the final green makes conversions
 * visually distinct from every stage that is a loss.
 */
export const STAGE_COLOR: Record<Stage, string> = {
  cart: "#6366f1",
  checkout_entered: "#7175f0",
  address: "#818cf8",
  delivery: "#93a0fb",
  payment: "#a5b4fc",
  review: "#c4b5fd",
  completed: "#3dd68c",
}

// ─── sale recommendations ──────────────────────────────────────────────────

export type RecommendedAction = "discount" | "free_shipping" | "investigate"

export type SaleCandidate = {
  key: string
  title: string
  sku: string | null
  thumbnail: string | null
  /** Never null — the API drops lines it cannot target with a promotion. */
  product_id: string
  abandoned_carts: number
  units: number
  stranded_value: number
  sold_units: number
  stage_mix: Array<{ stage: Stage; carts: number }>
  action: RecommendedAction
  action_confidence: "low" | "high"
  observed_sessions: number
}

/** Slovak label + the reasoning, shown so the operator can disagree with it. */
export const ACTION_LABEL: Record<RecommendedAction, string> = {
  discount: "Zľava",
  free_shipping: "Doprava zdarma",
  investigate: "Preveriť platbu",
}

export const ACTION_WHY: Record<RecommendedAction, string> = {
  discount:
    "Odišli skôr, než uvideli cenu dopravy — námietka je pri produkte samotnom.",
  free_shipping:
    "Cenu produktu prijali, cenu dopravy nie. Zľava z produktu mieri vedľa.",
  investigate:
    "Prijali cenu aj dopravu a zastavili sa až pri platbe — to nie je o cene.",
}

export const ACTION_COLOR: Record<RecommendedAction, string> = {
  discount: "#3dd68c",
  free_shipping: "#facc15",
  investigate: "#ff5b2e",
}
