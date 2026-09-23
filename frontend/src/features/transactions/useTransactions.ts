import type { OnChangeFn, RowSelectionState, SortingState } from '@tanstack/react-table'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAccounts } from '../../api/accounts'
import { getCategories, getSubcategories } from '../../api/categories'
import { getTags } from '../../api/tags'
import { linkExistingTransfer, unlinkExistingTransfer } from '../../api/transfers'
import {
  deleteTransaction,
  getTransactionCount,
  getTransactionSplits,
  getTransactions,
  patchTransaction,
  putTransactionSplits,
  type TransactionSortField,
} from '../../api/transactions'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { toast } from '@/components/ui/sonner'
import { invalidateTransactionData, queryKeys } from '../../queryKeys'
import { daysAgoIso, todayIso } from '@/lib/dates'
import type { AccountOut, CategoryOut, SubcategoryOut, TagOut, TransactionOut, TransactionSplitOut } from '../../types'
import type { SplitsFormValues, TransactionRow } from './types'

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

const PAGE_SIZE_OPTIONS = [100, 250, 500] as const
const DEFAULT_PAGE_SIZE = 100
const SEARCH_DEBOUNCE_MS = 300

/** Delay after the last committed cell edit before it's saved. */
const AUTOSAVE_DELAY_MS = 700

/** Table columns the server can sort by; sorting spans every page, not just the visible one. */
export const SORT_FIELD_BY_COLUMN: Record<string, TransactionSortField> = {
  Date: 'date',
  Merchant: 'merchant',
  Amount: 'amount',
  Category: 'category',
  Subcategory: 'subcategory',
  Acct: 'account',
}
const DEFAULT_SORTING: SortingState = [{ id: 'Date', desc: true }]

const EMPTY_ACCOUNTS: AccountOut[] = []
const EMPTY_CATEGORIES: CategoryOut[] = []
const EMPTY_TAGS: TagOut[] = []

export type TransactionsPagination = {
  pageIndex: number
  /** Null until the row total has loaded. */
  pageCount: number | null
  total: number | null
  rangeStart: number
  rangeEnd: number
  canPrevPage: boolean
  canNextPage: boolean
  goToPage: (index: number) => void
  /** Rows shown are from the previous page/filters while the next ones load. */
  loading: boolean
  initialLoading: boolean
  /** Changes whenever a different page or result set is shown. */
  pageToken: string
  pageSize: number
  setPageSize: (size: number) => void
  pageSizeOptions: readonly number[]
}

function toRow(t: TransactionOut): TransactionRow {
  return {
    id: t.id,
    // API dates are calendar days; re-parsing them through Date can shift the day by timezone.
    Date: t.date.slice(0, 10),
    Merchant: t.merchant ?? '',
    Amount: Number(t.amount),
    Category: t.category_name ?? '',
    Subcategory: t.subcategory_name ?? '',
    Tags: t.tag_names?.length ? t.tag_names.join(', ') : '',
    Notes: t.notes ?? '',
    Acct: t.account_name ?? '',
    Split: t.has_splits ? 'Split' : '',
  }
}

