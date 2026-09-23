import { apiGet } from './client'
import type { NetWorthPoint } from './dashboard'

/** A row of a tag / category / subcategory spend breakdown. */
export type BreakdownRow = {
  total: number
  count?: number
  percent: number
  tag?: string
  category?: string
  subcategory?: string
  category_id?: number
}

export type CumPoint = { day_of_month: number; this_month: number | null; last_month: number | null }

export type ReportsMonthlyResponse = {
  year: number
  month: number
  start_date: string
  end_date: string
  prev_month_year: number
  prev_month: number
  total_spending: number
  total_income: number
  avg_transaction_amount: number
  transaction_count: number
  savings_rate_pct: number | null
  cumulative_comparison: CumPoint[]
  by_tag: BreakdownRow[]
  by_category: BreakdownRow[]
  by_subcategory: BreakdownRow[]
}

export type NetWorthHistoryResponse = {
  start_date: string
  end_date: string
  net_worth_over_time: NetWorthPoint[]
}

export function getMonthlyReport(year: number, month: number) {
  return apiGet<ReportsMonthlyResponse>(`/api/reports/monthly?year=${year}&month=${month}`)
}

export function getNetWorthHistory(startDate: string, endDate: string) {
  const p = new URLSearchParams({ start_date: startDate, end_date: endDate })
  return apiGet<NetWorthHistoryResponse>(`/api/reports/net-worth?${p.toString()}`)
}
