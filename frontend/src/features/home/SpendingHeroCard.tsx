import { ChevronLeft, ChevronRight, TrendingDown, TrendingUp } from 'lucide-react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Skeleton } from '@/components/ui/skeleton'
import { formatSignedUsd, formatSignedUsdWhole } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ChartPoint, YearMonth } from './useMonthOverview'

const monthLong = new Intl.DateTimeFormat('en-US', { month: 'long' })
const monthShort = new Intl.DateTimeFormat('en-US', { month: 'short' })

function monthName(ym: YearMonth, fmt = monthLong) {
  return fmt.format(new Date(ym.year, ym.month - 1, 1))
}

/** "$2,839" with smaller ".29" — the hero figure. */
export function HeroAmount({ value, className }: { value: number; className?: string }) {
  const [whole, cents] = formatSignedUsd(value).split('.')
  return (
    <span className={cn('font-semibold tracking-tight', className)}>
      {whole}
      <span className="text-[0.5em] align-[0.6em] text-muted-foreground font-medium">.{cents}</span>
    </span>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[15px] font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

type Props = {
  ym: YearMonth
  prevYm: YearMonth
  canGoForward: boolean
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  loading: boolean
  isCurrentMonth: boolean
  spent: number
  prevTotal: number
  prevAtSameDay: number | null
  dailyAverage: number
  projected: number | null
  elapsedDays: number
  totalDays: number
  chart: ChartPoint[]
}

export default function SpendingHeroCard(p: Props) {
  const thisLabel = monthName(p.ym, monthShort)
  const prevLabel = monthName(p.prevYm, monthShort)
  const compareTo = p.isCurrentMonth ? p.prevAtSameDay : p.prevTotal
  const delta = compareTo == null ? null : p.spent - compareTo
  const ticks = [1, 8, 15, 22, p.totalDays]

  return (
    <section className="surface p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">Spending</p>
        <div className="flex items-center gap-1">
          {!p.isCurrentMonth ? (
            <button
              type="button"
              onClick={p.onToday}
              className="mr-1 rounded-full px-2.5 py-1 text-xs font-medium text-primary hover:bg-accent"
            >
              This month
            </button>
          ) : null}
          <button
            type="button"
            onClick={p.onPrev}
            aria-label="Previous month"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="w-28 text-center text-xs font-semibold uppercase tracking-[0.12em]">
            {monthShort.format(new Date(p.ym.year, p.ym.month - 1, 1))} {p.ym.year}
          </span>
          <button
            type="button"
            onClick={p.onNext}
            disabled={!p.canGoForward}
            aria-label="Next month"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {p.isCurrentMonth ? 'Spent so far in ' : 'Spent in '}
            {monthName(p.ym)}
          </p>
          {p.loading ? (
            <Skeleton className="mt-2 h-12 w-56" />
          ) : (
            <p className="mt-1 text-5xl leading-none tabular-nums">
              <HeroAmount value={p.spent} />
            </p>
          )}
          {!p.loading && delta != null ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                  delta <= 0 ? 'bg-income/10 text-income' : 'bg-expense/10 text-expense',
                )}
              >
                {delta <= 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                {formatSignedUsdWhole(Math.abs(delta))}
              </span>
              {delta <= 0 ? 'less' : 'more'} than{' '}
              {p.isCurrentMonth ? `this point in ${monthName(p.prevYm)}` : `all of ${monthName(p.prevYm)}`}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-6 sm:gap-8">
          <Stat
            label="Daily average"
            value={formatSignedUsdWhole(p.dailyAverage)}
            hint={`over ${p.elapsedDays} day${p.elapsedDays === 1 ? '' : 's'}`}
          />
          {p.projected != null ? (
            <Stat label="On pace for" value={formatSignedUsdWhole(p.projected)} hint={`by ${thisLabel} ${p.totalDays}`} />
          ) : (
            <Stat label="Days" value={String(p.totalDays)} hint="full month" />
          )}
          <Stat label={`${monthName(p.prevYm)} total`} value={formatSignedUsdWhole(p.prevTotal)} hint="last month" />
        </div>
      </div>

      <div className="mt-5 h-[220px] w-full">
        {p.loading ? (
          <Skeleton className="h-full w-full" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={p.chart} margin={{ top: 8, right: 4, left: 16, bottom: 0 }}>
              <defs>
                <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.7} />
              <XAxis
                dataKey="day"
                ticks={ticks}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(d) => `${thisLabel} ${d}`}
                interval={0}
                padding={{ left: 0, right: 8 }}
              />
              <YAxis
                orientation="right"
                tickLine={false}
                axisLine={false}
                width={52}
                tickCount={4}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v) => formatSignedUsdWhole(Number(v))}
              />
              <Tooltip
                cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.4, strokeDasharray: '3 3' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as ChartPoint
                  return (
                    <div className="rounded-xl border bg-popover px-3 py-2 text-xs shadow-elevated">
                      <p className="mb-1 font-medium text-muted-foreground">Through day {label}</p>
                      {row.current != null ? (
                        <p className="flex items-center justify-between gap-6">
                          <span className="flex items-center gap-1.5">
                            <span className="h-0.5 w-3 rounded bg-primary" /> {thisLabel}
                          </span>
                          <span className="font-semibold tabular-nums">{formatSignedUsd(row.current)}</span>
                        </p>
                      ) : null}
                      {row.previous != null ? (
                        <p className="flex items-center justify-between gap-6 text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <span className="h-0 w-3 border-t border-dashed border-muted-foreground" /> {prevLabel}
                          </span>
                          <span className="tabular-nums">{formatSignedUsd(row.previous)}</span>
                        </p>
                      ) : null}
                    </div>
                  )
                }}
              />
              <Line
                type="monotone"
                dataKey="previous"
                stroke="hsl(var(--muted-foreground))"
                strokeOpacity={0.55}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls
              />
              <Area
                type="monotone"
                dataKey="current"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#heroFill)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-primary" /> {monthName(p.ym)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 border-t border-dashed border-muted-foreground" /> {monthName(p.prevYm)}
        </span>
        <span className="ml-auto hidden sm:inline">Cumulative net spend, excl. income &amp; transfers</span>
      </div>
    </section>
  )
}
