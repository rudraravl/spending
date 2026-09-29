import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PerformancePoint } from '@/api/investments'
import { Skeleton } from '@/components/ui/skeleton'
import { formatSignedUsd, formatSignedUsdWhole } from '@/lib/format'
import { cn } from '@/lib/utils'

const DAY = 86_400_000
const GAP_DAYS = 10

const RANGES = [
  { key: '1M', days: 30 },
  { key: '3M', days: 90 },
  { key: '6M', days: 180 },
  { key: '1Y', days: 365 },
  { key: 'All', days: Infinity },
] as const

const RANGE_LABEL: Record<string, string> = { '1M': 'past month', '3M': 'past 3 months', '6M': 'past 6 months', '1Y': 'past year', All: 'since tracking began' }

type Mode = 'value' | 'gain'

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatSignedUsd(Math.abs(n))}`

export default function PortfolioHeroCard({
  total,
  invested,
  cash,
  points,
  loading,
}: {
  total: number
  invested: number
  cash: number
  points: PerformancePoint[]
  loading: boolean
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('All')
  const [mode, setMode] = useState<Mode>('value')

  const data = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)?.days ?? Infinity
    if (points.length === 0) return []
    const cutoff = points[points.length - 1].t - days * DAY
    const rows = Number.isFinite(days) ? points.filter((p) => p.t >= cutoff) : points
    if (rows.length === 0) return []
    const base = rows[0]
    return rows.map((p) => ({
      t: p.t,
      value: p.value,
      // Rebased so the chart and headline agree for whichever window is selected.
      gain: p.gain - base.gain,
    }))
  }, [points, range])

  const first = data[0]
  const last = data[data.length - 1]
  const valueChange = first && last ? last.value - first.value : null
  const marketGain = last ? last.gain : null
  const flows = valueChange != null && marketGain != null ? valueChange - marketGain : null
  const startTwr = useMemo(() => {
    if (!first) return null
    const a = points.find((p) => p.t === first.t)
    const b = points.find((p) => p.t === last?.t)
    return a && b ? (1 + b.twr) / (1 + a.twr) - 1 : null
  }, [points, first, last])

  const gaps = useMemo(() => {
    const out: { x1: number; x2: number }[] = []
    for (let i = 1; i < data.length; i++) {
      if (data[i].t - data[i - 1].t > GAP_DAYS * DAY) out.push({ x1: data[i - 1].t, x2: data[i].t })
    }
    return out
  }, [data])

  const key = mode === 'value' ? 'value' : 'gain'
  const up = (marketGain ?? 0) >= 0

  return (
    <section className="surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Total portfolio value</p>
          <p className="mt-1 text-[2.25rem] font-semibold leading-tight tracking-tight tabular-nums">
            {formatSignedUsd(total)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {formatSignedUsdWhole(invested)} invested · {formatSignedUsdWhole(cash)} cash
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="inline-flex rounded-lg bg-secondary p-0.5">
            {(['value', 'gain'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'value' ? 'Value' : 'Market gain'}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg bg-secondary p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  range === r.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {r.key}
              </button>
            ))}
          </div>
        </div>
      </div>

      {marketGain != null && data.length > 1 ? (
        <p className="mt-3 text-sm">
          <span className={cn('font-medium tabular-nums', up ? 'text-income' : 'text-expense')}>
            {up ? '▲' : '▼'} {signed(marketGain)}
            {startTwr != null ? ` (${startTwr >= 0 ? '+' : ''}${(startTwr * 100).toFixed(2)}%)` : ''}
          </span>{' '}
          <span className="text-muted-foreground">market gain, {RANGE_LABEL[range]}</span>
          {flows != null && Math.abs(flows) >= 1 ? (
            <span className="text-muted-foreground tabular-nums">
              {' '}
              · {signed(flows)} deposits &amp; other
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="mt-3 h-56">
        {loading ? (
          <Skeleton className="h-full w-full" />
        ) : data.length < 2 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Sync on a couple of different days to build a performance chart.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="pfFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--brand))" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="hsl(var(--brand))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
              {gaps.map((g) => (
                <ReferenceArea
                  key={g.x1}
                  x1={g.x1}
                  x2={g.x2}
                  fill="hsl(var(--muted-foreground))"
                  fillOpacity={0.07}
                  label={{ value: 'no syncs', position: 'insideTop', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                />
              ))}
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={48}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              />
              <YAxis
                domain={mode === 'value' ? ['auto', 'auto'] : [(min: number) => Math.min(0, min), 'auto']}
                width={64}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: number) => formatSignedUsdWhole(v)}
              />
              <Tooltip
                cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }}
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(t: number) => new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                formatter={(v: number) => [mode === 'value' ? formatSignedUsd(v) : signed(v), mode === 'value' ? 'Value' : 'Market gain']}
              />
              <Area
                type="linear"
                dataKey={key}
                stroke="hsl(var(--brand))"
                strokeWidth={2}
                fill="url(#pfFill)"
                // Every point is a real sync; showing them makes sparse stretches obvious instead of implying a smooth line.
                dot={{ r: 2, strokeWidth: 0, fill: 'hsl(var(--brand))' }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Market gain estimates price movement on shares held plus dividends and interest; deposits and withdrawals are
        excluded. Dots are sync dates.
      </p>
    </section>
  )
}
