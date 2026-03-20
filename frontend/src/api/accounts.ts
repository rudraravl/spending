import { apiDelete, apiGet, apiPostJson } from './client'

import type { AccountOut } from '../types'

export type Account = AccountOut

export const getAccounts = () => apiGet<Account[]>('/api/accounts')

export const createAccount = (payload: { name: string; type: string; currency: string }) =>
  apiPostJson<Account>('/api/accounts', payload)

export const deleteAccount = (id: number) => apiDelete(`/api/accounts/${id}`)

