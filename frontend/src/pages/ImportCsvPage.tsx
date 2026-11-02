import { useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { motion } from 'framer-motion'
import { CheckCircle2, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { TransferMatchCandidate } from '../api/transfers'
import { getImportAdapters, importCsv, previewCsv, type CsvImportResult, type CsvPreview } from '../api/imports'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidateTransactionData, queryKeys } from '../queryKeys'
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

import TransferMatchDialog, { type TransferReviewSummary } from '@/features/transfers/TransferMatchDialog'
import type { AccountOut } from '../types'
import PageHeader from '@/components/PageHeader'
import PageTip from '@/features/onboarding/PageTip'


const DEFAULT_ADAPTER = 'Bilt'

type ImportCsvFormValues = {
  account_id: number | null
  adapter_name: string
  generic_date_col: string
  generic_amount_col: string
  generic_merchant_col: string
}

type ImportOutcome = {
  account: AccountOut | null
  imported: number
  duplicates: number
  failed: number
  linked: number
}

const pluralize = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

export default function ImportCsvPage() {
  const queryClient = useQueryClient()

  const accountsQuery = useQuery<AccountOut[], Error>({
    queryKey: queryKeys.accounts(),
    queryFn: () => getAccounts(),
  })
  const adaptersQuery = useQuery<string[], Error>({
    queryKey: queryKeys.importAdapters(),
    queryFn: getImportAdapters,
  })

  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data])
  const adapters = useMemo(() => adaptersQuery.data ?? [], [adaptersQuery.data])

  const { control, watch, setValue } = useForm<ImportCsvFormValues>({
    defaultValues: {
      account_id: null,
      adapter_name: DEFAULT_ADAPTER,
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [importOutcome, setImportOutcome] = useState<ImportOutcome | null>(null)
  // Column sort for the preview table; tied to the preview it was chosen on.
  const [previewSortState, setPreviewSortState] = useState<{ signature: string; sort: ColumnSortState | null }>({
    signature: '',
    sort: null,
  })

  const [matchBatch, setMatchBatch] = useState<{ id: number; candidates: TransferMatchCandidate[] } | null>(null)

  const isGeneric = adapterName === 'Generic'

  const fileSignature = file ? `${file.name}|${file.size}|${file.lastModified}` : ''
  const previewSignature = fileSignature ? `${fileSignature}|${adapterName}` : ''

  const genericMappingComplete = Boolean(genericDateCol) && Boolean(genericAmountCol) && Boolean(genericMerchantCol)

  const previewQuery = useQuery<CsvPreview, Error>({
    queryKey: queryKeys.csvPreview(previewSignature),
    queryFn: async () => {
      if (!file) throw new Error('Choose a CSV file to preview.')

      // The preview is the raw file, which is where the Generic column choices
      // come from, so it can't depend on them. Import validates the mapping.
      const form = new FormData()
      form.append('file', file)
      form.append('adapter_name', adapterName)

      return previewCsv(form)
    },
    enabled: Boolean(file),
  })

  const preview = previewQuery.data ?? null
  const previewError = previewQuery.error?.message ?? null

  const genericColumns = useMemo(() => preview?.raw_columns ?? [], [preview])
  const previewKeys = useMemo(() => Object.keys(preview?.preview_rows[0] ?? {}), [preview])

  const previewSort = previewSortState.signature === previewSignature ? previewSortState.sort : null
  const setPreviewSort = (update: (prev: ColumnSortState | null) => ColumnSortState | null) =>
    setPreviewSortState({ signature: previewSignature, sort: update(previewSort) })

  const sortedPreviewRows = useMemo(() => {
    if (!preview?.preview_rows?.length) return []
    const rows = preview.preview_rows as Record<string, unknown>[]
    const numeric =
      previewSort && columnLooksNumeric(rows, previewSort.key) ? [previewSort.key] : []
    return sortByColumn(rows, previewSort, numeric)
  }, [preview, previewSort])

  useEffect(() => {
    if (accountId != null) return
    if (accounts.length === 0) return
    const bilt = accounts.find((a) => a.name.toLowerCase().includes('bilt'))
    setValue('account_id', (bilt ?? accounts[0]).id)
  }, [accounts, accountId, setValue])

  const acceptCsvFile = (f: File) => {
    const nameOk = f.name.toLowerCase().endsWith('.csv')
    const typeOk =
      f.type === 'text/csv' ||
      f.type === 'application/csv' ||
      f.type === 'application/vnd.ms-excel' ||
      f.type === ''
    const accepted = nameOk || typeOk
    if (accepted) {
      setFile(f)
      setValue('generic_date_col', '')
      setValue('generic_amount_col', '')
      setValue('generic_merchant_col', '')
      setImportOutcome(null)
      importMutation.reset()
    }
    return accepted
  }

  const importMutation = useMutation({
    mutationFn: async (): Promise<CsvImportResult> => {
      if (!file) throw new Error('Choose a CSV file first.')
      if (!accountId) throw new Error('Select an account first.')

      if (isGeneric && !genericMappingComplete) {
        throw new Error('Please select Generic mapping columns.')
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

      return importCsv(form)
    },
    onSuccess: (res) => {
      void invalidateTransactionData(queryClient)

      const duplicates = res.skipped.filter((row) => row.reason === 'duplicate').length
      setImportOutcome({
        account: accounts.find((a) => a.id === accountId) ?? null,
        imported: res.num_imported,
        duplicates,
        failed: res.skipped.length - duplicates,
        linked: 0,
      })

      // The file is consumed: clear it so the preview gives way to the result.
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''

      const candidates = res.transfer_match_candidates ?? []
      if (candidates.length > 0) {
        setMatchBatch({ id: Date.now(), candidates })
      }
    },
  })

  const finishTransferReview = (review: TransferReviewSummary) => {
    setMatchBatch(null)
    setImportOutcome((prev) => (prev ? { ...prev, linked: review.linked } : prev))
  }

  const importError = importMutation.error?.message ?? null

  return (
    <div className="page">
      <PageHeader title="Import CSV" description="Import transactions from a bank or card statement." />
      <PageTip id="import" />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>

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
                    ref={fileInputRef}
                    id="import-csv-file"
                    type="file"
                    accept=".csv"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      const accepted = acceptCsvFile(f)
                      if (!accepted) {
                        setFile(null)
                        e.currentTarget.value = ''
                      }
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
              {importError ? <p className="text-sm text-destructive mb-4">{importError}</p> : null}

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
                    <div className="space-y-2">
                      {isGeneric && !genericMappingComplete ? (
                        <p className="text-sm text-muted-foreground">
                          Choose the date, amount, and merchant columns to import.
                        </p>
                      ) : null}
                      <Button
                        onClick={() => importMutation.mutate()}
                        disabled={importMutation.isPending || (isGeneric && !genericMappingComplete)}
                      >
                        {importMutation.isPending ? 'Importing…' : 'Confirm import'}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Create/select an account first.</p>
                  )}
                </div>
              ) : importOutcome ? (
                <div className="space-y-4" role="status">
                  <div className="flex items-start gap-3">
                    <CheckCircle2
                      className={`h-5 w-5 shrink-0 mt-0.5 ${importOutcome.imported > 0 ? 'text-income' : 'text-muted-foreground'}`}
                    />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        {importOutcome.imported > 0
                          ? `Imported ${pluralize(importOutcome.imported, 'transaction')}${
                              importOutcome.account ? ` to ${importOutcome.account.name}` : ''
                            }`
                          : 'No new transactions to import'}
                      </p>
                      {importOutcome.duplicates > 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Skipped {pluralize(importOutcome.duplicates, 'duplicate row')}.
                        </p>
                      ) : null}
                      {importOutcome.failed > 0 ? (
                        <p className="text-sm text-destructive">
                          Couldn't import {pluralize(importOutcome.failed, 'row')}.
                        </p>
                      ) : null}
                      {importOutcome.linked > 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Linked {pluralize(importOutcome.linked, 'transfer')}.
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {importOutcome.account ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/accounts/${importOutcome.account.id}`}>View {importOutcome.account.name}</Link>
                    </Button>
                  ) : null}
                  <p className="text-sm text-muted-foreground">Choose another file to keep importing.</p>
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

      {matchBatch ? (
        <TransferMatchDialog
          key={matchBatch.id}
          candidates={matchBatch.candidates}
          source="import"
          onClose={finishTransferReview}
        />
      ) : null}
    </div>
  )
}
