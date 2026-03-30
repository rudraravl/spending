import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import PlotlyDefault from 'react-plotly.js'
import { apiGet } from '../api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { SortableHtmlTh } from '@/components/sortable-table-head'
import { columnLooksNumeric, cycleSort, sortByColumn, type ColumnSortState } from '@/lib/tableSort'
import { queryKeys } from '../queryKeys'
import { getAccounts } from '../api/accounts'
import { getCategories, getSubcategories } from '../api/categories'
import type { AccountOut, CategoryOut, SubcategoryOut, TagOut } from '../types'

// `react-plotly.js` is CJS; depending on bundler interop, the React component can be nested under one or more `default` keys.
const Plot: any =
  (PlotlyDefault as any)?.default?.default ?? (PlotlyDefault as any)?.default ?? PlotlyDefault

function Pie({
  labels,
  values,
  title,
  plotOk,
}: {
  labels: string[]
  values: number[]
  title: string
  plotOk: boolean
}) {
  return plotOk ? (
    <Plot
      data={[
        {
          type: 'pie',
          labels,
          values,
          hole: 0.2,
        },
      ]}
      layout={{
        title,
        height: 320,
        margin: { t: 30, b: 10, l: 10, r: 10 },
        showlegend: false,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
      }}
      config={{ displayModeBar: false, responsive: true }}
    />
  ) : (
    <div style={{ padding: 8, opacity: 0.75 }}>Plotly unavailable</div>
  )
}

function buildPieData(rows: Array<Record<string, any>>, labelKey: string): { labels: string[]; values: number[] } {
  const labels: string[] = []
  const values: number[] = []
  for (const row of rows) {
    const raw = Number(row.total)
    if (!Number.isFinite(raw)) continue
    const magnitude = Math.abs(raw)
    if (magnitude <= 0) continue
    labels.push(String(row[labelKey] ?? 'Unknown'))
    values.push(magnitude)
  }
  return { labels, values }
}

type ViewsResponse = {
  start_date: string
  end_date: string
  total: number
  transaction_count: number
  spending_over_time: Array<{ date: string; amount: number }>
  by_tag: Array<Record<string, any>>
  by_category: Array<Record<string, any>>
  by_subcategory: Array<Record<string, any>>
  transactions: Array<Record<string, any>>
}

type Preset = 'Custom' | 'Last 7 days' | 'Last 30 days' | 'Year to date'

