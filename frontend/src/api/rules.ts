import { apiDelete, apiGet, apiPatchJson, apiPostJson } from './client'

export type RuleMeta = { allowed_fields: string[]; allowed_operators: string[] }

export type Rule = {
  id: number
  priority: number
  field: string
  operator: string
  value: string
  category_id: number
  subcategory_id: number
}

export type RuleIn = Omit<Rule, 'id'>

export const getRules = () => apiGet<Rule[]>('/api/rules')

export const getRuleMeta = () => apiGet<RuleMeta>('/api/rules/meta')

export const createRule = (body: RuleIn) => apiPostJson<Rule>('/api/rules', body)

export const updateRule = (id: number, body: RuleIn) => apiPatchJson<Rule>(`/api/rules/${id}`, body)

export const deleteRule = (id: number) => apiDelete(`/api/rules/${id}`)
