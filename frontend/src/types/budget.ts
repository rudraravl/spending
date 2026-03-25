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

