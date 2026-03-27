import type { RowSelectionState } from '@tanstack/react-table'
import { useEffect, useMemo, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import { getAccounts } from '../../api/accounts'
import { getCategories, getSubcategories } from '../../api/categories'
import { linkExistingTransfer, unlinkExistingTransfer } from '../../api/transfers'
import {
  deleteTransaction,
  getTransactionSplits,
  getTransactions,
  patchTransaction,
  putTransactionSplits,
} from '../../api/transactions'
import { toast } from '@/components/ui/sonner'
import { queryKeys } from '../../queryKeys'
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

const PAGE_SIZE = 250

export function useTransactions() {
  const queryClient = useQueryClient()

  const [merchantSearch, setMerchantSearch] = useState('')
  const [fCategory, setFCategory] = useState('All')
  const [fTag, setFTag] = useState('All')
  const [fAccountId, setFAccountId] = useState<number | null>(null)
  const [showOnlyRecent, setShowOnlyRecent] = useState(false)

  const [gridRows, setGridRows] = useState<TransactionRow[]>([])
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(new Set())
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

  const metaQueryError = useMemo(() => {
    return (
      accountsQuery.error?.message ||
      categoriesQuery.error?.message ||
      tagsQuery.error?.message ||
      subcategoryQueries.find((q) => q.error)?.error?.message ||
      null
    )
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

  const transactionsQuery = useInfiniteQuery<TransactionOut[], Error>({
    queryKey: queryKeys.transactions({
      includeTransfers: true,
      startDate: recentRange.startDate,
      endDate: recentRange.endDate,
      accountId: fAccountId,
      categoryId: serverCategoryId ?? null,
      tagIdsKey,
      tagsMatchAny: true,
      limit: PAGE_SIZE,
    }),
    queryFn: ({ pageParam }) =>
      getTransactions<TransactionOut[]>({
        includeTransfers: true,
        startDate: recentRange.startDate,
        endDate: recentRange.endDate,
        accountId: fAccountId ?? undefined,
        categoryId: serverCategoryId,
        tagIds: serverTagIds,
        tagsMatchAny: true,
        limit: PAGE_SIZE,
        offset: typeof pageParam === 'number' ? pageParam : 0,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < PAGE_SIZE) return undefined
      return allPages.length * PAGE_SIZE
    },
  })

  const allTransactions = useMemo(() => {
    const pages = transactionsQuery.data?.pages ?? []
    return pages.flat()
  }, [transactionsQuery.data])

  const filteredRows = useMemo(() => {
    const needle = merchantSearch.trim().toLowerCase()
    let filtered = allTransactions
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
  }, [allTransactions, merchantSearch])

  useEffect(() => {
    if (metaLoading || transactionsQuery.isPending) return
    setGridRows((prev) => {
      // Preserve local edits for dirty rows while refreshing/adding server data.
      const prevById = new Map(prev.map((r) => [r.id, r]))
      const next: TransactionRow[] = []
      for (const r of filteredRows) {
        if (dirtyIds.has(r.id)) next.push(prevById.get(r.id) ?? r)
        else next.push(r)
      }
      return next
    })
    // If filters changed (or a refetch happened) while there are no pending edits, clear selection.
    setRowSelection({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows, metaLoading, transactionsQuery.isPending])

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
      toast.success('Changes saved', { duration: 1000 })
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : 'Failed to save edits')
    },
  })

  const linkCardPaymentMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      if (ids.length !== 2) {
        throw new Error('Select exactly two transactions to link as a transfer.')
      }
      const txns = allTransactions.filter((t) => ids.includes(t.id))
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
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['views'] })
      queryClient.invalidateQueries({ queryKey: ['summaries'] })
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
      const txns = allTransactions.filter((t) => ids.includes(t.id))
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
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['views'] })
      queryClient.invalidateQueries({ queryKey: ['summaries'] })
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
      toast.success('Splits saved', { duration: 1000 })
    },
    onError: (e: unknown) => {
      setSplitError(e instanceof Error ? e.message : 'Failed to save splits')
    },
  })

  function saveDirtyEdits() {
    const ids = Array.from(dirtyIds)
    if (ids.length === 0) return
    if (!metaReady) return
    setError(null)
    saveDirtyEditsMutation.mutate(ids)
  }

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

  function processRowUpdate(newRow: TransactionRow) {
    setGridRows((prev) => prev.map((r) => (r.id === newRow.id ? newRow : r)))
    setDirtyIds((prev) => {
      const next = new Set(prev)
      next.add(newRow.id)
      return next
    })
    return newRow
  }

  function loadMore() {
    if (!metaReady) return
    if (dirtyIds.size > 0) return
    if (!transactionsQuery.hasNextPage) return
    if (transactionsQuery.isFetchingNextPage) return
    transactionsQuery.fetchNextPage()
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
      deletePending: deleteSelectedMutation.isPending,
      linkCardPayment,
      linkCardPaymentPending: linkCardPaymentMutation.isPending,
      unlinkTransfer,
      unlinkTransferPending: unlinkTransferMutation.isPending,
      loadMore,
      canLoadMore:
        metaReady &&
        dirtyIds.size === 0 &&
        !!transactionsQuery.hasNextPage &&
        !transactionsQuery.isFetchingNextPage &&
        !transactionsQuery.isPending,
      loadMorePending: transactionsQuery.isFetchingNextPage,
      loadedCount: allTransactions.length,
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
