import { useEffect, useState } from "react"
import { Text, toast } from "@medusajs/ui"

import { formatMoney } from "./format"
import {
  ACTION_COLOR,
  ACTION_LABEL,
  ACTION_WHY,
  STAGE_LABEL,
  type SaleCandidate,
} from "./types"

/**
 * "What should I put on sale" — and the one button that acts on the answer.
 *
 * The list is products shoppers kept putting in the basket and nobody bought
 * in the window. The recommended lever comes from WHERE those shoppers
 * stopped, not from the count alone, because a product discount is the wrong
 * spend when the objection formed at the shipping step.
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

const ActionBadge = ({ row }: { row: SaleCandidate }) => (
  <span
    title={ACTION_WHY[row.action]}
    className="inline-flex shrink-0 items-center gap-x-1 rounded-full px-2 py-[2px] text-[10.5px] font-medium"
    style={{
      background: `${ACTION_COLOR[row.action]}1f`,
      color: ACTION_COLOR[row.action],
    }}
  >
    {ACTION_LABEL[row.action]}
    {row.action_confidence === "low" ? (
      <span
        title="Odporúčanie je odhad — pre týchto zákazníkov nemáme stránkové dáta, takže nevieme, na ktorom kroku presne odišli."
        className="opacity-70"
      >
        ?
      </span>
    ) : null}
  </span>
)

export const SaleRecommendations = ({
  rows,
  currency,
  onCreated,
}: {
  rows: SaleCandidate[]
  currency: string
  onCreated?: () => void
}) => {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [percentage, setPercentage] = useState(String(DEFAULT_PERCENTAGE))
  const [busy, setBusy] = useState(false)

  // Pre-tick exactly the rows whose evidence supports a discount. The merchant
  // can add the others; they just should not be the default spend.
  useEffect(() => {
    setSelected(
      new Set(
        rows.filter((row) => row.action === "discount").map((row) => row.product_id)
      )
    )
  }, [rows])

  if (!rows.length) {
    return (
      <Text size="xsmall" className="mt-4 text-ui-fg-subtle">
        Žiadny produkt sa v tomto období neopakoval v opustených košíkoch bez
        toho, aby sa aspoň raz predal. To je dobrá správa.
      </Text>
    )
  }

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
  const canSubmit = selected.size > 0 && validPercentage && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      const result = await createPromotion(
        [...selected],
        parsed,
        currency
      )
      toast.success("Akcia vytvorená ako koncept", {
        description: `Kód ${result.created.code} · −${result.created.percentage} % na ${result.created.product_count} produktov. Aktivujte ju v Promotions — zatiaľ nikomu nezľavňuje.`,
      })
      onCreated?.()
    } catch (error) {
      toast.error("Akciu sa nepodarilo vytvoriť", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3.5">
      <div className="flex flex-col gap-y-2">
        {rows.map((row) => {
          const checked = selected.has(row.product_id)
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
                onChange={() => toggle(row.product_id)}
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
                <span className="mt-0.5 flex items-center gap-x-2 text-[10.5px] text-ui-fg-muted">
                  <span className="font-mono">{row.sku ?? "—"}</span>
                  <span>·</span>
                  <span className="tabular-nums">
                    {row.abandoned_carts} košíkov · {row.units} ks ·{" "}
                    {formatMoney(row.stranded_value, currency)} uviaznuté
                  </span>
                  {topStage ? (
                    <>
                      <span>·</span>
                      <span>
                        najčastejšie stopli: {STAGE_LABEL[topStage.stage]}
                      </span>
                    </>
                  ) : null}
                </span>
              </span>
            </label>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-ui-border-base pt-3.5">
        <label className="flex items-center gap-x-2 text-[12px] text-ui-fg-subtle">
          Zľava
          <input
            type="number"
            min={1}
            max={90}
            value={percentage}
            onChange={(event) => setPercentage(event.target.value)}
            className="w-16 rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1 text-right text-[12px] tabular-nums text-ui-fg-base"
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
            ? "Vytváram…"
            : `Vytvoriť akciu · ${selected.size} ${
                selected.size === 1 ? "produkt" : "produktov"
              }`}
        </button>

        {!validPercentage ? (
          <span className="text-[11px]" style={{ color: "#ff5b2e" }}>
            Zadajte 1–90 %.
          </span>
        ) : null}
      </div>

      <Text size="xsmall" className="mt-2.5 text-ui-fg-muted">
        Akcia sa vytvorí ako <strong>koncept</strong> s kódom — nikomu nezľavňuje,
        kým ju neaktivujete v Promotions. Percento je váš odhad: z dát o
        opustených košíkoch sa správna výška zľavy odvodiť nedá, vidno z nich
        len to, ktoré produkty zákazníci chceli a nekúpili.
      </Text>
    </div>
  )
}
