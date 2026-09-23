import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardResponse } from '@/api/dashboard'
import { Skeleton } from '@/components/ui/skeleton'
import { categoryColor, categoryIcon } from '@/lib/categoryStyle'
import { formatSignedUsd, formatSignedUsdWhole } from '@/lib/format'
import { cn } from '@/lib/utils'

type Row = {
  id: number
  name: string
  spend: number
  count: number
  prevSpend: number
  subs: { name: string; spend: number; count: number }[]
}

function buildRows(current: DashboardResponse | undefined, previous: DashboardResponse | undefined): Row[] {
  if (!current) return []
  const prevById = new Map((previous?.by_category ?? []).map((r) => [r.category_id, -Number(r.total)]))
  return current.by_category
    .map((r) => ({
      id: r.category_id,
      name: r.category,
      spend: -Number(r.total),
      count: r.count,
      prevSpend: prevById.get(r.category_id) ?? 0,
      subs: current.by_subcategory
        .filter((s) => s.category_id === r.category_id)
        .map((s) => ({
          name: (s.subcategory && String(s.subcategory).trim()) || 'Uncategorized',
          spend: -Number(s.total),
          count: s.count,
        }))
        .filter((s) => s.spend > 0)
        .sort((a, b) => b.spend - a.spend),
    }))
    .filter((r) => r.spend > 0)
    .sort((a, b) => b.spend - a.spend)
}

function Delta({ now, before, prevLabel }: { now: number; before: number; prevLabel: string }) {
  if (before <= 0) return <span className="text-muted-foreground/70">new</span>
  const diff = now - before
  if (Math.abs(diff) < 1) return <span className="text-muted-foreground/70">same</span>
  return (
    <span className={diff > 0 ? 'text-expense' : 'text-income'} title={`vs ${formatSignedUsd(before)} in ${prevLabel}`}>
      {diff > 0 ? '↑' : '↓'} {formatSignedUsdWhole(Math.abs(diff))}
    </span>
  )
}

export default function CategoryBreakdownCard({
  current,
  previous,
  loading,
  prevLabel,
}: {
  current: DashboardResponse | undefined
  previous: DashboardResponse | undefined
  loading: boolean
  prevLabel: string
}) {
  const rows = useMemo(() => buildRows(current, previous), [current, previous])
  const [openId, setOpenId] = useState<number | null>(null)
  const total = rows.reduce((s, r) => s + r.spend, 0)
  const max = rows[0]?.spend ?? 0

  return (
    <section className="surface p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Spending by category</h2>
        <Link to="/reports" className="text-xs font-medium text-primary hover:underline">
          Reports
        </Link>
      </div>

      {loading ? (
        <div className="mt-5 space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No spending this month.</p>
      ) : (
        <>
          {/* Composition strip: each category's share of the month, 2px gaps between segments. */}
          <div className="mt-4 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden>
            {rows.map((r) => (
              <div
                key={r.id}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{ width: `${(r.spend / total) * 100}%`, background: categoryColor(r.id) }}
                title={`${r.name} ${Math.round((r.spend / total) * 100)}%`}
              />
            ))}
          </div>

          <div className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 text-[11px] text-muted-foreground sm:grid-cols-[minmax(0,11rem)_1fr_5.5rem_3rem_4.5rem]">
            <span>Category</span>
            <span className="hidden sm:block" />
            <span className="text-right">Amount</span>
            <span className="hidden text-right sm:block">Share</span>
            <span className="hidden text-right sm:block">vs {prevLabel}</span>
          </div>

          <ul className="mt-1 divide-y divide-border/60">
            {rows.map((r) => {
              const Icon = categoryIcon(r.name)
              const open = openId === r.id
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : r.id)}
                    aria-expanded={open}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 rounded-lg py-2.5 text-left text-sm transition-colors hover:bg-muted/60 sm:grid-cols-[minmax(0,11rem)_1fr_5.5rem_3rem_4.5rem]"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ChevronRight
                        className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
                      />
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                        style={{ background: `color-mix(in srgb, ${categoryColor(r.id)} 14%, transparent)` }}
                      >
                        <Icon className="h-3.5 w-3.5" style={{ color: categoryColor(r.id) }} />
                      </span>
                      <span className="truncate font-medium">{r.name}</span>
                      <span className="hidden text-xs text-muted-foreground md:inline">{r.count}</span>
                    </span>
                    <span className="hidden h-1.5 rounded-full bg-secondary sm:block">
                      <span
                        className="block h-1.5 rounded-full"
                        style={{ width: `${(r.spend / max) * 100}%`, background: categoryColor(r.id) }}
                      />
                    </span>
                    <span className="text-right font-medium tabular-nums">{formatSignedUsd(r.spend)}</span>
                    <span className="hidden text-right text-xs text-muted-foreground tabular-nums sm:block">
                      {Math.round((r.spend / total) * 100)}%
                    </span>
                    <span className="hidden text-right text-xs tabular-nums sm:block">
                      <Delta now={r.spend} before={r.prevSpend} prevLabel={prevLabel} />
                    </span>
                  </button>
                  {open ? (
                    <ul className="mb-2 ml-[2.6rem] space-y-1.5 border-l border-border pl-4">
                      {r.subs.length === 0 ? (
                        <li className="text-xs text-muted-foreground">No subcategory detail.</li>
                      ) : (
                        r.subs.map((s) => (
                          <li
                            key={s.name}
                            className="grid grid-cols-[1fr_auto] items-center gap-x-4 text-xs sm:grid-cols-[minmax(0,8rem)_1fr_5.5rem_3rem]"
                          >
                            <span className="truncate text-muted-foreground">
                              {s.name} <span className="text-muted-foreground/60">· {s.count}</span>
                            </span>
                            <span className="hidden h-1 rounded-full bg-secondary sm:block">
                              <span
                                className="block h-1 rounded-full opacity-70"
                                style={{ width: `${(s.spend / r.spend) * 100}%`, background: categoryColor(r.id) }}
                              />
                            </span>
                            <span className="text-right tabular-nums">{formatSignedUsd(s.spend)}</span>
                            <span className="hidden text-right text-muted-foreground tabular-nums sm:block">
                              {Math.round((s.spend / r.spend) * 100)}%
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
