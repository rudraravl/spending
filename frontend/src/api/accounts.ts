import { apiDelete, apiGet, apiPatchJson, apiPostJson } from './client'

import type { AccountOut, AccountSummaryOut } from '../types'

export type Account = AccountOut

export const getAccounts = () => apiGet<Account[]>('/api/accounts')

export const getAccount = (id: number) => apiGet<AccountOut>(`/api/accounts/${id}`)

export const getAccountSummary = (id: number) => apiGet<AccountSummaryOut>(`/api/accounts/${id}/summary`)

export const createAccount = (payload: { name: string; type: string; currency: string }) =>
  apiPostJson<Account>('/api/accounts', payload)

export const deleteAccount = (id: number) => apiDelete(`/api/accounts/${id}`)

export const patchAccount = (
  id: number,
  body: { type?: string; is_robinhood_crypto?: boolean; is_budget_account?: boolean },
) =>
  apiPatchJson<AccountOut>(`/api/accounts/${id}`, body)

