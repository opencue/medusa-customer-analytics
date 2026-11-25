import { Text } from "@medusajs/ui"

import { useCheckoutTranslation } from "../../lib/checkout-i18n"
import { formatCount, formatMoney } from "./format"
import type { AbandonedProduct } from "./types"

const ACCENT = "#6366f1"
const ACCENT_SOFT = "#818cf8"
const ORANGE = "#ff5b2e"

/**
 * Which page abandoned shoppers were last seen on.
 *
 * Only shoppers with analytics consent contribute a path, so this is a sample,
 * not the whole window — the card says so rather than implying full coverage.
 */
export const ExitPaths = ({
  rows,
}: {
  rows: Array<{ path: string; count: number }>
}) => {
  const { t, locale } = useCheckoutTranslation()
  if (!rows.length) {
    return (
      <Text size="xsmall" className="mt-4 text-ui-fg-subtle">
        {t("emptyExitPages")}
      </Text>
    )
  }

  const max = Math.max(...rows.map((row) => row.count))

  return (
    <div className="mt-3.5 flex flex-col gap-y-3">
      {rows.map((row) => (
        <div key={row.path}>
          <div className="mb-1.5 flex items-baseline justify-between gap-x-3">
            <span className="truncate font-mono text-[11.5px] text-ui-fg-base">
              <bdi>{row.path}</bdi>
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-ui-fg-subtle">
              {formatCount(row.count, locale)}
            </span>
          </div>
          <div className="h-[7px] overflow-hidden rounded bg-ui-bg-component">
            <div
              className="h-full rounded"
              style={{
                width: `${(row.count / max) * 100}%`,
                background: `linear-gradient(90deg, ${ORANGE}, ${ORANGE}99)`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Products that keep getting left behind, ranked by how many carts they sat in
 * — not by value. A cheap accessory blocking 30 checkouts is a bigger problem
 * than one stranded €2000 machine, and ranking by money would bury it.
 */
export const AbandonedProducts = ({
  rows,
}: {
  rows: AbandonedProduct[]
}) => {
  const { t, locale } = useCheckoutTranslation()
  if (!rows.length) {
    return (
      <Text size="xsmall" className="mt-4 text-ui-fg-subtle">
        {t("emptyProducts")}
      </Text>
    )
  }

  const max = Math.max(...rows.map((row) => row.carts))

  return (
    <div className="mt-3.5 flex flex-col gap-y-2.5">
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-x-2.5">
          <span className="size-8 shrink-0 overflow-hidden rounded-md border border-ui-border-base bg-ui-bg-component">
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

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-x-3">
              <span className="truncate text-[12px] text-ui-fg-base">
                {row.title}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-ui-fg-subtle">
                {t("carts", { value: formatCount(row.carts, locale) })}
              </span>
            </div>
            <div className="mt-1 h-[6px] overflow-hidden rounded bg-ui-bg-component">
              <div
                className="h-full rounded"
                style={{
                  width: `${(row.carts / max) * 100}%`,
                  background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_SOFT})`,
                }}
              />
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-x-3 text-[10.5px] text-ui-fg-muted">
              <span className="truncate font-mono">{row.sku ?? "—"}</span>
              <span className="tabular-nums">
                {t("units", { value: formatCount(row.units, locale) })} · {formatMoney(row.value, row.currency, locale)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
