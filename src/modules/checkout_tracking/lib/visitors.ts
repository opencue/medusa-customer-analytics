/**
 * Collapsing carts back into the person who made them.
 *
 * One shopper routinely leaves several carts behind: the cart is rebuilt on a
 * second device, the session is lost and the product added again a minute
 * later, or checkout is restarted after a payment fails. Counted as separate
 * journeys they inflate everything the operator reads — the abandoned count,
 * the lost value, the product ranking — and push the conversion rate down,
 * because the denominator grows while the one order stays one order.
 *
 * Two levels of evidence, and they are deliberately not equal:
 *
 *   - **Certain.** A customer id, or an email typed into checkout, identifies
 *     the same person no matter how far apart the carts are.
 *   - **Probable.** Two anonymous carts holding exactly the same items, from
 *     the same device and locale, minutes apart. Nothing proves this is one
 *     person, but two different shoppers picking an identical basket within
 *     the window is rare enough that keeping them apart misleads more often
 *     than merging them does.
 *
 * The window is what keeps the probable rule honest: without it, every cart
 * containing the shop's most popular item would fold into a single "visitor"
 * across the whole reporting period.
 *
 * No IP address is involved. The module stores none, and adding one would make
 * this a personal-data question rather than a grouping one.
 */

import { stageIndex } from "./stages"
import type { SessionRow } from "./dashboard"

/**
 * How close two anonymous carts must be to read as one shopper retrying.
 *
 * Kept deliberately short. The duplicates this rule exists for — a lost cart
 * cookie, a reload that mints a new cart, a locale switch — happen within a
 * couple of minutes. Widening it to an hour buys few extra merges and makes
 * the one dangerous case much more likely: two different shoppers who both
 * picked the shop's most popular item, folded into a single "visitor".
 */
export const REPEAT_WINDOW_MS = 15 * 60 * 1000

/** Env name a shop sets to override the window, in minutes. */
export const REPEAT_WINDOW_ENV = "CHECKOUT_TRACKING_REPEAT_WINDOW_MINUTES"

/**
 * Read the window from a shop's configuration.
 *
 * The right value is a property of the catalogue, not of this code: a phone
 * accessory is re-added within a minute, a truck tyre is reconsidered an hour
 * later. A shop that leaves it unset keeps the conservative default, and any
 * value that is not a positive finite number is ignored rather than turning
 * the window into NaN and silently merging everything.
 */
export const resolveRepeatWindowMs = (
  rawMinutes: string | undefined
): number => {
  if (!rawMinutes) return REPEAT_WINDOW_MS
  const minutes = Number(rawMinutes.trim())
  if (!Number.isFinite(minutes) || minutes <= 0) return REPEAT_WINDOW_MS
  return minutes * 60 * 1000
}

export type VisitorGroup = {
  /** Stable identity for the group. */
  key: string
  /** Which rule tied the carts together — shown so a merge can be argued with. */
  matched_by: "customer" | "email" | "repeat_cart" | "single"
  /**
   * The cart worth acting on: the one that got furthest, and among equals the
   * most recent. Totals read this cart so one shopper counts once.
   */
  lead: SessionRow
  /** Every cart in the group, furthest-and-newest first. Includes `lead`. */
  carts: SessionRow[]
  cart_count: number
}

const time = (value: string | null): number => {
  if (!value) return 0
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

/** Newest activity on a cart — a cart touched later is the better anchor. */
const activityAt = (row: SessionRow): number =>
  Math.max(time(row.last_seen_at), time(row.updated_at), time(row.created_at))

/**
 * What the cart holds, order-independent. Quantity is deliberately ignored:
 * a shopper who re-adds the same product and bumps it to 2 is still the same
 * shopper looking at the same thing.
 */
const basketSignature = (row: SessionRow): string =>
  row.items
    .filter((item) => !item.is_gift)
    .map((item) => item.sku ?? item.product_id ?? `title:${item.title}`)
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|")

/** Furthest rung first; among equals, the cart touched most recently. */
const byProgressThenRecency = (a: SessionRow, b: SessionRow): number => {
  const stages = stageIndex(b.stage) - stageIndex(a.stage)
  return stages !== 0 ? stages : activityAt(b) - activityAt(a)
}

export const groupSessionsByVisitor = (
  sessions: SessionRow[],
  options: { repeatWindowMs?: number } = {}
): VisitorGroup[] => {
  const windowMs = options.repeatWindowMs ?? REPEAT_WINDOW_MS

  type Bucket = {
    key: string
    matched_by: VisitorGroup["matched_by"]
    carts: SessionRow[]
    /** Only set for anonymous buckets — the basket they are keyed on. */
    signature?: string
    /** Latest activity seen in the bucket, for the window test. */
    latest: number
  }

  const byIdentity = new Map<string, Bucket>()
  const anonymous: Bucket[] = []
  const buckets: Bucket[] = []

  // Oldest first, so an anonymous bucket grows forward in time and the window
  // is always measured against the most recent cart already in it.
  const ordered = [...sessions].sort((a, b) => activityAt(a) - activityAt(b))

  for (const row of ordered) {
    const at = activityAt(row)
    const customer = (row.customer_id ?? "").trim()
    const email = (row.email ?? "").trim().toLowerCase()
    const identity = customer
      ? { key: `customer:${customer}`, matched_by: "customer" as const }
      : email
        ? { key: `email:${email}`, matched_by: "email" as const }
        : null

    if (identity) {
      const existing = byIdentity.get(identity.key)
      if (existing) {
        existing.carts.push(row)
        existing.latest = Math.max(existing.latest, at)
        continue
      }
      const bucket: Bucket = {
        key: identity.key,
        matched_by: identity.matched_by,
        carts: [row],
        latest: at,
      }
      byIdentity.set(identity.key, bucket)
      buckets.push(bucket)
      continue
    }

    // Anonymous: join the most recent open bucket with the same basket on the
    // same device and locale. An empty basket carries no signal, so it never
    // matches anything.
    const signature = basketSignature(row)
    const fingerprint = signature
      ? `${signature}::${row.device ?? "?"}::${row.locale ?? "?"}`
      : null

    const match = fingerprint
      ? [...anonymous]
          .reverse()
          .find(
            (bucket) =>
              bucket.signature === fingerprint && at - bucket.latest <= windowMs
          )
      : undefined

    if (match) {
      match.carts.push(row)
      match.matched_by = "repeat_cart"
      match.latest = Math.max(match.latest, at)
      continue
    }

    const bucket: Bucket = {
      key: `cart:${row.cart_id}`,
      matched_by: "single",
      carts: [row],
      signature: fingerprint ?? undefined,
      latest: at,
    }
    anonymous.push(bucket)
    buckets.push(bucket)
  }

  const groups = buckets.map((bucket) => {
    const carts = [...bucket.carts].sort(byProgressThenRecency)
    const lead = carts[0]
    return {
      key: bucket.key,
      matched_by:
        bucket.carts.length > 1 ? bucket.matched_by : ("single" as const),
      lead,
      carts,
      cart_count: carts.length,
    }
  })

  // Newest first, matching how the list is read: the freshest abandonment is
  // the one still worth a phone call.
  return groups.sort((a, b) => activityAt(b.lead) - activityAt(a.lead))
}
