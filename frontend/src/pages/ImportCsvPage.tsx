import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { motion } from 'framer-motion'
import { Upload } from 'lucide-react'
import FeedbackDialog from '../components/FeedbackDialog'
import { apiGet, apiPostForm } from '../api/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'
import { getAccounts } from '../api/accounts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SortableTableHead } from '@/components/sortable-table-head'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { columnLooksNumeric, cycleSort, sortByColumn, type ColumnSortState } from '@/lib/tableSort'

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
  const [isDraggingFile, setIsDraggingFile] = useState(false)

  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackTitle, setFeedbackTitle] = useState('')
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [previewSort, setPreviewSort] = useState<ColumnSortState | null>(null)

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
  const previewKeys = useMemo(() => Object.keys(preview?.preview_rows[0] ?? {}), [preview])

  const sortedPreviewRows = useMemo(() => {
    if (!preview?.preview_rows?.length) return []
    const rows = preview.preview_rows as Record<string, unknown>[]
    const numeric =
      previewSort && columnLooksNumeric(rows, previewSort.key) ? [previewSort.key] : []
    return sortByColumn(rows, previewSort, numeric)
  }, [preview?.preview_rows, previewSort])

  useEffect(() => {
    setPreviewSort(null)
  }, [previewSignature])

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

  const acceptCsvFile = (f: File) => {
    const nameOk = f.name.toLowerCase().endsWith('.csv')
    const typeOk =
      f.type === 'text/csv' ||
      f.type === 'application/csv' ||
      f.type === 'application/vnd.ms-excel' ||
      f.type === ''
    if (nameOk || typeOk) setFile(f)
  }

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
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
      if (accountId != null) {
        queryClient.invalidateQueries({ queryKey: queryKeys.accountDetail(accountId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.accountSummary(accountId) })
      }
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
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h1 className="text-2xl font-semibold mb-1">Import CSV</h1>
        <p className="text-muted-foreground mb-8">Import transactions from your bank or card statement.</p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-base">Step 1 · Account</CardTitle>
                <CardDescription>Choose the account these transactions belong to.</CardDescription>
              </CardHeader>
              <CardContent>
                <Controller
                  control={control}
                  name="account_id"
                  render={({ field }) => (
                    <div className="space-y-2">
                      <Label>Account</Label>
                      <Select
                        value={field.value != null ? String(field.value) : ''}
                        onValueChange={(v) => field.onChange(Number(v))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select account" />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((a) => (
                            <SelectItem key={a.id} value={String(a.id)}>
                              {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-base">Step 2 · Format</CardTitle>
                <CardDescription>Pick a bank-specific parser or use the generic CSV adapter.</CardDescription>
              </CardHeader>
              <CardContent>
                <Controller
                  control={control}
                  name="adapter_name"
                  render={({ field }) => (
                    <div className="space-y-2">
                      <Label>Adapter</Label>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {adapters.map((a) => (
                            <SelectItem key={a} value={a}>
                              {a}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-base">Step 3 · File</CardTitle>
                <CardDescription>Upload your CSV file and preview parsed transactions.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <label
                  htmlFor="import-csv-file"
                  onDragEnter={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setIsDraggingFile(true)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setIsDraggingFile(false)
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setIsDraggingFile(false)
                    const dropped = e.dataTransfer.files?.[0]
                    if (dropped) acceptCsvFile(dropped)
                  }}
                  className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
                    isDraggingFile
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-muted/30 hover:bg-muted/50'
                  }`}
                >
                  <Upload className="h-10 w-10 text-muted-foreground/50 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">Choose CSV file</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">or drop here (click to browse)</p>
                  <input
                    id="import-csv-file"
                    type="file"
                    accept=".csv"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) setFile(f)
                    }}
                  />
                </label>
                {file ? <p className="text-sm text-muted-foreground">{file.name}</p> : null}

                {isGeneric && preview && preview.raw_columns.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Controller
                      control={control}
                      name="generic_date_col"
                      render={({ field }) => (
                        <div className="space-y-2">
                          <Label>Date column</Label>
                          <Select value={field.value || undefined} onValueChange={field.onChange}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {genericColumns.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    />
                    <Controller
                      control={control}
                      name="generic_amount_col"
                      render={({ field }) => (
                        <div className="space-y-2">
                          <Label>Amount column</Label>
                          <Select value={field.value || undefined} onValueChange={field.onChange}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {genericColumns.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    />
                    <Controller
                      control={control}
                      name="generic_merchant_col"
                      render={({ field }) => (
                        <div className="space-y-2">
                          <Label>Merchant column</Label>
                          <Select value={field.value || undefined} onValueChange={field.onChange}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {genericColumns.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-card min-h-[320px]">
            <CardHeader>
              <CardTitle className="text-base">Preview & import</CardTitle>
              <CardDescription>Live preview after file and options are set.</CardDescription>
            </CardHeader>
            <CardContent>
              {previewError ? <p className="text-sm text-destructive mb-4">{previewError}</p> : null}

              {preview ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium">Rows detected</p>
                    <p className="text-sm text-muted-foreground">{preview.rows_detected}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Date range</p>
                    <p className="text-sm text-muted-foreground">
                      {preview.inferred_date_range ? (
                        <>
                          {preview.inferred_date_range.min_date} → {preview.inferred_date_range.max_date}
                        </>
                      ) : (
                        'Not detected'
                      )}
                    </p>
                  </div>

                  <div className="max-h-[300px] overflow-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {previewKeys.map((k) => (
                            <SortableTableHead
                              key={k}
                              label={k}
                              columnKey={k}
                              sort={previewSort}
                              onSort={(key) => setPreviewSort((prev) => cycleSort(prev, key))}
                              className="text-xs"
                            />
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedPreviewRows.map((row, idx) => (
                          <TableRow key={idx}>
                            {previewKeys.map((k) => (
                              <TableCell key={k} className="text-xs">
                                {String(row[k] ?? '')}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {accountId ? (
                    <Button onClick={() => importMutation.mutate()} disabled={importMutation.isPending}>
                      Confirm import
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">Create/select an account first.</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Choose an account, format, and file to see a live preview here.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>

      <FeedbackDialog
        open={feedbackOpen}
        title={feedbackTitle}
        message={feedbackMessage}
        onClose={() => setFeedbackOpen(false)}
      />
    </div>
  )
}
