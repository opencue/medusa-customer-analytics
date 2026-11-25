import { toNumber } from "./dashboard"

type Adjustment = { code?: string | null; amount?: unknown }
type OrderLine = { adjustments?: Adjustment[] | null }

export type PromotionOrder = {
  id: string
  created_at?: string | Date | null
  status?: string | null
  currency_code: string
  total?: unknown
  tax_total?: unknown
  items?: OrderLine[] | null
  shipping_methods?: OrderLine[] | null
}

type CurrencyPerformance = {
  currency: string
  orders: number
  discount_value: number
  order_value_ex_tax: number | null
}

export const buildPromotionPerformance = (
  code: string,
  orders: PromotionOrder[]
): { code: string; orders: number; by_currency: CurrencyPerformance[] } => {
  const byCurrency = new Map<string, CurrencyPerformance>()
  const counted = new Set<string>()

  for (const order of orders) {
    if (order.status === "canceled" || order.status === "draft" || counted.has(order.id)) continue

    const discount = [...(order.items ?? []), ...(order.shipping_methods ?? [])]
      .flatMap((line) => line.adjustments ?? [])
      .reduce((sum, adjustment) =>
        adjustment.code === code ? sum + toNumber(adjustment.amount) : sum, 0)
    if (discount <= 0) continue

    counted.add(order.id)
    const currency = order.currency_code.toLowerCase()
    const row = byCurrency.get(currency) ??
      { currency, orders: 0, discount_value: 0, order_value_ex_tax: 0 }
    row.orders += 1
    row.discount_value += discount
    row.order_value_ex_tax = row.order_value_ex_tax === null ||
      order.total == null || order.tax_total == null
      ? null
      : row.order_value_ex_tax + toNumber(order.total) - toNumber(order.tax_total)
    byCurrency.set(currency, row)
  }
  return {
    code,
    orders: counted.size,
    by_currency: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
  }
}
