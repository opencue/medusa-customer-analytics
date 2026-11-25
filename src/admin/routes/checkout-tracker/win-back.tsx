import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button, Input, Text } from "@medusajs/ui"

import { useCheckoutTranslation } from "../../lib/checkout-i18n"
import { formatCount, formatMoney } from "./format"
import type { PromotionPerformance } from "./types"

const fetchPerformance = async (code: string, days: number): Promise<PromotionPerformance> => {
  const params = new URLSearchParams({ code, days: String(days) })
  const response = await fetch(`/admin/checkout-tracking/promotions?${params}`, {
    credentials: "include",
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as PromotionPerformance
}

export const WinBack = ({
  days, code, onCodeChange,
}: {
  days: number
  code: string
  onCodeChange: (code: string) => void
}) => {
  const { t, locale } = useCheckoutTranslation()
  const [input, setInput] = useState(code)
  useEffect(() => setInput(code), [code])
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["checkout-tracking", "promotions", days, code],
    queryFn: () => fetchPerformance(code, days),
    enabled: code.length > 0,
  })

  return (
    <div className="mt-3 flex flex-col gap-2">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          const next = input.trim()
          if (!next) return
          if (next === code) void refetch()
          else onCodeChange(next)
        }}
      >
        <label className="flex flex-col gap-1 text-xs">
          {t("promoCode")}
          <Input value={input} onChange={(event) => setInput(event.target.value)} maxLength={40} dir="auto" required />
        </label>
        <Button type="submit" size="small" disabled={!input.trim()}>
          {t("showResults")}
        </Button>
      </form>

      {isFetching ? <Text role="status" size="xsmall">{t("loadingResults")}</Text> : null}
      {isError ? <Text role="alert" size="xsmall">{t("resultsError")}</Text> : null}
      {data && !isError ? (
        <div aria-live="polite">
          {data.scan.capped ? (
            <Text role="status" size="xsmall">
              {t("orderSample", { limit: formatCount(data.scan.cap, locale) })}
            </Text>
          ) : null}
          <Text size="small"><strong><bdi>{data.code}</bdi></strong> · {t("ordersWithCode", { value: formatCount(data.orders, locale) })}</Text>
          <ul className="mt-1 space-y-1 text-xs">
            {data.by_currency.map((row) => (
              <li key={row.currency}>
                <strong><bdi>{row.currency.toUpperCase()}</bdi></strong> · {t("orders", { value: formatCount(row.orders, locale) })} ·{" "}
                {t("codeDiscount", { amount: formatMoney(row.discount_value, row.currency, locale) })} ·{" "}
                {t("netValue", {
                  amount: row.order_value_ex_tax === null ? t("unavailable") : formatMoney(row.order_value_ex_tax, row.currency, locale),
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Text size="xsmall" className="text-ui-fg-muted">
        {t("winBackFootnote")}
      </Text>
    </div>
  )
}
