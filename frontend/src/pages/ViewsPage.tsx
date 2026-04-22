import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChevronDown, ChevronRight, Info, Receipt, Tag, Trash2, X } from 'lucide-react'
import { apiGet } from '../api/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { SortableTableHead } from '@/components/sortable-table-head'
import { columnLooksNumeric, cycleSort, sortByColumn, type ColumnSortState } from '@/lib/tableSort'
import { cn } from '@/lib/utils'
import {
  breakdownMotionContainer as container,
  breakdownMotionItem as item,
  formatMoney,
  rawSlicesFromRows,
  SpendPieCard,
  type BreakdownRow,
} from '@/components/reports/SpendBreakdownCharts'
import { queryKeys } from '../queryKeys'
import { getAccounts } from '../api/accounts'
import { getCategories, getSubcategories } from '../api/categories'
import type { AccountOut, CategoryOut, SubcategoryOut, TagOut } from '../types'

const VIEWS_SAVED_STORAGE_KEY = 'keep-views-saved-v1'

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

function rangeLast30Days() {
  const today = new Date()
  return {
    start: isoDate(new Date(today.getTime() - 30 * 24 * 3600 * 1000)),
    end: isoDate(today),
  }
}

function fmtShortDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

type ViewsResponse = {
  start_date: string
  end_date: string
  total: number
  transaction_count: number
  spending_over_time: Array<{ date: string; amount: number }>
  by_tag: BreakdownRow[]
  by_category: BreakdownRow[]
  by_subcategory: BreakdownRow[]
  transactions: TxnRow[]
}

type TxnRow = {
  id?: number
  Date: string
  Merchant: string
  Amount: number
  Category: string
  Subcategory: string
  Tags: string
  Notes: string
  Acct: string
  is_transfer?: boolean
}

type Preset = 'Custom' | 'Last 7 days' | 'Last 30 days' | 'Year to date'

type PersistedViewState = {
  preset: Preset
  startDate: string
  endDate: string
  accountId: number | null
  categoryId: number | null
  subcategoryIds: number[]
  selectedTagIds: number[]
  tagsMatchAny: boolean
  minAmount: number
  maxAmount: number
}

type SavedNamedView = { id: string; name: string; state: PersistedViewState }

function loadSavedViews(): SavedNamedView[] {
  try {
    const raw = localStorage.getItem(VIEWS_SAVED_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is SavedNamedView =>
        x != null &&
        typeof x === 'object' &&
        typeof (x as SavedNamedView).id === 'string' &&
        typeof (x as SavedNamedView).name === 'string' &&
        (x as SavedNamedView).state != null,
    )
  } catch {
    return []
  }
}

function persistSavedViews(views: SavedNamedView[]) {
  localStorage.setItem(VIEWS_SAVED_STORAGE_KEY, JSON.stringify(views))
}

