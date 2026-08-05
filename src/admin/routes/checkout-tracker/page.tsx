import { useMemo, useState, type ReactNode } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Funnel as FunnelIcon } from "@medusajs/icons"
import { useQuery } from "@tanstack/react-query"
import { Heading, Text } from "@medusajs/ui"

import { withRouteBoundary } from "../../lib/widget-boundary"
import { Funnel } from "./funnel"
import { AbandonedProducts, ExitPaths } from "./side-cards"
import { SaleRecommendations } from "./sale-recommendations"
import { SessionTable } from "./session-table"
import { formatMoney, formatPercent } from "./format"
import { STAGE_LABEL, type Stage, type TrackerResponse } from "./types"

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
 * "bez súhlasu" instead of showing a blank, so nobody reads a gap in the data
 * as a shopper who did nothing.
 */

const RANGES = [7, 14, 30, 90] as const
type RangeDays = (typeof RANGES)[number]

const RANGE_LABEL: Record<RangeDays, string> = {
  7: "7 dní",
  14: "14 dní",
  30: "30 dní",
  90: "90 dní",
}

const GREEN = "#3dd68c"
const ORANGE = "#ff5b2e"

const fetchTracker = async (days: number): Promise<TrackerResponse> => {
  const response = await fetch(
    `/admin/checkout-tracking?days=${days}`,
    { credentials: "include" }
  )
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(
      `Nepodarilo sa načítať tracker (HTTP ${response.status}): ${body.slice(0, 200)}`
    )
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
  sub: string
  action?: ReactNode
  children: ReactNode
}) => (
  <div className="rounded-xl border border-ui-border-base bg-ui-bg-base p-5">
    <div className="flex items-start justify-between gap-x-3">
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold text-ui-fg-base">
          {title}
        </div>
        <div className="mt-0.5 text-[11.5px] text-ui-fg-muted">{sub}</div>
      </div>
      {action}
    </div>
    {children}
  </div>
)

const KpiCard = ({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: "good" | "bad"
}) => (
  <div className="rounded-xl border border-ui-border-base bg-ui-bg-base p-4">
    <div className="text-[11.5px] text-ui-fg-muted">{label}</div>
    <div
      className="mt-1 text-[22px] font-semibold leading-tight tabular-nums"
      style={{
        color:
          tone === "good" ? GREEN : tone === "bad" ? ORANGE : undefined,
      }}
    >
      <span className={tone ? undefined : "text-ui-fg-base"}>{value}</span>
    </div>
    {hint ? (
      <div className="mt-1 text-[11px] text-ui-fg-subtle">{hint}</div>
    ) : null}
  </div>
)

