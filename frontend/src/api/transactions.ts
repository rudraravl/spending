import { apiDelete, apiGet, apiPatchJson, apiPostJson, apiPutJson } from './client'

export type TransactionFilterParams = {
  includeTransfers: boolean
  startDate?: string
  endDate?: string
  accountId?: number
  categoryId?: number
  subcategoryId?: number
  tagIds?: number[]
  tagsMatchAny?: boolean
  minAmount?: number
  maxAmount?: number
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
  if (params.categoryId != null) {
    query.set('category_id', String(params.categoryId))
  }
  if (params.subcategoryId != null) {
    query.set('subcategory_id', String(params.subcategoryId))
  }
  if (params.tagIds && params.tagIds.length > 0) {
    for (const id of params.tagIds) query.append('tag_ids', String(id))
    if (params.tagsMatchAny != null) query.set('tags_match_any', params.tagsMatchAny ? 'true' : 'false')
  }
  if (params.minAmount != null) {
    query.set('min_amount', String(params.minAmount))
  }
  if (params.maxAmount != null) {
    query.set('max_amount', String(params.maxAmount))
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

