import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  getInvestmentsSummary,
  getPortfolioPerformance,
  reclassifyInvestmentTxns,
  type InvestmentsSummary,
} from '@/api/investments'
import { listConnections } from '@/api/simplefin'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { invalidateTransactionData, queryKeys } from '@/queryKeys'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatMoney, formatSignedUsd, formatSignedUsdWhole } from '@/lib/format'
import { syncResultSummary, useSimplefinSync } from '@/features/simplefin/useSimplefinSync'
import PageHeader from '@/components/PageHeader'
import AllocationCard from '@/features/investments/AllocationCard'
import HoldingsTable from '@/features/investments/HoldingsTable'
import PortfolioHeroCard from '@/features/investments/PortfolioHeroCard'

export default function InvestmentsPage() {
  const queryClient = useQueryClient()
  const summaryQ = useQuery({
    queryKey: queryKeys.investmentsSummary(),
    queryFn: getInvestmentsSummary,
  })

  const reclassifyM = useMutation({
    mutationFn: () => reclassifyInvestmentTxns({}),
    onSuccess: (r) => {
      toast.success(`Reclassified ${r.updated_count} transactions`)
      void invalidateTransactionData(queryClient)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { data: simplefinConnections = [] } = useQuery({
    queryKey: queryKeys.simplefinConnections(),
    queryFn: listConnections,
  })
  const simplefinConnection = simplefinConnections[0] ?? null

  const syncMutation = useSimplefinSync(simplefinConnection?.id, {
    onSuccess: (result) => toast.success(syncResultSummary(result)),
    onError: (err) => toast.error(err.message),
  })

  const pageToolbar = (
    <PageHeader
      title="Investments"
      description="All investment accounts, combined."
      actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={!simplefinConnection || syncMutation.isPending}
                  onClick={() => syncMutation.mutate()}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                  Sync
                </Button>
              </span>
            </TooltipTrigger>
            {!simplefinConnection ? (
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                Add a SimpleFIN connection under Accounts → Bank Sync first.
              </TooltipContent>
            ) : (
              <TooltipContent side="bottom" className="text-xs">
                Pull latest balances and holdings from SimpleFIN
              </TooltipContent>
            )}
          </Tooltip>
      }
    />
  )

  if (summaryQ.isPending) {
    return (
      <div className="page max-w-5xl">
        {pageToolbar}
        <p className="text-sm text-muted-foreground mt-4">Loading investments…</p>
      </div>
    )
  }
  if (summaryQ.isError) {
    return (
      <div className="page max-w-5xl">
        {pageToolbar}
        <p className="text-sm text-destructive mt-4">{(summaryQ.error as Error).message}</p>
      </div>
    )
  }

  const s = summaryQ.data
  if (!s) return null

  return <InvestmentsBody s={s} pageToolbar={pageToolbar} reclassify={() => reclassifyM.mutate()} reclassifying={reclassifyM.isPending} />
}

function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'up' | 'down' }) {
  return (
    <div className="surface p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold tabular-nums tracking-tight', tone === 'up' && 'text-income', tone === 'down' && 'text-expense')}>
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{sub}</p> : null}
    </div>
  )
}

function InvestmentsBody({
  s,
  pageToolbar,
  reclassify,
  reclassifying,
}: {
  s: InvestmentsSummary
  pageToolbar: ReactNode
  reclassify: () => void
  reclassifying: boolean
}) {
  const perfQ = useQuery({
    queryKey: queryKeys.investmentsPerformance(),
    queryFn: getPortfolioPerformance,
  })
  const points = useMemo(() => perfQ.data?.series ?? [], [perfQ.data])

  const invested = s.grand_total - s.total_cash
  const cashPct = s.grand_total > 0 ? s.total_cash / s.grand_total : null
  const gainPct = s.total_cost_basis > 0 ? s.total_gain / s.total_cost_basis : null

  const n = points.length
  const lastStep = n >= 2 ? points[n - 1].gain - points[n - 2].gain : null
  const lastStepPct = lastStep != null && points[n - 2].value > 0 ? lastStep / points[n - 2].value : null
  const twr = n >= 2 ? points[n - 1].twr : null
  const trackedSince = perfQ.data?.start ? new Date(perfQ.data.start) : null
  const lastSync = s.accounts.map((a) => a.last_snapshot_at).filter(Boolean).sort().at(-1)
  const signed = (v: number) => `${v >= 0 ? '+' : '−'}${formatSignedUsd(Math.abs(v))}`
  const pct = (v: number) => `${v >= 0 ? '+' : '−'}${(Math.abs(v) * 100).toFixed(2)}%`

  return (
    <div className="page max-w-5xl">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        {pageToolbar}

        <PortfolioHeroCard total={s.grand_total} invested={invested} cash={s.total_cash} points={points} loading={perfQ.isPending} />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Since last sync"
            value={lastStep != null ? signed(lastStep) : '—'}
            sub={lastStepPct != null ? `${pct(lastStepPct)} market move` : 'Sync on two different days'}
            tone={lastStep == null ? undefined : lastStep >= 0 ? 'up' : 'down'}
          />
          <StatTile
            label="Unrealized gain / loss"
            value={s.total_cost_basis > 0 ? signed(s.total_gain) : '—'}
            sub={gainPct != null ? `${pct(gainPct)} on ${formatSignedUsdWhole(s.total_cost_basis)} cost` : 'No cost basis reported'}
            tone={s.total_cost_basis > 0 ? (s.total_gain >= 0 ? 'up' : 'down') : undefined}
          />
          <StatTile
            label="Return since tracking"
            value={twr != null ? pct(twr) : '—'}
            sub={trackedSince ? `Time-weighted, since ${trackedSince.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : undefined}
            tone={twr == null ? undefined : twr >= 0 ? 'up' : 'down'}
          />
          <StatTile
            label="Cash"
            value={formatSignedUsd(s.total_cash)}
            sub={cashPct != null ? `${(cashPct * 100).toFixed(1)}% of portfolio` : undefined}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <AllocationCard rows={s.allocation} />
          </div>
          <section className="surface p-5 lg:col-span-2">
            <p className="text-sm text-muted-foreground">Accounts</p>
            {s.accounts.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Create an account with type <strong>investment</strong> under Accounts, then link it on Connections.
              </p>
            ) : (
              <ul className="mt-3 divide-y">
                {s.accounts.map((a) => (
                  <li key={a.account_id}>
                    <Link
                      to={`/accounts/${a.account_id}`}
                      className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{a.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {a.positions_count} positions{a.institution_name ? ` · ${a.institution_name}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 text-right">
                        <div>
                          <p className="text-sm font-semibold tabular-nums">{formatMoney(a.total_value, a.currency)}</p>
                          {s.grand_total > 0 ? (
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {((a.total_value / s.grand_total) * 100).toFixed(1)}%
                            </p>
                          ) : null}
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <HoldingsTable rows={s.allocation} performance={perfQ.data?.symbols ?? []} />

        <div className="flex flex-wrap items-center gap-3 pt-2 text-xs text-muted-foreground">
          <Button type="button" variant="outline" size="sm" disabled={reclassifying} onClick={reclassify}>
            Re-run activity parser
          </Button>
          <span>Use after upgrading parsers or importing old transactions.</span>
          {lastSync ? (
            <span className="ml-auto">Last synced {new Date(lastSync).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
          ) : null}
        </div>
      </motion.div>
    </div>
  )
}
