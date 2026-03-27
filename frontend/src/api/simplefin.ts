import { apiDelete, apiGet, apiPatchJson, apiPostJson } from './client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SimpleFINConnection {
  id: number
  label: string
  status: string
  last_synced_at: string | null
  last_error: string | null
  created_at: string | null
}

export interface DiscoveredAccount {
  conn_id: string
  conn_name: string
  account_id: string
  name: string
  currency: string
  balance: number
  balance_date: number
  local_account_id: number | null
}

export interface DiscoveryResponse {
  accounts: DiscoveredAccount[]
  errors: { code: string; message: string }[]
}

export interface LinkAccountPayload {
  connection_id: number
  conn_id: string
  account_id: string
  local_name: string
  local_type: string
  currency?: string
  institution_name?: string
}

export interface LinkAccountResult {
  account_id: number
  name: string
  type: string
  is_linked: boolean
}

export interface SyncPayload {
  connection_id?: number | null
  start_date?: string | null
  // Matches SimpleFIN `end-date`: exclusive upper bound (before, not on, this date).
  end_date?: string | null
  include_pending?: boolean
  lookback_days?: number
}

export interface SyncResult {
  accounts_synced: number
  transactions_imported: number
  errors: string[] | null
}

export interface SyncRun {
  id: number
  connection_id: number
  started_at: string | null
  finished_at: string | null
  status: string
  accounts_synced: number | null
  transactions_imported: number | null
  error_message: string | null
}

export interface SimpleFINDailyBudget {
  connection_id: number
  used: number
  limit: number
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export const listConnections = () =>
  apiGet<SimpleFINConnection[]>('/api/simplefin/connections')

export const claimConnection = (token: string, label?: string) =>
  apiPostJson<SimpleFINConnection>('/api/simplefin/connections/claim', { token, label })

export const updateConnection = (id: number, payload: { label?: string; status?: string }) =>
  apiPatchJson<SimpleFINConnection>(`/api/simplefin/connections/${id}`, payload)

export const deleteConnection = (id: number) =>
  apiDelete(`/api/simplefin/connections/${id}`)

export const discoverAccounts = (connectionId: number) =>
  apiGet<DiscoveryResponse>(`/api/simplefin/discovery?connection_id=${connectionId}`)

export const linkAccount = (payload: LinkAccountPayload) =>
  apiPostJson<LinkAccountResult>('/api/simplefin/accounts/link', payload)

export const triggerSync = (payload: SyncPayload) =>
  apiPostJson<SyncResult>('/api/simplefin/sync', payload)

export const getSyncRuns = (connectionId: number, limit = 20) =>
  apiGet<SyncRun[]>(`/api/simplefin/sync-runs?connection_id=${connectionId}&limit=${limit}`)

export const getDailyBudget = (connectionId: number) =>
  apiGet<SimpleFINDailyBudget>(`/api/simplefin/daily-budget?connection_id=${connectionId}`)
