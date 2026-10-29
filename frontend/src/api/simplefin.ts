import { apiDelete, apiGet, apiPostJson } from './client'
import type { TransferMatchCandidate } from './transfers'

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
  connections: DiscoveredConnection[]
  errors: { code: string; message: string }[]
}

export interface DiscoveredConnection {
  conn_id: string
  name: string
  org_id: string
  org_url: string | null
  sfin_url: string | null
}

export interface LinkAccountPayload {
  conn_id: string
  account_id: string
  local_account_id: number
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
  imported_transaction_ids?: number[]
  /** Likely transfers involving this sync's new transactions. */
  transfer_candidates?: TransferMatchCandidate[]
}

export interface SimpleFINDailyBudget {
  connection_id: number
  used: number
  limit: number
  /** Set when the budget is exhausted: when the rolling 24h window frees a request. */
  next_available_at?: string | null
}

export interface CachedDiscoveryResponse extends DiscoveryResponse {
  captured_at: string | null
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export const listConnections = () =>
  apiGet<SimpleFINConnection[]>('/api/simplefin/connections')

export const claimConnection = (token: string, label?: string) =>
  apiPostJson<SimpleFINConnection>('/api/simplefin/connections/claim', { token, label })

export const deleteConnection = (id: number) =>
  apiDelete(`/api/simplefin/connections/${id}`)

export const discoverAccounts = (connectionId?: number | null) =>
  apiGet<DiscoveryResponse>(
    connectionId != null
      ? `/api/simplefin/discovery?connection_id=${connectionId}`
      : '/api/simplefin/discovery',
  )

export const getCachedAccounts = () =>
  apiGet<CachedDiscoveryResponse>('/api/simplefin/accounts-cached')

export const linkAccount = (payload: LinkAccountPayload) =>
  apiPostJson<LinkAccountResult>('/api/simplefin/accounts/link', payload)

export const unlinkAccount = (localAccountId: number) =>
  apiPostJson<LinkAccountResult>('/api/simplefin/accounts/unlink', { local_account_id: localAccountId })

export const triggerSync = (payload: SyncPayload) =>
  apiPostJson<SyncResult>('/api/simplefin/sync', payload)

export const getDailyBudget = (connectionId?: number | null) =>
  apiGet<SimpleFINDailyBudget>(
    connectionId != null
      ? `/api/simplefin/daily-budget?connection_id=${connectionId}`
      : '/api/simplefin/daily-budget',
  )
