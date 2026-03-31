import { apiDelete, apiGet, apiPatchJson, apiPostJson, apiPutJson } from './client'
import type {
  BudgetLimitUpsertIn,
  BudgetCategoryOut,
  BudgetMonthOut,
  BudgetProgressOut,
  ZbbAssignIn,
  ZbbMonthOut,
  ZbbMoveMoneyIn,
  ZbbRolloverSettingOut,
} from '@/types'

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

export function getZbbMonth(params: { year: number; month: number }) {
  const qs = new URLSearchParams({ year: String(params.year), month: String(params.month) })
  return apiGet<ZbbMonthOut>(`/api/budgets/zbb/months?${qs.toString()}`)
}

export function patchZbbAssign(params: { year: number; month: number; body: ZbbAssignIn }) {
  return apiPatchJson<ZbbMonthOut>(`/api/budgets/zbb/months/${params.year}/${params.month}/assign`, params.body)
}

export function postZbbMoveMoney(params: { year: number; month: number; body: ZbbMoveMoneyIn }) {
  return apiPostJson<ZbbMonthOut>(
    `/api/budgets/zbb/months/${params.year}/${params.month}/move-money`,
    params.body,
  )
}

export function getZbbSettings() {
  return apiGet<ZbbRolloverSettingOut>('/api/budgets/zbb/settings')
}

export function patchZbbSettings(body: { rollover_mode: 'strict' | 'flexible' }) {
  return apiPatchJson<ZbbRolloverSettingOut>('/api/budgets/zbb/settings', body)
}

export function getZbbCategories() {
  return apiGet<BudgetCategoryOut[]>('/api/budgets/zbb/categories')
}

export function postZbbCategory(body: {
  name: string
  txn_category_id?: number | null
  txn_subcategory_id?: number | null
}) {
  return apiPostJson<BudgetCategoryOut>('/api/budgets/zbb/categories', body)
}

