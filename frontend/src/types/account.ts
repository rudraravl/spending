export interface AccountOut {
  id: number
  name: string
  type: string
  currency: string
  created_at?: string | null
  is_linked?: boolean
  provider?: string | null
  external_id?: string | null
  institution_name?: string | null
  last_synced_at?: string | null
}

/** Response from GET /api/accounts/{id}/summary */
export interface AccountSummaryOut {
  account_id: number
  balance: number
}

