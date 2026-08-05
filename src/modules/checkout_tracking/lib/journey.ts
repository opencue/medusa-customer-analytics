/**
 * Pure state transition for one journey row.
 *
 * Kept out of the service so the interesting decisions — what a beacon is
 * allowed to change, what it can never walk back, and what gets stripped before
 * it touches the database — are testable without a container or a DB.
 */
import { isFunnelStage, maxStage, type FunnelStage } from "./stages"

export type TrackInput = {
  cart_id: string
  stage: string
  path?: string | null
  locale?: string | null
  device?: string | null
}

export type JourneyRow = {
  id: string
  cart_id: string
  stage: string
  locale: string | null
  device: string | null
  last_path: string | null
  stage_at: Record<string, string> | null
  first_seen_at: Date | string
  last_seen_at: Date | string
}

export type JourneyPatch = {
  cart_id: string
  stage: FunnelStage
  locale: string | null
  device: string | null
  last_path: string | null
  stage_at: Record<string, string>
  first_seen_at: Date
  last_seen_at: Date
}

const DEVICES = ["mobile", "tablet", "desktop"] as const
const LOCALES = ["sk", "hu"] as const

/** Longest path we store. Real storefront routes are far shorter; the cap is
 *  there so a crafted request cannot write an unbounded string. */
export const MAX_PATH_LENGTH = 200

const pick = <T extends string>(
  allowed: readonly T[],
  value: unknown
): T | null =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null

/**
 * Route path only — query string and fragment are dropped before storage.
 *
 * This is not tidiness. Storefront URLs carry `?cart_id=`, and Google/Meta
 * click ids ride along on every ad landing; keeping them would turn a
 * "which page did they leave from" field into an ad-attribution identifier
 * nobody consented to. The path alone answers the question.
 */
export const normalizePath = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // Accept only same-origin paths; an absolute URL would let a caller store
  // arbitrary text (and possibly someone else's domain) in the admin table.
  if (!trimmed.startsWith("/")) return null
  const withoutQuery = trimmed.split(/[?#]/)[0]
  if (!withoutQuery) return null
  return withoutQuery.slice(0, MAX_PATH_LENGTH)
}

export const normalizeLocale = (value: unknown): string | null =>
  pick(LOCALES, value)

export const normalizeDevice = (value: unknown): string | null =>
  pick(DEVICES, value)

const readStageAt = (row: JourneyRow | null): Record<string, string> => {
  const raw = row?.stage_at
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (isFunnelStage(key) && typeof value === "string") out[key] = value
  }
  return out
}

const asDate = (value: Date | string | undefined, fallback: Date): Date => {
  if (value instanceof Date) return value
  if (typeof value === "string") {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return fallback
}

/**
 * The row as it should look after `input` lands, or null when the beacon
 * carries nothing usable (unknown stage) and must be ignored.
 *
 * Two rules make the row trustworthy under an out-of-order or replayed beacon,
 * which is the normal case: `sendBeacon` gives no ordering guarantee and fires
 * again on every tab restore.
 *
 *   1. `stage` only ever moves FORWARD (`maxStage`). A late-arriving
 *      "checkout_entered" cannot demote a shopper who already reached review.
 *   2. Each `stage_at` timestamp is written once — first observation wins — so
 *      "how long did the address step take" measures the first attempt rather
 *      than being reset by a back-navigation.
 *
 * `last_seen_at` and `last_path` are the deliberate exceptions: they are meant
 * to track the latest contact, which is exactly the "where did they leave"
 * answer.
 */
export const nextJourneyState = (
  existing: JourneyRow | null,
  input: TrackInput,
  now: Date
): JourneyPatch | null => {
  if (!isFunnelStage(input.stage)) return null

  const previous = isFunnelStage(existing?.stage)
    ? (existing?.stage as FunnelStage)
    : null
  const stage = maxStage(previous, input.stage) as FunnelStage

  const stageAt = readStageAt(existing)
  if (!stageAt[input.stage]) {
    stageAt[input.stage] = now.toISOString()
  }

  const path = normalizePath(input.path)
  const locale = normalizeLocale(input.locale)
  const device = normalizeDevice(input.device)

  return {
    cart_id: input.cart_id,
    stage,
    // A later beacon with a missing/invalid field must not blank out what we
    // already know — the storefront omits locale/device on the exit beacon.
    locale: locale ?? existing?.locale ?? null,
    device: device ?? existing?.device ?? null,
    last_path: path ?? existing?.last_path ?? null,
    stage_at: stageAt,
    first_seen_at: asDate(existing?.first_seen_at, now),
    last_seen_at: now,
  }
}