export function useTransactions() {
  const queryClient = useQueryClient()

  const [merchantSearch, setMerchantSearch] = useState('')
  const [fCategory, setFCategory] = useState('All')
  const [fTag, setFTag] = useState('All')
  const [fAccountId, setFAccountId] = useState<number | null>(null)
  const [showOnlyRecent, setShowOnlyRecent] = useState(false)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING)

  // Unsaved cell edits by transaction id. Kept apart from the visible rows so
  // they survive paging, searching, and sorting until saved.
  const [edits, setEdits] = useState<Map<number, TransactionRow>>(new Map())
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [error, setError] = useState<string | null>(null)

  const splitsForm = useForm<SplitsFormValues>({
    defaultValues: {
      splitRows: [],
    },
  })
  const { control: splitsControl, watch: watchSplits, setValue: setSplitsValue } = splitsForm
  const { fields: splitFields, remove: removeSplitRow, append: appendSplitRow, replace: replaceSplitRows } = useFieldArray({
    control: splitsControl,
    name: 'splitRows',
  })
  const splitRows = watchSplits('splitRows')

  const splitTxnId = useMemo(() => {
    const ids = Object.entries(rowSelection)
      .filter(([, selected]) => selected)
      .map(([id]) => Number(id))
    return ids.length === 1 ? ids[0] : 0
  }, [rowSelection])
  const [splitError, setSplitError] = useState<string | null>(null)

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
    queryFn: getTags,
  })

  const accounts = accountsQuery.data ?? EMPTY_ACCOUNTS
  const categories = categoriesQuery.data ?? EMPTY_CATEGORIES
  const tags = tagsQuery.data ?? EMPTY_TAGS

  // `combine` keeps the result referentially stable between renders, so the table's
  // column definitions (which depend on it) are not rebuilt on every render.
  const subcategories = useQueries({
    queries: categories.map((c) => ({
      queryKey: queryKeys.subcategories(c.id),
      queryFn: () => getSubcategories(c.id),
    })),
    combine: (results) => {
      const byCategory: Record<number, SubcategoryOut[]> = {}
      results.forEach((q, i) => {
        if (q.data) byCategory[categories[i].id] = q.data
      })
      return {
        byCategory,
        pending: results.some((q) => q.isPending),
        error: results.find((q) => q.error)?.error?.message ?? null,
      }
    },
  })
  const subcategoriesByCategory = subcategories.byCategory

  const metaLoading =
    accountsQuery.isPending || categoriesQuery.isPending || tagsQuery.isPending || subcategories.pending

  const metaQueryError =
    accountsQuery.error?.message ||
    categoriesQuery.error?.message ||
    tagsQuery.error?.message ||
    subcategories.error ||
    null

  const metaReady = !metaLoading

  const categoryNameToId = useMemo(() => new Map(categories.map((c) => [c.name, c.id])), [categories])
  const tagNameToId = useMemo(() => new Map(tags.map((t) => [t.name, t.id])), [tags])
  const accountNameToId = useMemo(() => new Map(accounts.map((a) => [a.name, a.id])), [accounts])

  const recentRange = useMemo(() => {
    if (!showOnlyRecent) return { startDate: undefined as string | undefined, endDate: undefined as string | undefined }
    return { startDate: daysAgoIso(90), endDate: todayIso() }
  }, [showOnlyRecent])

  const serverCategoryId = useMemo(
    () => (fCategory === 'All' ? undefined : categoryNameToId.get(fCategory)),
    [fCategory, categoryNameToId],
  )
  const serverTagIds = useMemo(() => {
    if (fTag === 'All') return undefined
    const id = tagNameToId.get(fTag)
    return id ? [id] : undefined
  }, [fTag, tagNameToId])

  const tagIdsKey = useMemo(() => (serverTagIds?.length ? serverTagIds.join(',') : ''), [serverTagIds])

  const debouncedSearch = useDebouncedValue(merchantSearch.trim(), SEARCH_DEBOUNCE_MS)
  const activeSort = sorting[0]
  const sortBy = activeSort ? SORT_FIELD_BY_COLUMN[activeSort.id] : undefined
  const sortDir: 'asc' | 'desc' | undefined = sortBy ? (activeSort.desc ? 'desc' : 'asc') : undefined

  const filterParams = useMemo(
    () => ({
      includeTransfers: true,
      startDate: recentRange.startDate,
      endDate: recentRange.endDate,
      accountId: fAccountId ?? undefined,
      categoryId: serverCategoryId,
      tagIds: serverTagIds,
      tagsMatchAny: true,
      search: debouncedSearch || undefined,
    }),
    [recentRange.startDate, recentRange.endDate, fAccountId, serverCategoryId, serverTagIds, debouncedSearch],
  )

  // Any change to what's listed starts back at page 1. Tying the page to this key
  // (rather than resetting it in an effect) avoids first fetching the old page
  // number under the new filters.
  const scopeKey = JSON.stringify([filterParams, sortBy, sortDir, pageSize])
  const [page, setPage] = useState({ scopeKey, index: 0 })
  const pageIndex = page.scopeKey === scopeKey ? page.index : 0
  const setPageIndex = useCallback((index: number) => setPage({ scopeKey, index }), [scopeKey])

  const pageQueryOptions = useCallback(
    (index: number) => ({
      queryKey: queryKeys.transactions({
        includeTransfers: true,
        startDate: recentRange.startDate,
        endDate: recentRange.endDate,
        accountId: fAccountId,
        categoryId: serverCategoryId ?? null,
        tagIdsKey,
        tagsMatchAny: true,
        search: debouncedSearch || null,
        sortBy: sortBy ?? null,
        sortDir: sortDir ?? null,
        limit: pageSize,
        offset: index * pageSize,
      }),
      queryFn: () =>
        getTransactions<TransactionOut[]>({
          ...filterParams,
          sortBy,
          sortDir,
          limit: pageSize,
          offset: index * pageSize,
        }),
      staleTime: 30_000,
    }),
    [recentRange.startDate, recentRange.endDate, fAccountId, serverCategoryId, tagIdsKey, debouncedSearch, sortBy, sortDir, pageSize, filterParams],
  )

  const transactionsQuery = useQuery<TransactionOut[], Error>({
    ...pageQueryOptions(pageIndex),
    // Keep showing the current rows while the next page loads instead of blanking the table.
    placeholderData: keepPreviousData,
  })
  const countQuery = useQuery({
    queryKey: queryKeys.transactionsCount({
      includeTransfers: true,
      startDate: recentRange.startDate,
      endDate: recentRange.endDate,
      accountId: fAccountId,
      categoryId: serverCategoryId ?? null,
      tagIdsKey,
      tagsMatchAny: true,
      search: debouncedSearch || null,
    }),
    queryFn: () => getTransactionCount(filterParams),
    staleTime: 30_000,
  })

  const currentPageTransactions = useMemo(() => transactionsQuery.data ?? [], [transactionsQuery.data])
  const total = countQuery.data?.total ?? null
  const pageCount = total != null ? Math.max(1, Math.ceil(total / pageSize)) : null
  const hasNextPage =
    pageCount != null ? pageIndex + 1 < pageCount : currentPageTransactions.length === pageSize

  // Stay in range when the total shrinks (e.g. after deleting the last rows of the last page).
  useEffect(() => {
    if (pageCount != null && pageIndex > pageCount - 1) setPageIndex(pageCount - 1)
  }, [pageCount, pageIndex, setPageIndex])

  // Fetch the next page in the background so "Next" is instant.
  useEffect(() => {
    if (!hasNextPage || transactionsQuery.isPlaceholderData) return
    void queryClient.prefetchQuery(pageQueryOptions(pageIndex + 1))
  }, [hasNextPage, pageIndex, pageQueryOptions, queryClient, transactionsQuery.isPlaceholderData])

  const serverRows = useMemo(() => currentPageTransactions.map(toRow), [currentPageTransactions])
  const gridRows = useMemo(() => serverRows.map((r) => edits.get(r.id) ?? r), [serverRows, edits])

  // A new page or result set starts with nothing selected.
  useEffect(() => {
    setRowSelection({})
  }, [scopeKey, pageIndex])

  // Drop selections for rows that disappeared (deleted, or filtered out on refetch).
  useEffect(() => {
    setRowSelection((prev) => {
      const visible = new Set(serverRows.map((r) => String(r.id)))
      const kept = Object.entries(prev).filter(([id, selected]) => selected && visible.has(id))
      return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept)
    })
  }, [serverRows])

  const splitsQuery = useQuery<TransactionSplitOut[], Error>({
    queryKey: queryKeys.splits(splitTxnId),
    queryFn: () => getTransactionSplits<TransactionSplitOut[]>(splitTxnId),
    enabled: splitTxnId > 0 && metaReady,
  })

  const splitsLoading = splitTxnId > 0 && (splitsQuery.isPending || splitsQuery.isFetching)

  useEffect(() => {
    if (splitTxnId <= 0) {
      replaceSplitRows([])
      return
    }
    if (!splitsQuery.data) {
      replaceSplitRows([])
      return
    }
    replaceSplitRows(
      splitsQuery.data.map((s) => ({
        category_id: s.category_id,
        subcategory_id: s.subcategory_id,
        amount: Number(s.amount),
        notes: s.notes ?? null,
      })),
    )
  }, [splitTxnId, splitsQuery.data, replaceSplitRows])

  const splitTargetRow = useMemo(
    () => (splitTxnId > 0 ? gridRows.find((r) => r.id === splitTxnId) ?? null : null),
    [gridRows, splitTxnId],
  )

  const splitSelectionState = useMemo(() => {
    const n = Object.values(rowSelection).filter(Boolean).length
    if (n > 1) return 'multiple' as const
    if (n === 1) return 'one' as const
    return 'none' as const
  }, [rowSelection])

  const splitsQueryErrorMessage = splitsQuery.error?.message ?? null

  /** PATCH each edited row. Plain async so the unmount flush can call it without React state. */
  const persistEdits = useCallback(
    async (snapshot: Map<number, TransactionRow>) => {
      for (const [id, row] of snapshot) {
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
        payload.tag_ids = tagNames
          .map((n) => tagNameToId.get(n))
          .filter((x): x is number => typeof x === 'number')

        await patchTransaction(id, payload)
      }
    },
    [accountNameToId, categoryNameToId, subcategoriesByCategory, tagNameToId],
  )

  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  // The edits map that last failed to save; autosave pauses until the user edits again.
  const [failedEdits, setFailedEdits] = useState<Map<number, TransactionRow> | null>(null)

  const saveDirtyEditsMutation = useMutation({
    mutationFn: persistEdits,
    onSuccess: async (_data, snapshot) => {
      setError(null)
      setFailedEdits(null)
      // Refetch before dropping the overlay so saved cells don't flash their old values.
      await invalidateTransactionData(queryClient)
      // Tag recency changed.
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags() })
      // Keep rows edited again while this save was in flight.
      setEdits((prev) => {
        const next = new Map(prev)
        for (const [id, row] of snapshot) if (next.get(id) === row) next.delete(id)
        return next
      })
      setLastSavedAt(Date.now())
    },
    onError: (e: unknown, snapshot) => {
      setFailedEdits(snapshot)
      setError(e instanceof Error ? e.message : 'Failed to save edits')
    },
  })

  const linkCardPaymentMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      if (ids.length !== 2) {
        throw new Error('Select exactly two transactions to link as a transfer.')
      }
      const txns = currentPageTransactions.filter((t) => ids.includes(t.id))
      if (txns.length !== 2) {
        throw new Error('Could not resolve selected transactions; refresh and try again.')
      }
      for (const t of txns) {
        if (t.is_transfer) {
          throw new Error(`Transaction ${t.id} is already a transfer.`)
        }
        if (t.has_splits) {
          throw new Error(`Transaction ${t.id} has splits. Clear splits before linking.`)
        }
      }
      await linkExistingTransfer({
        transaction_id_a: ids[0],
        transaction_id_b: ids[1],
      })
    },
    onSuccess: () => {
      setError(null)
      setRowSelection({})
      void invalidateTransactionData(queryClient)
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : 'Could not link as transfer')
    },
  })

  const unlinkTransferMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      if (ids.length !== 2) {
        throw new Error('Select exactly two transactions to unlink a transfer.')
      }
      const txns = currentPageTransactions.filter((t) => ids.includes(t.id))
      if (txns.length !== 2) {
        throw new Error('Could not resolve selected transactions; refresh and try again.')
      }
      const [a, b] = txns
      if (!a.is_transfer || !b.is_transfer) {
        throw new Error('Both selected transactions must be linked transfers.')
      }
      if (!a.transfer_group_id || !b.transfer_group_id || a.transfer_group_id !== b.transfer_group_id) {
        throw new Error('Select the two legs of the same linked transfer.')
      }
      await unlinkExistingTransfer({
        transaction_id_a: ids[0],
        transaction_id_b: ids[1],
      })
    },
    onSuccess: () => {
      setError(null)
      setRowSelection({})
      void invalidateTransactionData(queryClient)
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : 'Could not unlink transfer')
    },
  })

  const deleteSelectedMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) {
        await deleteTransaction(id)
      }
    },
    onSuccess: (_data, ids) => {
      setError(null)
      setEdits((prev) => {
        const next = new Map(prev)
        for (const id of ids) next.delete(id)
        return next
      })
      void invalidateTransactionData(queryClient)
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
      void invalidateTransactionData(queryClient)
      toast.success('Splits saved', { duration: 1000 })
    },
    onError: (e: unknown) => {
      setSplitError(e instanceof Error ? e.message : 'Failed to save splits')
    },
  })

  function saveDirtyEdits() {
    if (edits.size === 0 || !metaReady || saveDirtyEditsMutation.isPending) return
    setError(null)
    saveDirtyEditsMutation.mutate(new Map(edits))
  }

  // Autosave: cells commit on blur / pick, then this saves shortly after the last change.
  const { mutate: mutateSave, isPending: savePending } = saveDirtyEditsMutation
  useEffect(() => {
    if (edits.size === 0 || !metaReady || savePending || edits === failedEdits) return
    const t = window.setTimeout(() => mutateSave(new Map(edits)), AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [edits, metaReady, savePending, failedEdits, mutateSave])

  // Flush anything still pending when leaving the page (navigation or tab close).
  const flushRef = useRef<() => void>(() => {})
  useEffect(() => {
    flushRef.current = () => {
      if (edits.size === 0 || !metaReady) return
      void persistEdits(new Map(edits)).then(() => invalidateTransactionData(queryClient))
    }
  }, [edits, metaReady, persistEdits, queryClient])
  useEffect(() => {
    const onUnload = () => flushRef.current()
    window.addEventListener('pagehide', onUnload)
    return () => {
      window.removeEventListener('pagehide', onUnload)
      flushRef.current()
    }
  }, [])

  function getSelectedIds(): number[] {
    return Object.entries(rowSelection)
      .filter(([, selected]) => selected)
      .map(([id]) => Number(id))
  }

  function deleteSelected() {
    setError(null)
    const selectedIds = getSelectedIds()
    if (selectedIds.length === 0) return
    if (!metaReady) return
    deleteSelectedMutation.mutate(selectedIds)
  }

  function linkCardPayment() {
    if (!metaReady) return
    linkCardPaymentMutation.mutate(getSelectedIds())
  }

  function unlinkTransfer() {
    if (!metaReady) return
    unlinkTransferMutation.mutate(getSelectedIds())
  }

  // Stable identity: the table's column definitions depend on it.
  const processRowUpdate = useCallback((newRow: TransactionRow) => {
    setEdits((prev) => new Map(prev).set(newRow.id, newRow))
    return newRow
  }, [])

  function goToPage(index: number) {
    const last = pageCount != null ? pageCount - 1 : hasNextPage ? pageIndex + 1 : pageIndex
    const target = Math.min(Math.max(index, 0), last)
    if (target !== pageIndex) setPageIndex(target)
  }

  const pageStart = pageIndex * pageSize
  const pagination: TransactionsPagination = {
    pageIndex,
    pageCount,
    total,
    rangeStart: currentPageTransactions.length ? pageStart + 1 : 0,
    rangeEnd: pageStart + currentPageTransactions.length,
    canPrevPage: pageIndex > 0,
    canNextPage: hasNextPage,
    goToPage,
    loading: transactionsQuery.isPlaceholderData,
    initialLoading: transactionsQuery.isPending,
    pageToken: `${scopeKey}|${pageIndex}`,
    pageSize,
    setPageSize,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
  }

  function saveSplits() {
    setSplitError(null)
    if (!metaReady) return
    saveSplitsMutation.mutate()
  }

  function appendDefaultSplitRow() {
    const catId = categories[0]?.id
    if (!catId) return
    const subs = subcategoriesByCategory[catId] ?? []
    const subId = subs[0]?.id
    if (!subId) return
    appendSplitRow({ category_id: catId, subcategory_id: subId, amount: 0, notes: null })
  }

  return {
    bannerError: error || metaQueryError ? (error ?? metaQueryError) : null,
    filters: {
      merchantSearch,
      setMerchantSearch,
      fCategory,
      setFCategory,
      fTag,
      setFTag,
      fAccountId,
      setFAccountId,
      showOnlyRecent,
      setShowOnlyRecent,
   },
    categories,
    tags,
    accounts,
    subcategoriesByCategory,
    table: {
      gridRows,
      rowSelection,
      setRowSelection,
      processRowUpdate,
      saveDirtyEdits,
      deleteSelected,
      getSelectedIds,
      metaReady,
      saveDirtyPending: saveDirtyEditsMutation.isPending,
      saveFailed: failedEdits != null && failedEdits === edits,
      lastSavedAt,
      deletePending: deleteSelectedMutation.isPending,
      linkCardPayment,
      linkCardPaymentPending: linkCardPaymentMutation.isPending,
      unlinkTransfer,
      unlinkTransferPending: unlinkTransferMutation.isPending,
      unsavedCount: edits.size,
      sorting,
      setSorting: setSorting as OnChangeFn<SortingState>,
      pagination,
    },
    splits: {
      splitsControl,
      setSplitsValue,
      splitFields,
      splitRows,
      removeSplitRow,
      appendDefaultSplitRow,
      splitTxnId,
      splitTargetRow,
      splitSelectionState,
      subcategoriesByCategory,
      splitsLoading,
      splitErrorMessage: splitError ?? splitsQueryErrorMessage,
      saveSplits,
      saveSplitsPending: saveSplitsMutation.isPending,
      metaReady,
    },
  }
}
