export type RecurringOccurrenceOut = {
  transaction_id: number
  date: string
  amount: number
  merchant: string
  category_id: number | null
  category_name: string | null
  subcategory_id: number | null
  subcategory_name: string | null
}

export type RecurringSeriesCardOut = {
  merchant_norm: string
  display_name: string | null
  amount_anchor_cents: number
  amount_anchor: number
  status: string
  cadence_type: string | null
  cadence_days: number | null
  category_id: number | null
  subcategory_id: number | null
  occurrences: RecurringOccurrenceOut[]
}

export type RecurringSeriesActionIn = {
  merchant_norm: string
  amount_anchor_cents: number
}

export type RecurringSeriesBulkCategoryUpdateIn = RecurringSeriesActionIn & {
  category_id: number
  subcategory_id: number
}

