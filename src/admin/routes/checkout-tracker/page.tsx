import { useMemo, useState, type ReactNode } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Funnel as FunnelIcon } from "@medusajs/icons"
import { useQuery } from "@tanstack/react-query"
import { Badge, Button, Heading, Text } from "@medusajs/ui"

import { withRouteBoundary } from "../../lib/widget-boundary"
import { useCheckoutTranslation } from "../../lib/checkout-i18n"
import { Funnel } from "./funnel"
import { AbandonedProducts, ExitPaths } from "./side-cards"
import { SaleRecommendations } from "./sale-recommendations"
import { matchesSessionFilters } from "./session-filters"
import { SessionTable } from "./session-table"
import { WinBack } from "./win-back"
import { formatCount, formatMoney, formatPercent } from "./format"
import type { CheckoutStatus, Stage, TrackerResponse } from "./types"

/**
 * Checkout tracker — where shoppers give up between "added to cart" and
 * "order placed".
 *
 * Two sources feed one funnel (see the backend module's lib/stages):
 *   - every cart, for the rungs a cart row can prove;
 *   - the storefront beacon, for the two page-only rungs, and only from
 *     visitors who granted analytics consent.
 *
 * That split is surfaced in the UI rather than hidden: page-level columns read
 * "No page data" instead of showing a blank, so nobody reads a gap in the data
 * as a shopper who did nothing.
 */

const RANGES = [7, 14, 30, 90] as const
type RangeDays = (typeof RANGES)[number]
const SESSION_STATUSES = ["active", "abandoned", "completed", "recovered"] as const

const fetchTracker = async (days: number): Promise<TrackerResponse> => {
  const response = await fetch(
    `/admin/checkout-tracking?days=${days}`,
    { credentials: "include" }
  )
  if (!response.ok) {
    throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
  }
  return (await response.json()) as TrackerResponse
}

const Card = ({
  title,
  sub,
  action,
  children,
}: {
  title: string
  sub: ReactNode
  action?: ReactNode
  children: ReactNode
}) => (
  <section className="min-w-0 rounded-lg border border-ui-border-base bg-ui-bg-base p-5">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <Heading level="h2" className="text-ui-fg-base" style={{ fontSize: 16 }}>{title}</Heading>
        <Text size="small" className="text-ui-fg-subtle">{sub}</Text>
      </div>
      {action}
    </div>
    {children}
  </section>
)

const KpiCard = ({
  label,
  value,
  hint,
  detail,
}: {
  label: string
  value: string
  hint?: string
  detail?: string
}) => (
  <div className="min-w-0 bg-ui-bg-base p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <Text size="small" weight="plus" className="text-ui-fg-subtle">{label}</Text>
      {detail ? <Badge size="2xsmall" color="grey">{detail}</Badge> : null}
    </div>
    <div
      className="mt-2 font-medium tabular-nums tracking-tight text-ui-fg-base"
      style={{ fontSize: 30, lineHeight: 1.2 }}
    >
      {value}
    </div>
    {hint ? (
      <Text size="small" className="mt-2 text-ui-fg-subtle">{hint}</Text>
    ) : null}
  </div>
)

const RangeToggle = ({
  value,
  onChange,
}: {
  value: RangeDays
  onChange: (days: RangeDays) => void
}) => {
  const { t, locale } = useCheckoutTranslation()
  return (
    <div role="group" aria-label={t("range")} className="inline-flex flex-wrap gap-1 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-1">
      {RANGES.map((days) => {
        const active = days === value
        return (
          <Button
            key={days}
            type="button"
            size="small"
            variant={active ? "secondary" : "transparent"}
            aria-pressed={active}
            onClick={() => onChange(days)}
          >
            {t("days", { value: formatCount(days, locale) })}
          </Button>
        )
      })}
    </div>
  )
}

