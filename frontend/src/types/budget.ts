export type ZbbCategoryRowOut = {
  category_id: number
  category_name: string
  txn_category_id: number | null
  txn_subcategory_id: number | null
  txn_category_name: string | null
  txn_subcategory_name: string | null
  /** Positive balance carried in from last month (negative only in "carry overspending" mode). */
  rollover: number
  assigned: number
  /** Signed net of transactions: spending is negative, refunds positive. */
  activity: number
  available: number
  target: number | null
  underfunded: number
  last_month_assigned: number
  avg_spent: number
}

export type ZbbAccountOut = {
  id: number
  name: string
  type: string
  balance: number
}

export type ZbbMonthTotalsOut = {
  assigned: number
  activity: number
  available: number
  income: number
  /** Signed net of spending in categories with no envelope (negative = spent). */
  unbudgeted: number
  overspent: number
  overspent_count: number
  underfunded: number
  /** Flexible mode: last month's overspending that reset to $0 and came out of Ready to Assign. */
  reset_overspending: number
  uncategorized_count: number
}

export type ZbbUnbudgetedOut = {
  txn_category_id: number | null
  txn_category_name: string
  amount: number
}

export type ZbbRolloverMode = 'strict' | 'flexible'

export type ZbbMonthOut = {
  year: number
  month: number
  rollover_mode: ZbbRolloverMode
  budget_start_year: number
  budget_start_month: number
  budget_start_is_set: boolean
  is_before_budget_start: boolean
  horizon_year: number
  horizon_month: number
  ready_to_assign: number
  cash_on_budget: number
  accounts: ZbbAccountOut[]
  totals: ZbbMonthTotalsOut
  unbudgeted: ZbbUnbudgetedOut[]
  rows: ZbbCategoryRowOut[]
}

export type ZbbAssignIn = {
  category_id: number
  assigned: number
}

/** null on either side means Ready to Assign. */
export type ZbbMoveMoneyIn = {
  from_category_id: number | null
  to_category_id: number | null
  amount: number
}

export type ZbbQuickAssignStrategy = 'targets' | 'last_month' | 'avg_spent' | 'clear'

export type ZbbQuickAssignIn = {
  strategy: ZbbQuickAssignStrategy
  category_ids?: number[] | null
}

export type ZbbRolloverSettingOut = {
  rollover_mode: ZbbRolloverMode
  budget_start_year?: number | null
  budget_start_month?: number | null
}

export type BudgetCategoryOut = {
  id: number
  name: string
  is_system: boolean
  system_kind?: string | null
  linked_account_id?: number | null
  txn_category_id?: number | null
  txn_subcategory_id?: number | null
  txn_category_name?: string | null
  txn_subcategory_name?: string | null
  monthly_target?: number | null
}

export type BudgetCategoryIn = {
  name?: string
  txn_category_id?: number | null
  txn_subcategory_id?: number | null
  monthly_target?: number | null
}
