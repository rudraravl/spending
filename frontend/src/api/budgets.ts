import { apiGet, apiPatchJson, apiPostJson } from './client'
import type {
  BudgetCategoryOut,
  ZbbAssignIn,
  ZbbMonthOut,
  ZbbMoveMoneyIn,
  ZbbRolloverSettingOut,
} from '@/types'

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

