import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ChevronDown, Info, LineChart } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getInvestmentsSummary, reclassifyInvestmentTxns } from '@/api/investments'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { queryKeys } from '@/queryKeys'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

function formatMoney(amount: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

const UNKNOWN = 'Unknown investment'

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
      void queryClient.invalidateQueries({ queryKey: queryKeys.investmentsSummary() })
      void queryClient.invalidateQueries({ queryKey: ['investments'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (summaryQ.isPending) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-sm text-muted-foreground">Loading investments…</p>
      </div>
    )
  }
  if (summaryQ.isError) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-sm text-destructive">{(summaryQ.error as Error).message}</p>
      </div>
    )
  }

  const s = summaryQ.data
  if (!s) return null

  const dayChg = s.day_change_pct

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <LineChart className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Investments</h1>
            <p className="text-sm text-muted-foreground">All investment accounts, combined</p>
          </div>
        </div>

        <Card className="mb-8 mt-6 border-primary/20 bg-gradient-to-br from-muted/40 to-transparent">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Total portfolio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold tabular-nums tracking-tight">
              {formatMoney(s.grand_total)}
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-3 text-sm">
              <span className="text-muted-foreground">
                Cash (est.):{' '}
                <span className="text-foreground font-medium tabular-nums">
                  {formatMoney(s.total_cash)}
                </span>
              </span>
              {dayChg != null ? (
                <span className={cn(dayChg >= 0 ? 'text-emerald-600' : 'text-red-600', 'tabular-nums')}>
                  {dayChg >= 0 ? '+' : ''}
                  {(dayChg * 100).toFixed(2)}% vs prior snapshot
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">Sync twice for change vs prior</span>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">Allocation</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center text-muted-foreground cursor-help">
                <Info className="h-3.5 w-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              <strong>{UNKNOWN}</strong> groups holdings without a symbol, manual entries with no ticker, and
              other unattributed amounts from your custodian data.
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="rounded-md border mb-10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Shares</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.allocation.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-10">
                    No investment accounts or sync snapshots yet. Link an investment account and run a
                    SimpleFIN sync.
                  </TableCell>
                </TableRow>
              ) : (
                s.allocation.map((row) => (
                  <TableRow key={row.symbol}>
                    <TableCell className="font-medium">
                      {row.symbol}
                      {row.symbol === UNKNOWN ? (
                        <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                          Unlabeled holdings or manual entries
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.market_value)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.percent_of_grand_total != null
                        ? `${(row.percent_of_grand_total * 100).toFixed(1)}%`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground hidden sm:table-cell">
                      {row.shares > 0 ? row.shares.toFixed(4) : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <h2 className="text-sm font-medium mb-3">By account</h2>
        <div className="space-y-2 mb-10">
          {s.accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Create an account with type <strong>investment</strong> under Accounts, then link it on
              Connections.
            </p>
          ) : (
            s.accounts.map((a) => (
              <Collapsible key={a.account_id} className="rounded-lg border bg-card">
                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 rounded-lg transition-colors">
                  <div>
                    <p className="font-medium text-sm">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.positions_count} positions
                      {a.institution_name ? ` · ${a.institution_name}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">{formatMoney(a.total_value, a.currency)}</p>
                      {a.cash_balance != null ? (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          Cash ~ {formatMoney(a.cash_balance, a.currency)}
                        </p>
                      ) : null}
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 pb-4 pt-0 text-sm border-t">
                    <p className="text-muted-foreground text-xs mt-3 mb-2">
                      Unknown on account: {formatMoney(a.unknown_on_account, a.currency)}
                    </p>
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/accounts/${a.account_id}`}>Open account · portfolio tab</Link>
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-4 border-t">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={reclassifyM.isPending}
            onClick={() => reclassifyM.mutate()}
          >
            Re-run activity parser
          </Button>
          <span className="text-xs text-muted-foreground">
            Use after upgrading parsers or importing old transactions.
          </span>
        </div>
      </motion.div>
    </div>
  )
}
