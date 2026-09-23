import { useCallback, useState, type ReactNode } from 'react'
import type { TransferMatchCandidate } from '@/api/transfers'
import { toast } from '@/components/ui/sonner'
import TransferMatchDialog, { type TransferReviewSummary } from './TransferMatchDialog'
import { TransferReviewContext } from './transferReviewContext'

function summaryMessage({ linked, skipped, remaining }: TransferReviewSummary): string | null {
  const parts: string[] = []
  if (linked) parts.push(`Linked ${linked} transfer${linked === 1 ? '' : 's'}`)
  if (skipped) parts.push(`${skipped} skipped`)
  if (remaining) parts.push(`${remaining} left for later in Transactions → Transfers`)
  return parts.length ? `${parts.join(' · ')}.` : null
}

/**
 * Hosts the post-sync transfer review dialog at the app root, so any page that
 * starts a sync can open it and it survives navigation.
 */
export default function TransferReviewProvider({ children }: { children: ReactNode }) {
  const [batch, setBatch] = useState<{ id: number; candidates: TransferMatchCandidate[] } | null>(null)

  const review = useCallback((candidates: TransferMatchCandidate[]) => {
    if (candidates.length === 0) return
    setBatch({ id: Date.now(), candidates })
  }, [])

  return (
    <TransferReviewContext.Provider value={review}>
      {children}
      {batch ? (
        <TransferMatchDialog
          key={batch.id}
          candidates={batch.candidates}
          source="sync"
          onClose={(summary) => {
            setBatch(null)
            const message = summaryMessage(summary)
            if (message) toast.success(message)
          }}
        />
      ) : null}
    </TransferReviewContext.Provider>
  )
}
