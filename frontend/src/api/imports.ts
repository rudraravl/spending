import { apiGet, apiPostForm } from './client'
import type { TransferMatchCandidate } from './transfers'

export type CsvPreview = {
  rows_detected: number
  raw_columns: string[]
  preview_rows: Array<Record<string, object>>
  inferred_date_range: { min_date: string; max_date: string } | null
}

export type CsvImportResult = {
  num_imported: number
  skipped: Array<{ date?: string; amount?: number; merchant?: string; reason?: string }>
  imported_transaction_ids: number[]
  transfer_match_candidates: TransferMatchCandidate[]
}

export const getImportAdapters = () => apiGet<string[]>('/api/import/adapters')

export const previewCsv = (form: FormData) => apiPostForm<CsvPreview>('/api/import/preview', form)

export const importCsv = (form: FormData) => apiPostForm<CsvImportResult>('/api/import/csv', form)
