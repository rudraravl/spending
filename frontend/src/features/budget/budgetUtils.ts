import { formatSignedUsd } from '@/lib/format'
import type { ZbbCategoryRowOut } from '@/types'

export type YearMonth = { year: number; month: number }

/** Integer cents for comparisons — avoids float noise at penny boundaries. */
export function cents(n: number): number {
  return Math.round(n * 100)
}

/** USD with a typographic minus and no "−$0.00" from float dust. */
export function usd(n: number): string {
  return formatSignedUsd(cents(n) === 0 ? 0 : n)
}

export function monthLabel(ym: YearMonth, opts: { short?: boolean } = {}): string {
  return new Date(ym.year, ym.month - 1, 1).toLocaleString(undefined, {
    month: opts.short ? 'short' : 'long',
    year: 'numeric',
  })
}

export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const idx = ym.year * 12 + (ym.month - 1) + delta
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

export function compareMonths(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month)
}

export function currentMonth(): YearMonth {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

export function monthRange(ym: YearMonth): { startDate: string; endDate: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const last = new Date(ym.year, ym.month, 0).getDate()
  return {
    startDate: `${ym.year}-${pad(ym.month)}-01`,
    endDate: `${ym.year}-${pad(ym.month)}-${pad(last)}`,
  }
}

/**
 * Parse what someone typed into an Assigned cell. Plain numbers replace the value;
 * a leading + or − adjusts the current value (YNAB-style "+50"). "$" and "," are ignored.
 * Returns null for anything unparseable.
 */
export function parseAssignInput(raw: string, current: number): number | null {
  const s = raw.replace(/[$,\s]/g, '').replace(/[−–]/g, '-')
  if (s === '') return 0
  const rel = /^([+-])(\d*\.?\d+)$/.exec(s)
  if (rel) {
    const n = Number(rel[2])
    return Math.round((rel[1] === '+' ? current + n : current - n) * 100) / 100
  }
  if (!/^\d*\.?\d+$/.test(s)) return null
  return Math.round(Number(s) * 100) / 100
}

/** Draft-friendly display of an amount in an input (no currency sign, no trailing .00). */
export function inputAmount(n: number): string {
  if (cents(n) === 0) return '0'
  return cents(n) % 100 === 0 ? String(Math.round(n)) : n.toFixed(2)
}

export type EnvelopeFilter = 'all' | 'overspent' | 'underfunded' | 'available'

export function matchesFilter(r: ZbbCategoryRowOut, filter: EnvelopeFilter): boolean {
  if (filter === 'overspent') return cents(r.available) < 0
  if (filter === 'underfunded') return cents(r.underfunded) > 0
  if (filter === 'available') return cents(r.available) > 0
  return true
}
