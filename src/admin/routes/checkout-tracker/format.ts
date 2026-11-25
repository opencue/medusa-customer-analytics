/** Presentation helpers for the checkout tracker. Pure, so they stay cheap to
 *  reason about and can be reused by every card on the page. */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const formatCount = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale).format(value)

export const formatMoney = (value: number, currency: string, locale: string): string => {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(value)
  } catch {
    // An unknown currency code must not blank out a KPI card.
    return `${Math.round(value)} ${currency.toUpperCase()}`
  }
}

export const formatPercent = (ratio: number, locale: string, digits = 1): string =>
  new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ratio)

/**
 * Relative time, coarse on purpose. The operator is deciding whether an
 * abandoned cart is still worth a call-back, so "20 min ago" and "3 hr ago"
 * are the distinctions that matter — exact seconds are noise.
 */
export const formatAgo = (iso: string | null, now: number, locale: string): string => {
  if (!iso) return "—"
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "—"

  const diff = Math.max(0, now - then)
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" })
  if (diff < MINUTE) return relative.format(0, "second")
  if (diff < HOUR) return relative.format(-Math.floor(diff / MINUTE), "minute")
  if (diff < DAY) return relative.format(-Math.floor(diff / HOUR), "hour")
  return relative.format(-Math.floor(diff / DAY), "day")
}

export const formatDateTime = (iso: string | null, locale: string): string => {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

/** "cart_01JX…9QF" — enough to match against a Medusa cart without the noise. */
export const shortId = (id: string): string =>
  id.length <= 16 ? id : `${id.slice(0, 9)}…${id.slice(-4)}`
