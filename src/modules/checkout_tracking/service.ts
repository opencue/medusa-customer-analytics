import { MedusaService } from "@medusajs/framework/utils"

import CheckoutJourney from "./models/checkout-journey"
import {
  nextJourneyState,
  type JourneyRow,
  type TrackInput,
} from "./lib/journey"

/** Retention promise for page-level checkout data, in hours. Mirrors the
 *  abandoned-cart window in the published privacy document. */
export const RETENTION_HOURS = 72

/** Rows deleted per statement — keeps the id array clear of Postgres'
 *  bind-parameter ceiling, same reasoning as the gdpr-retention job. */
const DELETE_CHUNK = 500

/** Cart ids per `IN (...)` lookup when the admin dashboard hydrates a page. */
const LOOKUP_CHUNK = 200

const chunk = <T>(rows: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

class CheckoutTrackingModuleService extends MedusaService({
  CheckoutJourney,
}) {
  /**
   * Upsert the journey for a cart from a storefront beacon.
   *
   * Silently does nothing for an unrecognised stage. The caller is a public
   * endpoint that must not tell a prober which stage names exist, and a stray
   * beacon from a stale storefront bundle is expected noise, not an error.
   */
  async track(input: TrackInput, now: Date = new Date()): Promise<void> {
    const apply = async (): Promise<boolean> => {
      const existing = (
        (await this.listCheckoutJourneys({
          cart_id: input.cart_id,
        })) as JourneyRow[]
      )[0]

      const patch = nextJourneyState(existing ?? null, input, now)
      if (!patch) return true

      if (existing) {
        await this.updateCheckoutJourneys({ id: existing.id, ...patch })
        return true
      }
      await this.createCheckoutJourneys(patch)
      return true
    }

    try {
      await apply()
    } catch {
      // Read-then-write has a window: two beacons for the same cart can both
      // see "no row" and both insert, and the unique index on cart_id rejects
      // the loser. Retrying re-reads, now finds the row the winner wrote, and
      // takes the update path instead — otherwise that stage would be dropped
      // silently, which is the one failure this table cannot self-report.
      //
      // A second failure is a real fault (not contention); it propagates to
      // the route, which logs it and still answers 204.
      await apply()
    }
  }

  /** Journeys for the given carts, chunked so a wide dashboard page cannot
   *  build one enormous `IN (...)`. */
  async listByCartIds(cartIds: string[]): Promise<JourneyRow[]> {
    if (!cartIds.length) return []
    const out: JourneyRow[] = []
    for (const ids of chunk(cartIds, LOOKUP_CHUNK)) {
      const rows = (await this.listCheckoutJourneys({
        cart_id: ids,
      })) as JourneyRow[]
      out.push(...rows)
    }
    return out
  }

  /**
   * Hard-delete journeys last seen more than `RETENTION_HOURS` ago.
   *
   * Deliberately NOT behind the gdpr-retention job's dry-run flag. That flag
   * guards an irreversible one-shot amputation of years-old marketing consent;
   * this table is 72h of page paths that regenerate on the next visit, and
   * leaving it undeleted would break a promise the privacy document already
   * makes in writing. A soft delete would not satisfy it either — the row still
   * links a cart (and therefore an e-mail) to a browsing trail.
   */
  async purgeExpired(
    now: Date = new Date(),
    retentionHours: number = RETENTION_HOURS
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionHours * 60 * 60 * 1000)

    const expired = (await this.listCheckoutJourneys(
      { last_seen_at: { $lt: cutoff } },
      { select: ["id"] }
    )) as Array<{ id: string }>

    if (!expired.length) return 0

    let deleted = 0
    for (const ids of chunk(
      expired.map((row) => row.id),
      DELETE_CHUNK
    )) {
      await this.deleteCheckoutJourneys(ids)
      deleted += ids.length
    }
    return deleted
  }
}

export default CheckoutTrackingModuleService