export default function ViewsPage() {
  const [preset, setPreset] = useState<Preset>('Custom')
  const [startDate, setStartDate] = useState(() => '2024-01-01')
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))

  const accountsQuery = useQuery<AccountOut[], Error>({
    queryKey: queryKeys.accounts(),
    queryFn: () => getAccounts(),
  })
  const categoriesQuery = useQuery<CategoryOut[], Error>({
    queryKey: queryKeys.categories(),
    queryFn: () => getCategories(),
  })
  const tagsQuery = useQuery<TagOut[], Error>({
    queryKey: queryKeys.tags(),
    queryFn: () => apiGet<TagOut[]>('/api/tags'),
  })

  const accounts = accountsQuery.data ?? []
  const categories = categoriesQuery.data ?? []
  const tags = tagsQuery.data ?? []

  const [subcategories, setSubcategories] = useState<SubcategoryOut[]>([])

  const [accountId, setAccountId] = useState<number | null>(null)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [subcategoryId, setSubcategoryId] = useState<number | null>(null)
  // When the user explicitly selects "All subcategories", keep `subcategoryId = null`
  // and don't let the subcategory-loading effect auto-pick the first subcategory.
  const subcategoryAllExplicitRef = useRef(false)

  const subcategoriesQuery = useQuery<SubcategoryOut[], Error>({
    queryKey: queryKeys.subcategories(categoryId),
    queryFn: () => getSubcategories(categoryId!),
    enabled: categoryId != null,
  })

  useEffect(() => {
    if (!categoryId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubcategories([])
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubcategoryId(null)
      subcategoryAllExplicitRef.current = false
      return
    }
    if (!subcategoriesQuery.data) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubcategories(subcategoriesQuery.data)
    if (subcategoryAllExplicitRef.current) return

    const firstId = subcategoriesQuery.data[0]?.id ?? null
    if (subcategoryId == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubcategoryId(firstId)
      return
    }

    if (!subcategoriesQuery.data.find((s) => s.id === subcategoryId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubcategoryId(firstId)
    }
  }, [categoryId, subcategoriesQuery.data, subcategoryId])

  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [tagsMatchAny, setTagsMatchAny] = useState(false)
  const [minAmount, setMinAmount] = useState<number>(0)
  const [maxAmount, setMaxAmount] = useState<number>(0)

  const [tab, setTab] = useState<'tag' | 'category' | 'subcategory'>('tag')
  const [viewsTagSort, setViewsTagSort] = useState<ColumnSortState | null>(null)
  const [viewsCategorySort, setViewsCategorySort] = useState<ColumnSortState | null>(null)
  const [viewsSubcategorySort, setViewsSubcategorySort] = useState<ColumnSortState | null>(null)
  const [viewsTxnSort, setViewsTxnSort] = useState<ColumnSortState | null>(null)
  const plotOk = typeof Plot === 'function' || (typeof Plot === 'object' && Boolean((Plot as any)?.$$typeof))

  const viewsThStyle = { textAlign: 'left' as const, padding: 8, borderBottom: '1px solid var(--border)' }

  // Meta (accounts/categories/tags) comes from React Query.

  useEffect(() => {
    const today = new Date()
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    if (preset === 'Custom') return
    if (preset === 'Last 7 days') {
      const start = new Date(today.getTime() - 7 * 24 * 3600 * 1000)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStartDate(iso(start))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEndDate(iso(today))
    } else if (preset === 'Last 30 days') {
      const start = new Date(today.getTime() - 30 * 24 * 3600 * 1000)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStartDate(iso(start))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEndDate(iso(today))
    } else if (preset === 'Year to date') {
      const start = new Date(today.getFullYear(), 0, 1)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStartDate(iso(start))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEndDate(iso(today))
    }
  }, [preset])

  const shouldMinMaxInclude = useMemo(() => {
    const min = minAmount > 0 ? minAmount : undefined
    const max = maxAmount > 0 ? maxAmount : undefined
    return { min, max }
  }, [minAmount, maxAmount])

  const normalizedTagIds = useMemo(() => [...selectedTagIds].sort((a, b) => a - b), [selectedTagIds])
  const viewsParamsKey = JSON.stringify({
    startDate,
    endDate,
    accountId,
    categoryId,
    subcategoryId,
    tagIds: normalizedTagIds,
    tagsMatchAny,
    min: shouldMinMaxInclude.min ?? null,
    max: shouldMinMaxInclude.max ?? null,
  })

  const viewsQuery = useQuery<ViewsResponse, Error>({
    queryKey: queryKeys.views(viewsParamsKey),
    enabled: Boolean(startDate && endDate),
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('start_date', startDate)
      params.set('end_date', endDate)
      if (accountId) params.set('account_id', String(accountId))
      if (categoryId) params.set('category_id', String(categoryId))
      if (subcategoryId) params.set('subcategory_id', String(subcategoryId))

      if (normalizedTagIds.length) {
        for (const id of normalizedTagIds) params.append('tag_ids', String(id))
      }
      params.set('tags_match_any', tagsMatchAny ? 'true' : 'false')

      if (shouldMinMaxInclude.min !== undefined) params.set('min_amount', String(shouldMinMaxInclude.min))
      if (shouldMinMaxInclude.max !== undefined) params.set('max_amount', String(shouldMinMaxInclude.max))

      return apiGet<ViewsResponse>(`/api/views?${params.toString()}`)
    },
  })

  const data = viewsQuery.data ?? null
  const error = viewsQuery.error?.message ?? null
  const loading = viewsQuery.isLoading

  const sortedViewsByTag = useMemo(() => {
    if (!data?.by_tag?.length) return data?.by_tag ?? []
    return sortByColumn(data.by_tag as Record<string, unknown>[], viewsTagSort, ['total', 'count', 'percent'])
  }, [data?.by_tag, viewsTagSort])

  const sortedViewsByCategory = useMemo(() => {
    if (!data?.by_category?.length) return data?.by_category ?? []
    return sortByColumn(data.by_category as Record<string, unknown>[], viewsCategorySort, [
      'total',
      'count',
      'percent',
    ])
  }, [data?.by_category, viewsCategorySort])

  const sortedViewsBySubcategory = useMemo(() => {
    if (!data?.by_subcategory?.length) return data?.by_subcategory ?? []
    return sortByColumn(data.by_subcategory as Record<string, unknown>[], viewsSubcategorySort, [
      'total',
      'count',
      'percent',
    ])
  }, [data?.by_subcategory, viewsSubcategorySort])

  const sortedViewsTransactions = useMemo(() => {
    if (!data?.transactions?.length) return data?.transactions ?? []
    const numeric =
      viewsTxnSort && columnLooksNumeric(data.transactions as Record<string, unknown>[], viewsTxnSort.key)
        ? [viewsTxnSort.key]
        : []
    return sortByColumn(data.transactions as Record<string, unknown>[], viewsTxnSort, numeric)
  }, [data?.transactions, viewsTxnSort])

  const tagPieData = useMemo(() => buildPieData(data?.by_tag ?? [], 'tag'), [data?.by_tag])
  const categoryPieData = useMemo(() => buildPieData(data?.by_category ?? [], 'category'), [data?.by_category])
  const subcategoryPieData = useMemo(
    () => buildPieData(data?.by_subcategory ?? [], 'subcategory'),
    [data?.by_subcategory]
  )

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <p className="text-muted-foreground mb-0">Mix and match filters to explore your spending from any angle.</p>
      </motion.div>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}
      {!data && loading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}

      <Card className="shadow-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Filters</CardTitle>
          <CardDescription>Set the reporting window, then narrow by account, category, tags, or amount.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground tracking-tight">Date range</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="views-preset">Quick range</Label>
                <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
                  <SelectTrigger id="views-preset" className="w-full">
                    <SelectValue placeholder="Preset" />
                  </SelectTrigger>
                  <SelectContent>
                    {(['Custom', 'Last 7 days', 'Last 30 days', 'Year to date'] as Preset[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="views-start">Start date</Label>
                <Input
                  id="views-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setPreset('Custom')
                    setStartDate(e.target.value)
                  }}
                />
              </div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="views-end">End date</Label>
                <Input
                  id="views-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setPreset('Custom')
                    setEndDate(e.target.value)
                  }}
                />
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground tracking-tight">Classification</h2>
            <p className="text-xs text-muted-foreground -mt-1">
              Optional. Choose All accounts / categories / subcategories to avoid narrowing by classification.
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="views-account">Account</Label>
                <Select
                  value={accountId != null ? String(accountId) : '__all__'}
                  onValueChange={(v) => setAccountId(v === '__all__' ? null : Number(v))}
                >
                  <SelectTrigger id="views-account">
                    <SelectValue placeholder="All accounts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All accounts</SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="views-category">Category</Label>
                <Select
                  value={categoryId != null ? String(categoryId) : '__all__'}
                  onValueChange={(v) => setCategoryId(v === '__all__' ? null : Number(v))}
                >
                  <SelectTrigger id="views-category">
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All categories</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="views-subcategory" className={!categoryId ? 'text-muted-foreground' : undefined}>
                  Subcategory
                </Label>
                <Select
                  value={subcategoryId != null ? String(subcategoryId) : '__all__'}
                  onValueChange={(v) => {
                    const next = v === '__all__' ? null : Number(v)
                    subcategoryAllExplicitRef.current = next === null
                    setSubcategoryId(next)
                  }}
                  disabled={!categoryId}
                >
                  <SelectTrigger id="views-subcategory">
                    <SelectValue placeholder={categoryId ? 'All subcategories' : 'Pick a category first'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All subcategories</SelectItem>
                    {subcategories.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground tracking-tight">Tags</h2>
            <div className="rounded-lg border border-input bg-muted/30 p-3 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="views-tags">Select tags</Label>
                <select
                  id="views-tags"
                  multiple
                  value={selectedTagIds.map(String)}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions).map((o) => Number(o.value))
                    setSelectedTagIds(selected)
                  }}
                  className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">Hold Ctrl (Windows) or ⌘ (Mac) to select multiple.</p>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="views-tags-or"
                  checked={tagsMatchAny}
                  onCheckedChange={(c) => setTagsMatchAny(c === true)}
                />
                <Label htmlFor="views-tags-or" className="text-sm font-normal leading-snug cursor-pointer">
                  Match any selected tag (OR). When off, transactions must include all selected tags (AND).
                </Label>
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground tracking-tight">Amount</h2>
            <p className="text-xs text-muted-foreground -mt-1">
              Leave at 0 or empty for no bound; only positive values filter by amount.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 max-w-xl">
              <div className="space-y-2">
                <Label htmlFor="views-min-amt">Min amount</Label>
                <Input
                  id="views-min-amt"
                  type="number"
                  step="0.01"
                  min={0}
                  value={minAmount || ''}
                  onChange={(e) => setMinAmount(e.target.value === '' ? 0 : Number(e.target.value))}
                  placeholder="No minimum"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="views-max-amt">Max amount</Label>
                <Input
                  id="views-max-amt"
                  type="number"
                  step="0.01"
                  min={0}
                  value={maxAmount || ''}
                  onChange={(e) => setMaxAmount(e.target.value === '' ? 0 : Number(e.target.value))}
                  placeholder="No maximum"
                />
              </div>
            </div>
          </section>
        </CardContent>
      </Card>

      {data ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 16 }}>
            <div className="rounded-xl border bg-card shadow-card p-4">
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Total</div>
              <div style={{ fontSize: 26 }}>${data.total.toFixed(2)}</div>
              <div style={{ opacity: 0.7, marginTop: 8, fontSize: 13 }}>
                Across {data.transaction_count} matching transactions from {data.start_date} to {data.end_date}.
              </div>
            </div>

            <div className="rounded-xl border bg-card shadow-card p-4">
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Spending over time</div>
              {plotOk ? (
                <Plot
                  data={[
                    {
                      x: data.spending_over_time.map((r) => r.date),
                      y: data.spending_over_time.map((r) => r.amount),
                      type: 'bar',
                      marker: { color: 'rgba(170, 59, 255, 0.8)' },
                    },
                  ]}
                  layout={{
                    height: 280,
                    margin: { t: 20, b: 40, l: 40, r: 20 },
                    title: 'Daily spending',
                    xaxis: { tickformat: '%b %d' },
                  }}
                  config={{ displayModeBar: false, responsive: true }}
                />
              ) : (
                <div style={{ padding: 8, opacity: 0.75 }}>Plotly unavailable</div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="flex flex-wrap gap-2 mb-3">
              <Button variant={tab === 'tag' ? 'default' : 'outline'} size="sm" onClick={() => setTab('tag')}>
                By tag
              </Button>
              <Button variant={tab === 'category' ? 'default' : 'outline'} size="sm" onClick={() => setTab('category')}>
                By category
              </Button>
              <Button variant={tab === 'subcategory' ? 'default' : 'outline'} size="sm" onClick={() => setTab('subcategory')}>
                By subcategory
              </Button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {tab === 'tag' ? (
                <>
                  <div className="rounded-xl border bg-card shadow-card p-4">
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>By Tag</div>
                    <div style={{ overflow: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <SortableHtmlTh
                              label="tag"
                              columnKey="tag"
                              sort={viewsTagSort}
                              onSort={(k) => setViewsTagSort((p) => cycleSort(p, k))}
                              style={viewsThStyle}
                            />
                            <SortableHtmlTh
                              label="total"
                              columnKey="total"
                              sort={viewsTagSort}
                              onSort={(k) => setViewsTagSort((p) => cycleSort(p, k))}
                              style={viewsThStyle}
                            />
                            <SortableHtmlTh
                              label="count"
                              columnKey="count"
                              sort={viewsTagSort}
                              onSort={(k) => setViewsTagSort((p) => cycleSort(p, k))}
                              style={viewsThStyle}
                            />
                            <SortableHtmlTh
                              label="percent"
                              columnKey="percent"
                              sort={viewsTagSort}
                              onSort={(k) => setViewsTagSort((p) => cycleSort(p, k))}
                              style={viewsThStyle}
                            />
                          </tr>
                        </thead>
                        <tbody>
                          {data.by_tag.length === 0 ? (
                            <tr>
                              <td colSpan={4} style={{ padding: 8, opacity: 0.7 }}>
                                No tags assigned.
                              </td>
                            </tr>
                          ) : (
                            sortedViewsByTag.map((r, idx) => (
                              <tr key={idx}>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.tag}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>${Number(r.total).toFixed(2)}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.count}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{Number(r.percent).toFixed(2)}%</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="rounded-xl border bg-card shadow-card p-4">
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>Spend by Tag</div>
                    {tagPieData.values.length ? (
                      <Pie
                        plotOk={plotOk}
                        labels={tagPieData.labels}
                        values={tagPieData.values}
                        title="Spend by Tag"
                      />
                    ) : (
                      <div style={{ opacity: 0.7 }}>No data.</div>
                    )}
                  </div>
                </>
              ) : null}

              {tab === 'category' ? (
                <>
                  <div className="rounded-xl border bg-card shadow-card p-4">
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>By Category</div>
                    <div style={{ overflow: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <SortableHtmlTh
                              label="category"
                              columnKey="category"
                              sort={viewsCategorySort}
                              onSort={(k) => setViewsCategorySort((p) => cycleSort(p, k))}
                              style={viewsThStyle}
                            />
                            <SortableHtmlTh
                              label="total"
                              columnKey="total"
                              sort={viewsCategorySort}
                              onSort={(k) => setViewsCategorySort((p) => cycleSort(p, k))}
                              style={viewsThStyle}
                            />
                            <SortableHtmlTh
                              label="count"
                              columnKey="count"
                              sort={viewsCategorySort}
                              onSort={(k) => setViewsCategorySort((p) => cycleSort(p, k))}
                              style={viewsThStyle}
                            />
                            <SortableHtmlTh
                              label="percent"
                              columnKey="percent"
                              sort={viewsCategorySort}
                              onSort={(k) => setViewsCategorySort((p) => cycleSort(p, k))}
                              style={viewsThStyle}
                            />
                          </tr>
                        </thead>
                        <tbody>
                          {data.by_category.length === 0 ? (
                            <tr>
                              <td colSpan={4} style={{ padding: 8, opacity: 0.7 }}>
                                No categories.
                              </td>
                            </tr>
                          ) : (
                            sortedViewsByCategory.map((r, idx) => (
                              <tr key={idx}>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.category}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>${Number(r.total).toFixed(2)}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.count}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{Number(r.percent).toFixed(2)}%</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="rounded-xl border bg-card shadow-card p-4">
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>Spend by Category</div>
                    {categoryPieData.values.length ? (
                      <Pie
                        plotOk={plotOk}
                        labels={categoryPieData.labels}
                        values={categoryPieData.values}
                        title="Spend by Category"
                      />
                    ) : (
                      <div style={{ opacity: 0.7 }}>No data.</div>
                    )}
                  </div>
                </>
              ) : null}

              {tab === 'subcategory' ? (
                <>
                  <div className="rounded-xl border bg-card shadow-card p-4">
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>By Subcategory</div>
                    <div style={{ overflow: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <SortableHtmlTh
                              label="category"
                              columnKey="category"
                              sort={viewsSubcategorySort}
                              onSort={(k) => setViewsSubcategorySort((p) => cycleSort(p, k))}
                              style={viewsThStyle}
                            />
                            <SortableHtmlTh
                              label="subcategory"
                              columnKey="subcategory"
                              sort={viewsSubcategorySort}
                              onSort={(k) => setViewsSubcategorySort((p) => cycleSort(p, k))}
                              style={viewsThStyle}
                            />
                            <SortableHtmlTh
                              label="total"
                              columnKey="total"
                              sort={viewsSubcategorySort}
                              onSort={(k) => setViewsSubcategorySort((p) => cycleSort(p, k))}
                              style={viewsThStyle}
                            />
                            <SortableHtmlTh
                              label="count"
                              columnKey="count"
                              sort={viewsSubcategorySort}
                              onSort={(k) => setViewsSubcategorySort((p) => cycleSort(p, k))}
                              style={viewsThStyle}
                            />
                            <SortableHtmlTh
                              label="percent"
                              columnKey="percent"
                              sort={viewsSubcategorySort}
                              onSort={(k) => setViewsSubcategorySort((p) => cycleSort(p, k))}
                              style={viewsThStyle}
                            />
                          </tr>
                        </thead>
                        <tbody>
                          {data.by_subcategory.length === 0 ? (
                            <tr>
                              <td colSpan={5} style={{ padding: 8, opacity: 0.7 }}>
                                No subcategories.
                              </td>
                            </tr>
                          ) : (
                            sortedViewsBySubcategory.map((r, idx) => (
                              <tr key={idx}>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.category}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.subcategory}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>${Number(r.total).toFixed(2)}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.count}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{Number(r.percent).toFixed(2)}%</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="rounded-xl border bg-card shadow-card p-4">
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>Spend by Subcategory</div>
                    {subcategoryPieData.values.length ? (
                      <Pie
                        plotOk={plotOk}
                        labels={subcategoryPieData.labels}
                        values={subcategoryPieData.values}
                        title="Spend by Subcategory"
                      />
                    ) : (
                      <div style={{ opacity: 0.7 }}>No data.</div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Transactions</div>
            <div className="rounded-xl border bg-card shadow-card p-4 overflow-auto">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <SortableHtmlTh
                      label="Date"
                      columnKey="Date"
                      sort={viewsTxnSort}
                      onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                      style={viewsThStyle}
                    />
                    <SortableHtmlTh
                      label="Merchant"
                      columnKey="Merchant"
                      sort={viewsTxnSort}
                      onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                      style={viewsThStyle}
                    />
                    <SortableHtmlTh
                      label="Amount"
                      columnKey="Amount"
                      sort={viewsTxnSort}
                      onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                      style={{ ...viewsThStyle, textAlign: 'right' }}
                      align="right"
                    />
                    <SortableHtmlTh
                      label="Category"
                      columnKey="Category"
                      sort={viewsTxnSort}
                      onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                      style={viewsThStyle}
                    />
                    <SortableHtmlTh
                      label="Subcategory"
                      columnKey="Subcategory"
                      sort={viewsTxnSort}
                      onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                      style={viewsThStyle}
                    />
                    <SortableHtmlTh
                      label="Tags"
                      columnKey="Tags"
                      sort={viewsTxnSort}
                      onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                      style={viewsThStyle}
                    />
                    <SortableHtmlTh
                      label="Notes"
                      columnKey="Notes"
                      sort={viewsTxnSort}
                      onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                      style={viewsThStyle}
                    />
                    <SortableHtmlTh
                      label="Acct"
                      columnKey="Acct"
                      sort={viewsTxnSort}
                      onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                      style={viewsThStyle}
                    />
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 8, opacity: 0.7 }}>
                        No transactions found.
                      </td>
                    </tr>
                  ) : (
                    sortedViewsTransactions.map((r: Record<string, unknown>, idx: number) => (
                      <tr key={idx}>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{String(r.Date ?? '')}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{String(r.Merchant ?? '')}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                          ${Number(r.Amount).toFixed(2)}
                        </td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{String(r.Category ?? '')}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{String(r.Subcategory ?? '')}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{String(r.Tags ?? '')}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{String(r.Notes ?? '')}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{String(r.Acct ?? '')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

