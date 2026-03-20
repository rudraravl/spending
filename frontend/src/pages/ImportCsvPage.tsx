import { useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/PageHeader'
import { apiGet, apiPostForm } from '../api/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'
import { getAccounts } from '../api/accounts'

type Account = { id: number; name: string; type: string; currency: string }

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

export default function ImportCsvPage() {
  const queryClient = useQueryClient()

  const accountsQuery = useQuery<Account[], Error>({
    queryKey: queryKeys.accounts(),
    queryFn: () => getAccounts(),
  })
  const adaptersQuery = useQuery<string[], Error>({
    queryKey: queryKeys.importAdapters(),
    queryFn: () => apiGet<string[]>('/api/import/adapters'),
  })

  const accounts = accountsQuery.data ?? []
  const adapters = adaptersQuery.data ?? []

  const [accountId, setAccountId] = useState<number | null>(null)
  const [adapterName, setAdapterName] = useState<string>('Wells')

  const [file, setFile] = useState<File | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState<string | null>(null)

  // Generic mapping
  const [genericDateCol, setGenericDateCol] = useState<string | null>(null)
  const [genericAmountCol, setGenericAmountCol] = useState<string | null>(null)
  const [genericMerchantCol, setGenericMerchantCol] = useState<string | null>(null)

  const isGeneric = adapterName === 'Generic'

  const fileSignature = file ? `${file.name}|${file.size}|${file.lastModified}` : ''
  const previewSignature = fileSignature
    ? `${fileSignature}|${adapterName}|${genericDateCol ?? ''}|${genericAmountCol ?? ''}|${genericMerchantCol ?? ''}`
    : ''

  const previewEnabled =
    Boolean(file) && (!isGeneric || (genericDateCol != null && genericAmountCol != null && genericMerchantCol != null))

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
        form.append('date_col', genericDateCol!)
        form.append('amount_col', genericAmountCol!)
        form.append('merchant_col', genericMerchantCol!)
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccountId(accounts[0].id)
  }, [accounts, accountId])

  useEffect(() => {
    if (adapters.includes('Generic')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAdapterName('Generic')
    }
  }, [adapters])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImportError(null)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImportSuccess(null)
  }, [previewSignature])

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
        form.append('date_col', genericDateCol!)
        form.append('amount_col', genericAmountCol!)
        form.append('merchant_col', genericMerchantCol!)
      }

      return apiPostForm<CsvImportResult>('/api/import/csv', form)
    },
    onSuccess: (res) => {
      setImportSuccess(`✅ Imported ${res.num_imported} transactions`)
      setImportError(res.skipped.length > 0 ? `⚠️ Skipped ${res.skipped.length} duplicate rows` : null)
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['views'] })
      queryClient.invalidateQueries({ queryKey: ['summaries'] })
    },
    onError: (e: unknown) => {
      setImportSuccess(null)
      setImportError(e instanceof Error ? e.message : 'Import failed')
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
          <select
            value={accountId ?? ''}
            onChange={(e) => setAccountId(Number(e.target.value))}
            style={{ width: '100%', padding: 10 }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <div style={{ fontWeight: 700, margin: '16px 0 8px' }}>Step 2 · Format</div>
          <select
            value={adapterName}
            onChange={(e) => setAdapterName(e.target.value)}
            style={{ width: '100%', padding: 10 }}
          >
            {adapters.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          <div style={{ fontWeight: 700, margin: '16px 0 8px' }}>Step 3 · File</div>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />

          {isGeneric && preview && preview.raw_columns.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Generic column mapping</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <label>
                  Date column
                  <select
                    value={genericDateCol ?? ''}
                    onChange={(e) => setGenericDateCol(e.target.value)}
                    style={{ width: '100%', padding: 10 }}
                  >
                    <option value="" disabled>
                      Select
                    </option>
                    {genericColumns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount column
                  <select
                    value={genericAmountCol ?? ''}
                    onChange={(e) => setGenericAmountCol(e.target.value)}
                    style={{ width: '100%', padding: 10 }}
                  >
                    <option value="" disabled>
                      Select
                    </option>
                    {genericColumns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Merchant column
                  <select
                    value={genericMerchantCol ?? ''}
                    onChange={(e) => setGenericMerchantCol(e.target.value)}
                    style={{ width: '100%', padding: 10 }}
                  >
                    <option value="" disabled>
                      Select
                    </option>
                    {genericColumns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
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
                <button
                  style={{ marginTop: 12, padding: '10px 14px' }}
                  onClick={() => {
                    setImportError(null)
                    setImportSuccess(null)
                    importMutation.mutate()
                  }}
                  disabled={importMutation.isPending}
                >
                  ✅ Confirm import
                </button>
              ) : (
                <div style={{ marginTop: 10 }}>Create/select an account first.</div>
              )}

              {importError ? <div style={{ marginTop: 10, color: 'crimson' }}>{importError}</div> : null}
              {importSuccess ? <div style={{ marginTop: 10, color: 'green' }}>{importSuccess}</div> : null}
            </div>
          ) : (
            <div>Choose an account, format, and file to see a live preview here.</div>
          )}
        </div>
      </div>
    </div>
  )
}

