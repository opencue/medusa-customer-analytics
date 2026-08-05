/** Presentation helpers for the checkout tracker. Pure, so they stay cheap to
 *  reason about and can be reused by every card on the page. */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const formatMoney = (value: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("sk-SK", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    }).format(value)
  } catch {
    // An unknown currency code must not blank out a KPI card.
    return `${Math.round(value)} ${currency.toUpperCase()}`
  }
}

export const formatPercent = (ratio: number, digits = 1): string =>
  `${(ratio * 100).toFixed(digits).replace(".", ",")} %`

/**
 * Slovak relative time, coarse on purpose. The operator is deciding whether an
 * abandoned cart is still worth a call-back, so "pred 20 min" and "pred 3 h"
 * are the distinctions that matter — exact seconds are noise.
 */
export const formatAgo = (iso: string | null, now: number): string => {
  if (!iso) return "—"
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "—"

  const diff = Math.max(0, now - then)
  if (diff < MINUTE) return "teraz"
  if (diff < HOUR) return `pred ${Math.floor(diff / MINUTE)} min`
  if (diff < DAY) return `pred ${Math.floor(diff / HOUR)} h`
  const days = Math.floor(diff / DAY)
  return days === 1 ? "včera" : `pred ${days} dňami`
}

export const formatDateTime = (iso: string | null): string => {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("sk-SK", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

/** "cart_01JX…9QF" — enough to match against a Medusa cart without the noise. */
export const shortId = (id: string): string =>
  id.length <= 16 ? id : `${id.slice(0, 9)}…${id.slice(-4)}`

export const DEVICE_LABEL: Record<string, string> = {
  mobile: "Mobil",
  tablet: "Tablet",
  desktop: "Desktop",
}
