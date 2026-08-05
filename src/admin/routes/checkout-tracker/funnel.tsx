import { Text } from "@medusajs/ui"

import { formatPercent } from "./format"
import {
  STAGE_COLOR,
  STAGE_HINT,
  STAGE_LABEL,
  type FunnelRow,
  type Stage,
} from "./types"

/**
 * The funnel — the page's answer to "kde to zákazníci vzdali".
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
  const total = rows[0]?.reached ?? 0

  if (!total) {
    return (
      <Text size="small" className="text-ui-fg-subtle">
        V tomto období nikto nepridal nič do košíka.
      </Text>
    )
  }

  return (
    <div className="mt-4 flex flex-col">
      {rows.map((row, i) => {
        const isLast = i === rows.length - 1
        const isActive = selected === row.stage
        // On the final rung `dropped` is the conversions, not a loss.
        const lost = isLast ? 0 : row.dropped

        return (
          <div key={row.stage}>
            <button
              type="button"
              onClick={() => onSelect(isActive ? null : row.stage)}
              aria-pressed={isActive}
              className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                isActive
                  ? "bg-ui-bg-component"
                  : "hover:bg-ui-bg-subtle-hover"
              }`}
            >
              <div className="flex items-baseline justify-between gap-x-3">
                <div className="flex min-w-0 items-baseline gap-x-2">
                  <span
                    className="inline-flex size-[18px] shrink-0 translate-y-[3px] items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ background: STAGE_COLOR[row.stage] }}
                  >
                    {i + 1}
                  </span>
                  <span className="truncate text-[13px] font-semibold text-ui-fg-base">
                    {STAGE_LABEL[row.stage]}
                  </span>
                  <span className="hidden truncate text-[11px] text-ui-fg-muted lg:inline">
                    {STAGE_HINT[row.stage]}
                  </span>
                </div>
                <div className="flex shrink-0 items-baseline gap-x-2 tabular-nums">
                  <span className="text-[13px] font-semibold text-ui-fg-base">
                    {row.reached}
                  </span>
                  <span className="w-[52px] text-right text-[11px] text-ui-fg-subtle">
                    {formatPercent(row.reach_rate, 0)}
                  </span>
                </div>
              </div>

              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-ui-bg-component">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${Math.max(row.reach_rate * 100, row.reached > 0 ? 1.5 : 0)}%`,
                    background: `linear-gradient(90deg, ${STAGE_COLOR[row.stage]}, ${STAGE_COLOR[row.stage]}bb)`,
                  }}
                />
              </div>
            </button>

            {!isLast ? (
              <div className="flex items-center gap-x-2 py-1 pl-[13px] pr-2.5">
                <span className="h-3.5 w-px bg-ui-border-strong" />
                {lost > 0 ? (
                  <span
                    className="rounded-full px-2 py-[2px] text-[10.5px] font-medium tabular-nums"
                    style={{
                      background: "rgba(255,91,46,0.12)",
                      color: "#ff5b2e",
                    }}
                  >
                    ↓ {lost} odišlo · {formatPercent(row.drop_rate, 1)}
                  </span>
                ) : (
                  <span className="text-[10.5px] text-ui-fg-muted">
                    ↓ nikto neodišiel
                  </span>
                )}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
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
