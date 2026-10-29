import { apiDelete, apiGet, apiPatchJson, apiPostJson } from './client'
import type {
  BudgetCategoryIn,
  BudgetCategoryOut,
  ZbbAssignIn,
  ZbbMonthOut,
  ZbbMoveMoneyIn,
  ZbbQuickAssignIn,
  ZbbRolloverMode,
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

export function postZbbQuickAssign(params: { year: number; month: number; body: ZbbQuickAssignIn }) {
  return apiPostJson<ZbbMonthOut>(
    `/api/budgets/zbb/months/${params.year}/${params.month}/quick-assign`,
    params.body,
  )
}

export function patchZbbSettings(body: {
  rollover_mode?: ZbbRolloverMode
  clear_budget_start?: boolean
  budget_start_year?: number
  budget_start_month?: number
}) {
  return apiPatchJson<ZbbRolloverSettingOut>('/api/budgets/zbb/settings', body)
}

export function postZbbCategory(body: BudgetCategoryIn & { name: string }) {
  return apiPostJson<BudgetCategoryOut>('/api/budgets/zbb/categories', body)
}

/** Only the fields present in `body` change; send null to clear a mapping or target. */
export function patchZbbCategory(id: number, body: BudgetCategoryIn) {
  return apiPatchJson<BudgetCategoryOut>(`/api/budgets/zbb/categories/${id}`, body)
}

export function deleteZbbCategory(id: number) {
  return apiDelete(`/api/budgets/zbb/categories/${id}`)
}
