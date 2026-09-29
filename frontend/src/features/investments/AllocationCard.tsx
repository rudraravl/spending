import { Info } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import type { InvestmentAllocationRow } from '@/api/investments'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatSignedUsd } from '@/lib/format'
import { CASH, UNKNOWN, sliceColor } from './labels'

const MAX_SLICES = 7

/** Top holdings individually, the long tail rolled into "Other". */
function buildSlices(rows: InvestmentAllocationRow[]) {
  const positive = rows.filter((r) => r.market_value > 0)
  const special = positive.filter((r) => r.symbol === CASH || r.symbol === UNKNOWN)
  const assets = positive.filter((r) => r.symbol !== CASH && r.symbol !== UNKNOWN)
  const head = assets.slice(0, MAX_SLICES)
  const tail = assets.slice(MAX_SLICES)
  const slices = head.map((r, i) => ({ name: r.symbol, value: r.market_value, pct: r.percent_of_grand_total, color: sliceColor(r.symbol, i) }))
  if (tail.length) {
    slices.push({
      name: `Other (${tail.length})`,
      value: tail.reduce((s, r) => s + r.market_value, 0),
      pct: tail.reduce((s, r) => s + (r.percent_of_grand_total ?? 0), 0),
      color: 'var(--cat-4)',
    })
  }
  for (const r of special) {
    slices.push({ name: r.symbol, value: r.market_value, pct: r.percent_of_grand_total, color: sliceColor(r.symbol, 0) })
  }
  return slices
}

export default function AllocationCard({ rows }: { rows: InvestmentAllocationRow[] }) {
  const slices = buildSlices(rows)
  return (
    <section className="surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Allocation</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-help text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">
            <strong>{CASH}</strong> is uninvested cash from the latest sync; <strong>{UNKNOWN}</strong> groups
            holdings without a symbol and other unattributed amounts.
          </TooltipContent>
        </Tooltip>
      </div>
      {slices.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No holdings yet.</p>
      ) : (
        <div className="mt-3 flex flex-col items-center gap-5 sm:flex-row">
          <div className="h-40 w-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" innerRadius={48} outerRadius={72} paddingAngle={1.5} stroke="none">
                  {slices.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm">
            {slices.map((s) => (
              <li key={s.name} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="tabular-nums text-muted-foreground">{formatSignedUsd(s.value)}</span>
                <span className="w-12 text-right tabular-nums font-medium">
                  {s.pct != null ? `${(s.pct * 100).toFixed(1)}%` : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
