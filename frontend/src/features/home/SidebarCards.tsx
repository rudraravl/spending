import { CalendarClock } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { DashboardRecentRow } from '@/api/dashboard'
import type { AccountOut } from '@/types'
import type { RecurringSeriesCardOut } from '@/types/recurring'
import { Skeleton } from '@/components/ui/skeleton'
import { categoryColor, categoryIcon } from '@/lib/categoryStyle'
import { daysAgoIso, parseIsoDate, todayIso } from '@/lib/dates'
import { formatMoney, formatSignedUsd } from '@/lib/format'
import { cn } from '@/lib/utils'

function CardHeader({ title, to, linkLabel }: { title: string; to?: string; linkLabel?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-5 pt-5 pb-2">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {to ? (
        <Link to={to} className="text-xs font-medium text-primary hover:underline">
          {linkLabel ?? 'See all'}
        </Link>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ Accounts */

const GROUPS: { key: string; label: string; match: (t: string) => boolean }[] = [
  { key: 'cash', label: 'Cash', match: (t) => t === 'checking' || t === 'savings' || t === 'cash' },
  { key: 'credit', label: 'Credit cards', match: (t) => t === 'credit' },
  { key: 'invest', label: 'Investments', match: (t) => t === 'investment' },
]

export function AccountsCard({ accounts }: { accounts: AccountOut[] | undefined }) {
  const list = accounts ?? []
  const known = new Set(GROUPS.flatMap((g) => list.filter((a) => g.match(a.type)).map((a) => a.id)))
  const groups = [
    ...GROUPS.map((g) => ({ ...g, items: list.filter((a) => g.match(a.type)) })),
    { key: 'other', label: 'Other', match: () => true, items: list.filter((a) => !known.has(a.id)) },
  ].filter((g) => g.items.length > 0)

  return (
    <section className="surface pb-2">
      <CardHeader title="Accounts" to="/accounts" linkLabel="Manage" />
      {accounts === undefined ? (
        <div className="space-y-2 px-5 pb-3">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      ) : list.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-muted-foreground">No accounts yet.</p>
      ) : (
        groups.map((g) => {
          const total = g.items.reduce((s, a) => s + Number(a.balance), 0)
          return (
            <div key={g.key} className="px-2 pb-1">
              <div className="flex items-center justify-between px-3 pt-2 pb-1">
                <p className="eyebrow">{g.label}</p>
                <p className="text-xs font-semibold tabular-nums">{formatSignedUsd(total)}</p>
              </div>
              {g.items
                .slice()
                .sort((a, b) => Math.abs(Number(b.balance)) - Math.abs(Number(a.balance)))
                .map((a) => (
                  <Link
                    key={a.id}
                    to={`/accounts/${a.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm hover:bg-muted/60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{a.name}</span>
                    </span>
                    <span
                      className={cn(
                        'shrink-0 tabular-nums text-muted-foreground',
                        Number(a.balance) < 0 && 'text-foreground',
                      )}
                    >
                      {a.currency === 'USD' ? formatSignedUsd(Number(a.balance)) : formatMoney(Number(a.balance), a.currency)}
                    </span>
                  </Link>
                ))}
            </div>
          )
        })
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ Upcoming recurring */

const shortDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

function dueLabel(iso: string): string {
  const today = parseIsoDate(todayIso())!
  const d = parseIsoDate(iso)
  if (!d) return iso
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return `${-days}d overdue`
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 7) return `In ${days} days`
  return shortDay.format(d)
}

export function UpcomingCard({ series }: { series: RecurringSeriesCardOut[] | undefined }) {
  const horizon = daysAgoIso(-30)
  const soon = (series ?? [])
    .filter((s) => s.status === 'confirmed' && s.is_active && s.next_expected_date && s.next_expected_date <= horizon)
    .sort((a, b) => (a.next_expected_date! < b.next_expected_date! ? -1 : 1))
    .slice(0, 5)
  if (!soon.length) return null
  const total = soon.reduce((s, r) => s + Math.abs(r.amount_anchor), 0)

  return (
    <section className="surface pb-3">
      <CardHeader title="Upcoming" to="/recurring" linkLabel="Recurring" />
      <p className="-mt-1 px-5 pb-2 text-xs text-muted-foreground">
        {formatSignedUsd(total)} expected in the next 30 days
      </p>
      <ul className="px-2">
        {soon.map((s) => (
          <li key={`${s.merchant_norm}-${s.amount_anchor_cents}`} className="flex items-center gap-3 rounded-lg px-3 py-1.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{s.display_name || s.merchant_norm}</span>
              <span className="block text-xs text-muted-foreground">
                {dueLabel(s.next_expected_date!)} · {s.cadence_type ?? 'recurring'}
              </span>
            </span>
            <span className="shrink-0 text-sm tabular-nums">{formatSignedUsd(Math.abs(s.amount_anchor))}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ Recent activity */

const weekdayLong = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

function dayHeading(iso: string): string {
  if (iso === todayIso()) return 'Today'
  if (iso === daysAgoIso(1)) return 'Yesterday'
  const d = parseIsoDate(iso)
  return d ? weekdayLong.format(d) : iso
}

export function RecentActivityCard({
  rows,
  categoryIds,
  loading,
}: {
  rows: DashboardRecentRow[] | undefined
  categoryIds: Map<string, number>
  loading: boolean
}) {
  const byDay = new Map<string, DashboardRecentRow[]>()
  for (const r of rows ?? []) {
    const key = r.Date.slice(0, 10)
    byDay.set(key, [...(byDay.get(key) ?? []), r])
  }

  return (
    <section className="surface pb-2">
      <CardHeader title="Recent activity" to="/transactions" />
      {loading ? (
        <div className="space-y-3 px-5 pb-4">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : byDay.size === 0 ? (
        <p className="px-5 pb-4 text-sm text-muted-foreground">No transactions yet.</p>
      ) : (
        [...byDay.entries()].map(([day, items]) => (
          <div key={day} className="px-2">
            <p className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">{dayHeading(day)}</p>
            <ul>
              {items.map((t) => {
                const catId = categoryIds.get(t.Category)
                const Icon = categoryIcon(t.Category)
                const inflow = t.Amount > 0
                const sub = t.Subcategory && t.Subcategory !== 'None' ? t.Subcategory : t.Category
                return (
                  <li key={t.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/60">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                      style={{ background: `color-mix(in srgb, ${categoryColor(catId)} 13%, transparent)` }}
                    >
                      <Icon className="h-4 w-4" style={{ color: categoryColor(catId) }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" title={t.Merchant}>
                        {t.Merchant}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {sub}
                        {t.Acct ? ` · ${t.Acct}` : ''}
                      </span>
                    </span>
                    <span className={cn('shrink-0 text-sm font-medium tabular-nums', inflow && 'text-income')}>
                      {inflow ? '+' : ''}
                      {formatSignedUsd(t.Amount)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}
