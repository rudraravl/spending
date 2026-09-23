import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  linkExistingTransfer,
  transferMatchImportLegLabels,
  type TransferMatchCandidate,
  type TransferMatchTxnBrief,
} from '@/api/transfers'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { invalidateTransactionData } from '@/queryKeys'
import { CONFIDENCE_BADGE_VARIANT, CONFIDENCE_LABEL, DUPLICATE_TRANSFER_WARNING } from './transferMatchDisplay'
import { formatMoney } from '@/lib/format'

export type TransferReviewSummary = { linked: number; skipped: number; remaining: number }

type TransferMatchDialogProps = {
  candidates: TransferMatchCandidate[]
  /** Where the suggestions came from; only changes the wording. */
  source: 'sync' | 'import'
  /** Called once when the dialog closes, whether finished or dismissed early. */
  onClose: (summary: TransferReviewSummary) => void
}

function sharesLeg(a: TransferMatchCandidate, b: TransferMatchCandidate) {
  const legs = new Set([a.asset_transaction_id, a.credit_transaction_id])
  return legs.has(b.asset_transaction_id) || legs.has(b.credit_transaction_id)
}

/**
 * Steps through suggested transfer pairs one at a time. Mount it with a fresh
 * `key` for each batch of suggestions; it owns the queue from then on.
 */
export default function TransferMatchDialog({ candidates, source, onClose }: TransferMatchDialogProps) {
  const queryClient = useQueryClient()
  const [queue, setQueue] = useState(candidates)
  const [index, setIndex] = useState(0)
  const [linked, setLinked] = useState(0)
  const [skipped, setSkipped] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = queue[index] ?? null
  const kind = current?.kind ?? 'card_payment'
  const confidence = current?.confidence ?? 'medium'
  const legLabels = transferMatchImportLegLabels(kind)
  const isDuplicate = current?.duplicate_of_transfer_group_id != null

  const close = (counts: { linked: number; skipped: number }, nextIndex: number, nextQueue = queue) => {
    onClose({ ...counts, remaining: Math.max(nextQueue.length - nextIndex, 0) })
  }

  const advance = (counts: { linked: number; skipped: number }, nextQueue = queue) => {
    setError(null)
    const nextIndex = index + 1
    if (nextIndex < nextQueue.length) {
      setIndex(nextIndex)
    } else {
      close(counts, nextIndex, nextQueue)
    }
  }

  const linkCurrent = async () => {
    if (!current) return
    setPending(true)
    setError(null)
    try {
      await linkExistingTransfer({
        transaction_id_a: current.asset_transaction_id,
        transaction_id_b: current.credit_transaction_id,
        canonical_amount: current.canonical_amount,
      })
      void invalidateTransactionData(queryClient)
      // Later suggestions that reuse either leg are now impossible; drop them
      // instead of letting them fail with "already a transfer".
      const nextQueue = [
        ...queue.slice(0, index + 1),
        ...queue.slice(index + 1).filter((c) => !sharesLeg(c, current)),
      ]
      const counts = { linked: linked + 1, skipped }
      setQueue(nextQueue)
      setLinked(counts.linked)
      advance(counts, nextQueue)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not link these transactions')
    } finally {
      setPending(false)
    }
  }

  const skipCurrent = () => {
    const counts = { linked, skipped: skipped + 1 }
    setSkipped(counts.skipped)
    advance(counts)
  }

  const title =
    source === 'sync'
      ? queue.length === 1
        ? 'Transfer found in this sync'
        : 'Transfers found in this sync'
      : queue.length === 1
        ? 'Transfer found in this import'
        : 'Transfers found in this import'

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close({ linked, skipped }, index)
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Linking marks both sides as one transfer so the money isn't counted as spending or income.
            {queue.length > 1 ? ` Suggestion ${index + 1} of ${queue.length}.` : null}
          </DialogDescription>
        </DialogHeader>

        {current ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={CONFIDENCE_BADGE_VARIANT[confidence]}>{CONFIDENCE_LABEL[confidence]}</Badge>
              <span className="text-sm font-medium tabular-nums">{formatMoney(current.canonical_amount)}</span>
              <span className="text-xs text-muted-foreground">
                {kind === 'asset_transfer' ? 'between accounts' : 'card payment'}
              </span>
            </div>

            {isDuplicate ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {DUPLICATE_TRANSFER_WARNING} Skip this one unless the earlier transfer was a mistake.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <LegCard label={legLabels.outflow} leg={current.asset} />
              <LegCard label={legLabels.inflow} leg={current.credit} />
            </div>

            {current.reasons?.length ? (
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                {current.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button asChild variant="link" className="px-0 h-auto justify-start">
            <Link to="/transactions?tab=transfers" onClick={() => close({ linked, skipped }, index)}>
              See all suggestions
            </Link>
          </Button>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={() => close({ linked, skipped }, index)} disabled={pending}>
              Review later
            </Button>
            <Button type="button" variant="secondary" onClick={skipCurrent} disabled={pending}>
              Skip
            </Button>
            <Button
              type="button"
              variant={isDuplicate ? 'outline' : 'default'}
              onClick={() => void linkCurrent()}
              disabled={pending || !current}
            >
              {pending ? 'Linking…' : isDuplicate ? 'Link anyway' : 'Link as transfer'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LegCard({ label, leg }: { label: string; leg: TransferMatchTxnBrief }) {
  return (
    <div className="rounded-lg border p-3 space-y-1 min-w-0">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="font-medium truncate">{leg.account_name ?? 'Unknown account'}</p>
      <p className="text-muted-foreground truncate" title={leg.merchant}>
        {leg.merchant}
      </p>
      <p className="tabular-nums">{formatMoney(leg.amount)}</p>
      <p className="text-xs text-muted-foreground">{leg.date}</p>
    </div>
  )
}
