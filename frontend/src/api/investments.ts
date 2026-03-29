import { apiDelete, apiGet, apiPatchJson, apiPostJson } from './client'

export type InvestmentAllocationRow = {
  symbol: string
  market_value: number
  shares: number
  cost_basis: number | null
  gain_pct: number | null
  percent_of_grand_total: number | null
}

export type InvestmentAccountSummaryRow = {
  account_id: number
  name: string
  institution_name: string | null
  currency: string
  total_value: number
  cash_balance: number | null
  positions_count: number
  unknown_on_account: number
  last_snapshot_at: string | null
}

export type InvestmentsSummary = {
  grand_total: number
  total_cash: number
  accounts: InvestmentAccountSummaryRow[]
  allocation: InvestmentAllocationRow[]
  day_change_pct: number | null
}

export type InvestmentHistoryPoint = {
  captured_at: string | null
  total_value: number
  cash_balance: number
  positions_value: number
  currency: string
}

export type PortfolioHolding = {
  external_holding_id: string
  symbol: string | null
  description: string | null
  shares: number
  market_value: number
  cost_basis: number | null
  purchase_price: number | null
  currency: string
  gain_pct: number | null
}

export type PortfolioActivityRow = {
  transaction_id: number
  date: string | null
  amount: number
  merchant: string
  is_transfer: boolean
  kind: string | null
  parsed_symbol: string | null
  confidence: string | null
}

export type PortfolioDetail = {
  account: {
    id: number
    name: string
    type: string
    currency: string
    institution_name: string | null
  }
  latest_snapshot: {
    captured_at: string | null
    reported_balance: number
    positions_value: number
    cash_balance: number
    currency: string
    reconciliation_residual: number
  } | null
  totals: {
    total_value: number
    cash_balance: number
    positions_value: number
  }
  holdings: PortfolioHolding[]
  manual_positions: {
    id: number
    symbol: string | null
    quantity: number
    cost_basis_total: number | null
    as_of_date: string | null
    notes: string | null
  }[]
  activity: PortfolioActivityRow[]
}

export type ManualPositionCreate = {
  symbol?: string | null
  quantity: number
  cost_basis_total?: number | null
  as_of_date: string
  notes?: string | null
}

export type ManualPositionOut = {
  id: number
  account_id: number
  symbol: string | null
  quantity: number
  cost_basis_total: number | null
  as_of_date: string
  notes: string | null
}

export function getInvestmentsSummary() {
  return apiGet<InvestmentsSummary>('/api/investments/summary')
}

export function getPortfolio(accountId: number) {
  return apiGet<PortfolioDetail>(`/api/investments/accounts/${accountId}/portfolio`)
}

export function getPortfolioHistory(accountId: number, limit = 365) {
  return apiGet<InvestmentHistoryPoint[]>(
    `/api/investments/accounts/${accountId}/history?limit=${limit}`,
  )
}

export function createManualPosition(accountId: number, body: ManualPositionCreate) {
  return apiPostJson<ManualPositionOut>(
    `/api/investments/accounts/${accountId}/manual-positions`,
    body,
  )
}

export function updateManualPosition(
  accountId: number,
  positionId: number,
  body: Partial<ManualPositionCreate>,
) {
  return apiPatchJson<ManualPositionOut>(
    `/api/investments/accounts/${accountId}/manual-positions/${positionId}`,
    body,
  )
}

export function deleteManualPosition(accountId: number, positionId: number) {
  return apiDelete(`/api/investments/accounts/${accountId}/manual-positions/${positionId}`)
}

export function reclassifyInvestmentTxns(body: { account_id?: number | null } = {}) {
  return apiPostJson<{ updated_count: number }>('/api/investments/reclassify', body)
}
