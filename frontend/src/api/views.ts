import { apiGet } from './client'
import type { BreakdownRow } from './reports'

export type ViewsTxnRow = {
  id?: number
  Date: string
  Merchant: string
  Amount: number
  Category: string
  Subcategory: string
  Tags: string
  Notes: string
  Acct: string
  is_transfer?: boolean
}

export type ViewsResponse = {
  start_date: string
  end_date: string
  total: number
  transaction_count: number
  spending_over_time: Array<{ date: string; amount: number }>
  by_tag: BreakdownRow[]
  by_category: BreakdownRow[]
  by_subcategory: BreakdownRow[]
  transactions: ViewsTxnRow[]
}

export type ViewsParams = {
  startDate: string
  endDate: string
  accountId: number | null
  categoryId: number | null
  /** Sorted ascending so equal filter sets share a cache entry. */
  subcategoryIds: number[]
  tagIds: number[]
  tagsMatchAny: boolean
  min: number | null
  max: number | null
}

export function getViews(params: ViewsParams) {
  const q = new URLSearchParams()
  q.set('start_date', params.startDate)
  q.set('end_date', params.endDate)
  if (params.accountId) q.set('account_id', String(params.accountId))
  if (params.categoryId) q.set('category_id', String(params.categoryId))
  for (const id of params.subcategoryIds) q.append('subcategory_ids', String(id))
  for (const id of params.tagIds) q.append('tag_ids', String(id))
  q.set('tags_match_any', params.tagsMatchAny ? 'true' : 'false')
  if (params.min != null) q.set('min_amount', String(params.min))
  if (params.max != null) q.set('max_amount', String(params.max))
  return apiGet<ViewsResponse>(`/api/views?${q.toString()}`)
}
