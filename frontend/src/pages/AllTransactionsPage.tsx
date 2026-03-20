import { useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, FormControlLabel, MenuItem, TextField } from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import type { GridColDef } from '@mui/x-data-grid'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '../components/PageHeader'
import { apiGet } from '../api/client'
import { getAccounts } from '../api/accounts'
import { getCategories, getSubcategories } from '../api/categories'
import { deleteTransaction, getTransactionSplits, getTransactions, patchTransaction, putTransactionSplits } from '../api/transactions'
import { queryKeys } from '../queryKeys'

import type {
  AccountOut,
  CategoryOut,
  SubcategoryOut,
  TagOut,
  TransactionOut,
  TransactionSplitIn,
  TransactionSplitOut,
} from '../types'

type TransactionRow = {
  id: number
  Date: string
  Merchant: string
  Amount: number
  Category: string
  Subcategory: string
  Tags: string
  Notes: string
  Acct: string
  Split: string
}

export default function AllTransactionsPage() {
  const queryClient = useQueryClient()

  type TransactionPatchPayload = {
    date: string
    amount: number
    merchant: string
    notes: string | null
    account_id?: number
    category_id?: number
    subcategory_id?: number
    tag_ids: number[]
  }

  // Filters
  const [merchantSearch, setMerchantSearch] = useState('')
  const [fCategory, setFCategory] = useState('All')
  const [fTag, setFTag] = useState('All')
  const [showOnlyRecent, setShowOnlyRecent] = useState(false)

  // Data
  const [gridRows, setGridRows] = useState<TransactionRow[]>([])
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(new Set())
  // MUI's selection model type differs across versions (array vs Set), so we keep it flexible at runtime.
  // (Runtime bug we hit: `rowSelectionModel` sometimes got set to `undefined` -> DataGrid crashes.)
  /** MUI DataGrid selection shape varies by version (array vs object with `ids`). */
  const [selectionModel, setSelectionModel] = useState<unknown>([])
  const [error, setError] = useState<string | null>(null)

  // Split editor
  const [splitTxnId, setSplitTxnId] = useState<number>(0)
  const [splitRows, setSplitRows] = useState<TransactionSplitIn[]>([])
  const [splitError, setSplitError] = useState<string | null>(null)

  // Meta queries (dropdown data + id/name mapping).
  const accountsQuery = useQuery<AccountOut[], Error>({
    queryKey: queryKeys.accounts(),
    queryFn: () => getAccounts(),
  })
  const categoriesQuery = useQuery<CategoryOut[], Error>({
    queryKey: queryKeys.categories(),
    queryFn: () => getCategories(),
  })
  const tagsQuery = useQuery<TagOut[], Error>({
    queryKey: queryKeys.tags(),
    queryFn: () => apiGet<TagOut[]>('/api/tags'),
  })

  const accounts = accountsQuery.data ?? []
  const categories = categoriesQuery.data ?? []
  const tags = tagsQuery.data ?? []

  const subcategoryQueries = useQueries({
    queries: categories.map((c) => ({
      queryKey: queryKeys.subcategories(c.id),
      queryFn: () => getSubcategories(c.id),
    })),
  })

  const subcategoriesByCategory = useMemo(() => {
    const subsMap: Record<number, SubcategoryOut[]> = {}
    for (let i = 0; i < categories.length; i++) {
      const c = categories[i]
      const q = subcategoryQueries[i]
      if (q?.data) subsMap[c.id] = q.data
    }
    return subsMap
  }, [categories, subcategoryQueries])

  const metaLoading =
    accountsQuery.isPending || categoriesQuery.isPending || tagsQuery.isPending || subcategoryQueries.some((q) => q.isPending)

  useEffect(() => {
    const next =
      accountsQuery.error?.message ||
      categoriesQuery.error?.message ||
      tagsQuery.error?.message ||
      subcategoryQueries.find((q) => q.error)?.error?.message
    if (next) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(next)
    }
  }, [accountsQuery.error, categoriesQuery.error, tagsQuery.error, subcategoryQueries])

  const metaReady = !metaLoading

  const categoryNameToId = useMemo(() => new Map(categories.map((c) => [c.name, c.id])), [categories])
  const tagNameToId = useMemo(() => new Map(tags.map((t) => [t.name, t.id])), [tags])
  const accountNameToId = useMemo(() => new Map(accounts.map((a) => [a.name, a.id])), [accounts])

  const recentRange = useMemo(() => {
    if (!showOnlyRecent) return { startDate: undefined as string | undefined, endDate: undefined as string | undefined }
    const today = new Date()
    const endDate = today.toISOString().slice(0, 10)
    const startDate = new Date(today.getTime() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    return { startDate, endDate }
  }, [showOnlyRecent])

  const transactionsQuery = useQuery<TransactionOut[], Error>({
    queryKey: queryKeys.transactions({
      includeTransfers: true,
      startDate: recentRange.startDate,
      endDate: recentRange.endDate,
    }),
    queryFn: async () =>
      getTransactions<TransactionOut[]>({
        includeTransfers: true,
        startDate: recentRange.startDate,
        endDate: recentRange.endDate,
      }),
  })

  const filteredRows = useMemo(() => {
    const needle = merchantSearch.trim().toLowerCase()
    let filtered = transactionsQuery.data ?? []
    if (fCategory !== 'All') filtered = filtered.filter((t) => t.category_name === fCategory)
    if (fTag !== 'All') filtered = filtered.filter((t) => t.tag_names.includes(fTag))
    if (needle) {
      filtered = filtered.filter((t) => {
        const hay = `${t.merchant ?? ''} ${t.notes ?? ''}`.toLowerCase()
        return hay.includes(needle)
      })
    }

    return filtered.map((t) => ({
      id: t.id,
      Date: new Date(t.date).toISOString().slice(0, 10),
      Merchant: t.merchant ?? '',
      Amount: Number(t.amount),
      Category: t.has_splits ? t.category_name ?? '' : t.category_name ?? '',
      Subcategory: t.has_splits ? t.subcategory_name ?? '' : t.subcategory_name ?? '',
      Tags: t.tag_names?.length ? t.tag_names.join(', ') : '',
      Notes: t.notes ?? '',
      Acct: t.account_name ?? '',
      Split: t.has_splits ? 'Split' : '',
    }))
  }, [transactionsQuery.data, merchantSearch, fCategory, fTag])

  useEffect(() => {
    if (metaLoading || transactionsQuery.isPending) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGridRows(filteredRows)
    setDirtyIds(new Set())
    setSelectionModel([])
  }, [filteredRows, metaLoading, transactionsQuery.isPending])

  // Splits query + editor state sync.
  const splitsQuery = useQuery<TransactionSplitOut[], Error>({
    queryKey: queryKeys.splits(splitTxnId),
    queryFn: () => getTransactionSplits<TransactionSplitOut[]>(splitTxnId),
    enabled: splitTxnId > 0 && metaReady,
  })

  const splitsLoading = splitTxnId > 0 && (splitsQuery.isPending || splitsQuery.isFetching)

  useEffect(() => {
    if (!splitsQuery.data) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSplitRows(
      splitsQuery.data.map((s) => ({
        category_id: s.category_id,
        subcategory_id: s.subcategory_id,
        amount: Number(s.amount),
        notes: s.notes ?? null,
      })),
    )
  }, [splitsQuery.data])

  useEffect(() => {
    if (!splitsQuery.error) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSplitError(splitsQuery.error.message)
  }, [splitsQuery.error])

  // Mutations
  const saveDirtyEditsMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) {
        const row = gridRows.find((r) => r.id === id)
        if (!row) continue

        const payload: TransactionPatchPayload = {
          date: row.Date,
          amount: Number(row.Amount),
          merchant: row.Merchant,
          notes: row.Notes.trim() ? row.Notes : null,
          tag_ids: [],
        }

        const accountId = accountNameToId.get(row.Acct)
        if (accountId) payload.account_id = accountId

        const categoryId = categoryNameToId.get(row.Category)
        if (categoryId) payload.category_id = categoryId

        if (categoryId) {
          const subList = subcategoriesByCategory[categoryId] ?? []
          const match = subList.find((s) => s.name === row.Subcategory)
          if (match) payload.subcategory_id = match.id
        }

        const tagNames = row.Tags ? row.Tags.split(',').map((s) => s.trim()).filter(Boolean) : []
        const tagIds = tagNames.map((n) => tagNameToId.get(n)).filter((x): x is number => typeof x === 'number')
        payload.tag_ids = tagIds

        await patchTransaction(id, payload)
      }
    },
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['splits'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['views'] })
      queryClient.invalidateQueries({ queryKey: ['summaries'] })
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : 'Failed to save edits')
    },
  })

  const deleteSelectedMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) {
        await deleteTransaction(id)
      }
    },
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['splits'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['views'] })
      queryClient.invalidateQueries({ queryKey: ['summaries'] })
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : 'Failed to delete transactions')
    },
  })

  const saveSplitsMutation = useMutation({
    mutationFn: async () => {
      await putTransactionSplits(splitTxnId, splitRows)
    },
    onSuccess: () => {
      setSplitError(null)
      queryClient.invalidateQueries({ queryKey: queryKeys.splits(splitTxnId) })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (e: unknown) => {
      setSplitError(e instanceof Error ? e.message : 'Failed to save splits')
    },
  })

  const columns: GridColDef[] = [
    { field: 'Date', headerName: 'Date', flex: 0.8, editable: true },
    { field: 'Merchant', headerName: 'Merchant', flex: 1.2, editable: true },
    { field: 'Amount', headerName: 'Amount', type: 'number', flex: 0.7, editable: true },
    { field: 'Category', headerName: 'Category', flex: 0.9, editable: true },
    { field: 'Subcategory', headerName: 'Subcategory', flex: 0.9, editable: true },
    { field: 'Acct', headerName: 'Acct', flex: 0.8, editable: true },
    { field: 'Tags', headerName: 'Tags', flex: 1.0, editable: true },
    { field: 'Notes', headerName: 'Notes', flex: 1.4, editable: true },
    { field: 'Split', headerName: 'Split', flex: 0.4, editable: false },
  ]

  function saveDirtyEdits() {
    const ids = Array.from(dirtyIds)
    if (ids.length === 0) return
    if (!metaReady) return
    setError(null)
    saveDirtyEditsMutation.mutate(ids)
  }

  function deleteSelected() {
    setError(null)
    const selectedIds = (() => {
      if (Array.isArray(selectionModel)) return selectionModel.map((x) => Number(x))

      const maybeIds = (selectionModel as { ids?: unknown }).ids
      if (Array.isArray(maybeIds)) return maybeIds.map((x: unknown) => Number(x))
      if (maybeIds && typeof (maybeIds as Set<unknown>).forEach === 'function')
        return Array.from(maybeIds as Set<unknown>).map((x) => Number(x))

      return []
    })()
    if (selectedIds.length === 0) return
    if (!metaReady) return
    deleteSelectedMutation.mutate(selectedIds)
  }

  function getSelectedIds(): number[] {
    const selectedIds = (() => {
      if (Array.isArray(selectionModel)) return selectionModel.map((x) => Number(x))

      const maybeIds = (selectionModel as { ids?: unknown }).ids
      if (Array.isArray(maybeIds)) return maybeIds.map((x: unknown) => Number(x))
      if (maybeIds && typeof (maybeIds as Set<unknown>).forEach === 'function')
        return Array.from(maybeIds as Set<unknown>).map((x) => Number(x))

      return []
    })()
    return selectedIds
  }

  return (
    <div className="sp-page">
      <PageHeader
        icon="📋"
        title="All transactions"
        subtitle="Search, edit, and clean up any transaction in your history."
      />

      {error ? <div style={{ color: 'crimson', marginBottom: 10 }}>{error}</div> : null}

      <div style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, alignItems: 'flex-start' }}>
        <TextField
          label="Merchant / notes search"
          value={merchantSearch}
          onChange={(e) => setMerchantSearch(e.target.value)}
          fullWidth
        />
        <TextField select label="Category" value={fCategory} onChange={(e) => setFCategory(e.target.value)} fullWidth>
          <MenuItem value="All">All</MenuItem>
          {categories.map((c) => (
            <MenuItem key={c.id} value={c.name}>
              {c.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField select label="Tag" value={fTag} onChange={(e) => setFTag(e.target.value)} fullWidth>
          <MenuItem value="All">All</MenuItem>
          {tags.map((t) => (
            <MenuItem key={t.id} value={t.name}>
              {t.name}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={<Checkbox checked={showOnlyRecent} onChange={(e) => setShowOnlyRecent(e.target.checked)} />}
          label="Limit to last 90 days"
        />
      </div>

      <div style={{ height: 520, width: '100%', border: '1px solid var(--border)', borderRadius: 14 }}>
        <DataGrid
          rows={gridRows}
          columns={columns}
          checkboxSelection
          editMode="cell"
          disableRowSelectionOnClick
          hideFooterSelectedRowCount
          onRowSelectionModelChange={(newSel) => setSelectionModel(newSel ?? [])}
          processRowUpdate={(newRow) => {
            const updatedRow = newRow as TransactionRow
            setGridRows((prev) => prev.map((r) => (r.id === updatedRow.id ? updatedRow : r)))
            setDirtyIds((prev) => {
              const next = new Set(prev)
              next.add(updatedRow.id)
              return next
            })
            return updatedRow
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <Button variant="contained" onClick={saveDirtyEdits}>
          Save edits
        </Button>
        <Button variant="outlined" color="error" onClick={deleteSelected} disabled={getSelectedIds().length === 0}>
          Delete selected
        </Button>
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Splits</div>
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>Enter a Transaction ID to edit splits:</span>
          <TextField
            type="number"
            value={splitTxnId}
            inputProps={{ min: 0 }}
            onChange={(e) => setSplitTxnId(Number(e.target.value))}
            size="small"
            sx={{ width: 140 }}
          />
        </div>

        {splitError ? <div style={{ color: 'crimson' }}>{splitError}</div> : null}
        {splitsLoading ? <div>Loading splits...</div> : null}

        {splitTxnId > 0 && !splitsLoading && metaReady ? (
          <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>Edit splits</div>
            {splitRows.map((sr, idx) => {
              const subs = subcategoriesByCategory[sr.category_id] ?? []
              return (
                <div
                  key={`${splitTxnId}-${idx}`}
                  style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 0.8fr 1.2fr auto', gap: 8, marginBottom: 8 }}
                >
                  <TextField
                    select
                    value={sr.category_id}
                    onChange={(e) => {
                      const nextCat = Number(e.target.value)
                      const nextSubs = subcategoriesByCategory[nextCat] ?? []
                      const nextSub = nextSubs.find((s) => s.id === sr.subcategory_id)?.id ?? nextSubs[0]?.id
                      setSplitRows((prev) =>
                        prev.map((r, i) =>
                          i === idx
                            ? {
                                ...r,
                                category_id: nextCat,
                                subcategory_id: nextSub ?? r.subcategory_id,
                              }
                            : r,
                        ),
                      )
                    }}
                    size="small"
                    fullWidth
                  >
                    {categories.map((c) => (
                      <MenuItem key={c.id} value={c.id}>
                        {c.name}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    select
                    value={sr.subcategory_id}
                    onChange={(e) => {
                      const nextSub = Number(e.target.value)
                      setSplitRows((prev) => prev.map((r, i) => (i === idx ? { ...r, subcategory_id: nextSub } : r)))
                    }}
                    size="small"
                    fullWidth
                  >
                    {subs.map((s) => (
                      <MenuItem key={s.id} value={s.id}>
                        {s.name}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    type="number"
                    inputProps={{ step: '0.01' }}
                    value={sr.amount}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setSplitRows((prev) => prev.map((r, i) => (i === idx ? { ...r, amount: v } : r)))
                    }}
                    size="small"
                    fullWidth
                  />

                  <TextField
                    value={sr.notes ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setSplitRows((prev) => prev.map((r, i) => (i === idx ? { ...r, notes: v ? v : null } : r)))
                    }}
                    placeholder="Notes"
                    size="small"
                    fullWidth
                  />

                  <Button color="error" variant="outlined" onClick={() => setSplitRows((prev) => prev.filter((_, i) => i !== idx))}>
                    Remove
                  </Button>
                </div>
              )
            })}

            <Button
              variant="outlined"
              onClick={() => {
                const catId = categories[0]?.id
                if (!catId) return
                const subs = subcategoriesByCategory[catId] ?? []
                const subId = subs[0]?.id
                if (!subId) return
                setSplitRows((prev) => [
                  ...prev,
                  { category_id: catId, subcategory_id: subId, amount: 0, notes: null },
                ])
              }}
            >
              Add split row
            </Button>

            <Button
              variant="contained"
              sx={{ marginLeft: 1 }}
              onClick={() => {
                setSplitError(null)
                if (!metaReady) return
                saveSplitsMutation.mutate()
              }}
              disabled={saveSplitsMutation.isPending || !metaReady}
            >
              Save splits
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