const Notice = ({ children }: { children: ReactNode }) => (
  <div role="status" className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3 text-sm text-ui-fg-subtle">
    {children}
  </div>
)

const CheckoutTrackerPage = () => {
  const { t, locale } = useCheckoutTranslation()
  const count = (value: number) => formatCount(value, locale)
  const [days, setDays] = useState<RangeDays>(7)
  const [stageFilter, setStageFilter] = useState<Stage | null>(null)
  const [statusFilter, setStatusFilter] = useState<CheckoutStatus | null>(null)
  const [onlyContactable, setOnlyContactable] = useState(false)
  const [promotionCode, setPromotionCode] = useState("")

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["checkout-tracking", days],
    queryFn: () => fetchTracker(days),
    staleTime: 60_000,
  })

  // A stable "now" per render pass keeps every relative timestamp in the table
  // consistent with each other.
  const now = useMemo(
    () => (data ? new Date(data.range.now).getTime() : Date.now()),
    [data]
  )

  // Filters read the lead cart: it is the state the shopper actually reached,
  // and the row the operator sees.
  const visitors = useMemo(() => {
    if (!data) return []
    return data.visitors.filter((visitor) =>
      matchesSessionFilters(visitor, stageFilter, statusFilter, onlyContactable)
    )
  }, [data, stageFilter, statusFilter, onlyContactable])

  const contactable = useMemo(
    () =>
      data
        ? data.visitors.filter(
            (v) => v.lead.email && v.status === "abandoned"
          ).length
        : 0,
    [data]
  )

  if (isError) {
    return (
      <div className="flex flex-col gap-y-3">
        <Heading level="h1">{t("title")}</Heading>
        <Notice>
          {error && "status" in error
            ? t("loadError", { status: error.status })
            : t("resultsError")}
        </Notice>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-y-4" style={{ width: "100%", maxWidth: 1280, marginInline: "auto" }}>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-ui-border-base pb-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 text-ui-fg-subtle">
            <FunnelIcon aria-hidden="true" />
            <Text size="small" weight="plus">{t("analytics")}</Text>
          </div>
          <Heading level="h1" style={{ fontSize: 28, lineHeight: 1.2, letterSpacing: "-0.025em" }}>{t("title")}</Heading>
          <Text size="small" className="mt-1 text-ui-fg-subtle">
            {t("subtitle")}
          </Text>
        </div>
        <RangeToggle value={days} onChange={setDays} />
      </header>

      {isLoading ? (
        <Text size="small" className="text-ui-fg-subtle">
          {t("loading")}
        </Text>
      ) : null}

      {data ? (
        <>
          {data.scan.capped ? (
            <Notice>
              {data.scan.limited_by === "raw_cart_cap" && data.scan.raw_cap !== undefined
                ? t("rawSample", { limit: count(data.scan.raw_cap) })
                : t("sample", { limit: count(data.scan.carts) })}
            </Notice>
          ) : null}

          <div
            aria-label={t("overview")}
            role="group"
            className="grid overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-subtle"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 1, background: "var(--border-base)" }}
          >
            <KpiCard
              label={t("adds")}
              value={count(data.add_to_cart.adds)}
              detail={t("distinctCarts", { value: count(data.add_to_cart.carts) })}
              hint={t("addsRetention", { hours: count(data.add_to_cart.retention_hours) })}
            />
            <KpiCard
              label={t("completed")}
              value={count(data.totals.completed)}
              hint={t("conversion", {
                rate: formatPercent(data.totals.conversion_rate, locale),
                recovered: count(data.totals.recovered),
              })}
            />
            <KpiCard
              label={t("abandoned")}
              value={count(data.totals.abandoned)}
              hint={t("contactable", { value: count(contactable) })}
            />
            <KpiCard
              label={t("inProgress")}
              value={count(data.totals.active)}
              hint={t("inactivity", { minutes: count(data.abandonment_minutes) })}
            />
          </div>

          <Card
            title={t("funnel")}
            sub={t("funnelHint", {
              observed: count(data.totals.with_storefront_data),
              total: count(data.totals.tracked),
            })}
            action={
              stageFilter ? (
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  onClick={() => setStageFilter(null)}
                >
                  {t("clearFilter")}
                </Button>
              ) : undefined
            }
          >
            <Funnel
              rows={data.funnel}
              selected={stageFilter}
              onSelect={setStageFilter}
            />
          </Card>

          {data.totals.by_currency.length ? (
            <Card title={t("values")} sub={t("valuesHint")}>
              <ul className="mt-3 divide-y divide-ui-border-base">
                {data.totals.by_currency.map((row) => (
                  <li key={row.currency} className="flex flex-wrap items-center gap-3 py-2">
                    <Badge size="small" color="grey">{row.currency.toUpperCase()}</Badge>
                    <Text size="small" className="tabular-nums">{t("lostValue", { amount: formatMoney(row.lost_value, row.currency, locale) })}</Text>
                    <Text size="small" className="tabular-nums">{t("convertedValue", { amount: formatMoney(row.converted_value, row.currency, locale) })}</Text>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card
            title={t("recommendations")}
            sub={t("recommendationsHint")}
          >
            {data.scan.capped || data.scan.orders_capped ? (
              <Notice>{t("incomplete")}</Notice>
            ) : (
              <SaleRecommendations key={days} rows={data.sale_candidates} onCreated={setPromotionCode} />
            )}
          </Card>

          <Card title={t("winBack")} sub={t("winBackHint")}>
            <WinBack days={days} code={promotionCode} onCodeChange={setPromotionCode} />
          </Card>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card
              title={t("exitPages")}
              sub={t("exitPagesHint")}
            >
              <ExitPaths rows={data.exit_paths} />
            </Card>
            <Card
              title={t("topProducts")}
              sub={t("topProductsHint")}
            >
              <AbandonedProducts rows={data.abandoned_products} />
            </Card>
          </div>

          <Card
            title={t("sessions")}
            sub={
              <span aria-live="polite">
                {stageFilter
                  ? t("lastStage", { stage: t(`stage.${stageFilter}`), value: count(visitors.length) })
                  : statusFilter || onlyContactable
                    ? count(visitors.length)
                    : t("allSessions", { value: count(visitors.length) })}
                {statusFilter ? ` · ${t(`status.${statusFilter}`)}` : null}
                {onlyContactable ? ` · ${t("emailOnly")}` : null}
              </span>
            }
            action={
              <button
                type="button"
                onClick={() => setOnlyContactable((value) => !value)}
                aria-pressed={onlyContactable}
                className={`shrink-0 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                  onlyContactable
                    ? "border-ui-border-interactive bg-ui-bg-component text-ui-fg-base"
                    : "border-ui-border-base text-ui-fg-subtle hover:text-ui-fg-base"
                }`}
              >
                {t("emailOnly")}
              </button>
            }
          >
            <div role="group" aria-label={t("checkoutStatus")} className="mt-3 flex flex-wrap gap-1">
              {SESSION_STATUSES.map((status) => (
                <Button
                  key={status}
                  type="button"
                  size="small"
                  variant={statusFilter === status ? "secondary" : "transparent"}
                  aria-pressed={statusFilter === status}
                  onClick={() => setStatusFilter((current) => current === status ? null : status)}
                >
                  {t(`status.${status}`)}
                </Button>
              ))}
            </div>
            <SessionTable visitors={visitors} now={now} />
          </Card>

          <Text size="xsmall" className="text-ui-fg-muted">
            {t("consent")}
          </Text>
        </>
      ) : null}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "title",
  // Medusa extracts route config statically; this must be a string literal.
  translationNs: "checkout-analytics",
  icon: FunnelIcon,
})

export default withRouteBoundary(CheckoutTrackerPage, "Checkout tracker")
