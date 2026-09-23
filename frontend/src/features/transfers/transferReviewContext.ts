import { createContext, useContext } from 'react'
import type { TransferMatchCandidate } from '@/api/transfers'

/** Opens the transfer review dialog for a batch of suggestions (no-op when empty). */
export type ReviewTransfers = (candidates: TransferMatchCandidate[]) => void

export const TransferReviewContext = createContext<ReviewTransfers>(() => {})

export function useTransferReview(): ReviewTransfers {
  return useContext(TransferReviewContext)
}
