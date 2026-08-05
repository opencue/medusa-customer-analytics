import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { createPromotionsWorkflow } from "@medusajs/medusa/core-flows"

/**
 * POST /admin/checkout-tracking/promotions
 *
 * Creates a percentage promotion for the products the tracker flagged as
 * "kept getting added, never bought".
 *
 * The promotion is created as a **draft**, never active. Two reasons, and the
 * first one is the important one:
 *
 *   1. This endpoint spends real money. It is reached from a dashboard whose
 *      whole job is to make a problem feel urgent, which is exactly the state
 *      of mind in which someone mis-clicks. A draft costs nothing to discard;
 *      an active discount on a live storefront cannot be un-granted from the
 *      orders it already applied to.
 *   2. Medusa's own Promotions screen is the right place to review the rule,
 *      set a campaign and budget, and choose when it starts. Re-implementing
 *      that here would be a worse version of a screen that already exists.
 *
 * The operator flips it to active in Promotions when they are happy with it.
 */

const MAX_PRODUCTS = 50
const MIN_PERCENTAGE = 1
const MAX_PERCENTAGE = 90

/**
 * Units per line the discount applies to. Medusa requires this whenever the
 * allocation is "each" and refuses the promotion without it.
 *
 * 10 covers any realistic basket in this catalogue (racks, benches, barbells —
 * bought in ones and twos) while capping the exposure if a line ever carries a
 * wild quantity. It is a ceiling, not a target: nothing changes for a normal
 * order, and a 500-unit line cannot turn a 15% promotion into an unbounded
 * write-off.
 */
const MAX_DISCOUNTED_QUANTITY = 10

type Body = {
  product_ids?: unknown
  percentage?: unknown
  code?: unknown
  currency_code?: unknown
}

/** `AKCIA-` + 6 chars of the id, so two runs never collide on a code. */
const buildCode = (raw: unknown, seed: string): string => {
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim().toUpperCase().slice(0, 40)
  }
  return `AKCIA-${seed.replace(/[^0-9A-Za-z]/g, "").slice(-6).toUpperCase()}`
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as Body

  const productIds = Array.isArray(body.product_ids)
    ? [...new Set(body.product_ids)]
        .filter((id): id is string => typeof id === "string" && !!id.trim())
        .map((id) => id.trim())
        .slice(0, MAX_PRODUCTS)
    : []

  if (!productIds.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "product_ids must contain at least one product id"
    )
  }

  const percentage = Number(body.percentage)
  if (
    !Number.isFinite(percentage) ||
    percentage < MIN_PERCENTAGE ||
    percentage > MAX_PERCENTAGE
  ) {
    // An out-of-range percentage is refused rather than clamped: silently
    // turning a fat-fingered 900 into 90 would still be a 90% discount nobody
    // asked for.
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `percentage must be between ${MIN_PERCENTAGE} and ${MAX_PERCENTAGE}`
    )
  }

  const currencyCode =
    typeof body.currency_code === "string" && body.currency_code.trim()
      ? body.currency_code.trim().toLowerCase()
      : "eur"

  const code = buildCode(body.code, productIds[0])

  const { result } = await createPromotionsWorkflow(req.scope).run({
    input: {
      promotionsData: [
        {
          code,
          type: "standard",
          // The whole point: never live straight from a dashboard click.
          status: "draft",
          // Requires the shopper to enter the code. An automatic promotion
          // would start discounting the moment someone activates it, with no
          // second look at who it reaches.
          is_automatic: false,
          application_method: {
            type: "percentage",
            target_type: "items",
            // "each" applies the percentage per qualifying line. "across"
            // would split one discount over the whole basket, so adding an
            // unrelated product would dilute the discount on the item the
            // promotion is actually meant to move.
            allocation: "each",
            max_quantity: MAX_DISCOUNTED_QUANTITY,
            value: percentage,
            currency_code: currencyCode,
            target_rules: [
              {
                attribute: "items.product.id",
                operator: "in",
                values: productIds,
              },
            ],
          },
        },
      ],
    },
  })

  const promotion = Array.isArray(result) ? result[0] : result

  res.status(201).json({
    promotion,
    // Echoed back so the admin can say exactly what was created without
    // re-reading it, and so the draft status is impossible to miss.
    created: {
      code,
      percentage,
      product_count: productIds.length,
      status: "draft",
    },
  })
}
