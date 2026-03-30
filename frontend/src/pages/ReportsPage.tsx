import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Info, PiggyBank, Receipt, TrendingDown, TrendingUp } from 'lucide-react'
import { apiGet } from '../api/client'
import { queryKeys } from '../queryKeys'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type BreakdownRow = {
  total: number
  count?: number
  percent: number
  tag?: string
  category?: string
  subcategory?: string
  category_id?: number
}

type CumPoint = { day_of_month: number; this_month: number | null; last_month: number | null }

type ReportsMonthlyResponse = {
  year: number
  month: number
  start_date: string
  end_date: string
  prev_month_year: number
  prev_month: number
  total_spending: number
  total_income: number
  avg_transaction_amount: number
  transaction_count: number
  savings_rate_pct: number | null
  cumulative_comparison: CumPoint[]
  by_tag: BreakdownRow[]
  by_category: BreakdownRow[]
  by_subcategory: BreakdownRow[]
}

const pieColors = [
  'hsl(217, 91%, 54%)',
  'hsl(199, 80%, 48%)',
  'hsl(160, 84%, 38%)',
  'hsl(262, 52%, 52%)',
  'hsl(239, 58%, 58%)',
  'hsl(330, 65%, 52%)',
  'hsl(38, 92%, 50%)',
  'hsl(220, 11%, 58%)',
]

const ET_AL_COLOR = 'hsl(var(--muted-foreground) / 0.35)'
const ET_AL_SLICE_FILL = 'hsl(var(--muted) / 0.55)'

const SMALL_SLICE_PCT = 1

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
}
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
}

function monthYearLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

type RawSlice = {
  name: string
  value: number
  pct: number
  categoryId?: number
}

type PieSlice = RawSlice & {
  isEtAl: boolean
  fill: string
}

type LegendRow = {
  name: string
  pct: number
  color: string
  inEtAlGroup?: boolean
}

function consolidatePieSlices(raw: RawSlice[]): { pieSlices: PieSlice[]; legendRows: LegendRow[] } {
  if (raw.length === 0) return { pieSlices: [], legendRows: [] }
  const sorted = [...raw].sort((a, b) => b.value - a.value)
  const major = sorted.filter((s) => s.pct >= SMALL_SLICE_PCT)
  const minor = sorted.filter((s) => s.pct < SMALL_SLICE_PCT)

  const pieSlices: PieSlice[] = []
  const legendRows: LegendRow[] = []

  major.forEach((s, i) => {
    const fill = pieColors[i % pieColors.length]
    pieSlices.push({ ...s, isEtAl: false, fill })
    legendRows.push({ name: s.name, pct: s.pct, color: fill })
  })

  if (minor.length > 0) {
    const sumV = minor.reduce((a, b) => a + b.value, 0)
    const sumP = minor.reduce((a, b) => a + b.pct, 0)
    pieSlices.push({
      name: 'et al.',
      value: sumV,
      pct: sumP,
      isEtAl: true,
      fill: ET_AL_SLICE_FILL,
    })
    minor.forEach((s) => {
      legendRows.push({
        name: s.name,
        pct: s.pct,
        color: ET_AL_COLOR,
        inEtAlGroup: true,
      })
    })
  }

  return { pieSlices, legendRows }
}

function rawSlicesFromRows(
  rows: BreakdownRow[],
  nameKey: 'tag' | 'category' | 'subcategory',
  idKey?: 'category_id',
): RawSlice[] {
  const out: RawSlice[] = []
  for (const row of rows) {
    const raw = Number(row.total)
    if (!Number.isFinite(raw)) continue
    const magnitude = Math.abs(raw)
    if (magnitude <= 0) continue
    const label = String(row[nameKey] ?? 'Unknown').trim() || 'Unknown'
    const slice: RawSlice = {
      name: label,
      value: magnitude,
      pct: Number(row.percent),
    }
    if (idKey && row.category_id != null) {
      slice.categoryId = row.category_id
    }
    out.push(slice)
  }
  return out
}

