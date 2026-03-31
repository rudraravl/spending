export type ZbbCategoryRowOut = {
  category_id: number
  category_name: string
  assigned: number
  activity: number
  rollover: number
  available: number
  is_system?: boolean
  system_kind?: string | null
}

export type ZbbMonthOut = {
  year: number
  month: number
  rollover_mode: 'strict' | 'flexible' | string
  liquid_pool: number
  total_assigned: number
  ready_to_assign: number
  rows: ZbbCategoryRowOut[]
}

export type ZbbAssignIn = {
  category_id: number
  assigned: number
}

export type ZbbMoveMoneyIn = {
  from_category_id: number
  to_category_id: number
  amount: number
}

export type ZbbRolloverSettingOut = {
  rollover_mode: 'strict' | 'flexible' | string
}

export type BudgetCategoryOut = {
  id: number
  name: string
  is_system: boolean
  system_kind?: string | null
  linked_account_id?: number | null
  txn_category_id?: number | null
  txn_subcategory_id?: number | null
}

