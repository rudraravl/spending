import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowRight, Info, Scale, TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { apiGet } from '../api/client'
import { SortableTableHead } from '@/components/sortable-table-head'
import { cycleSort, sortBySelector, type ColumnSortState } from '@/lib/tableSort'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type RangeKey = 'this_month' | 'last_month' | 'year' | 'custom'

type CategoryRow = {
  category_id: number
  category: string
  total: number
  count: number
  percent: number
}

type SubcategoryRow = {
  category_id: number
  category: string
  subcategory: string
  total: number
  count: number
  percent: number
}

type TrendPoint = { date: string; spending: number; credits: number }

type RecentRow = {
  id: number
  Date: string
  Merchant: string
  Amount: number
  Category: string
}

type DashboardResponse = {
  range: string
  start_date: string
  end_date: string
  total_spending: number
  total_income: number
  by_category: CategoryRow[]
  by_subcategory: SubcategoryRow[]
  spending_over_time: TrendPoint[]
  recent_transactions: RecentRow[]
}

const PRESETS: { key: RangeKey; label: string }[] = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'year', label: 'Year' },
  { key: 'custom', label: 'Custom' },
]

const pieColors = [
  'hsl(158, 50%, 38%)',
  'hsl(24, 80%, 55%)',
  'hsl(220, 60%, 55%)',
  'hsl(280, 50%, 55%)',
  'hsl(38, 92%, 50%)',
  'hsl(190, 50%, 45%)',
  'hsl(220, 10%, 70%)',
]

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}
const item = {
  hidden: { opacity: 0, y: 16, filter: 'blur(4px)' },
  show: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  },
}

function buildDashboardUrl(preset: RangeKey, customStart: string, customEnd: string): string {
  const p = new URLSearchParams()
  p.set('range', preset)
  if (preset === 'custom') {
    p.set('start_date', customStart)
    p.set('end_date', customEnd)
  }
  return `/api/dashboard?${p.toString()}`
}

