export type BudgetLimitOut = {
  id: number
  budget_month_id: number
  category_id: number
  category_name?: string | null
  subcategory_id?: number | null
  subcategory_name?: string | null
  limit_amount: number
}

export type BudgetMonthOut = {
  id: number
  month_start: string // YYYY-MM-DD
  limits: BudgetLimitOut[]
}

export type BudgetLimitUpsertIn = {
  category_id: number
  subcategory_id?: number | null
  limit_amount: number
}

export type BudgetProgressSubcategoryOut = {
  category_id: number
  subcategory_id: number
  subcategory_name: string
  limit_amount: number
  spent_amount: number
  remaining_amount: number
  percent_used: number
  projected_spent_amount: number
}

export type BudgetProgressCategoryOut = {
  category_id: number
  category_name: string
  limit_amount: number
  allocated_to_subcategories: number
  unallocated_amount: number
  spent_amount: number
  remaining_amount: number
  percent_used: number
  projected_spent_amount: number
  subcategories: BudgetProgressSubcategoryOut[]
}

export type BudgetProgressOut = {
  month_start: string // YYYY-MM-DD
  include_projected: boolean
  categories: BudgetProgressCategoryOut[]
}

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

