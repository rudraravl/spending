import { apiGet, apiPostJson } from './client'

export type TransferMatchKind = 'card_payment' | 'asset_transfer'

export type TransferMatchTxnBrief = {
  id: number
  date: string
  amount: number
  merchant: string
  account_id: number
  account_name: string | null
  account_type: string | null
}

export type TransferMatchCandidate = {
  /** Present on API responses; omit on older cached payloads. */
  kind?: TransferMatchKind
  asset_transaction_id: number
  credit_transaction_id: number
  canonical_amount: number
  amount_delta: number
  date_delta_days: number
  asset: TransferMatchTxnBrief
  credit: TransferMatchTxnBrief
}

/** Labels for the outflow (asset.*) and inflow (credit.*) legs of a suggested pair. */
export function transferMatchLegLabels(kind: TransferMatchKind) {
  if (kind === 'asset_transfer') {
    return { outflow: 'From', inflow: 'To' }
  }
  return { outflow: 'Bank', inflow: 'Card' }
}

/** Descriptive labels for CSV import match dialog. */
export function transferMatchImportLegLabels(kind: TransferMatchKind) {
  if (kind === 'asset_transfer') {
    return { outflow: 'From (outflow)', inflow: 'To (inflow)' }
  }
  return { outflow: 'Bank (outflow)', inflow: 'Card (payment)' }
}

export type TransferMatchCandidatesResponse = {
  candidates: TransferMatchCandidate[]
}

export type PaymentsHoldoutResponse = {
  count: number
  transaction_ids: number[]
}

export function getTransferMatchCandidates(params?: {
  seedIds?: number[]
  lookbackDays?: number
}): Promise<TransferMatchCandidatesResponse> {
  const p = new URLSearchParams()
  if (params?.seedIds?.length) {
    for (const id of params.seedIds) {
      p.append('seed_ids', String(id))
    }
  }
  if (params?.lookbackDays != null) {
    p.set('lookback_days', String(params.lookbackDays))
  }
  const qs = p.toString()
  return apiGet<TransferMatchCandidatesResponse>(
    `/api/transfers/match-candidates${qs ? `?${qs}` : ''}`,
  )
}

export function getPaymentsHoldouts(): Promise<PaymentsHoldoutResponse> {
  return apiGet<PaymentsHoldoutResponse>('/api/transfers/payments-holdouts')
}

export function linkExistingTransfer(payload: {
  transaction_id_a: number
  transaction_id_b: number
  canonical_amount?: number | null
  notes?: string | null
}): Promise<{ transfer_group_id: number }> {
  return apiPostJson<{ transfer_group_id: number }>('/api/transfers/link-existing', payload)
}

export function unlinkExistingTransfer(payload: {
  transaction_id_a: number
  transaction_id_b: number
}): Promise<{ transfer_group_id: number }> {
  return apiPostJson<{ transfer_group_id: number }>('/api/transfers/unlink-existing', payload)
}
