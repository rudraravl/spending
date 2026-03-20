import { apiDelete, apiGet, apiPostJson } from './client'

export type Account = {
  id: number
  name: string
  type: string
  currency: string
}

export const getAccounts = () => apiGet<Account[]>('/api/accounts')

export const createAccount = (payload: { name: string; type: string; currency: string }) =>
  apiPostJson<Account>('/api/accounts', payload)

export const deleteAccount = (id: number) => apiDelete(`/api/accounts/${id}`)

