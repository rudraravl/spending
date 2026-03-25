import { apiGet, apiPostJsonNoContent } from './client'
import type { RecurringSeriesActionIn, RecurringSeriesCardOut } from '@/types/recurring'

export const getRecurringSuggestions = () =>
  apiGet<RecurringSeriesCardOut[]>('/api/recurring/suggestions')

export const confirmRecurringSeries = (payload: RecurringSeriesActionIn) =>
  apiPostJsonNoContent('/api/recurring/series/confirm', payload)

export const ignoreRecurringSeries = (payload: RecurringSeriesActionIn) =>
  apiPostJsonNoContent('/api/recurring/series/ignore', payload)

export const removeRecurringSeries = (payload: RecurringSeriesActionIn) =>
  apiPostJsonNoContent('/api/recurring/series/remove', payload)