export default function ViewsPage() {
  const initialRange = useMemo(() => rangeLast30Days(), [])
  const [preset, setPreset] = useState<Preset>('Last 30 days')
  const [startDate, setStartDate] = useState(initialRange.start)
  const [endDate, setEndDate] = useState(initialRange.end)
  const [filtersOpen, setFiltersOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  )

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
  const [selectedSubcategoryIds, setSelectedSubcategoryIds] = useState<number[]>([])

  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [tagsMatchAny, setTagsMatchAny] = useState(false)
  const [minAmount, setMinAmount] = useState(0)
  const [maxAmount, setMaxAmount] = useState(0)
  const [tagSearch, setTagSearch] = useState('')

  const [breakdownTab, setBreakdownTab] = useState<'tag' | 'category' | 'subcategory'>('tag')
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)

  const [viewsTagSort, setViewsTagSort] = useState<ColumnSortState | null>(null)
  const [viewsCategorySort, setViewsCategorySort] = useState<ColumnSortState | null>(null)
  const [viewsSubcategorySort, setViewsSubcategorySort] = useState<ColumnSortState | null>(null)
  const [viewsTxnSort, setViewsTxnSort] = useState<ColumnSortState | null>(null)

  const [savedViews, setSavedViews] = useState<SavedNamedView[]>(() => loadSavedViews())
  const [saveName, setSaveName] = useState('')

  const subcategoriesQuery = useQuery<SubcategoryOut[], Error>({
    queryKey: queryKeys.subcategories(categoryId),
    queryFn: () => getSubcategories(categoryId!),
    enabled: categoryId != null,
  })

  useEffect(() => {
    if (!categoryId) {
      setSubcategories([])
      setSelectedSubcategoryIds([])
      return
    }
    if (!subcategoriesQuery.data) return
    setSubcategories(subcategoriesQuery.data)
    setSelectedSubcategoryIds((prev) =>
      prev.filter((id) => subcategoriesQuery.data.some((subcategory) => subcategory.id === id)),
    )
  }, [categoryId, subcategoriesQuery.data])

  useEffect(() => {
    setSelectedCategoryId(null)
  }, [
    startDate,
    endDate,
    accountId,
    categoryId,
    selectedSubcategoryIds,
    selectedTagIds,
    tagsMatchAny,
    minAmount,
    maxAmount,
  ])

  const shouldMinMaxInclude = useMemo(() => {
    const min = minAmount > 0 ? minAmount : undefined
    const max = maxAmount > 0 ? maxAmount : undefined
    return { min, max }
  }, [minAmount, maxAmount])

  const normalizedSubcategoryIds = useMemo(
    () => [...selectedSubcategoryIds].sort((a, b) => a - b),
    [selectedSubcategoryIds],
  )
  const normalizedTagIds = useMemo(() => [...selectedTagIds].sort((a, b) => a - b), [selectedTagIds])
  const viewsParamsKey = JSON.stringify({
    startDate,
    endDate,
    accountId,
    categoryId,
    subcategoryIds: normalizedSubcategoryIds,
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
      if (normalizedSubcategoryIds.length) {
        for (const id of normalizedSubcategoryIds) params.append('subcategory_ids', String(id))
      }

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
  const isFetching = viewsQuery.isFetching

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

  const subcategoryRowsFiltered = useMemo(() => {
    const rows = data?.by_subcategory ?? []
    if (selectedCategoryId == null) return rows
    return rows.filter((r) => r.category_id === selectedCategoryId)
  }, [data?.by_subcategory, selectedCategoryId])

  const sortedViewsBySubcategory = useMemo(() => {
    if (!subcategoryRowsFiltered.length) return subcategoryRowsFiltered
    return sortByColumn(subcategoryRowsFiltered as Record<string, unknown>[], viewsSubcategorySort, [
      'total',
      'count',
      'percent',
    ])
  }, [subcategoryRowsFiltered, viewsSubcategorySort])

  const sortedViewsTransactions = useMemo(() => {
    if (!data?.transactions?.length) return data?.transactions ?? []
    const numeric =
      viewsTxnSort && columnLooksNumeric(data.transactions as Record<string, unknown>[], viewsTxnSort.key)
        ? [viewsTxnSort.key]
        : []
    return sortByColumn(data.transactions as Record<string, unknown>[], viewsTxnSort, numeric)
  }, [data?.transactions, viewsTxnSort])

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
    setBreakdownTab('subcategory')
  }, [])

  const barData = useMemo(() => {
    if (!data?.spending_over_time?.length) return []
    return data.spending_over_time.map((r) => ({
      label: fmtShortDate(r.date.slice(0, 10)),
      amount: Number(r.amount),
      iso: r.date.slice(0, 10),
    }))
  }, [data?.spending_over_time])

  const avgAbsFromTxns = useMemo(() => {
    if (!data?.transactions?.length) return 0
    const sum = data.transactions.reduce((acc, r) => acc + Math.abs(Number(r.Amount)), 0)
    return sum / data.transactions.length
  }, [data?.transactions])

  const activeFilterCount = useMemo(() => {
    let n = 0
    if (accountId != null) n++
    if (categoryId != null) n++
    if (selectedSubcategoryIds.length) n += selectedSubcategoryIds.length
    if (selectedTagIds.length) n += selectedTagIds.length
    if (tagsMatchAny && selectedTagIds.length > 1) n++
    if (shouldMinMaxInclude.min !== undefined) n++
    if (shouldMinMaxInclude.max !== undefined) n++
    return n
  }, [
    accountId,
    categoryId,
    selectedSubcategoryIds.length,
    selectedTagIds.length,
    tagsMatchAny,
    shouldMinMaxInclude.min,
    shouldMinMaxInclude.max,
  ])

  const filterSummaryLine = `${startDate} → ${endDate}${activeFilterCount ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'}` : ''}`

  const resetToDefaults = useCallback(() => {
    const r = rangeLast30Days()
    setPreset('Last 30 days')
    setStartDate(r.start)
    setEndDate(r.end)
    setAccountId(null)
    setCategoryId(null)
    setSelectedSubcategoryIds([])
    setSelectedTagIds([])
    setTagsMatchAny(false)
    setMinAmount(0)
    setMaxAmount(0)
    setTagSearch('')
  }, [])

  const captureState = useCallback((): PersistedViewState => {
    return {
      preset,
      startDate,
      endDate,
      accountId,
      categoryId,
      subcategoryIds: [...selectedSubcategoryIds],
      selectedTagIds: [...selectedTagIds],
      tagsMatchAny,
      minAmount,
      maxAmount,
    }
  }, [
    preset,
    startDate,
    endDate,
    accountId,
    categoryId,
    selectedSubcategoryIds,
    selectedTagIds,
    tagsMatchAny,
    minAmount,
    maxAmount,
  ])

  const applyState = useCallback((s: PersistedViewState & { subcategoryId?: number | null }) => {
    setPreset(s.preset)
    setStartDate(s.startDate)
    setEndDate(s.endDate)
    setAccountId(s.accountId)
    setCategoryId(s.categoryId)
    if (Array.isArray(s.subcategoryIds)) {
      setSelectedSubcategoryIds([...s.subcategoryIds])
    } else if (s.subcategoryId != null) {
      // Backward compatibility for old saved views with single subcategory.
      setSelectedSubcategoryIds([s.subcategoryId])
    } else {
      setSelectedSubcategoryIds([])
    }
    setSelectedTagIds([...s.selectedTagIds])
    setTagsMatchAny(s.tagsMatchAny)
    setMinAmount(s.minAmount)
    setMaxAmount(s.maxAmount)
  }, [])

  const handleSaveView = () => {
    const name = saveName.trim()
    if (!name) return
    const next: SavedNamedView = {
      id: crypto.randomUUID(),
      name,
      state: captureState(),
    }
    const merged = [...savedViews, next]
    setSavedViews(merged)
    persistSavedViews(merged)
    setSaveName('')
  }

  const handleDeleteSaved = (id: string) => {
    const merged = savedViews.filter((v) => v.id !== id)
    setSavedViews(merged)
    persistSavedViews(merged)
  }

  const filteredTagsForList = useMemo(() => {
    const q = tagSearch.trim().toLowerCase()
    if (!q) return tags
    return tags.filter((t) => t.name.toLowerCase().includes(q))
  }, [tags, tagSearch])

  const toggleTag = (id: number) => {
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  useEffect(() => {
    const today = new Date()
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    if (preset === 'Custom') return
    if (preset === 'Last 7 days') {
      const start = new Date(today.getTime() - 7 * 24 * 3600 * 1000)
      setStartDate(iso(start))
      setEndDate(iso(today))
    } else if (preset === 'Last 30 days') {
      const start = new Date(today.getTime() - 30 * 24 * 3600 * 1000)
      setStartDate(iso(start))
      setEndDate(iso(today))
    } else if (preset === 'Year to date') {
      const start = new Date(today.getFullYear(), 0, 1)
      setStartDate(iso(start))
      setEndDate(iso(today))
    }
  }, [preset])

  const hasNoData = data != null && data.transaction_count === 0
  const awaitingData = !data && !viewsQuery.error && (loading || isFetching)
  const loadFailed = Boolean(viewsQuery.error) && !data

  const accountName = accountId != null ? accounts.find((a) => a.id === accountId)?.name : null
  const categoryName = categoryId != null ? categories.find((c) => c.id === categoryId)?.name : null
  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <p className="text-muted-foreground text-sm mb-1">
          Build a custom slice of your data with date range, accounts, categories, tags, and amounts. Transfers are
          excluded from totals and charts.
        </p>
      </motion.div>

      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
        <Card className="shadow-card">
          <CardHeader className="pb-2 space-y-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="h-auto p-0 hover:bg-transparent gap-2 text-left font-semibold">
                    {filtersOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 opacity-70" />
                    )}
                    <span>Filters</span>
                  </Button>
                </CollapsibleTrigger>
                <CardDescription className="mt-1.5 pl-6 text-xs">
                  {filtersOpen ? 'Set the window, then narrow by classification, tags, or amount.' : filterSummaryLine}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button type="button" variant="outline" size="sm" onClick={resetToDefaults}>
                  Reset filters
                </Button>
              </div>
            </div>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-8 pt-2">
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-foreground tracking-tight">Saved views</h2>
                <p className="text-xs text-muted-foreground">
                  Save the current filter set with a name, then load it anytime (stored in this browser).
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1.5 flex-1 min-w-[160px] max-w-xs">
                    <Label htmlFor="views-save-name" className="text-xs text-muted-foreground">
                      Name
                    </Label>
                    <Input
                      id="views-save-name"
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                      placeholder="e.g. Dining out — last quarter"
                      className="bg-background"
                    />
                  </div>
                  <Button type="button" size="sm" onClick={handleSaveView} disabled={!saveName.trim()}>
                    Save current
                  </Button>
                </div>
                {savedViews.length > 0 ? (
                  <ul className="flex flex-wrap gap-2 pt-1">
                    {savedViews.map((v) => (
                      <li key={v.id} className="flex items-center gap-1">
                        <Button type="button" variant="secondary" size="sm" onClick={() => applyState(v.state)}>
                          {v.name}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          aria-label={`Delete saved view ${v.name}`}
                          onClick={() => handleDeleteSaved(v.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>

              <Separator />

              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-foreground tracking-tight">Date range</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="views-preset">Quick range</Label>
                    <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
                      <SelectTrigger id="views-preset" className="w-full bg-background">
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
                      className="bg-background"
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
                      className="bg-background"
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
                  Optional. Use “All” to skip narrowing by account or category.
                </p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="views-account">Account</Label>
                    <Select
                      value={accountId != null ? String(accountId) : '__all__'}
                      onValueChange={(v) => setAccountId(v === '__all__' ? null : Number(v))}
                    >
                      <SelectTrigger id="views-account" className="bg-background">
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
                      <SelectTrigger id="views-category" className="bg-background">
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
                    <Label className={!categoryId ? 'text-muted-foreground' : undefined}>
                      Subcategory
                    </Label>
                    <div className="rounded-md border border-border bg-background p-2 space-y-2">
                      {!categoryId ? (
                        <p className="text-xs text-muted-foreground px-2 py-2">Choose a category</p>
                      ) : subcategories.length === 0 ? (
                        <p className="text-xs text-muted-foreground px-2 py-2">No subcategories available</p>
                      ) : (
                        <>
                          <div className="flex items-center justify-between px-1">
                            <p className="text-xs text-muted-foreground">
                              {selectedSubcategoryIds.length === 0
                                ? 'All subcategories'
                                : `${selectedSubcategoryIds.length} selected`}
                            </p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setSelectedSubcategoryIds([])}
                              disabled={selectedSubcategoryIds.length === 0}
                            >
                              Clear
                            </Button>
                          </div>
                          <div className="max-h-[150px] overflow-y-auto space-y-1 pr-1">
                            {subcategories.map((s) => (
                              <label
                                key={s.id}
                                className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-muted/60 cursor-pointer"
                              >
                                <Checkbox
                                  checked={selectedSubcategoryIds.includes(s.id)}
                                  onCheckedChange={() =>
                                    setSelectedSubcategoryIds((prev) =>
                                      prev.includes(s.id) ? prev.filter((id) => id !== s.id) : [...prev, s.id],
                                    )
                                  }
                                />
                                <span className="text-sm">{s.name}</span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <Separator />

              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-foreground tracking-tight">Tags</h2>
                <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="views-tag-search">Find tags</Label>
                    <Input
                      id="views-tag-search"
                      className="bg-background max-w-md"
                      placeholder="Search…"
                      value={tagSearch}
                      onChange={(e) => setTagSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-[200px] overflow-y-auto rounded-md border border-border bg-background p-2 space-y-1">
                    {filteredTagsForList.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-2 py-3">No tags match.</p>
                    ) : (
                      filteredTagsForList.map((t) => (
                        <label
                          key={t.id}
                          className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-muted/60 cursor-pointer"
                        >
                          <Checkbox
                            checked={selectedTagIds.includes(t.id)}
                            onCheckedChange={() => toggleTag(t.id)}
                          />
                          <span className="text-sm">{t.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="views-tags-or"
                      checked={tagsMatchAny}
                      onCheckedChange={(c) => setTagsMatchAny(c === true)}
                    />
                    <Label htmlFor="views-tags-or" className="text-sm font-normal leading-snug cursor-pointer">
                      Match any selected tag (OR). Off = must have all selected tags (AND).
                    </Label>
                  </div>
                </div>
              </section>

              <Separator />

              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-foreground tracking-tight">Amount</h2>
                <p className="text-xs text-muted-foreground -mt-1">
                  Leave at 0 for no bound; only positive values apply a filter.
                </p>
                <div className="grid gap-4 sm:grid-cols-2 max-w-xl">
                  <div className="space-y-2">
                    <Label htmlFor="views-min-amt">Min amount</Label>
                    <Input
                      id="views-min-amt"
                      type="number"
                      step="0.01"
                      min={0}
                      className="bg-background"
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
                      className="bg-background"
                      value={maxAmount || ''}
                      onChange={(e) => setMaxAmount(e.target.value === '' ? 0 : Number(e.target.value))}
                      placeholder="No maximum"
                    />
                  </div>
                </div>
              </section>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}
      {!data && loading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}

      {data ? (
        <>
          <div className="flex flex-wrap items-center gap-2 min-h-[28px]">
            <span className="text-xs text-muted-foreground mr-1">Active filters</span>
            {accountName ? (
              <Badge variant="secondary" className="gap-1 font-normal">
                Account: {accountName}
                <button
                  type="button"
                  className="rounded-sm hover:bg-muted p-0.5"
                  aria-label="Clear account"
                  onClick={() => setAccountId(null)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ) : null}
            {categoryName ? (
              <Badge variant="secondary" className="gap-1 font-normal">
                Category: {categoryName}
                <button
                  type="button"
                  className="rounded-sm hover:bg-muted p-0.5"
                  aria-label="Clear category"
                  onClick={() => {
                    setCategoryId(null)
                    setSelectedSubcategoryIds([])
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ) : null}
            {selectedSubcategoryIds.map((subcatId) => {
              const subcatName = subcategories.find((s) => s.id === subcatId)?.name ?? `#${subcatId}`
              return (
                <Badge key={subcatId} variant="secondary" className="gap-1 font-normal">
                  Subcategory: {subcatName}
                  <button
                    type="button"
                    className="rounded-sm hover:bg-muted p-0.5"
                    aria-label={`Remove subcategory ${subcatName}`}
                    onClick={() =>
                      setSelectedSubcategoryIds((prev) => prev.filter((id) => id !== subcatId))
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )
            })}
            {selectedTagIds.map((tid) => {
              const tname = tags.find((t) => t.id === tid)?.name ?? `#${tid}`
              return (
                <Badge key={tid} variant="secondary" className="gap-1 font-normal">
                  <Tag className="h-3 w-3 opacity-70" />
                  {tname}
                  <button
                    type="button"
                    className="rounded-sm hover:bg-muted p-0.5"
                    aria-label={`Remove tag ${tname}`}
                    onClick={() => setSelectedTagIds((prev) => prev.filter((x) => x !== tid))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )
            })}
            {tagsMatchAny && selectedTagIds.length > 1 ? (
              <Badge variant="outline" className="font-normal">
                Tags: match any
                <button
                  type="button"
                  className="ml-1 rounded-sm hover:bg-muted p-0.5"
                  aria-label="Use match all for tags"
                  onClick={() => setTagsMatchAny(false)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ) : null}
            {shouldMinMaxInclude.min !== undefined ? (
              <Badge variant="secondary" className="gap-1 font-normal">
                Min ${shouldMinMaxInclude.min.toFixed(2)}
                <button
                  type="button"
                  className="rounded-sm hover:bg-muted p-0.5"
                  onClick={() => setMinAmount(0)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ) : null}
            {shouldMinMaxInclude.max !== undefined ? (
              <Badge variant="secondary" className="gap-1 font-normal">
                Max ${shouldMinMaxInclude.max.toFixed(2)}
                <button
                  type="button"
                  className="rounded-sm hover:bg-muted p-0.5"
                  onClick={() => setMaxAmount(0)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ) : null}
            {activeFilterCount === 0 ? (
              <span className="text-xs text-muted-foreground">None beyond date range</span>
            ) : null}
            {isFetching ? <span className="text-xs text-muted-foreground">Updating…</span> : null}
          </div>

          {!loadFailed && hasNoData && !awaitingData ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              No transactions match these filters. Try widening the date range or removing filters.
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <motion.div variants={item} className="rounded-xl border bg-card p-5 shadow-card">
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="brand-icon-well h-8 w-8 !rounded-lg">
                      <Receipt className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">Net total</p>
                      <Tooltip>
                        <TooltipTrigger type="button" className="shrink-0">
                          <Info className="h-3 w-3 text-muted-foreground/50" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          Signed sum of all matching non-transfer amounts (inflows positive, outflows negative). Not the
                          same as “spending only” on Reports.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  {awaitingData ? (
                    <div className="text-2xl font-mono text-muted-foreground">—</div>
                  ) : (
                    <p
                      className={cn(
                        'text-2xl font-bold tabular-nums font-mono',
                        Number(data.total) < 0 ? 'text-income' : 'text-foreground',
                      )}
                    >
                      {formatMoney(Number(data.total))}
                    </p>
                  )}
                </motion.div>

                <motion.div variants={item} className="rounded-xl border bg-card p-5 shadow-card">
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 shadow-sm">
                      <Tag className="h-4 w-4 text-primary" />
                    </div>
                    <p className="text-xs font-medium text-muted-foreground">Transactions</p>
                  </div>
                  {awaitingData ? (
                    <div className="text-2xl font-mono text-muted-foreground">—</div>
                  ) : (
                    <p className="text-2xl font-bold tabular-nums font-mono text-foreground">{data.transaction_count}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {data.start_date} → {data.end_date}
                  </p>
                </motion.div>

                <motion.div variants={item} className="rounded-xl border bg-card p-5 shadow-card">
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted ring-1 ring-border shadow-sm">
                      <Receipt className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-medium text-muted-foreground">Avg |amount|</p>
                      <Tooltip>
                        <TooltipTrigger type="button">
                          <Info className="h-3 w-3 text-muted-foreground/50" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          Mean of absolute transaction amounts in the result set (client-side from loaded rows).
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  {awaitingData ? (
                    <div className="text-2xl font-mono text-muted-foreground">—</div>
                  ) : data.transaction_count === 0 ? (
                    <p className="text-2xl font-bold tabular-nums font-mono text-muted-foreground">—</p>
                  ) : (
                    <p className="text-2xl font-bold tabular-nums font-mono text-foreground">
                      {formatMoney(avgAbsFromTxns)}
                    </p>
                  )}
                </motion.div>
              </div>

              <motion.div variants={item} className="rounded-xl border bg-card p-6 shadow-card">
                <h2 className="text-sm font-semibold mb-1">Daily activity in view</h2>
                <p className="text-xs text-muted-foreground mb-4">
                  Net non-rent spending by day for charting (same logic as the previous views chart). Bars show signed
                  daily totals in your filter window.
                </p>
                {awaitingData ? (
                  <p className="text-sm text-muted-foreground py-12 text-center">Loading chart…</p>
                ) : hasNoData ? (
                  <p className="text-sm text-muted-foreground py-12 text-center">No data for this view.</p>
                ) : barData.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-12 text-center">No daily series for this range.</p>
                ) : (
                  <div className="h-[min(38vh,320px)] min-h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="label"
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
                          width={56}
                          tickFormatter={(v) => {
                            const n = Number(v)
                            const s = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
                            if (n < 0) return `−$${s}`
                            if (n > 0) return `$${s}`
                            return '$0'
                          }}
                        />
                        <RechartsTooltip
                          formatter={(value: number) => [
                            `$${Number(value).toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`,
                            'Amount',
                          ]}
                          labelFormatter={(label) => String(label)}
                          contentStyle={{
                            fontSize: 12,
                            borderRadius: 8,
                            border: '1px solid hsl(var(--border))',
                          }}
                        />
                        <Bar dataKey="amount" fill="hsl(var(--primary))" maxBarSize={32} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </motion.div>

              <motion.div variants={item}>
                <Tabs value={breakdownTab} onValueChange={(v) => setBreakdownTab(v as typeof breakdownTab)}>
                  <TabsList className="mb-4">
                    <TabsTrigger value="tag">By tag</TabsTrigger>
                    <TabsTrigger value="category">By category</TabsTrigger>
                    <TabsTrigger value="subcategory">By subcategory</TabsTrigger>
                  </TabsList>
                  <TabsContent value="tag" className="mt-0">
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                      <div className="rounded-xl border bg-card p-6 shadow-card min-w-0">
                        <h2 className="text-sm font-semibold mb-4">Table</h2>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <SortableTableHead
                                label="Tag"
                                columnKey="tag"
                                sort={viewsTagSort}
                                onSort={(k) => setViewsTagSort((p) => cycleSort(p, k))}
                              />
                              <SortableTableHead
                                label="Total"
                                columnKey="total"
                                sort={viewsTagSort}
                                onSort={(k) => setViewsTagSort((p) => cycleSort(p, k))}
                              />
                              <SortableTableHead
                                label="Count"
                                columnKey="count"
                                sort={viewsTagSort}
                                onSort={(k) => setViewsTagSort((p) => cycleSort(p, k))}
                              />
                              <SortableTableHead
                                label="%"
                                columnKey="percent"
                                sort={viewsTagSort}
                                onSort={(k) => setViewsTagSort((p) => cycleSort(p, k))}
                              />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {data.by_tag.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={4} className="text-muted-foreground">
                                  No tags assigned.
                                </TableCell>
                              </TableRow>
                            ) : (
                              sortedViewsByTag.map((r, idx) => (
                                <TableRow key={idx}>
                                  <TableCell className="font-medium">{String(r.tag)}</TableCell>
                                  <TableCell className="tabular-nums">{formatMoney(Number(r.total))}</TableCell>
                                  <TableCell className="tabular-nums">{String(r.count ?? '')}</TableCell>
                                  <TableCell className="tabular-nums">{Number(r.percent).toFixed(1)}%</TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                      <SpendPieCard
                        title="Spend by tag"
                        rawSlices={tagRaw}
                        emptyHint="No tagged spending in this view."
                        twoThirdsPieLayout
                      />
                    </div>
                  </TabsContent>
                  <TabsContent value="category" className="mt-0">
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                      <div className="rounded-xl border bg-card p-6 shadow-card min-w-0">
                        <h2 className="text-sm font-semibold mb-4">Table</h2>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <SortableTableHead
                                label="Category"
                                columnKey="category"
                                sort={viewsCategorySort}
                                onSort={(k) => setViewsCategorySort((p) => cycleSort(p, k))}
                              />
                              <SortableTableHead
                                label="Total"
                                columnKey="total"
                                sort={viewsCategorySort}
                                onSort={(k) => setViewsCategorySort((p) => cycleSort(p, k))}
                              />
                              <SortableTableHead
                                label="Count"
                                columnKey="count"
                                sort={viewsCategorySort}
                                onSort={(k) => setViewsCategorySort((p) => cycleSort(p, k))}
                              />
                              <SortableTableHead
                                label="%"
                                columnKey="percent"
                                sort={viewsCategorySort}
                                onSort={(k) => setViewsCategorySort((p) => cycleSort(p, k))}
                              />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {data.by_category.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={4} className="text-muted-foreground">
                                  No categories.
                                </TableCell>
                              </TableRow>
                            ) : (
                              sortedViewsByCategory.map((r, idx) => (
                                <TableRow key={idx}>
                                  <TableCell className="font-medium">{String(r.category)}</TableCell>
                                  <TableCell className="tabular-nums">{formatMoney(Number(r.total))}</TableCell>
                                  <TableCell className="tabular-nums">{String(r.count ?? '')}</TableCell>
                                  <TableCell className="tabular-nums">{Number(r.percent).toFixed(1)}%</TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                      <SpendPieCard
                        title="Spend by category"
                        subtitle="Click a slice to focus subcategories in the next tab."
                        rawSlices={categoryRaw}
                        emptyHint="No categorized spending in this view."
                        interactiveCategory
                        selectedCategoryId={selectedCategoryId}
                        onCategorySliceClick={onCategorySliceClick}
                        twoThirdsPieLayout
                      />
                    </div>
                  </TabsContent>
                  <TabsContent value="subcategory" className="mt-0">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      {selectedCategoryId != null ? (
                        <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedCategoryId(null)}>
                          All subcategories
                        </Button>
                      ) : null}
                      {selectedCategoryId != null && selectedCategoryName ? (
                        <span className="text-xs text-muted-foreground">
                          Filtered: <span className="font-medium text-foreground">{selectedCategoryName}</span>
                        </span>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                      <div className="rounded-xl border bg-card p-6 shadow-card min-w-0 overflow-x-auto">
                        <h2 className="text-sm font-semibold mb-4">Table</h2>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <SortableTableHead
                                label="Category"
                                columnKey="category"
                                sort={viewsSubcategorySort}
                                onSort={(k) => setViewsSubcategorySort((p) => cycleSort(p, k))}
                              />
                              <SortableTableHead
                                label="Subcategory"
                                columnKey="subcategory"
                                sort={viewsSubcategorySort}
                                onSort={(k) => setViewsSubcategorySort((p) => cycleSort(p, k))}
                              />
                              <SortableTableHead
                                label="Total"
                                columnKey="total"
                                sort={viewsSubcategorySort}
                                onSort={(k) => setViewsSubcategorySort((p) => cycleSort(p, k))}
                              />
                              <SortableTableHead
                                label="Count"
                                columnKey="count"
                                sort={viewsSubcategorySort}
                                onSort={(k) => setViewsSubcategorySort((p) => cycleSort(p, k))}
                              />
                              <SortableTableHead
                                label="%"
                                columnKey="percent"
                                sort={viewsSubcategorySort}
                                onSort={(k) => setViewsSubcategorySort((p) => cycleSort(p, k))}
                              />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {subcategoryRowsFiltered.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={5} className="text-muted-foreground">
                                  {selectedCategoryId != null
                                    ? 'No subcategories for the selected category in this view.'
                                    : 'No subcategories.'}
                                </TableCell>
                              </TableRow>
                            ) : (
                              sortedViewsBySubcategory.map((r, idx) => (
                                <TableRow key={idx}>
                                  <TableCell className="font-medium whitespace-nowrap">{String(r.category)}</TableCell>
                                  <TableCell>{String(r.subcategory)}</TableCell>
                                  <TableCell className="tabular-nums">{formatMoney(Number(r.total))}</TableCell>
                                  <TableCell className="tabular-nums">{String(r.count ?? '')}</TableCell>
                                  <TableCell className="tabular-nums">{Number(r.percent).toFixed(1)}%</TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                      <SpendPieCard
                        title="Spend by subcategory"
                        subtitle={
                          selectedCategoryId != null && selectedCategoryName
                            ? `Filtered: ${selectedCategoryName}`
                            : 'Click a category slice on the previous tab to narrow.'
                        }
                        rawSlices={subcategoryRaw}
                        emptyHint={
                          selectedCategoryId != null
                            ? 'No subcategory spending for this category in this view.'
                            : 'No subcategory breakdown in this view.'
                        }
                        twoThirdsPieLayout
                      />
                    </div>
                  </TabsContent>
                </Tabs>
              </motion.div>

              <motion.div variants={item} className="rounded-xl border bg-card p-6 shadow-card">
                <h2 className="text-sm font-semibold mb-4">Transactions</h2>
                <div className="overflow-x-auto -mx-2 px-2">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableTableHead
                          label="Date"
                          columnKey="Date"
                          sort={viewsTxnSort}
                          onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                        />
                        <SortableTableHead
                          label="Merchant"
                          columnKey="Merchant"
                          sort={viewsTxnSort}
                          onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                        />
                        <SortableTableHead
                          label="Amount"
                          columnKey="Amount"
                          sort={viewsTxnSort}
                          onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                          align="right"
                        />
                        <SortableTableHead
                          label="Category"
                          columnKey="Category"
                          sort={viewsTxnSort}
                          onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                        />
                        <SortableTableHead
                          label="Subcategory"
                          columnKey="Subcategory"
                          sort={viewsTxnSort}
                          onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                        />
                        <SortableTableHead
                          label="Tags"
                          columnKey="Tags"
                          sort={viewsTxnSort}
                          onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                        />
                        <SortableTableHead
                          label="Notes"
                          columnKey="Notes"
                          sort={viewsTxnSort}
                          onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                        />
                        <SortableTableHead
                          label="Account"
                          columnKey="Acct"
                          sort={viewsTxnSort}
                          onSort={(k) => setViewsTxnSort((p) => cycleSort(p, k))}
                        />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.transactions.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-muted-foreground">
                            No transactions found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        sortedViewsTransactions.map((r, idx) => {
                          const row = r as unknown as TxnRow
                          return (
                            <TableRow key={row.id ?? idx}>
                              <TableCell className="whitespace-nowrap tabular-nums text-xs">{row.Date}</TableCell>
                              <TableCell className="max-w-[140px] truncate" title={row.Merchant}>
                                {row.Merchant}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatMoney(Number(row.Amount))}
                              </TableCell>
                              <TableCell>{row.Category}</TableCell>
                              <TableCell>{row.Subcategory}</TableCell>
                              <TableCell className="max-w-[120px] truncate" title={row.Tags}>
                                {row.Tags}
                              </TableCell>
                              <TableCell className="max-w-[120px] truncate" title={row.Notes}>
                                {row.Notes}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                <span className="mr-1.5">{row.Acct}</span>
                                {row.is_transfer ? (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                                    Transfer
                                  </Badge>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          )
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </motion.div>
            </motion.div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