const RangeToggle = ({
  value,
  onChange,
}: {
  value: RangeDays
  onChange: (days: RangeDays) => void
}) => (
  <div className="inline-flex rounded-lg border border-ui-border-base bg-ui-bg-subtle p-0.5">
    {RANGES.map((days) => {
      const active = days === value
      return (
        <button
          key={days}
          type="button"
          onClick={() => onChange(days)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            active
              ? "bg-ui-bg-base text-ui-fg-base shadow-sm"
              : "text-ui-fg-subtle hover:text-ui-fg-base"
          }`}
        >
          {RANGE_LABEL[days]}
        </button>
      )
    })}
  </div>
)

const Notice = ({ children }: { children: ReactNode }) => (
  <div
    className="rounded-lg border px-3.5 py-2.5 text-[11.5px]"
    style={{
      borderColor: "rgba(255,91,46,0.35)",
      background: "rgba(255,91,46,0.08)",
      color: ORANGE,
    }}
  >
    {children}
  </div>
)

const CheckoutTrackerPage = () => {
  const [days, setDays] = useState<RangeDays>(7)
  const [stageFilter, setStageFilter] = useState<Stage | null>(null)
  const [onlyContactable, setOnlyContactable] = useState(false)

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

  const sessions = useMemo(() => {
    if (!data) return []
    return data.sessions.filter((session) => {
      if (stageFilter && session.stage !== stageFilter) return false
      if (onlyContactable && !session.email) return false
      return true
    })
  }, [data, stageFilter, onlyContactable])

  const contactable = useMemo(
    () =>
      data
        ? data.sessions.filter((s) => s.email && s.stage !== "completed").length
        : 0,
    [data]
  )

  if (isError) {
    return (
      <div className="flex flex-col gap-y-3">
        <Heading level="h1">Checkout tracker</Heading>
        <Notice>
          {error instanceof Error ? error.message : "Načítanie zlyhalo."}
        </Notice>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-x-2">
          <FunnelIcon className="text-ui-fg-subtle" />
          <div>
            <Heading level="h1">Checkout tracker</Heading>
            <Text size="xsmall" className="text-ui-fg-muted">
              Kde zákazníci prestali — od pridania do košíka po objednávku
            </Text>
          </div>
        </div>
        <RangeToggle value={days} onChange={setDays} />
      </div>

      {isLoading ? (
        <Text size="small" className="text-ui-fg-subtle">
          Načítavam košíky…
        </Text>
      ) : null}

      {data ? (
        <>
          {data.scan.capped ? (
            <Notice>
              Zobrazených je najnovších {data.scan.cap} košíkov — staršia časť
              obdobia sa do výpočtu nedostala. Čísla sú vzorka, nie celé
              obdobie.
            </Notice>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label={`Košíky · ${RANGE_LABEL[days]}`}
              value={String(data.totals.tracked)}
              hint={`${data.totals.with_storefront_data} so stránkovými dátami`}
            />
            <KpiCard
              label="Dokončené objednávky"
              value={String(data.totals.completed)}
              hint={`Konverzia ${formatPercent(data.totals.conversion_rate)}`}
              tone="good"
            />
            <KpiCard
              label="Opustené košíky"
              value={String(data.totals.abandoned)}
              hint={`${contactable} má e-mail — dajú sa osloviť`}
              tone="bad"
            />
            <KpiCard
              label="Stratená hodnota"
              value={formatMoney(data.totals.lost_value, data.totals.currency)}
              hint={`Dokončené: ${formatMoney(
                data.totals.converted_value,
                data.totals.currency
              )}`}
              tone="bad"
            />
          </div>

          <Card
            title="Lievik checkoutu"
            sub="Kliknutím na krok vyfiltrujete zákazníkov, ktorí skončili práve tam"
            action={
              stageFilter ? (
                <button
                  type="button"
                  onClick={() => setStageFilter(null)}
                  className="shrink-0 rounded-md border border-ui-border-base px-2 py-1 text-[11px] text-ui-fg-subtle transition-colors hover:text-ui-fg-base"
                >
                  Zrušiť filter
                </button>
              ) : undefined
            }
          >
            <Funnel
              rows={data.funnel}
              selected={stageFilter}
              onSelect={setStageFilter}
            />
          </Card>

          <Card
            title="Čo dať do akcie"
            sub="Najviac pridávané do košíka a ani raz nepredané za zvolené obdobie"
          >
            <SaleRecommendations
              rows={data.sale_candidates}
              currency={data.totals.currency}
            />
          </Card>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card
              title="Odkiaľ odišli"
              sub="Posledná stránka pred odchodom · len opustené košíky"
            >
              <ExitPaths rows={data.exit_paths} />
            </Card>
            <Card
              title="Najčastejšie opustené produkty"
              sub="Zoradené podľa počtu košíkov, v ktorých uviazli"
            >
              <AbandonedProducts
                rows={data.abandoned_products}
                currency={data.totals.currency}
              />
            </Card>
          </div>

          <Card
            title="Zákazníci"
            sub={
              stageFilter
                ? `Skončili na kroku „${STAGE_LABEL[stageFilter]}“ · ${sessions.length}`
                : `Všetky sledované košíky · ${sessions.length}`
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
                Len s e-mailom
              </button>
            }
          >
            <SessionTable sessions={sessions} now={now} />
          </Card>

          <Text size="xsmall" className="text-ui-fg-muted">
            Kroky adresa / doprava / platba / objednané sa odvodzujú z košíka,
            takže platia pre každého zákazníka. Stránkové údaje (otvorenie
            checkoutu, súhrn, zariadenie, posledná stránka) zbiera storefront
            len so súhlasom s analytickými cookies a mažú sa 72 hodín po
            poslednej návšteve.
          </Text>
        </>
      ) : null}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Checkout tracker",
  icon: FunnelIcon,
})

export default withRouteBoundary(CheckoutTrackerPage, "Checkout tracker")
