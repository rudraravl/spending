import { ArrowLeftRight, TrendingUp } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'
import type { NetWorthPoint } from '@/api/dashboard'
import type { AccountOut } from '@/types'
import { Skeleton } from '@/components/ui/skeleton'
import { formatSignedUsd, formatSignedUsdWhole } from '@/lib/format'
import { cn } from '@/lib/utils'

function CardTitle({ icon: Icon, children }: { icon: typeof TrendingUp; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

function DeltaText({ value, suffix, goodWhenPositive = true }: { value: number; suffix: string; goodWhenPositive?: boolean }) {
  const good = goodWhenPositive ? value >= 0 : value <= 0
  return (
    <p className="text-xs text-muted-foreground">
      <span className={cn('font-medium tabular-nums', good ? 'text-income' : 'text-expense')}>
        {value >= 0 ? '+' : ''}
        {formatSignedUsdWhole(value)}
      </span>{' '}
      {suffix}
    </p>
  )
}

export function NetWorthCard({
  accounts,
  series,
  monthLabel,
}: {
  accounts: AccountOut[] | undefined
  series: NetWorthPoint[] | undefined
  monthLabel: string
}) {
  const list = accounts ?? []
  const total = list.reduce((s, a) => s + Number(a.balance), 0)
  const assets = list.filter((a) => Number(a.balance) > 0).reduce((s, a) => s + Number(a.balance), 0)
  const debts = total - assets
  const points = (series ?? []).map((p) => ({ v: Number(p.total_value) }))
  const change = points.length > 1 ? points[points.length - 1].v - points[0].v : null
  const mixed = new Set(list.map((a) => a.currency)).size > 1

  return (
    <section className="surface flex flex-col p-5">
      <CardTitle icon={TrendingUp}>Net worth</CardTitle>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          {accounts === undefined ? (
            <Skeleton className="h-8 w-40" />
          ) : (
            <p className="text-[1.65rem] font-semibold leading-tight tracking-tight tabular-nums">
              {formatSignedUsd(total)}
            </p>
          )}
          {change != null ? <DeltaText value={change} suffix={`in ${monthLabel}`} /> : null}
        </div>
        {points.length > 1 ? (
          <div className="h-12 w-28 shrink-0" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
                <defs>
                  <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={['dataMin', 'dataMax']} />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke="hsl(var(--primary))"
                  strokeWidth={1.75}
                  fill="url(#nwFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </div>
      <div className="mt-auto flex gap-5 border-t border-border/70 pt-3 text-xs">
        <p className="text-muted-foreground">
          Assets <span className="ml-1 font-medium text-foreground tabular-nums">{formatSignedUsdWhole(assets)}</span>
        </p>
        <p className="text-muted-foreground">
          Debts <span className="ml-1 font-medium text-foreground tabular-nums">{formatSignedUsdWhole(Math.abs(debts))}</span>
        </p>
        {mixed ? <p className="ml-auto text-muted-foreground">Mixed currencies, unconverted</p> : null}
      </div>
    </section>
  )
}

function FlowBar({ label, value, max, className }: { label: string; value: number; max: number; className: string }) {
  const pct = max > 0 ? Math.max(2, (Math.abs(value) / max) * 100) : 0
  return (
    <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="h-2 rounded-full bg-secondary">
        <div className={cn('h-2 rounded-full', className)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 text-right font-medium tabular-nums">{formatSignedUsdWhole(value)}</span>
    </div>
  )
}

export function CashflowCard({
  income,
  spent,
  loading,
  monthLabel,
}: {
  income: number
  spent: number
  loading: boolean
  monthLabel: string
}) {
  const net = income - spent
  const savingsRate = income > 0 ? Math.round((net / income) * 100) : null
  const max = Math.max(income, Math.abs(spent))

  return (
    <section className="surface flex flex-col p-5">
      <CardTitle icon={ArrowLeftRight}>Net cash flow · {monthLabel}</CardTitle>
      <div className="mt-3">
        {loading ? (
          <Skeleton className="h-8 w-40" />
        ) : (
          <p
            className={cn(
              'text-[1.65rem] font-semibold leading-tight tracking-tight tabular-nums',
              net >= 0 ? 'text-income' : 'text-expense',
            )}
          >
            {net >= 0 ? '+' : ''}
            {formatSignedUsd(net)}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {savingsRate != null ? (
            <>
              <span className="font-medium text-foreground">{savingsRate}%</span> of income kept
            </>
          ) : (
            'No income recorded yet'
          )}
        </p>
      </div>
      <div className="mt-auto space-y-2 border-t border-border/70 pt-3">
        <FlowBar label="Income" value={income} max={max} className="bg-income" />
        <FlowBar label="Spending" value={spent} max={max} className="bg-foreground/70" />
      </div>
    </section>
  )
}
