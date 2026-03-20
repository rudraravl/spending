import { useEffect, useMemo, useState } from 'react'
import { Button, MenuItem, TextField } from '@mui/material'
import { Controller, useForm } from 'react-hook-form'
import PageHeader from '../components/PageHeader'
import FeedbackDialog from '../components/FeedbackDialog'
import { apiGet, apiPostForm } from '../api/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'
import { getAccounts } from '../api/accounts'

import type { AccountOut } from '../types'

type CsvPreview = {
  rows_detected: number
  raw_columns: string[]
  preview_rows: Array<Record<string, object>>
  inferred_date_range: { min_date: string; max_date: string } | null
}

type CsvImportResult = {
  num_imported: number
  skipped: Array<{ date?: string; amount?: number; merchant?: string; reason?: string }>
}

type ImportCsvFormValues = {
  account_id: number | null
  adapter_name: string
  generic_date_col: string
  generic_amount_col: string
  generic_merchant_col: string
}

export default function ImportCsvPage() {
  const queryClient = useQueryClient()

  const accountsQuery = useQuery<AccountOut[], Error>({
    queryKey: queryKeys.accounts(),
    queryFn: () => getAccounts(),
  })
  const adaptersQuery = useQuery<string[], Error>({
    queryKey: queryKeys.importAdapters(),
    queryFn: () => apiGet<string[]>('/api/import/adapters'),
  })

  const accounts = accountsQuery.data ?? []
  const adapters = adaptersQuery.data ?? []

  const { control, watch, setValue } = useForm<ImportCsvFormValues>({
    defaultValues: {
      account_id: null,
      adapter_name: 'Wells',
      generic_date_col: '',
      generic_amount_col: '',
      generic_merchant_col: '',
    },
  })
  const accountId = watch('account_id')
  const adapterName = watch('adapter_name')
  const genericDateCol = watch('generic_date_col')
  const genericAmountCol = watch('generic_amount_col')
  const genericMerchantCol = watch('generic_merchant_col')

  const [file, setFile] = useState<File | null>(null)

  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackTitle, setFeedbackTitle] = useState('')
  const [feedbackMessage, setFeedbackMessage] = useState('')

  const isGeneric = adapterName === 'Generic'

  const fileSignature = file ? `${file.name}|${file.size}|${file.lastModified}` : ''
  const previewSignature = fileSignature
    ? `${fileSignature}|${adapterName}|${genericDateCol}|${genericAmountCol}|${genericMerchantCol}`
    : ''

  const previewEnabled =
    Boolean(file) && (!isGeneric || (Boolean(genericDateCol) && Boolean(genericAmountCol) && Boolean(genericMerchantCol)))

  const previewQuery = useQuery<CsvPreview, Error>({
    queryKey: queryKeys.csvPreview(previewSignature),
    queryFn: async () => {
      if (!file) throw new Error('Choose a CSV file to preview.')

      if (isGeneric) {
        if (!genericDateCol || !genericAmountCol || !genericMerchantCol) {
          throw new Error('Please select Generic mapping columns.')
        }
      }

      const form = new FormData()
      form.append('file', file)
      form.append('adapter_name', adapterName)
      if (isGeneric) {
        form.append('date_col', genericDateCol)
        form.append('amount_col', genericAmountCol)
        form.append('merchant_col', genericMerchantCol)
      }

      return apiPostForm<CsvPreview>('/api/import/preview', form)
    },
    enabled: previewEnabled,
  })

  const preview = previewQuery.data ?? null
  const previewError = previewQuery.error?.message ?? null

  const genericColumns = useMemo(() => preview?.raw_columns ?? [], [preview])

  useEffect(() => {
    if (accountId != null) return
    if (accounts.length === 0) return
    setValue('account_id', accounts[0].id)
  }, [accounts, accountId, setValue])

  useEffect(() => {
    if (adapters.includes('Generic')) {
      setValue('adapter_name', 'Generic')
    }
  }, [adapters, setValue])

  const importMutation = useMutation({
    mutationFn: async (): Promise<CsvImportResult> => {
      if (!file) throw new Error('Choose a CSV file first.')
      if (!accountId) throw new Error('Select an account first.')

      if (isGeneric) {
        if (!genericDateCol || !genericAmountCol || !genericMerchantCol) {
          throw new Error('Please select Generic mapping columns.')
        }
      }

      const form = new FormData()
      form.append('file', file)
      form.append('account_id', String(accountId))
      form.append('adapter_name', adapterName)
      if (isGeneric) {
        form.append('date_col', genericDateCol)
        form.append('amount_col', genericAmountCol)
        form.append('merchant_col', genericMerchantCol)
      }

      return apiPostForm<CsvImportResult>('/api/import/csv', form)
    },
    onSuccess: (res) => {
      const lines = [`Imported ${res.num_imported} transactions.`]
      if (res.skipped.length > 0) lines.push(`Skipped ${res.skipped.length} duplicate rows.`)
      setFeedbackTitle('Import complete')
      setFeedbackMessage(lines.join('\n'))
      setFeedbackOpen(true)
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['views'] })
      queryClient.invalidateQueries({ queryKey: ['summaries'] })
    },
    onError: (e: unknown) => {
      setFeedbackTitle('Import failed')
      setFeedbackMessage(e instanceof Error ? e.message : 'Import failed')
      setFeedbackOpen(true)
    },
  })

  return (
    <div className="sp-page">
      <PageHeader
        icon="📥"
        title="Import CSV"
        subtitle="Bring in transactions from your bank or card statements."
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Step 1 · Account</div>
          <Controller
            control={control}
            name="account_id"
            render={({ field }) => (
              <TextField
                select
                label="Account"
                value={field.value ?? ''}
                onChange={(e) => field.onChange(Number(e.target.value))}
                fullWidth
                sx={{ marginBottom: 2 }}
              >
                {accounts.map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />

          <div style={{ fontWeight: 700, margin: '16px 0 8px' }}>Step 2 · Format</div>
          <Controller
            control={control}
            name="adapter_name"
            render={({ field }) => (
              <TextField
                select
                label="Adapter"
                value={field.value}
                onChange={field.onChange}
                fullWidth
                sx={{ marginBottom: 2 }}
              >
                {adapters.map((a) => (
                  <MenuItem key={a} value={a}>
                    {a}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />

          <div style={{ fontWeight: 700, margin: '16px 0 8px' }}>Step 3 · File</div>
          <Button component="label" variant="outlined" sx={{ display: 'block', mb: 1 }}>
            Choose CSV file
            <input
              type="file"
              accept=".csv"
              hidden
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Button>
          {file ? <div style={{ fontSize: 14, opacity: 0.85 }}>{file.name}</div> : null}

          {isGeneric && preview && preview.raw_columns.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Generic column mapping</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <Controller
                  control={control}
                  name="generic_date_col"
                  render={({ field }) => (
                    <TextField
                      select
                      label="Date column"
                      value={field.value}
                      onChange={field.onChange}
                      fullWidth
                    >
                      <MenuItem value="" disabled>
                        Select
                      </MenuItem>
                      {genericColumns.map((c) => (
                        <MenuItem key={c} value={c}>
                          {c}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
                <Controller
                  control={control}
                  name="generic_amount_col"
                  render={({ field }) => (
                    <TextField
                      select
                      label="Amount column"
                      value={field.value}
                      onChange={field.onChange}
                      fullWidth
                    >
                      <MenuItem value="" disabled>
                        Select
                      </MenuItem>
                      {genericColumns.map((c) => (
                        <MenuItem key={c} value={c}>
                          {c}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
                <Controller
                  control={control}
                  name="generic_merchant_col"
                  render={({ field }) => (
                    <TextField
                      select
                      label="Merchant column"
                      value={field.value}
                      onChange={field.onChange}
                      fullWidth
                    >
                      <MenuItem value="" disabled>
                        Select
                      </MenuItem>
                      {genericColumns.map((c) => (
                        <MenuItem key={c} value={c}>
                          {c}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Preview & import</div>
          {previewError ? (
            <div style={{ color: 'crimson' }}>{previewError}</div>
          ) : null}

          {preview ? (
            <div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>Rows detected</div>
                <div>{preview.rows_detected}</div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>Date range</div>
                <div>
                  {preview.inferred_date_range ? (
                    <>
                      {preview.inferred_date_range.min_date} → {preview.inferred_date_range.max_date}
                    </>
                  ) : (
                    'Not detected'
                  )}
                </div>
              </div>

              <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {Object.keys(preview.preview_rows[0] ?? {}).map((k) => (
                        <th key={k} style={{ padding: 8, borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview_rows.map((row, idx) => (
                      <tr key={idx}>
                        {Object.keys(preview.preview_rows[0] ?? {}).map((k) => (
                          <td key={k} style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                            {String((row as Record<string, unknown>)[k] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {accountId ? (
                <Button
                  variant="contained"
                  sx={{ marginTop: 1.5 }}
                  onClick={() => importMutation.mutate()}
                  disabled={importMutation.isPending}
                >
                  Confirm import
                </Button>
              ) : (
                <div style={{ marginTop: 10 }}>Create/select an account first.</div>
              )}
            </div>
          ) : (
            <div>Choose an account, format, and file to see a live preview here.</div>
          )}
        </div>
      </div>

      <FeedbackDialog
        open={feedbackOpen}
        title={feedbackTitle}
        message={feedbackMessage}
        onClose={() => setFeedbackOpen(false)}
      />
    </div>
  )
}
