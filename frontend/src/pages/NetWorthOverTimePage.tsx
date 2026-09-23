import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Info } from 'lucide-react'
import { getNetWorthHistory, type NetWorthHistoryResponse } from '../api/reports'
import { daysAgoIso, fmtShortDate, toLocalIsoDate } from '@/lib/dates'
import { formatSignedUsd as formatMoney, formatSignedUsdWhole as formatMoneyNoCents } from '@/lib/format'
import type { NetWorthPoint } from '../api/dashboard'
import { queryKeys } from '../queryKeys'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Preset = 'last_30' | 'last_90' | 'ytd' | 'all' | 'custom'

export default function NetWorthOverTimePage() {
  // Pinned for the life of the page so derived ranges (and query keys) stay stable across renders.
  const [today] = useState(() => new Date())
  const todayISO = toLocalIsoDate(today)
  const last90StartISO = daysAgoIso(90 - 1, today)

  const [preset, setPreset] = useState<Preset>('last_90')
  const [customStart, setCustomStart] = useState<string>(last90StartISO)
  const [customEnd, setCustomEnd] = useState<string>(todayISO)

  const { startDate, endDate } = useMemo(() => {
    const normalizedCustom =
      customStart > customEnd ? { startDate: customEnd, endDate: customStart } : { startDate: customStart, endDate: customEnd }

    if (preset === 'custom') return normalizedCustom

    if (preset === 'all') {
      return { startDate: '2000-01-01', endDate: todayISO }
    }

    if (preset === 'ytd') {
      const ytdStart = toLocalIsoDate(new Date(today.getFullYear(), 0, 1))
      return { startDate: ytdStart, endDate: todayISO }
    }

    const days = preset === 'last_30' ? 30 : 90
    return { startDate: daysAgoIso(days - 1, today), endDate: todayISO }
  }, [customEnd, customStart, preset, today, todayISO])

  const { data, error, isPending, isFetching } = useQuery<NetWorthHistoryResponse, Error>({
    queryKey: queryKeys.netWorthHistory(startDate, endDate),
    queryFn: () => getNetWorthHistory(startDate, endDate),
    staleTime: 60 * 1000,
  })

  const points = useMemo<NetWorthPoint[]>(() => data?.net_worth_over_time ?? [], [data])

  const mixedAny = useMemo(() => points.some((p) => p.mixed_currencies), [points])
  const currencyAny = useMemo(() => {
    const first = points.find((p) => Boolean(p.currency))
    return first?.currency ?? 'USD'
  }, [points])

  const chartData = useMemo(() => {
    return points.map((p) => ({
      time: fmtShortDate(p.date),
      isoTime: p.date,
      value: Number(p.total_value),
      currency: p.currency,
      mixed: p.mixed_currencies,
      accountsCount: p.accounts_count,
    }))
  }, [points])

  const hasNoData = points.length === 0
  const awaitingData = !data && (isPending || isFetching)
  const loadFailed = Boolean(error) && !data

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <p className="text-muted-foreground text-sm mb-2">
          Net worth for each day, estimated from account balances and transactions. Use the date interval below to explore changes over time.
        </p>
        {mixedAny ? (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Info className="h-4 w-4" />
            Accounts use more than one currency; totals are summed without conversion.
          </p>
        ) : null}
      </motion.div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor="net-worth-preset" className="text-xs text-muted-foreground">
            Interval
          </Label>
          <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
            <SelectTrigger id="net-worth-preset" className="w-[200px] bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="last_30">Last 30 days</SelectItem>
              <SelectItem value="last_90">Last 90 days</SelectItem>
              <SelectItem value="ytd">Year to date</SelectItem>
              <SelectItem value="all">All time</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="net-worth-start" className="text-xs text-muted-foreground">
            Start date
          </Label>
          <Input
            id="net-worth-start"
            type="date"
            value={customStart}
            disabled={preset !== 'custom'}
            onChange={(e) => setCustomStart(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="net-worth-end" className="text-xs text-muted-foreground">
            End date
          </Label>
          <Input
            id="net-worth-end"
            type="date"
            value={customEnd}
            disabled={preset !== 'custom'}
            onChange={(e) => setCustomEnd(e.target.value)}
          />
        </div>

        {preset === 'custom' ? (
          <div className="mb-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                setCustomStart(last90StartISO)
                setCustomEnd(todayISO)
              }}
            >
              Reset to last 90 days
            </Button>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-sm font-semibold">Net worth over time</h2>
            <p className="text-xs text-muted-foreground">
              {fmtShortDate(startDate)} → {fmtShortDate(endDate)} {mixedAny ? '(mixed)' : `(${currencyAny})`}
            </p>
          </div>
        </div>

        {awaitingData ? (
          <p className="text-sm text-muted-foreground py-12 text-center">Loading net worth history…</p>
        ) : loadFailed ? (
          <p className="text-sm text-red-500 py-12 text-center">{error?.message ?? 'Failed to load'}</p>
        ) : hasNoData ? (
          <p className="text-sm text-muted-foreground py-12 text-center">No account activity in this interval.</p>
        ) : (
          <div className="h-[min(44vh,340px)] min-h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  height={36}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                  tickFormatter={(v) => formatMoneyNoCents(Number(v))}
                />
                <RechartsTooltip
                  formatter={(value: number, _n, item: { payload?: (typeof chartData)[number] }) => {
                    const payload = item.payload
                    const currency = payload?.currency ?? currencyAny
                    const mixed = Boolean(payload?.mixed)
                    const accountsCount = payload?.accountsCount
                    const extra = mixed ? ' (mixed)' : ` (${currency})`
                    const accounts = typeof accountsCount === 'number' ? ` · ${accountsCount} accounts` : ''
                    return [`${formatMoney(value)}${extra}${accounts}`, `${payload?.isoTime ?? ''}`]
                  }}
                  labelFormatter={() => ''}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid hsl(var(--border))',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}

