import { useMutation, useQueryClient } from '@tanstack/react-query'
import { triggerSync, type SyncResult } from '@/api/simplefin'
import { useTransferReview } from '@/features/transfers/transferReviewContext'
import { invalidateTransactionData, queryKeys } from '@/queryKeys'

export function syncResultSummary(result: SyncResult): string {
  const base = `Synced ${result.accounts_synced} account(s), imported ${result.transactions_imported} new transaction(s).`
  return result.errors?.length ? `${base} ${result.errors.join('; ')}` : base
}

/**
 * "Sync banks" mutation: pulls from SimpleFIN, queues suggested transfers for review, and
 * refreshes everything the new transactions and balances feed into.
 */
export function useSimplefinSync(
  connectionId: number | null | undefined,
  handlers: { onSuccess?: (result: SyncResult) => void; onError?: (err: Error) => void } = {},
) {
  const queryClient = useQueryClient()
  const reviewTransfers = useTransferReview()
  return useMutation({
    mutationFn: () => triggerSync({ connection_id: connectionId ?? null }),
    onSuccess: (result: SyncResult) => {
      reviewTransfers(result.transfer_candidates ?? [])
      handlers.onSuccess?.(result)
      void invalidateTransactionData(queryClient)
      void queryClient.invalidateQueries({ queryKey: queryKeys.simplefinConnections() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.simplefinDailyBudgetAll() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.simplefinCachedAccounts() })
    },
    onError: (err: Error) => handlers.onError?.(err),
  })
}
