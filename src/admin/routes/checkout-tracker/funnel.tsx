import { Badge, Text } from "@medusajs/ui"

import { useCheckoutTranslation } from "../../lib/checkout-i18n"
import { formatCount, formatPercent } from "./format"
import {
  STAGE_COLOR,
  type FunnelRow,
  type Stage,
} from "./types"

/**
 * The funnel shows where shoppers stopped.
 *
 * Each rung is a bar whose width is the share of tracked shoppers that got at
 * least that far, so the taper IS the drop-off. Between two rungs sits the
 * count that stopped there; that number, not the bar, is what the operator
 * acts on, so it is rendered as a chip rather than left to be inferred from
 * two bar lengths.
 *
 * Rows are buttons: clicking one filters the session list below to the people
 * who stopped exactly there. The funnel is the diagnosis, the table is the
 * phone list.
 */
export const Funnel = ({
  rows,
  selected,
  onSelect,
}: {
  rows: FunnelRow[]
  selected: Stage | null
  onSelect: (stage: Stage | null) => void
}) => {
  const { t, locale } = useCheckoutTranslation()
  const total = rows[0]?.reached ?? 0

  if (!total) {
    return (
      <Text size="small" className="text-ui-fg-subtle">
        {t("emptyFunnel")}
      </Text>
    )
  }

  return (
    <ol className="mt-4 divide-y divide-ui-border-base overflow-hidden rounded-lg border border-ui-border-base">
      {rows.map((row, i) => {
        const isSelected = selected === row.stage
        const lost = row.stage === "completed" ? 0 : row.dropped
        return (
          <li key={row.stage}>
            <button
              type="button"
              onClick={() => onSelect(isSelected ? null : row.stage)}
              aria-pressed={isSelected}
              className={`w-full px-3 py-3 text-start focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ui-border-interactive ${
                isSelected ? "bg-ui-bg-component" : "hover:bg-ui-bg-subtle-hover"
              }`}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="me-2 font-mono text-xs tabular-nums text-ui-fg-subtle">
                    {new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 }).format(i + 1)}
                  </span>
                  <span className="text-sm font-medium text-ui-fg-base">{t(`stage.${row.stage}`)}</span>
                  <span className="block text-xs text-ui-fg-subtle">{t(`stageHint.${row.stage}`)}</span>
                </span>
                <span className="shrink-0 text-end text-sm font-medium tabular-nums text-ui-fg-base">
                  {formatCount(row.reached, locale)}
                  <span className="ms-2 text-xs font-normal text-ui-fg-subtle">{formatPercent(row.reach_rate, locale, 0)}</span>
                </span>
              </span>
              <span aria-hidden="true" className="mt-2 block overflow-hidden rounded bg-ui-bg-component" style={{ height: 5 }}>
                <span
                  className="block h-full rounded"
                  style={{ width: `${row.reach_rate * 100}%`, background: "var(--fg-base)" }}
                />
              </span>
              {lost ? (
                <span className="mt-2 block">
                  <Badge size="2xsmall" color="orange">{t("dropOff", { value: formatCount(lost, locale) })} · {formatPercent(row.drop_rate, locale)}</Badge>
                </span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Seven dots, one per rung, filled up to where this shopper got. Reads at a
 * glance in a dense table row where a full funnel would not fit.
 *
 * The unreached dots carry a theme token class rather than an inline colour.
 * They previously used `var(--border-base)` — which resolves to
 * rgba(255,255,255,0.08) — dimmed further by opacity 0.45, for an effective
 * 3.6% alpha: invisible. That silently turned a "3 of 7" position indicator
 * into a bare count of filled dots, which is a different (and misleading)
 * statement. A token also keeps it correct in the light admin theme, where a
 * hard-coded white would vanish just as badly.
 */
export const StageDots = ({ stage, all }: { stage: Stage; all: Stage[] }) => {
  const reachedIndex = all.indexOf(stage)
  return (
    <span className="inline-flex items-center gap-[3px]">
      {all.map((s, i) => {
        const reached = i <= reachedIndex
        return (
          <span
            key={s}
            className={`size-[5px] rounded-full ${
              reached ? "" : "bg-ui-border-strong"
            }`}
            style={reached ? { background: STAGE_COLOR[stage] } : undefined}
          />
        )
      })}
    </span>
  )
}
