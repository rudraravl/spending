import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, EyeOff, Trash2 } from 'lucide-react'
import {
  bulkUpdateRecurringSeriesCategory,
  confirmRecurringSeries,
  getRecurringSeriesOccurrences,
  getRecurringSuggestions,
  ignoreRecurringSeries,
  removeRecurringSeries,
} from '@/api/recurring'
import { getCategories, getSubcategories } from '@/api/categories'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CategoryOut, SubcategoryOut } from '@/types'
import type { RecurringOccurrenceOut, RecurringSeriesCardOut } from '@/types/recurring'

const queryKey = ['recurringSuggestions']

function formatMoneyFromCents(cents: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (status === 'confirmed') return 'default'
  if (status === 'suggested') return 'secondary'
  if (status === 'ignored') return 'outline'
  if (status === 'removed') return 'destructive'
  return 'outline'
}

function cadenceLabel(row: RecurringSeriesCardOut) {
  if (row.cadence_type) return row.cadence_type
  if (row.occurrences?.length >= 2) return 'monthly (detected)'
  return '—'
}

export default function RecurringChargesPage() {
  const qc = useQueryClient()
  const [selectedSeries, setSelectedSeries] = useState<RecurringSeriesCardOut | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [categoryId, setCategoryId] = useState<string>('')
  const [subcategoryId, setSubcategoryId] = useState<string>('')

  const { data, error, isLoading, isFetching } = useQuery<RecurringSeriesCardOut[], Error>({
    queryKey,
    queryFn: () => getRecurringSuggestions(),
    staleTime: 30_000,
  })

  const confirmMut = useMutation({
    mutationFn: confirmRecurringSeries,
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  })
  const ignoreMut = useMutation({
    mutationFn: ignoreRecurringSeries,
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  })
  const removeMut = useMutation({
    mutationFn: removeRecurringSeries,
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  })
  const bulkCategoryMut = useMutation({
    mutationFn: bulkUpdateRecurringSeriesCategory,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey }),
        qc.invalidateQueries({ queryKey: ['transactions'] }),
      ])
    },
  })

  const pending =
    confirmMut.isPending || ignoreMut.isPending || removeMut.isPending || bulkCategoryMut.isPending

  const { data: categories = [] } = useQuery<CategoryOut[], Error>({
    queryKey: ['categories'],
    queryFn: () => getCategories(),
  })

  const { data: subcategories = [] } = useQuery<SubcategoryOut[], Error>({
    queryKey: ['recurringPageSubcategories', categoryId],
    queryFn: () => getSubcategories(Number(categoryId)),
    enabled: dialogOpen && categoryId.length > 0,
  })

  const { data: occurrences = [], isFetching: isLoadingOccurrences } = useQuery<RecurringOccurrenceOut[], Error>({
    queryKey: ['recurringSeriesOccurrences', selectedSeries?.merchant_norm, selectedSeries?.amount_anchor_cents],
    queryFn: () =>
      getRecurringSeriesOccurrences({
        merchant_norm: selectedSeries?.merchant_norm ?? '',
        amount_anchor_cents: selectedSeries?.amount_anchor_cents ?? 0,
      }),
    enabled: dialogOpen && selectedSeries != null,
  })

  useEffect(() => {
    if (!dialogOpen) return
    if (!categoryId && categories.length > 0) {
      setCategoryId(String(categories[0].id))
    }
  }, [dialogOpen, categoryId, categories])

  useEffect(() => {
    if (!dialogOpen || !occurrences.length) return
    const categorized = occurrences.filter((o) => o.category_id != null && o.subcategory_id != null)
    if (categorized.length !== occurrences.length || categorized.length === 0) return
    const first = categorized[0]
    const same = categorized.every(
      (o) => o.category_id === first.category_id && o.subcategory_id === first.subcategory_id,
    )
    if (!same || first.category_id == null || first.subcategory_id == null) return
    setCategoryId(String(first.category_id))
    setSubcategoryId(String(first.subcategory_id))
  }, [dialogOpen, occurrences])

  useEffect(() => {
    if (!dialogOpen || !categoryId) return
    const first = subcategories[0]
    if (!first) {
      setSubcategoryId('')
      return
    }
    if (!subcategories.some((s) => String(s.id) === subcategoryId)) {
      setSubcategoryId(String(first.id))
    }
  }, [dialogOpen, categoryId, subcategories, subcategoryId])

  const selectedCategoryName = useMemo(() => {
    const id = Number(categoryId)
    return categories.find((c) => c.id === id)?.name ?? 'category'
  }, [categoryId, categories])

  const categorizationSummary = useMemo(() => {
    if (!occurrences.length) return 'No instances to validate yet.'
    const categorized = occurrences.filter((o) => o.category_id != null && o.subcategory_id != null)
    if (!categorized.length) return 'All instances are uncategorized.'
    if (categorized.length !== occurrences.length) {
      return 'Mixed categorization: some instances are uncategorized.'
    }
    const first = categorized[0]
    const same = categorized.every(
      (o) => o.category_id === first.category_id && o.subcategory_id === first.subcategory_id,
    )
    if (!same) return 'Mixed categorization across instances.'
    return `Current categorization: ${first.category_name ?? 'Unknown'} / ${first.subcategory_name ?? 'Unknown'}`
  }, [occurrences])

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">{error.message}</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-lg font-semibold tracking-tight">Recurring charges</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Suggested recurring charges are detected using amount tolerance (±$0.05) and month-over-month date matching (±2
          days). Confirm, ignore, or remove any series.
        </p>
      </motion.div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading recurring charges…</p>
      ) : !data?.length ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No recurring charges detected yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((row) => {
            const occs = row.occurrences ?? []
            const last = occs.length ? occs[0] : null
            const title = row.display_name || row.merchant_norm
            return (
              <Card
                key={`${row.merchant_norm}:${row.amount_anchor_cents}`}
                className="cursor-pointer transition-colors hover:bg-muted/20"
                onClick={() => {
                  setSelectedSeries(row)
                  setDialogOpen(true)
                }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{title}</CardTitle>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {formatMoneyFromCents(row.amount_anchor_cents)}
                        {last ? (
                          <span className="ml-2 text-xs text-muted-foreground/80">last: {last.date}</span>
                        ) : null}
                      </div>
                    </div>
                    <Badge variant={statusBadgeVariant(row.status)} className="shrink-0">
                      {row.status}
                    </Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>cadence:</span>
                    <span className="text-foreground">{cadenceLabel(row)}</span>
                    {isFetching ? <span className="text-muted-foreground/70">(refreshing)</span> : null}
                  </div>
                </CardHeader>

                <CardContent className="pt-0">
                  {occs.length ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">Recent occurrences</div>
                      <ul className="space-y-1">
                        {occs.slice(0, 5).map((o) => (
                          <li key={o.transaction_id} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{o.date}</span>
                            <span className="font-medium">{formatMoneyFromCents(Math.round(o.amount * 100))}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">No occurrences loaded for this series yet.</div>
                  )}
                </CardContent>

                <CardFooter className="gap-2 flex-wrap">
                  {row.status !== 'confirmed' ? (
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={(e) => {
                        e.stopPropagation()
                        confirmMut.mutate({
                          merchant_norm: row.merchant_norm,
                          amount_anchor_cents: row.amount_anchor_cents,
                        })
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Confirm
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={(e) => {
                      e.stopPropagation()
                      ignoreMut.mutate({
                        merchant_norm: row.merchant_norm,
                        amount_anchor_cents: row.amount_anchor_cents,
                      })
                    }}
                  >
                    <EyeOff className="h-4 w-4" />
                    Not recurring
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeMut.mutate({
                        merchant_norm: row.merchant_norm,
                        amount_anchor_cents: row.amount_anchor_cents,
                      })
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedSeries?.display_name || selectedSeries?.merchant_norm || 'Recurring charge'}</DialogTitle>
            <DialogDescription>
              View all detected instances and apply one category/subcategory to every instance.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {categorizationSummary}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={categoryId}
                  onValueChange={(next) => {
                    setCategoryId(next)
                    setSubcategoryId('')
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Subcategory</Label>
                <Select value={subcategoryId} onValueChange={setSubcategoryId} disabled={!categoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select subcategory" />
                  </SelectTrigger>
                  <SelectContent>
                    {subcategories.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-md border">
              <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
                All instances ({occurrences.length})
              </div>
              <div className="max-h-72 overflow-auto border-t">
                {isLoadingOccurrences ? (
                  <p className="p-3 text-sm text-muted-foreground">Loading instances…</p>
                ) : !occurrences.length ? (
                  <p className="p-3 text-sm text-muted-foreground">No instances found for this recurring charge.</p>
                ) : (
                  <ul className="divide-y">
                    {occurrences.map((o) => (
                      <li key={o.transaction_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <div>
                          <div className="font-medium">{o.merchant}</div>
                          <div className="text-xs text-muted-foreground">{o.date}</div>
                        </div>
                        <div className="font-medium">{formatMoneyFromCents(Math.round(o.amount * 100))}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Close
            </Button>
            <Button
              disabled={!selectedSeries || !categoryId || !subcategoryId || bulkCategoryMut.isPending}
              onClick={() => {
                if (!selectedSeries) return
                bulkCategoryMut.mutate({
                  merchant_norm: selectedSeries.merchant_norm,
                  amount_anchor_cents: selectedSeries.amount_anchor_cents,
                  category_id: Number(categoryId),
                  subcategory_id: Number(subcategoryId),
                })
              }}
            >
              {bulkCategoryMut.isPending ? 'Updating…' : `Apply to all (${selectedCategoryName})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

