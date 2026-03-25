import { apiDelete, apiGet, apiPutJson } from './client'
import type { BudgetLimitUpsertIn, BudgetMonthOut, BudgetProgressOut } from '@/types'

export function getBudgetMonth(params: { year: number; month: number }) {
  const qs = new URLSearchParams({ year: String(params.year), month: String(params.month) })
  return apiGet<BudgetMonthOut>(`/api/budgets/months?${qs.toString()}`)
}

export function putBudgetLimits(params: { monthStart: string; items: BudgetLimitUpsertIn[] }) {
  return apiPutJson<BudgetMonthOut>(`/api/budgets/months/${encodeURIComponent(params.monthStart)}/limits`, params.items)
}

export function getBudgetProgress(params: { monthStart: string; includeProjected: boolean }) {
  const qs = new URLSearchParams({ include_projected: String(params.includeProjected) })
  return apiGet<BudgetProgressOut>(
    `/api/budgets/months/${encodeURIComponent(params.monthStart)}/progress?${qs.toString()}`
  )
}

export function deleteBudgetCategory(params: { monthStart: string; categoryId: number }) {
  return apiDelete(`/api/budgets/months/${encodeURIComponent(params.monthStart)}/categories/${params.categoryId}`)
}

