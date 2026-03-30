import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  createManualPosition,
  deleteManualPosition,
  getPortfolio,
  getPortfolioHistory,
} from '@/api/investments'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

function formatPct(x: number | null | undefined) {
  if (x == null || Number.isNaN(x)) return '—'
  return `${(x * 100).toFixed(2)}%`
}

type Props = {
  accountId: number
  currency: string
}

export default function AccountPortfolioTab({ accountId, currency }: Props) {
  const queryClient = useQueryClient()
  const [sym, setSym] = useState('')
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')

  const portfolioQ = useQuery({
    queryKey: queryKeys.investmentPortfolio(accountId),
    queryFn: () => getPortfolio(accountId),
  })

  const historyQ = useQuery({
    queryKey: queryKeys.investmentHistory(accountId, 365),
    queryFn: () => getPortfolioHistory(accountId, 365),
  })

  const chartData = useMemo(() => {
    const rows = historyQ.data ?? []
    return rows.map((p) => ({
      t: p.captured_at ? new Date(p.captured_at).getTime() : 0,
      label: p.captured_at
        ? new Date(p.captured_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : '',
      value: p.total_value,
    }))
  }, [historyQ.data])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.investmentPortfolio(accountId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.investmentHistory(accountId, 365) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.investmentsSummary() })
  }

  const addMutation = useMutation({
    mutationFn: () =>
      createManualPosition(accountId, {
        symbol: sym.trim() || null,
        quantity: Number.parseFloat(qty),
        cost_basis_total: cost.trim() ? Number.parseFloat(cost) : null,
        as_of_date: asOf,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Manual position saved')
      setSym('')
      setQty('')
      setCost('')
      setNotes('')
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const delMutation = useMutation({
    mutationFn: (positionId: number) => deleteManualPosition(accountId, positionId),
    onSuccess: () => {
      toast.success('Removed')
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (portfolioQ.isPending) {
    return <p className="text-sm text-muted-foreground">Loading portfolio…</p>
  }
  if (portfolioQ.isError) {
    return (
      <p className="text-sm text-destructive">
        {(portfolioQ.error as Error).message ?? 'Could not load portfolio'}
      </p>
    )
  }

  const d = portfolioQ.data
  if (!d) return null

  const totals = d.totals
  const rhCrypto = Boolean(d.account.is_robinhood_crypto)

  return (
    <div className="space-y-8">
      <div className={cn('grid gap-4', rhCrypto ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
        <Card className="border-primary/15 bg-muted/20">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Total value
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 px-4">
            <p className="text-2xl font-semibold tabular-nums">{formatMoney(totals.total_value, currency)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {rhCrypto ? 'Sum of positions (Robinhood crypto sub-account)' : 'From last custodian sync'}
            </p>
          </CardContent>
        </Card>
        {!rhCrypto ? (
          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide cursor-help">
                    Cash
                  </CardTitle>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  Uninvested cash from the last SimpleFIN sync (account balance minus positions).
                </TooltipContent>
              </Tooltip>
            </CardHeader>
            <CardContent className="pb-4 px-4">
              <p className="text-xl font-semibold tabular-nums">{formatMoney(totals.cash_balance, currency)}</p>
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              In positions
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 px-4">
            <p className="text-xl font-semibold tabular-nums">{formatMoney(totals.positions_value, currency)}</p>
            {!rhCrypto &&
            d.latest_snapshot &&
            Math.abs(d.latest_snapshot.reconciliation_residual) > 0.02 ? (
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                Residual {formatMoney(d.latest_snapshot.reconciliation_residual, currency)}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Value over time</h3>
        {historyQ.isPending ? (
          <p className="text-sm text-muted-foreground">Loading chart…</p>
        ) : chartData.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Sync this account again to build history. Two or more snapshots are required for a line chart.
          </p>
        ) : (
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  className="text-muted-foreground"
                  tickFormatter={(v) =>
                    new Intl.NumberFormat(undefined, {
                      notation: 'compact',
                      maximumFractionDigits: 1,
                    }).format(v)
                  }
                />
                <RechartsTooltip
                  formatter={(value: number) => [formatMoney(value, currency), 'Value']}
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload?.label ? String(payload[0].payload.label) : ''
                  }
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Holdings</h3>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Shares</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Gain</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.holdings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center py-8">
                    No holdings in the last sync payload.
                  </TableCell>
                </TableRow>
              ) : (
                d.holdings.map((h) => (
                  <TableRow key={h.external_holding_id}>
                    <TableCell className="font-medium">{h.symbol ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">
                      {h.description ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{h.shares.toFixed(4)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(h.market_value, h.currency || currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatPct(h.gain_pct)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-1">Manual positions</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Add lots that are too old to import or missing from the feed. Leave symbol blank to count toward
          “Unknown investment” on the summary.
        </p>
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <div className="space-y-1">
            <Label htmlFor="man-sym" className="text-xs">
              Symbol
            </Label>
            <Input
              id="man-sym"
              className="w-[100px] h-9"
              placeholder="e.g. AAPL"
              value={sym}
              onChange={(e) => setSym(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="man-qty" className="text-xs">
              Quantity
            </Label>
            <Input
              id="man-qty"
              className="w-[100px] h-9"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="man-cost" className="text-xs">
              Cost basis (opt.)
            </Label>
            <Input
              id="man-cost"
              className="w-[120px] h-9"
              inputMode="decimal"
              placeholder="Total"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="man-date" className="text-xs">
              As of
            </Label>
            <Input
              id="man-date"
              type="date"
              className="w-[150px] h-9"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
            />
          </div>
          <div className="space-y-1 flex-1 min-w-[160px]">
            <Label htmlFor="man-notes" className="text-xs">
              Notes
            </Label>
            <Input
              id="man-notes"
              className="h-9"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={addMutation.isPending || !qty.trim() || Number.isNaN(Number.parseFloat(qty))}
            onClick={() => addMutation.mutate()}
          >
            Add
          </Button>
        </div>
        {d.manual_positions.length > 0 ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>As of</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.manual_positions.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.symbol ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.cost_basis_total != null ? formatMoney(m.cost_basis_total, currency) : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{m.as_of_date ?? '—'}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive h-8"
                        disabled={delMutation.isPending}
                        onClick={() => delMutation.mutate(m.id)}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Recent activity</h3>
        <p className="text-xs text-muted-foreground mb-2">
          Parsed labels for buys, sells, dividends, and fees (excludes transfers).
        </p>
        <div className="rounded-md border max-h-[320px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.activity
                .filter((a) => !a.is_transfer)
                .map((a) => (
                  <TableRow key={a.transaction_id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap text-sm">
                      {a.date ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {a.kind ?? '—'}
                      {a.parsed_symbol ? (
                        <span className="text-muted-foreground"> · {a.parsed_symbol}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm max-w-[240px] truncate">{a.merchant}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {formatMoney(a.amount, currency)}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
