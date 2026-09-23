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

const relativeTime = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto', style: 'short' })

/** "5 min. ago" / "yesterday" for an ISO timestamp; "just now" under a minute. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const secs = Math.round((then - now.getTime()) / 1000)
  if (Math.abs(secs) < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (Math.abs(mins) < 60) return relativeTime.format(mins, 'minute')
  const hours = Math.round(mins / 60)
  if (Math.abs(hours) < 24) return relativeTime.format(hours, 'hour')
  return relativeTime.format(Math.round(hours / 24), 'day')
}
