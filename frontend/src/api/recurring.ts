import { apiGet, apiPostJson, apiPostJsonNoContent } from './client'
import type {
  RecurringOccurrenceOut,
  RecurringSeriesActionIn,
  RecurringSeriesBulkCategoryUpdateIn,
  RecurringSeriesCardOut,
} from '@/types/recurring'

export const getRecurringSuggestions = () =>
  apiGet<RecurringSeriesCardOut[]>('/api/recurring/suggestions')

/** Re-run recurring detection across all accounts (outflows on every account type). */
export const scanRecurringCharges = () =>
  apiPostJson<RecurringSeriesCardOut[]>('/api/recurring/scan', {})

export const confirmRecurringSeries = (payload: RecurringSeriesActionIn) =>
  apiPostJsonNoContent('/api/recurring/series/confirm', payload)

export const ignoreRecurringSeries = (payload: RecurringSeriesActionIn) =>
  apiPostJsonNoContent('/api/recurring/series/ignore', payload)

export const removeRecurringSeries = (payload: RecurringSeriesActionIn) =>
  apiPostJsonNoContent('/api/recurring/series/remove', payload)

export const getRecurringSeriesOccurrences = (payload: RecurringSeriesActionIn) =>
  apiPostJson<RecurringOccurrenceOut[]>('/api/recurring/series/occurrences', payload)

export const bulkUpdateRecurringSeriesCategory = (payload: RecurringSeriesBulkCategoryUpdateIn) =>
  apiPostJsonNoContent('/api/recurring/series/bulk-category', payload)

