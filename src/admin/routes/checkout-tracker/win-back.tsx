import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button, Input, Text } from "@medusajs/ui"

import { formatMoney } from "./format"
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
          Kód akcie
          <Input value={input} onChange={(event) => setInput(event.target.value)} maxLength={40} required />
        </label>
        <Button type="submit" size="small" disabled={!input.trim()}>
          Zobraziť výsledky
        </Button>
      </form>

      {isFetching ? <Text role="status" size="xsmall">Načítavam výsledky…</Text> : null}
      {isError ? <Text role="alert" size="xsmall">Výsledky sa nepodarilo načítať.</Text> : null}
      {data && !isError ? (
        <div aria-live="polite">
          {data.scan.capped ? (
            <Text role="status" size="xsmall">
              Len vzorka: staršie objednávky presiahli limit {data.scan.cap}. Skúste kratšie obdobie.
            </Text>
          ) : null}
          <Text size="small"><strong>{data.code}</strong> · {data.orders} objednávok s kódom</Text>
          <ul className="mt-1 space-y-1 text-xs">
            {data.by_currency.map((row) => (
              <li key={row.currency}>
                <strong>{row.currency.toUpperCase()}</strong> · {row.orders} obj. · Zľava kódu:{" "}
                {formatMoney(row.discount_value, row.currency)} · Hodnota bez DPH:{" "}
                {row.order_value_ex_tax === null ? "nedostupná" : formatMoney(row.order_value_ex_tax, row.currency)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Text size="xsmall" className="text-ui-fg-muted">
        Hodnota objednávok po zľavách, bez DPH a pred refundáciami. Použitie kódu samo nepreukazuje
        dodatočný predaj.
      </Text>
    </div>
  )
}
