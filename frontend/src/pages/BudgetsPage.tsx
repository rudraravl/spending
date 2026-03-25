import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { getCategories, getSubcategories } from '@/api/categories'
import { deleteBudgetCategory, getBudgetMonth, getBudgetProgress, putBudgetLimits } from '@/api/budgets'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { BudgetLimitUpsertIn, BudgetProgressCategoryOut } from '@/types'

function monthStartIso(year: number, month: number) {
  const mm = String(month).padStart(2, '0')
  return `${year}-${mm}-01`
}

function money(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n)
}

function clampPct(p: number) {
  if (!Number.isFinite(p)) return 0
  if (p < 0) return 0
  if (p > 999) return 999
  return p
}

function progressColorClass(percent: number) {
  if (percent >= 100) return 'bg-red-500'
  if (percent >= 85) return 'bg-yellow-500'
  return 'bg-green-500'
}

function BudgetProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, clampPct(percent))
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={`h-full transition-all ${progressColorClass(percent)}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

function monthLabel(y: number, m: number) {
  const d = new Date(y, m - 1, 1)
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' })
}

export default function BudgetsPage() {
  const qc = useQueryClient()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [includeProjected, setIncludeProjected] = useState(false)
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)
  const [newBudgetCategoryId, setNewBudgetCategoryId] = useState<string>('')
  const [newBudgetCap, setNewBudgetCap] = useState<string>('')

  const ms = useMemo(() => monthStartIso(year, month), [year, month])

  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => getCategories(),
    staleTime: 5 * 60 * 1000,
  })

  const subcatsQ = useQuery({
    queryKey: ['subcategoriesByCategory'],
    queryFn: async () => {
      const cats = await getCategories()
      const entries = await Promise.all(
        cats.map(async (c) => [c.id, await getSubcategories(c.id)] as const)
      )
      return Object.fromEntries(entries) as Record<number, { id: number; name: string; category_id: number }[]>
    },
    staleTime: 5 * 60 * 1000,
  })

  const monthQ = useQuery({
    queryKey: ['budgetMonth', year, month],
    queryFn: () => getBudgetMonth({ year, month }),
  })

  const progressQ = useQuery({
    queryKey: ['budgetProgress', ms, includeProjected],
    queryFn: () => getBudgetProgress({ monthStart: ms, includeProjected }),
  })

  const putLimitsMut = useMutation({
    mutationFn: (items: BudgetLimitUpsertIn[]) => putBudgetLimits({ monthStart: ms, items }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['budgetMonth', year, month] }),
        qc.invalidateQueries({ queryKey: ['budgetProgress', ms] }),
        qc.invalidateQueries({ queryKey: ['budgetProgress', ms, includeProjected] }),
      ])
    },
  })
  const deleteCategoryMut = useMutation({
    mutationFn: (categoryId: number) => deleteBudgetCategory({ monthStart: ms, categoryId }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['budgetMonth', year, month] }),
        qc.invalidateQueries({ queryKey: ['budgetProgress', ms] }),
        qc.invalidateQueries({ queryKey: ['budgetProgress', ms, includeProjected] }),
      ])
    },
  })

  const byCategory = useMemo(() => {
    const rows = progressQ.data?.categories ?? []
    return rows
      .slice()
      .sort((a, b) => a.category_name.localeCompare(b.category_name))
  }, [progressQ.data?.categories])

  const existingLimits = useMemo(() => monthQ.data?.limits ?? [], [monthQ.data?.limits])

  const limitLookup = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of existingLimits) {
      const key = `${l.category_id}:${l.subcategory_id ?? ''}`
      m.set(key, l.limit_amount)
    }
    return m
  }, [existingLimits])

  const [drafts, setDrafts] = useState<Record<string, string>>({})

  function getDraft(categoryId: number, subcategoryId: number | null) {
    const key = `${categoryId}:${subcategoryId ?? ''}`
    const v = drafts[key]
    if (v != null) return v
    const existing = limitLookup.get(key)
    return existing != null ? String(existing) : ''
  }

  function setDraft(categoryId: number, subcategoryId: number | null, value: string) {
    const key = `${categoryId}:${subcategoryId ?? ''}`
    setDrafts((p) => ({ ...p, [key]: value }))
  }

  function parseMoney(value: string): number | null {
    const s = value.trim()
    if (!s) return null
    const n = Number(s)
    if (!Number.isFinite(n)) return null
    return n
  }

  function buildUpserts(): BudgetLimitUpsertIn[] {
    const upserts: BudgetLimitUpsertIn[] = []
    for (const [key, raw] of Object.entries(drafts)) {
      const [catStr, subStr] = key.split(':')
      const category_id = Number(catStr)
      const subcategory_id = subStr ? Number(subStr) : null
      const amt = parseMoney(raw)
      if (amt == null) continue
      upserts.push({ category_id, subcategory_id, limit_amount: amt })
    }
    return upserts
  }

  const anyLoading = categoriesQ.isLoading || subcatsQ.isLoading || monthQ.isLoading || progressQ.isLoading
  const error = categoriesQ.error || subcatsQ.error || monthQ.error || progressQ.error

  const allCats = categoriesQ.data ?? []
  const subcatsByCat = subcatsQ.data ?? {}

  const shownCats = useMemo(() => {
    const configured = new Set<number>((progressQ.data?.categories ?? []).map((c) => c.category_id))
    const all = allCats.map((c) => c.id)
    return all.filter((id) => configured.has(id) || (subcatsByCat[id]?.length ?? 0) >= 0)
  }, [allCats, progressQ.data?.categories, subcatsByCat])

  const categoryNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of allCats) m.set(c.id, c.name)
    return m
  }, [allCats])

  const categoryRows: BudgetProgressCategoryOut[] = useMemo(() => {
    const configured = new Map<number, BudgetProgressCategoryOut>()
    for (const r of byCategory) configured.set(r.category_id, r)
    const out: BudgetProgressCategoryOut[] = []
    for (const cid of shownCats) {
      const row = configured.get(cid)
      if (row) out.push(row)
      else {
        out.push({
          category_id: cid,
          category_name: categoryNameById.get(cid) ?? '',
          limit_amount: 0,
          allocated_to_subcategories: 0,
          unallocated_amount: 0,
          spent_amount: 0,
          remaining_amount: 0,
          percent_used: 0,
          projected_spent_amount: 0,
          subcategories: [],
        })
      }
    }
    return out.sort((a, b) => a.category_name.localeCompare(b.category_name))
  }, [byCategory, categoryNameById, shownCats])

  const years = useMemo(() => {
    const y = now.getFullYear()
    return [y - 1, y, y + 1]
  }, [now])

  const configuredBudgetCards = useMemo(() => {
    return categoryRows.filter((c) => c.limit_amount > 0 || (c.subcategories?.length ?? 0) > 0)
  }, [categoryRows])

  const unconfiguredCategories = useMemo(() => {
    const configuredIds = new Set(configuredBudgetCards.map((c) => c.category_id))
    return allCats.filter((c) => !configuredIds.has(c.id))
  }, [allCats, configuredBudgetCards])

  const selectedCategory = useMemo(() => {
    if (selectedCategoryId == null) return configuredBudgetCards[0] ?? null
    return categoryRows.find((c) => c.category_id === selectedCategoryId) ?? null
  }, [categoryRows, configuredBudgetCards, selectedCategoryId])

  function createBudgetCard() {
    const categoryId = Number(newBudgetCategoryId)
    if (!Number.isFinite(categoryId) || categoryId <= 0) return
    const parsed = parseMoney(newBudgetCap)
    const cap = parsed != null ? parsed : 0
    putLimitsMut.mutate(
      [{ category_id: categoryId, subcategory_id: null, limit_amount: cap }],
      {
        onSuccess: () => {
          setSelectedCategoryId(categoryId)
          setNewBudgetCategoryId('')
          setNewBudgetCap('')
        },
      }
    )
  }

  function removeSelectedBudgetCard() {
    if (!selectedCategory) return
    deleteCategoryMut.mutate(selectedCategory.category_id, {
      onSuccess: () => {
        setSelectedCategoryId(null)
      },
    })
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Budgets</h1>
        <p className="text-sm text-muted-foreground">
          Set monthly category caps and (optionally) allocate them to subcategories. Progress uses split-aware spending.
        </p>
      </motion.div>

      {error ? <div className="text-sm text-destructive">{(error as Error).message}</div> : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Month</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="grid gap-1.5">
            <Label>Year</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Month</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select month" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }).map((_, idx) => {
                  const m = idx + 1
                  return (
                    <SelectItem key={m} value={String(m)}>
                      {monthLabel(2000, m).replace('2000', '').trim()}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3 pt-5">
            <Switch checked={includeProjected} onCheckedChange={setIncludeProjected} />
            <Label className="text-sm">Include projected recurring</Label>
          </div>

          <div className="ml-auto flex items-center gap-2 pt-5">
            <Button
              type="button"
              disabled={putLimitsMut.isPending || Object.keys(drafts).length === 0}
              onClick={() => putLimitsMut.mutate(buildUpserts())}
            >
              Save changes
            </Button>
            <Button type="button" variant="outline" disabled={putLimitsMut.isPending} onClick={() => setDrafts({})}>
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {anyLoading ? (
        <div className="text-sm text-muted-foreground">Loading budgets for {monthLabel(year, month)}…</div>
      ) : (
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Budgets</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {configuredBudgetCards.map((cat) => {
                  const cap = Number.isFinite(cat.limit_amount) ? cat.limit_amount : 0
                  const spent = cat.spent_amount ?? 0
                  const pct = cap > 0 ? (spent / cap) * 100 : 0
                  const isSelected = selectedCategory?.category_id === cat.category_id
                  return (
                    <button
                      key={cat.category_id}
                      type="button"
                      onClick={() => setSelectedCategoryId(cat.category_id)}
                      className={`rounded-lg border p-3 text-left transition ${
                        isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium truncate">{cat.category_name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {cap > 0 ? `${pct.toFixed(0)}%` : '—'}
                        </div>
                      </div>
                      <div className="mt-2">
                        <BudgetProgressBar percent={pct} />
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {cap > 0 ? `${money(spent)} / ${money(cap)}` : 'No cap set'}
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end rounded-lg border p-3">
                <div className="md:col-span-1">
                  <Label>Create budget for category</Label>
                  <Select value={newBudgetCategoryId} onValueChange={setNewBudgetCategoryId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {unconfiguredCategories.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-1">
                  <Label>Initial cap (optional)</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="e.g. 400"
                    value={newBudgetCap}
                    onChange={(e) => setNewBudgetCap(e.target.value)}
                  />
                </div>
                <div className="md:col-span-1 flex justify-end">
                  <Button
                    type="button"
                    disabled={putLimitsMut.isPending || !newBudgetCategoryId}
                    onClick={createBudgetCard}
                  >
                    Add budget card
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {selectedCategory ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">{selectedCategory.category_name} budget details</CardTitle>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {selectedCategory.limit_amount > 0 ? (
                        <>
                          {money(selectedCategory.spent_amount)} spent of {money(selectedCategory.limit_amount)} •{' '}
                          {money(selectedCategory.remaining_amount)} remaining
                        </>
                      ) : (
                        <>No cap set yet.</>
                      )}
                      {selectedCategory.unallocated_amount > 0 ? (
                        <span className="ml-2">• {money(selectedCategory.unallocated_amount)} unallocated</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="w-[200px]">
                    <BudgetProgressBar
                      percent={
                        selectedCategory.limit_amount > 0
                          ? (selectedCategory.spent_amount / selectedCategory.limit_amount) * 100
                          : 0
                      }
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <div className="sm:col-span-2">
                    <Label>Category cap</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="e.g. 500"
                      value={getDraft(selectedCategory.category_id, null)}
                      onChange={(e) => setDraft(selectedCategory.category_id, null, e.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-1 flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={putLimitsMut.isPending || deleteCategoryMut.isPending}
                      onClick={() => {
                        const amt = parseMoney(getDraft(selectedCategory.category_id, null))
                        if (amt == null) return
                        putLimitsMut.mutate([{ category_id: selectedCategory.category_id, subcategory_id: null, limit_amount: amt }])
                      }}
                    >
                      Save cap
                    </Button>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={putLimitsMut.isPending || deleteCategoryMut.isPending}
                    onClick={removeSelectedBudgetCard}
                  >
                    {deleteCategoryMut.isPending ? 'Removing…' : 'Remove budget card'}
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Subcategory allocations</div>
                  {(subcatsByCat[selectedCategory.category_id] ?? []).length === 0 ? (
                    <div className="text-xs text-muted-foreground">No subcategories for this category.</div>
                  ) : (
                    <div className="grid gap-2">
                      {(subcatsByCat[selectedCategory.category_id] ?? []).map((s) => {
                        const existingRow = (selectedCategory.subcategories ?? []).find((r) => r.subcategory_id === s.id)
                        const sCap = existingRow?.limit_amount ?? 0
                        const sSpent = existingRow?.spent_amount ?? 0
                        const sPct = sCap > 0 ? (sSpent / sCap) * 100 : 0
                        return (
                          <div key={s.id} className="rounded-lg border p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{s.name}</div>
                                <div className="mt-0.5 text-[11px] text-muted-foreground">
                                  {sCap > 0 ? (
                                    <>
                                      {money(sSpent)} spent of {money(sCap)} • {money(existingRow?.remaining_amount ?? 0)} remaining
                                    </>
                                  ) : (
                                    <>Not allocated yet.</>
                                  )}
                                </div>
                              </div>
                              <div className="w-[180px]">
                                <BudgetProgressBar percent={sPct} />
                                <div className="mt-1 text-[11px] text-muted-foreground text-right">
                                  {sCap > 0 ? `${sPct.toFixed(0)}%` : '—'}
                                </div>
                              </div>
                            </div>

                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                              <div className="sm:col-span-2">
                                <Label className="text-xs">Allocation</Label>
                                <Input
                                  inputMode="decimal"
                                  placeholder="e.g. 120"
                                  value={getDraft(selectedCategory.category_id, s.id)}
                                  onChange={(e) => setDraft(selectedCategory.category_id, s.id, e.target.value)}
                                />
                              </div>
                              <div className="sm:col-span-1 flex justify-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={putLimitsMut.isPending}
                                  onClick={() => {
                                    const amt = parseMoney(getDraft(selectedCategory.category_id, s.id))
                                    if (amt == null) return
                                    putLimitsMut.mutate([
                                      { category_id: selectedCategory.category_id, subcategory_id: s.id, limit_amount: amt },
                                    ])
                                  }}
                                >
                                  Save
                                </Button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-sm text-muted-foreground">
                No budgets yet. Create one above to get started.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

