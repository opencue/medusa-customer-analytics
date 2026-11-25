import { useState } from "react"
import { Text, toast } from "@medusajs/ui"

import { useCheckoutTranslation } from "../../lib/checkout-i18n"
import { formatCount, formatMoney, formatPercent } from "./format"
import { ACTION_COLOR, type SaleCandidate } from "./types"

/**
 * "What should I put on sale" — and the one button that acts on the answer.
 *
 * The list is products shoppers kept putting in the basket and nobody bought
 * in the window. The last step suggests where to investigate, not the cause.
 *
 * Rows whose recommendation is not "discount" are still selectable. The
 * recommendation is evidence, not a lock — the merchant knows things the cart
 * table does not, and a UI that refuses to let them act on that is a UI they
 * will work around.
 *
 * The button creates a DRAFT promotion. Nothing here can start discounting on
 * its own.
 */

/** Starting point for the input, NOT a derived optimum — see the note in the
 *  footer. Abandonment data cannot tell you the right discount. */
const DEFAULT_PERCENTAGE = 10

type CreateResult = {
  created: { code: string; percentage: number; product_count: number }
}

const createPromotion = async (
  productIds: string[],
  percentage: number,
  currency: string
): Promise<CreateResult> => {
  const response = await fetch("/admin/checkout-tracking/promotions", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      product_ids: productIds,
      percentage,
      currency_code: currency,
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
  }
  return (await response.json()) as CreateResult
}

const ActionBadge = ({ row }: { row: SaleCandidate }) => {
  const { t } = useCheckoutTranslation()
  return (
    <span
      title={t(`reason.${row.action}`)}
      className="inline-flex shrink-0 items-center gap-x-1 rounded-full px-2 py-[2px] text-[10.5px] font-medium"
      style={{
        background: `${ACTION_COLOR[row.action]}1f`,
        color: ACTION_COLOR[row.action],
      }}
    >
      {t(`recommendation.${row.action}`)}
      {row.action_confidence === "low" ? (
        <span title={t("confidence")} className="opacity-70">?</span>
      ) : null}
    </span>
  )
}

export const SaleRecommendations = ({
  rows,
  onCreated,
}: {
  rows: SaleCandidate[]
  onCreated: (code: string) => void
}) => {
  const { t, locale } = useCheckoutTranslation()
  const count = (value: number) => formatCount(value, locale)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedCurrency, setSelectedCurrency] = useState("")
  const [percentage, setPercentage] = useState(String(DEFAULT_PERCENTAGE))
  const [busy, setBusy] = useState(false)

  if (!rows.length) {
    return (
      <Text size="xsmall" className="mt-4 text-ui-fg-subtle">
        {t("emptyRecommendations")}
      </Text>
    )
  }

  const currencies = [...new Set(rows.map((row) => row.currency))]
  const currency = currencies.includes(selectedCurrency) ? selectedCurrency : currencies[0]
  const visible = rows.filter((row) => row.currency === currency)
  const products = [...new Set(visible
    .filter((row) => selectedCurrency === currency && selected.has(row.product_id))
    .map((row) => row.product_id))]

  const toggle = (productId: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })

  const parsed = Number(percentage)
  const validPercentage =
    Number.isFinite(parsed) && parsed >= 1 && parsed <= 90
  const canSubmit = products.length > 0 && validPercentage && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      const result = await createPromotion(
        products,
        parsed,
        currency
      )
      toast.success(t("draftCreated"), {
        description: t("draftCreatedDetail", {
          code: result.created.code,
          discount: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 6 })
            .format(result.created.percentage / 100),
          products: count(result.created.product_count),
        }),
      })
      onCreated(result.created.code)
      setSelected(new Set())
    } catch (error) {
      toast.error(t("draftError"), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3.5">
      {currencies.length > 1 ? (
        <label className="mb-3 flex items-center gap-x-2 text-xs">
          {t("currency")}
          <select
            value={currency}
            disabled={busy}
            onChange={(event) => {
              setSelectedCurrency(event.target.value)
              setSelected(new Set())
            }}
          >
            {currencies.map((code) => <option key={code} value={code}>{code.toUpperCase()}</option>)}
          </select>
        </label>
      ) : null}
      <div className="flex flex-col gap-y-2">
        {visible.map((row) => {
          const checked = products.includes(row.product_id)
          const topStage = row.stage_mix[0]

          return (
            <label
              key={row.key}
              className={`flex cursor-pointer items-center gap-x-3 rounded-lg border p-2.5 transition-colors ${
                checked
                  ? "border-ui-border-interactive bg-ui-bg-component"
                  : "border-ui-border-base hover:bg-ui-bg-subtle-hover"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={busy}
                onChange={() => {
                  if (selectedCurrency !== currency) {
                    setSelectedCurrency(currency)
                    setSelected(new Set([row.product_id]))
                  } else {
                    toggle(row.product_id)
                  }
                }}
                className="size-4 shrink-0 accent-[#6366f1]"
              />

              <span className="size-9 shrink-0 overflow-hidden rounded-md border border-ui-border-base bg-ui-bg-component">
                {row.thumbnail ? (
                  <img
                    src={row.thumbnail}
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex size-full items-center justify-center text-[9px] text-ui-fg-muted">
                    {row.title.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-x-3">
                  <span className="truncate text-[12.5px] text-ui-fg-base">
                    {row.title}
                  </span>
                  <ActionBadge row={row} />
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10.5px] text-ui-fg-muted">
                  <bdi className="font-mono">{row.sku ?? "—"}</bdi>
                  <span>·</span>
                  <span className="tabular-nums">
                    {t("carts", { value: count(row.abandoned_carts) })} · {t("units", { value: count(row.units) })} ·{" "}
                    {t("strandedValue", { amount: formatMoney(row.stranded_value, currency, locale) })}
                  </span>
                  {topStage ? (
                    <>
                      <span>·</span>
                      <span>
                        {t("commonStage", { stage: t(`stage.${topStage.stage}`) })}
                      </span>
                    </>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[10.5px] text-ui-fg-muted">
                  {t("observed", {
                    observed: count(row.observed_sessions),
                    total: count(row.abandoned_carts),
                    rate: formatPercent(row.observed_coverage, locale, 0),
                  })}
                </span>
              </span>
            </label>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-ui-border-base pt-3.5">
        <label className="flex items-center gap-x-2 text-[12px] text-ui-fg-subtle">
          {t("discount")}
          <input
            type="number"
            min={1}
            max={90}
            value={percentage}
            onChange={(event) => setPercentage(event.target.value)}
            className="w-16 rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1 text-end text-[12px] tabular-nums text-ui-fg-base"
          />
          %
        </label>

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "#6366f1" }}
        >
          {busy
            ? t("creating")
            : t("createDraft", { value: count(products.length) })}
        </button>

        {!validPercentage ? (
          <span className="text-[11px]" style={{ color: "#ff5b2e" }}>
            {t("discountRange", {
              min: formatPercent(0.01, locale, 0),
              max: formatPercent(0.9, locale, 0),
            })}
          </span>
        ) : null}
      </div>

      <Text size="xsmall" className="mt-2.5 text-ui-fg-muted">
        {t("draftHint")}
      </Text>
    </div>
  )
}
