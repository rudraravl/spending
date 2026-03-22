import { apiDelete, apiGet, apiPatchJson, apiPostJson, apiPutJson } from './client'

export type TransactionFilterParams = {
  includeTransfers: boolean
  startDate?: string
  endDate?: string
  accountId?: number
  limit?: number
  offset?: number
}

export const getTransactions = <T,>(params: TransactionFilterParams) => {
  const query = new URLSearchParams()
  query.set('include_transfers', params.includeTransfers ? 'true' : 'false')
  if (params.startDate && params.endDate) {
    query.set('start_date', params.startDate)
    query.set('end_date', params.endDate)
  }
  if (params.accountId != null) {
    query.set('account_id', String(params.accountId))
  }
  if (params.limit != null) {
    query.set('limit', String(params.limit))
  }
  if (params.offset != null && params.offset > 0) {
    query.set('offset', String(params.offset))
  }
  return apiGet<T>(`/api/transactions?${query.toString()}`)
}

export const createTransaction = <T,>(payload: unknown) => apiPostJson<T>('/api/transactions', payload)

export const patchTransaction = <T,>(id: number, payload: unknown) => apiPatchJson<T>(`/api/transactions/${id}`, payload)

export const deleteTransaction = (id: number) => apiDelete(`/api/transactions/${id}`)

export const getTransactionSplits = <T,>(txnId: number) => apiGet<T>(`/api/transactions/${txnId}/splits`)

export const putTransactionSplits = <T,>(txnId: number, payload: unknown) =>
  apiPutJson<T>(`/api/transactions/${txnId}/splits`, payload)

