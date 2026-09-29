import { ArrowDown, ArrowUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { InvestmentAllocationRow, PerformanceSymbol } from '@/api/investments'
import { formatSignedUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CASH, UNKNOWN } from './labels'

type SortKey = 'symbol' | 'market_value' | 'gain' | 'gain_pct' | 'percent_of_grand_total' | 'income'

export default function HoldingsTable({
  rows,
  performance,
}: {
  rows: InvestmentAllocationRow[]
  performance: PerformanceSymbol[]
}) {
  const incomeBySymbol = useMemo(() => new Map(performance.map((p) => [p.symbol, p.income])), [performance])
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'market_value', dir: -1 })
  const holdings = useMemo(() => {
    const list = rows.filter((r) => r.symbol !== CASH && r.symbol !== UNKNOWN)
    const val = (r: InvestmentAllocationRow) =>
      sort.key === 'income' ? (incomeBySymbol.get(r.symbol) ?? 0) : sort.key === 'symbol' ? r.symbol : r[sort.key]
    return [...list].sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      if (av == null) return 1
      if (bv == null) return -1
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir
    })
  }, [rows, sort, incomeBySymbol])
  const maxWeight = Math.max(0.0001, ...holdings.map((r) => r.percent_of_grand_total ?? 0))

  const th = (k: SortKey, children: string, right = true, className?: string) => (
    <th key={k} className={cn('px-4 py-2.5 font-medium', right && 'text-right', className)}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : -1 }))}
        className={cn('inline-flex items-center gap-1 hover:text-foreground', sort.key === k && 'text-foreground')}
      >
        {children}
        {sort.key === k ? sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : null}
      </button>
    </th>
  )

  return (
    <section className="surface overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <p className="text-sm text-muted-foreground">Holdings</p>
        <p className="text-xs text-muted-foreground">{holdings.length} positions</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y bg-muted/30 text-xs text-muted-foreground">
            <tr>
              {th("symbol", "Asset", false)}
              {th("market_value", "Value")}
              {th("gain", "Gain / loss", true, "hidden sm:table-cell")}
              {th("gain_pct", "Return")}
              {th("income", "Dividends", true, "hidden lg:table-cell")}
              {th("percent_of_grand_total", "Weight", true, "hidden md:table-cell")}
            </tr>
          </thead>
          <tbody className="divide-y">
            {holdings.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-muted-foreground">
                  No investment holdings yet. Link an investment account and run a SimpleFIN sync.
                </td>
              </tr>
            ) : (
              holdings.map((r) => {
                const gain = r.gain
                const income = incomeBySymbol.get(r.symbol) ?? 0
                const tone = gain == null ? '' : gain >= 0 ? 'text-income' : 'text-expense'
                return (
                  <tr key={r.symbol} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.symbol}</p>
                      {r.shares > 0 ? (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {r.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares
                          {r.cost_basis && r.shares ? ` · avg cost ${formatSignedUsd(r.cost_basis / r.shares)}` : ''}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatSignedUsd(r.market_value)}</td>
                    <td className={cn('hidden px-4 py-3 text-right tabular-nums sm:table-cell', tone)}>
                      {gain == null ? <span className="text-muted-foreground">—</span> : `${gain >= 0 ? '+' : ''}${formatSignedUsd(gain)}`}
                    </td>
                    <td className={cn('px-4 py-3 text-right tabular-nums', tone)}>
                      {r.gain_pct == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        `${r.gain_pct >= 0 ? '+' : ''}${(r.gain_pct * 100).toFixed(2)}%`
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground lg:table-cell">
                      {income > 0 ? formatSignedUsd(income) : '—'}
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <div className="ml-auto flex w-32 items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${((r.percent_of_grand_total ?? 0) / maxWeight) * 100}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                          {r.percent_of_grand_total != null ? `${(r.percent_of_grand_total * 100).toFixed(1)}%` : '—'}
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