function formatMoney(n: number) {
  const sign = n < 0 ? '−' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function PieLegendList({
  rows,
  showEtAlNote,
  large,
}: {
  rows: LegendRow[]
  showEtAlNote: boolean
  large?: boolean
}) {
  return (
    <div>
      {showEtAlNote ? (
        <p
          className={cn(
            'text-muted-foreground mb-2 leading-snug',
            large ? 'text-xs' : 'text-[10px]',
          )}
        >
          Segments under 1% are drawn as one &quot;et al.&quot; slice; each category still appears here.
        </p>
      ) : null}
      <ul
        className={cn(
          'leading-snug max-h-[min(52vh,360px)] overflow-y-auto pr-1',
          large ? 'space-y-2 text-sm' : 'space-y-1.5 text-[11px]',
        )}
      >
        {rows.map((row, i) => (
          <li key={`${row.name}-${i}`} className="flex items-start gap-2 min-w-0">
            <span
              className={cn(
                'shrink-0 rounded-sm',
                large ? 'mt-0.5 h-3 w-3' : 'mt-1 h-2.5 w-2.5',
              )}
              style={{ backgroundColor: row.color }}
              aria-hidden
            />
            <span className={row.inEtAlGroup ? 'text-muted-foreground' : 'text-foreground'}>
              <span className="break-words">{row.name}</span>
              <span className="tabular-nums text-muted-foreground"> — {row.pct.toFixed(1)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SpendPieCard({
  title,
  subtitle,
  rawSlices,
  emptyHint,
  interactiveCategory,
  selectedCategoryId,
  onCategorySliceClick,
  /** Pie ~⅔ width, legend ~⅓; larger legend type (category + tag row). */
  twoThirdsPieLayout,
}: {
  title: string
  subtitle?: string
  rawSlices: RawSlice[]
  emptyHint: string
  interactiveCategory?: boolean
  selectedCategoryId?: number | null
  onCategorySliceClick?: (categoryId: number) => void
  twoThirdsPieLayout?: boolean
}) {
  const { pieSlices, legendRows } = useMemo(() => consolidatePieSlices(rawSlices), [rawSlices])
  const showEtAlNote = legendRows.some((r) => r.inEtAlGroup)

  if (rawSlices.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 shadow-card flex flex-col min-h-[320px]">
        <h2 className="text-sm font-semibold mb-1">{title}</h2>
        {subtitle ? <p className="text-xs text-muted-foreground mb-4">{subtitle}</p> : null}
        <p className="text-sm text-muted-foreground flex-1 flex items-center justify-center">{emptyHint}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-6 shadow-card min-w-0">
      <h2 className="text-sm font-semibold mb-1">{title}</h2>
      {subtitle ? <p className="text-xs text-muted-foreground mb-4">{subtitle}</p> : null}
      <div className="flex flex-col lg:flex-row lg:items-stretch gap-4 min-w-0">
        <div
          className={cn(
            'h-[min(52vh,420px)] min-h-[260px] min-w-0',
            twoThirdsPieLayout ? 'lg:flex-[2]' : 'flex-1',
          )}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <Pie
                data={pieSlices}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="44%"
                outerRadius="76%"
                paddingAngle={1.2}
                strokeWidth={1}
                stroke="hsl(var(--background))"
                label={false}
                cursor={interactiveCategory ? 'pointer' : 'default'}
                onClick={
                  interactiveCategory && onCategorySliceClick
                    ? (_, index) => {
                        const s = pieSlices[index]
                        if (!s || s.isEtAl || s.categoryId == null) return
                        onCategorySliceClick(s.categoryId)
                      }
                    : undefined
                }
              >
                {pieSlices.map((s, i) => {
                  const selected =
                    interactiveCategory &&
                    !s.isEtAl &&
                    s.categoryId != null &&
                    selectedCategoryId === s.categoryId
                  return (
                    <Cell
                      key={i}
                      fill={s.fill}
                      stroke={selected ? 'hsl(var(--primary))' : 'hsl(var(--background))'}
                      strokeWidth={selected ? 3 : 1}
                      className={interactiveCategory ? 'outline-none' : ''}
                    />
                  )
                })}
              </Pie>
              <RechartsTooltip
                formatter={(value: number, _n, item: { payload?: PieSlice }) => {
                  const name = item.payload?.name ?? ''
                  return [
                    `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                    name,
                  ]
                }}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: '1px solid hsl(var(--border))',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div
          className={cn(
            'w-full shrink-0 lg:border-l lg:border-border/60 lg:pl-4',
            twoThirdsPieLayout ? 'lg:flex-1 lg:min-w-0' : 'lg:w-[min(100%,280px)]',
          )}
        >
          <p
            className={cn(
              'font-medium uppercase tracking-wide text-muted-foreground mb-2',
              twoThirdsPieLayout ? 'text-xs' : 'text-[10px]',
            )}
          >
            Legend
          </p>
          <PieLegendList rows={legendRows} showEtAlNote={showEtAlNote} large={twoThirdsPieLayout} />
        </div>
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  const yearOptions = useMemo(() => {
    const cy = today.getFullYear()
    const start = Math.min(cy - 10, 2018)
    const out: number[] = []
    for (let y = start; y <= cy + 1; y++) out.push(y)
    return out
  }, [today])

  const { data, error, isPending, isFetching } = useQuery<ReportsMonthlyResponse, Error>({
    queryKey: queryKeys.reportsMonthly(year, month),
    queryFn: () => apiGet<ReportsMonthlyResponse>(`/api/reports/monthly?year=${year}&month=${month}`),
    staleTime: 60 * 1000,
  })

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)

  const awaitingData = !data && !error && (isPending || isFetching)
  const loadFailed = Boolean(error) && !data
  const hasNoData = data != null && data.transaction_count === 0

  const thisLabel = data ? monthYearLabel(data.year, data.month) : monthYearLabel(year, month)
  const prevLabel = data ? monthYearLabel(data.prev_month_year, data.prev_month) : ''

  const lineData = useMemo(() => {
    if (!data?.cumulative_comparison?.length) return []
    return data.cumulative_comparison.map((row) => ({
      day: row.day_of_month,
      [thisLabel]: row.this_month,
      [prevLabel]: row.last_month,
    }))
  }, [data?.cumulative_comparison, thisLabel, prevLabel])

  const categoryRaw = useMemo(
    () => rawSlicesFromRows(data?.by_category ?? [], 'category', 'category_id'),
    [data?.by_category],
  )

  const tagRaw = useMemo(() => rawSlicesFromRows(data?.by_tag ?? [], 'tag'), [data?.by_tag])

  const subcategoryRaw = useMemo(() => {
    const rows = data?.by_subcategory ?? []
    const filtered =
      selectedCategoryId == null ? rows : rows.filter((r) => r.category_id === selectedCategoryId)
    const mapped: BreakdownRow[] = filtered.map((r) => ({
      ...r,
      subcategory: r.category ? `${r.category} › ${r.subcategory ?? '—'}` : String(r.subcategory ?? ''),
    }))
    return rawSlicesFromRows(mapped, 'subcategory')
  }, [data?.by_subcategory, selectedCategoryId])

  const selectedCategoryName =
    selectedCategoryId != null
      ? data?.by_category.find((c) => c.category_id === selectedCategoryId)?.category ?? ''
      : ''

  const onCategorySliceClick = useCallback((id: number) => {
    setSelectedCategoryId(id)
  }, [])

  useEffect(() => {
    setSelectedCategoryId(null)
  }, [year, month])

  const spending = data ? Number(data.total_spending) : 0
  const income = data ? Number(data.total_income) : 0

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <p className="text-muted-foreground text-sm mb-4">
          Monthly spending, income, and category mix. Transfers (including to savings) are excluded from spending.
        </p>
      </motion.div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor="reports-year" className="text-xs text-muted-foreground">
            Year
          </Label>
          <Select
            value={String(year)}
            onValueChange={(v) => setYear(parseInt(v, 10))}
          >
            <SelectTrigger id="reports-year" className="w-[120px] bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="reports-month-select" className="text-xs text-muted-foreground">
            Month
          </Label>
          <Select
            value={String(month)}
            onValueChange={(v) => setMonth(parseInt(v, 10))}
          >
            <SelectTrigger id="reports-month-select" className="w-[min(100%,200px)] bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((name, idx) => (
                <SelectItem key={name} value={String(idx + 1)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isFetching && data ? (
          <span className="text-xs text-muted-foreground pb-2">Updating…</span>
        ) : null}
      </div>

      {error ? <div className="text-sm text-destructive">{error.message}</div> : null}
      {loadFailed ? <div className="text-sm text-muted-foreground">Unable to load reports.</div> : null}

      {!loadFailed && hasNoData && !awaitingData ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          No data for that month.
        </div>
      ) : null}

      {!loadFailed ? (
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="space-y-8"
          style={{ opacity: awaitingData ? 0.72 : 1, transition: 'opacity 0.15s ease' }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <motion.div variants={item} className="rounded-xl border bg-card p-5 shadow-card">
              <div className="flex items-center gap-2 mb-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-expense/10 ring-1 ring-expense/20 shadow-sm">
                  <TrendingDown className="h-4 w-4 text-expense" />
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Spending</p>
                  <Tooltip>
                    <TooltipTrigger type="button">
                      <Info className="h-3 w-3 text-muted-foreground/50" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      Net non-Income activity for the month (split-aware). Excludes transfers and the Income category.
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              {awaitingData ? (
                <div className="text-2xl font-mono text-muted-foreground">—</div>
              ) : (
                <p className={`text-2xl font-bold tabular-nums font-mono ${spending >= 0 ? 'text-expense' : 'text-income'}`}>
                  {formatMoney(spending)}
                </p>
              )}
            </motion.div>

            <motion.div variants={item} className="rounded-xl border bg-card p-5 shadow-card">
              <div className="flex items-center gap-2 mb-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-income/10 ring-1 ring-income/25 shadow-sm">
                  <TrendingUp className="h-4 w-4 text-income" />
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Income</p>
                  <Tooltip>
                    <TooltipTrigger type="button">
                      <Info className="h-3 w-3 text-muted-foreground/50" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      Sum of amounts in the Income category for the month.
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              {awaitingData ? (
                <div className="text-2xl font-mono text-muted-foreground">—</div>
              ) : (
                <p className="text-2xl font-bold tabular-nums font-mono text-income">{formatMoney(income)}</p>
              )}
            </motion.div>

            <motion.div variants={item} className="rounded-xl border bg-card p-5 shadow-card">
              <div className="flex items-center gap-2 mb-2.5">
                <div className="brand-icon-well h-8 w-8 !rounded-lg">
                  <Receipt className="h-4 w-4 text-primary" />
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Avg transaction</p>
                  <Tooltip>
                    <TooltipTrigger type="button">
                      <Info className="h-3 w-3 text-muted-foreground/50" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      Mean of |amount| over non-transfer transactions ({data?.transaction_count ?? 0} in range).
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              {awaitingData ? (
                <div className="text-2xl font-mono text-muted-foreground">—</div>
              ) : (
                <p className="text-2xl font-bold tabular-nums font-mono text-foreground">
                  {formatMoney(Number(data?.avg_transaction_amount ?? 0))}
                </p>
              )}
            </motion.div>

            <motion.div variants={item} className="rounded-xl border bg-card p-5 shadow-card">
              <div className="flex items-center gap-2 mb-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 shadow-sm">
                  <PiggyBank className="h-4 w-4 text-primary" />
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Savings rate</p>
                  <Tooltip>
                    <TooltipTrigger type="button">
                      <Info className="h-3 w-3 text-muted-foreground/50" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      (Income − spending) ÷ income. Spending excludes transfers (e.g. moves to savings). If there is no
                      income this month, this is blank.
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              {awaitingData ? (
                <div className="text-2xl font-mono text-muted-foreground">—</div>
              ) : data?.savings_rate_pct == null ? (
                <p className="text-2xl font-bold tabular-nums font-mono text-muted-foreground">—</p>
              ) : (
                <p
                  className={`text-2xl font-bold tabular-nums font-mono ${
                    data.savings_rate_pct >= 0 ? 'text-income' : 'text-expense'
                  }`}
                >
                  {data.savings_rate_pct.toFixed(1)}%
                </p>
              )}
            </motion.div>
          </div>

          <motion.div variants={item} className="rounded-xl border bg-card p-5 shadow-card">
            <h2 className="text-sm font-semibold mb-1">Cumulative spending vs prior month</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Day-by-day running total of net non-Income spending (transfers excluded). {prevLabel} vs {thisLabel}.
              In-progress months stop at today; the prior month ends on its last calendar day.
            </p>
            {awaitingData ? (
              <p className="text-sm text-muted-foreground py-16 text-center">Loading chart…</p>
            ) : hasNoData ? (
              <p className="text-sm text-muted-foreground py-16 text-center">No data for this month.</p>
            ) : lineData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">No data for this month.</p>
            ) : (
              <div className="h-[min(36vh,340px)] min-h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={lineData}
                    margin={{ top: 6, right: 12, left: 2, bottom: 26 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      height={28}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      width={72}
                      tickFormatter={(v) => `$${Math.abs(Number(v)).toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
                    />
                    <RechartsTooltip
                      formatter={(value) => {
                        if (value == null || value === '') return ['—', '']
                        const n = Number(value)
                        if (Number.isNaN(n)) return ['—', '']
                        return [
                          `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                          '',
                        ]
                      }}
                      labelFormatter={(d) => `Day ${d}`}
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 8,
                        border: '1px solid hsl(var(--border))',
                      }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      align="center"
                      wrapperStyle={{ paddingTop: 2, fontSize: 11 }}
                      iconSize={10}
                    />
                    <Line
                      type="monotone"
                      dataKey={prevLabel}
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      name={prevLabel}
                    />
                    <Line
                      type="monotone"
                      dataKey={thisLabel}
                      stroke="hsl(var(--primary))"
                      strokeWidth={2.5}
                      dot={false}
                      connectNulls={false}
                      name={thisLabel}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </motion.div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <motion.div variants={item}>
              <SpendPieCard
                title="Spend by category"
                subtitle="Click a slice to filter subcategories below. Non-Income categories; transfers excluded."
                rawSlices={categoryRaw}
                emptyHint="No categorized spending this month."
                interactiveCategory
                selectedCategoryId={selectedCategoryId}
                onCategorySliceClick={onCategorySliceClick}
                twoThirdsPieLayout
              />
            </motion.div>
            <motion.div variants={item}>
              <SpendPieCard
                title="Spend by tag"
                rawSlices={tagRaw}
                emptyHint="No tagged spending this month."
                twoThirdsPieLayout
              />
            </motion.div>
          </div>

          <motion.div variants={item} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {selectedCategoryId != null ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedCategoryId(null)}>
                  All subcategories
                </Button>
              ) : null}
              {selectedCategoryId != null && selectedCategoryName ? (
                <span className="text-xs text-muted-foreground">
                  Showing subcategories for <span className="font-medium text-foreground">{selectedCategoryName}</span>
                </span>
              ) : null}
            </div>
            <SpendPieCard
              title="Spend by subcategory"
              subtitle={
                selectedCategoryId != null && selectedCategoryName
                  ? `Filtered: ${selectedCategoryName}`
                  : 'Category › subcategory'
              }
              rawSlices={subcategoryRaw}
              emptyHint={
                selectedCategoryId != null
                  ? 'No subcategory spending for this category in this month.'
                  : 'No subcategory breakdown this month.'
              }
            />
          </motion.div>
        </motion.div>
      ) : null}
    </div>
  )
}
