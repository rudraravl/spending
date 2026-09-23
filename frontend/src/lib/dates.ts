/**
 * Calendar-date helpers. API dates are plain `YYYY-MM-DD` strings in the user's local calendar.
 * Avoid `new Date('YYYY-MM-DD')` (parsed as UTC midnight, so it shows the previous day west of UTC)
 * and `toISOString().slice(0, 10)` (the UTC date, which is tomorrow on a US evening).
 */

/** `YYYY-MM-DD` for the local calendar day of `d`. */
export function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayIso(): string {
  return toLocalIsoDate(new Date())
}

/** Local calendar date `days` before `from` (DST-safe: steps calendar days, not 24h blocks). */
export function daysAgoIso(days: number, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - days)
  return toLocalIsoDate(d)
}

/** Local-midnight Date for a `YYYY-MM-DD` (or ISO datetime) string, or null if unparseable. */
export function parseIsoDate(value: string): Date | null {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

/** "Jan 5" for a `YYYY-MM-DD` (or ISO datetime) string; returns the input if unparseable. */
export function fmtShortDate(value: string): string {
  const d = parseIsoDate(value)
  return d ? shortDate.format(d) : value
}
