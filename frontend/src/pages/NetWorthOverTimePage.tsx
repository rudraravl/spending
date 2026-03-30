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
import { apiGet } from '../api/client'
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

type NetWorthPoint = {
  captured_at: string
  total_value: number
  currency: string
  mixed_currencies: boolean
  accounts_count: number
}

type NetWorthHistoryResponse = {
  start_date: string
  end_date: string
  net_worth_over_time: NetWorthPoint[]
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

function fmtShortDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatMoney(n: number) {
  const sign = n < 0 ? '−' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatMoneyNoCents(n: number) {
  const sign = n < 0 ? '−' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

type Preset = 'last_30' | 'last_90' | 'ytd' | 'all' | 'custom'

export default function NetWorthOverTimePage() {
  const today = new Date()
  const currentYear = today.getFullYear()
  const todayISO = isoDate(today)
  const last90StartISO = isoDate(new Date(today.getTime() - (90 - 1) * 24 * 3600 * 1000))

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
      const ytdStart = isoDate(new Date(currentYear, 0, 1))
      return { startDate: ytdStart, endDate: todayISO }
    }

    const days = preset === 'last_30' ? 30 : 90
    const start = new Date(today.getTime() - (days - 1) * 24 * 3600 * 1000)
    return { startDate: isoDate(start), endDate: todayISO }
  }, [customEnd, customStart, preset, todayISO, currentYear])

  const { data, error, isPending, isFetching } = useQuery<NetWorthHistoryResponse, Error>({
    queryKey: queryKeys.netWorthHistory(startDate, endDate),
    queryFn: () => apiGet<NetWorthHistoryResponse>(`/api/reports/net-worth?start_date=${startDate}&end_date=${endDate}`),
    staleTime: 60 * 1000,
  })

  const points = data?.net_worth_over_time ?? []

  const mixedAny = useMemo(() => points.some((p) => p.mixed_currencies), [points])
  const currencyAny = useMemo(() => {
    const first = points.find((p) => Boolean(p.currency))
    return first?.currency ?? 'USD'
  }, [points])

  const chartData = useMemo(() => {
    return points.map((p) => ({
      time: fmtShortDate(p.captured_at.slice(0, 10)),
      isoTime: p.captured_at.slice(0, 10),
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
          Net worth snapshots are captured on each sync. Use the date interval below to explore changes over time.
        </p>
        {mixedAny ? (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Info className="h-4 w-4" />
            Mixed-currency snapshots detected; totals are summed without conversion.
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
          <p className="text-sm text-muted-foreground py-12 text-center">No net worth snapshots in this interval.</p>
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
                  formatter={(value: number, _n, item: { payload?: any }) => {
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
                  dot={{ r: 2.5, strokeWidth: 0, fill: 'hsl(var(--primary))' }}
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

