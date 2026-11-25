import { useMemo, useState, type ReactNode } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Funnel as FunnelIcon } from "@medusajs/icons"
import { useQuery } from "@tanstack/react-query"
import { Badge, Button, Heading, Text } from "@medusajs/ui"

import { withRouteBoundary } from "../../lib/widget-boundary"
import { Funnel } from "./funnel"
import { AbandonedProducts, ExitPaths } from "./side-cards"
import { SaleRecommendations } from "./sale-recommendations"
import { SessionTable } from "./session-table"
import { WinBack } from "./win-back"
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

const formatCount = new Intl.NumberFormat("sk-SK").format

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
}) => (
  <div role="group" aria-label="Obdobie" className="inline-flex flex-wrap gap-1 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-1">
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
          {RANGE_LABEL[days]}
        </Button>
      )
    })}
  </div>
)

const Notice = ({ children }: { children: ReactNode }) => (
  <div role="status" className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3 text-sm text-ui-fg-subtle">
    {children}
  </div>
)

const CheckoutTrackerPage = () => {
  const [days, setDays] = useState<RangeDays>(7)
  const [stageFilter, setStageFilter] = useState<Stage | null>(null)
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
    return data.visitors.filter(({ lead }) => {
      if (stageFilter && lead.stage !== stageFilter) return false
      if (onlyContactable && !lead.email) return false
      return true
    })
  }, [data, stageFilter, onlyContactable])

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
        <Heading level="h1">Checkout tracker</Heading>
        <Notice>
          {error instanceof Error ? error.message : "Načítanie zlyhalo."}
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
            <Text size="small" weight="plus">Analytika</Text>
          </div>
          <Heading level="h1" style={{ fontSize: 28, lineHeight: 1.2, letterSpacing: "-0.025em" }}>Checkout tracker</Heading>
          <Text size="small" className="mt-1 text-ui-fg-subtle">
            Od pridania do košíka po dokončenú objednávku.
          </Text>
        </div>
        <RangeToggle value={days} onChange={setDays} />
      </header>

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

          <div
            aria-label="Prehľad checkoutu"
            role="group"
            className="grid overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-subtle"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 1, background: "var(--border-base)" }}
          >
            <KpiCard
              label="Úspešné pridania do košíka"
              value={formatCount(data.add_to_cart.adds)}
              detail={`${formatCount(data.add_to_cart.carts)} rôznych košíkov`}
              hint={`Od zapnutia merania, najviac za ${data.add_to_cart.retention_hours} h`}
            />
            <KpiCard
              label="Dokončené checkouty"
              value={formatCount(data.totals.completed)}
              hint={`Konverzia ${formatPercent(data.totals.conversion_rate)} · ${data.totals.recovered} po návrate`}
            />
            <KpiCard
              label="Opustené košíky"
              value={formatCount(data.totals.abandoned)}
              hint={`${contactable} má e-mail — dajú sa osloviť`}
            />
            <KpiCard
              label="Rozpracované košíky"
              value={formatCount(data.totals.active)}
              hint={`Opustené po ${data.abandonment_minutes} min bez zaznamenanej aktivity`}
            />
          </div>

          <Card
            title="Lievik checkoutu"
            sub={`Podiel od prvého kroku · ${formatCount(data.totals.with_storefront_data)} z ${formatCount(data.totals.tracked)} má údaje z e-shopu. Kliknutím vyfiltrujete posledný krok.`}
            action={
              stageFilter ? (
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  onClick={() => setStageFilter(null)}
                >
                  Zrušiť filter
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
            <Card title="Hodnota košíkov podľa meny" sub="Hodnota košíkov, nie vykázaná tržba">
              <ul className="mt-3 divide-y divide-ui-border-base">
                {data.totals.by_currency.map((row) => (
                  <li key={row.currency} className="flex flex-wrap items-center gap-3 py-2">
                    <Badge size="small" color="grey">{row.currency.toUpperCase()}</Badge>
                    <Text size="small" className="tabular-nums">Opustené: {formatMoney(row.lost_value, row.currency)}</Text>
                    <Text size="small" className="tabular-nums">Dokončené: {formatMoney(row.converted_value, row.currency)}</Text>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card
            title="Čo preveriť pri opustených košíkoch"
            sub="Najviac pridávané do košíka a ani raz nepredané za zvolené obdobie"
          >
            {data.scan.capped || data.scan.orders_capped ? (
              <Notice>Neúplné údaje. Pre odporúčania vyberte kratšie obdobie.</Notice>
            ) : (
              <SaleRecommendations key={days} rows={data.sale_candidates} onCreated={setPromotionCode} />
            )}
          </Card>

          <Card title="Výsledky win-back akcií" sub="Objednávky a zľavy podľa kódu vo zvolenom období">
            <WinBack days={days} code={promotionCode} onCodeChange={setPromotionCode} />
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
              <AbandonedProducts rows={data.abandoned_products} />
            </Card>
          </div>

          <Card
            title="Zákazníci"
            sub={
              stageFilter
                ? `Posledný krok „${STAGE_LABEL[stageFilter]}“ · ${visitors.length}`
                : `Všetky sledované košíky · ${visitors.length}`
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
            <SessionTable visitors={visitors} now={now} />
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
