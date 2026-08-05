import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger, MedusaContainer } from "@medusajs/framework/types"

import { CHECKOUT_TRACKING_MODULE } from "../modules/checkout_tracking"
import type CheckoutTrackingModuleService from "../modules/checkout_tracking/service"
import { RETENTION_HOURS } from "../modules/checkout_tracking/service"

/**
 * Deletes checkout-journey rows older than the 72h window the published
 * privacy document declares for abandoned-cart data.
 *
 * Runs hourly, on the half hour, so it interleaves with the abandoned-cart
 * reminder job (top of the hour) rather than competing with it for the same
 * connection pool while the storefront is being served.
 *
 * Unlike `gdpr-retention`, this has no dry-run flag. That job's flag guards an
 * irreversible amputation of years-old marketing consent and deserves a human
 * read of the first run; this one removes 72h of page paths that regenerate on
 * the next visit. Making the deletion opt-in would mean shipping a table that
 * quietly outlives a promise already made in writing.
 */
export default async function checkoutTrackingRetentionJob(
  container: MedusaContainer
) {
  let logger: Logger | undefined
  try {
    logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  } catch {
    logger = undefined
  }

  try {
    const service = container.resolve<CheckoutTrackingModuleService>(
      CHECKOUT_TRACKING_MODULE
    )
    const deleted = await service.purgeExpired()

    if (deleted > 0) {
      logger?.info(
        `[checkout-tracking] purged ${deleted} journey row(s) older than ${RETENTION_HOURS}h`
      )
    }
  } catch (error) {
    // Logged, not rethrown: a failed sweep must retry next hour rather than
    // mark the scheduled job permanently failed.
    logger?.error(
      `[checkout-tracking] retention sweep failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

export const config = {
  name: "checkout-tracking-retention",
  schedule: "30 * * * *",
}