function fmtShortDate(iso: string) {
  try {
    const d = new Date(iso + (iso.length <= 10 ? 'T12:00:00' : ''))
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

export default function DashboardPage() {
  const [preset, setPreset] = useState<RangeKey>('this_month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [pinnedCategoryId, setPinnedCategoryId] = useState<number | null>(null)
  const [recentSort, setRecentSort] = useState<ColumnSortState | null>(null)

  const customReady = preset !== 'custom' || (Boolean(customStart) && Boolean(customEnd))

  const { data, error, isLoading } = useQuery<DashboardResponse, Error>({
    queryKey: ['dashboard', preset, preset === 'custom' ? customStart : '', preset === 'custom' ? customEnd : ''],
    queryFn: () => apiGet<DashboardResponse>(buildDashboardUrl(preset, customStart, customEnd)),
    enabled: customReady,
  })

  const selectedCategoryId = useMemo(() => {
    const rows = data?.by_category ?? []
    if (!rows.length) return null
    if (pinnedCategoryId != null && rows.some((r) => r.category_id === pinnedCategoryId)) {
      return pinnedCategoryId
    }
    return rows[0].category_id
  }, [data, pinnedCategoryId])

  const categoryPieData = useMemo(() => {
    if (!data?.by_category.length) return []
    return data.by_category.map((r) => ({
      name: r.category,
      amount: Math.abs(Number(r.total)),
      percent: Number(r.percent),
      category_id: r.category_id,
    }))
  }, [data])

  const subPieData = useMemo(() => {
    if (!data || selectedCategoryId == null) return []
    const rows = data.by_subcategory.filter((r) => r.category_id === selectedCategoryId)
    return rows
      .map((r) => ({
        name: (r.subcategory && String(r.subcategory).trim()) || 'Uncategorized',
        amount: Math.abs(Number(r.total)),
        percent: Number(r.percent),
      }))
      .filter((x) => x.amount > 0)
  }, [data, selectedCategoryId])

  const dailyBars = useMemo(() => {
    if (!data?.spending_over_time?.length) return []
    return data.spending_over_time.map((r) => ({
      day: fmtShortDate(r.date),
      spending: Number(r.spending),
      creditsNeg: -Number(r.credits),
    }))
  }, [data])

  const selectedCategoryName =
    data?.by_category.find((c) => c.category_id === selectedCategoryId)?.category ?? ''

  const netBalance = data ? Number(data.total_income) - Number(data.total_spending) : 0

  const sortedRecentTransactions = useMemo(() => {
    if (!data?.recent_transactions?.length) return []
    return sortBySelector(data.recent_transactions, recentSort, {
      Date: (r) => r.Date,
      Merchant: (r) => r.Merchant,
      Amount: (r) => r.Amount,
      Category: (r) => r.Category,
    })
  }, [data?.recent_transactions, recentSort])

  function onSelectPreset(next: RangeKey) {
    setPreset(next)
    if (next === 'custom' && !customStart) {
      const t = new Date()
      const y = t.getFullYear()
      const m = String(t.getMonth() + 1).padStart(2, '0')
      const day = String(t.getDate()).padStart(2, '0')
      setCustomStart(`${y}-${m}-01`)
      setCustomEnd(`${y}-${m}-${day}`)
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1280px] mx-auto">
      <motion.div variants={container} initial="hidden" animate="show">
        <motion.div variants={item} className="flex flex-wrap items-center gap-2 mb-4">
          {PRESETS.map(({ key, label }) => (
            <Button
              key={key}
              type="button"
              variant={preset === key ? 'default' : 'outline'}
              size="sm"
              className="text-xs"
              onClick={() => onSelectPreset(key)}
            >
              {label}
            </Button>
          ))}
          <div className="flex-1 min-w-[120px]" />
          <Button variant="outline" size="sm" className="text-xs" asChild>
            <Link to="/add-transaction">Add transaction</Link>
          </Button>
          <Button variant="outline" size="sm" className="text-xs" asChild>
            <Link to="/import">Import CSV</Link>
          </Button>
        </motion.div>

        {preset === 'custom' ? (
          <motion.div variants={item} className="flex flex-wrap items-end gap-3 mb-6">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">From</span>
              <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-auto" />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">To</span>
              <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-auto" />
            </div>
            {!customReady ? (
              <span className="text-xs text-muted-foreground pb-2">Choose start and end dates</span>
            ) : null}
          </motion.div>
        ) : null}

        {data ? (
          <p className="text-xs text-muted-foreground mb-4">
            {fmtShortDate(data.start_date)} — {fmtShortDate(data.end_date)}
          </p>
        ) : null}

        {error ? (
          <div className="text-sm text-destructive mb-4">{error.message}</div>
        ) : null}

        {!customReady ? (
          <div className="text-sm text-muted-foreground">Set a custom date range to load.</div>
        ) : isLoading || !data ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <div className="rounded-xl border bg-card p-5 shadow-card">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-expense/10">
                    <TrendingDown className="h-4 w-4 text-expense" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Total Spending</p>
                    <Tooltip>
                      <TooltipTrigger type="button">
                        <Info className="h-3 w-3 text-muted-foreground/50" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs max-w-[220px]">
                          Net non-Income activity: purchases minus refunds in spend categories. Excludes
                          transfers, card payments, and the Income category. Negative means net credits in
                          the period.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                <p
                  className={`text-2xl font-bold tabular-nums font-mono ${Number(data.total_spending) >= 0 ? 'text-expense' : 'text-income'}`}
                >
                  {Number(data.total_spending) < 0 ? '-' : ''}$
                  {Math.abs(Number(data.total_spending)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
              </div>

              <div className="rounded-xl border bg-card p-5 shadow-card">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-income/10">
                    <TrendingUp className="h-4 w-4 text-income" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Total Income</p>
                    <Tooltip>
                      <TooltipTrigger type="button">
                        <Info className="h-3 w-3 text-muted-foreground/50" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs max-w-[220px]">
                          Sum of transactions in the Income category (e.g. Paycheck). Refunds in other
                          categories are not included.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                <p className="text-2xl font-bold tabular-nums font-mono text-income">
                  ${Number(data.total_income).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
              </div>

              <div className="rounded-xl border bg-card p-5 shadow-card">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                    <Scale className="h-4 w-4 text-primary" />
                  </div>
                  <p className="text-xs font-medium text-muted-foreground">Net Balance</p>
                </div>
                <p
                  className={`text-2xl font-bold tabular-nums font-mono ${netBalance >= 0 ? 'text-income' : 'text-expense'}`}
                >
                  {netBalance >= 0 ? '+' : ''}$
                  {Math.abs(netBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </motion.div>

            {/* Full-width daily chart */}
            <div className="mb-8">
              <motion.div variants={item} className="rounded-xl border bg-card p-6 shadow-card">
                <h2 className="text-sm font-semibold mb-1">Daily spending (excl. Income)</h2>
                <p className="text-xs text-muted-foreground mb-4">
                  Red = money out; green = credits/refunds.
                </p>
                {dailyBars.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-12 text-center">No data for this range.</p>
                ) : (
                  <div className="h-[min(42vh,380px)] min-h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={dailyBars}
                        stackOffset="sign"
                        margin={{ top: 8, right: 12, left: 4, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(220, 12%, 90%)" />
                        <XAxis
                          dataKey="day"
                          tick={{ fontSize: 10, fill: 'hsl(220, 10%, 45%)' }}
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                          height={36}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: 'hsl(220, 10%, 45%)' }}
                          tickLine={false}
                          axisLine={false}
                          width={56}
                          tickFormatter={(v) => {
                            const n = Number(v)
                            const s = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
                            if (n < 0) return `−$${s}`
                            if (n > 0) return `$${s}`
                            return '$0'
                          }}
                        />
                        <ReferenceLine y={0} stroke="hsl(220, 12%, 70%)" strokeWidth={1.5} />
                        <RechartsTooltip
                          formatter={(value: number, name: string) => {
                            const n = typeof value === 'number' ? value : Number(value)
                            const abs = Math.abs(n).toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                            const label =
                              name === 'creditsNeg' || name === 'Credits' ? 'Credits' : 'Spending'
                            return [`$${abs}`, label]
                          }}
                          labelFormatter={(label) => label}
                          contentStyle={{
                            fontSize: 12,
                            borderRadius: 8,
                            border: '1px solid hsl(220, 12%, 90%)',
                          }}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                          formatter={(value) => (value === 'creditsNeg' ? 'Credits' : value)}
                        />
                        <Bar
                          dataKey="spending"
                          name="Spending"
                          stackId="stack"
                          fill="hsl(var(--expense))"
                          maxBarSize={28}
                          radius={[3, 3, 0, 0]}
                        />
                        <Bar
                          dataKey="creditsNeg"
                          name="Credits"
                          stackId="stack"
                          fill="hsl(var(--income))"
                          maxBarSize={28}
                          radius={[3, 3, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </motion.div>
            </div>

            {/* Category (2 cols) + Subcategories (1 col) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              <motion.div variants={item} className="lg:col-span-2 rounded-xl border bg-card p-6 shadow-card">
                <h2 className="text-sm font-semibold mb-4">By Category</h2>
                <div className="h-40 sm:h-44 mb-4">
                  {categoryPieData.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No spending in this period.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categoryPieData}
                          dataKey="amount"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={68}
                          paddingAngle={2}
                          strokeWidth={0}
                          onClick={(_, index) => {
                            const id = categoryPieData[index]?.category_id
                            if (id != null) setPinnedCategoryId(id)
                          }}
                        >
                          {categoryPieData.map((_, i) => (
                            <Cell key={i} fill={pieColors[i % pieColors.length]} className="cursor-pointer" />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="space-y-2">
                  {categoryPieData.slice(0, 7).map((cat, i) => (
                    <button
                      key={cat.category_id}
                      type="button"
                      className={`flex w-full items-center justify-between text-sm rounded-md px-1 py-0.5 text-left hover:bg-muted/80 ${
                        selectedCategoryId === cat.category_id ? 'bg-muted' : ''
                      }`}
                      onClick={() => setPinnedCategoryId(cat.category_id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: pieColors[i % pieColors.length] }}
                        />
                        <span className="text-foreground truncate">{cat.name}</span>
                      </div>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground shrink-0">
                        {cat.percent.toFixed(0)}%
                      </span>
                    </button>
                  ))}
                </div>
              </motion.div>

              <motion.div variants={item} className="lg:col-span-1 rounded-xl border bg-card p-6 shadow-card min-h-[280px] flex flex-col">
                <h2 className="text-sm font-semibold mb-1">Subcategories</h2>
                <p className="text-xs text-muted-foreground mb-4 truncate" title={selectedCategoryName}>
                  {selectedCategoryName || '—'}
                </p>
                {subPieData.length > 0 ? (
                  <>
                    <div className="h-44 w-full shrink-0 mb-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={subPieData}
                            dataKey="amount"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={28}
                            outerRadius={52}
                            paddingAngle={2}
                            strokeWidth={0}
                          >
                            {subPieData.map((_, i) => (
                              <Cell key={i} fill={pieColors[i % pieColors.length]} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2 min-w-0 flex-1 overflow-auto">
                      {subPieData.map((sub, i) => (
                        <div
                          key={`${sub.name}-${i}`}
                          className="flex w-full items-center justify-between text-sm rounded-md px-1 py-0.5"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: pieColors[i % pieColors.length] }}
                            />
                            <span className="text-foreground truncate" title={sub.name}>
                              {sub.name}
                            </span>
                          </div>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground shrink-0">
                            {sub.percent.toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center text-center text-sm text-muted-foreground px-2 py-8">
                    {categoryPieData.length === 0
                      ? 'Add categorized transactions to see subcategories.'
                      : 'Click a category (chart or list) to see its subcategories.'}
                  </div>
                )}
              </motion.div>
            </div>

            <motion.div variants={item} className="rounded-xl border bg-card shadow-card overflow-hidden">
              <div className="flex items-center justify-between px-6 pt-5 pb-3">
                <h2 className="text-sm font-semibold">Recent Activity</h2>
                <Link
                  to="/transactions"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <SortableTableHead
                      label="Date"
                      columnKey="Date"
                      sort={recentSort}
                      onSort={(k) => setRecentSort((prev) => cycleSort(prev, k))}
                    />
                    <SortableTableHead
                      label="Merchant"
                      columnKey="Merchant"
                      sort={recentSort}
                      onSort={(k) => setRecentSort((prev) => cycleSort(prev, k))}
                    />
                    <SortableTableHead
                      label="Amount"
                      columnKey="Amount"
                      sort={recentSort}
                      onSort={(k) => setRecentSort((prev) => cycleSort(prev, k))}
                      align="right"
                    />
                    <SortableTableHead
                      label="Category"
                      columnKey="Category"
                      sort={recentSort}
                      onSort={(k) => setRecentSort((prev) => cycleSort(prev, k))}
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRecentTransactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {fmtShortDate(tx.Date)}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{tx.Merchant}</TableCell>
                      <TableCell
                        className={`text-right font-mono text-sm tabular-nums font-medium ${
                          tx.Amount > 0 ? 'text-income' : tx.Amount < 0 ? 'text-expense' : ''
                        }`}
                      >
                        {tx.Amount > 0 ? '+' : ''}
                        {tx.Amount.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px] font-normal">
                          {tx.Category}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </motion.div>
          </>
        )}
      </motion.div>
    </div>
  )
}
