import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { CheckCircle2, EyeOff, Trash2 } from 'lucide-react'
import {
  confirmRecurringSeries,
  getRecurringSuggestions,
  ignoreRecurringSeries,
  removeRecurringSeries,
} from '@/api/recurring'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { RecurringSeriesCardOut } from '@/types/recurring'

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

  const pending = confirmMut.isPending || ignoreMut.isPending || removeMut.isPending

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
              <Card key={`${row.merchant_norm}:${row.amount_anchor_cents}`}>
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
                  <Button
                    size="sm"
                    disabled={pending || row.status === 'confirmed'}
                    onClick={() =>
                      confirmMut.mutate({
                        merchant_norm: row.merchant_norm,
                        amount_anchor_cents: row.amount_anchor_cents,
                      })
                    }
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      ignoreMut.mutate({
                        merchant_norm: row.merchant_norm,
                        amount_anchor_cents: row.amount_anchor_cents,
                      })
                    }
                  >
                    <EyeOff className="h-4 w-4" />
                    Not recurring
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={() =>
                      removeMut.mutate({
                        merchant_norm: row.merchant_norm,
                        amount_anchor_cents: row.amount_anchor_cents,
                      })
                    }
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
    </div>
  )
}

