import { apiGet } from './client'

export type DashboardRange = 'this_month' | 'last_month' | 'year' | 'custom'

export type DashboardCategoryRow = {
  category_id: number
  category: string
  total: number
  count: number
  percent: number
}

export type DashboardSubcategoryRow = DashboardCategoryRow & { subcategory: string }

export type DashboardTrendPoint = { date: string; spending: number; credits: number }

/** Estimated net worth at the end of one local calendar day. */
export type NetWorthPoint = {
  date: string
  total_value: number
  currency: string
  mixed_currencies: boolean
  accounts_count: number
}

export type DashboardRecentRow = {
  id: number
  Date: string
  Merchant: string
  Amount: number
  Category: string
  Subcategory: string
  Acct: string
  is_transfer: boolean
}

export type DashboardResponse = {
  range: string
  start_date: string
  end_date: string
  total_spending: number
  total_income: number
  by_category: DashboardCategoryRow[]
  by_subcategory: DashboardSubcategoryRow[]
  spending_over_time: DashboardTrendPoint[]
  net_worth_over_time: NetWorthPoint[]
  recent_transactions: DashboardRecentRow[]
}

export function getDashboard(range: DashboardRange, customStart: string, customEnd: string) {
  const p = new URLSearchParams()
  p.set('range', range)
  if (range === 'custom') {
    p.set('start_date', customStart)
    p.set('end_date', customEnd)
  }
  return apiGet<DashboardResponse>(`/api/dashboard?${p.toString()}`)
}
