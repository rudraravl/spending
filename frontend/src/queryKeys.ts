import type { QueryClient } from '@tanstack/react-query'

export const queryKeys = {
  dashboard: () => ['dashboard'] as const,
  dashboardRange: (range: string, customStart: string, customEnd: string) =>
    ['dashboard', range, customStart, customEnd] as const,
  accounts: () => ['accounts'] as const,
  accountDetail: (id: number) => ['accounts', 'detail', id] as const,
  accountSummary: (id: number) => ['accounts', 'summary', id] as const,
  categories: () => ['categories'] as const,
  tags: () => ['tags'] as const,
  rules: () => ['rules'] as const,
  rulesMeta: () => ['rules', 'meta'] as const,
  subcategoriesAll: () => ['subcategories'] as const,
  subcategories: (categoryId: number | null | undefined) => ['subcategories', categoryId] as const,

  transactionsAll: () => ['transactions'] as const,

  // Server-backed transactions list. Keep keys based on the server params we actually pass.
  transactions: (params: {
    includeTransfers: boolean
    startDate?: string
    endDate?: string
    accountId?: number | null
    categoryId?: number | null
    subcategoryId?: number | null
    tagIdsKey?: string | null
    tagsMatchAny?: boolean | null
    search?: string | null
    sortBy?: string | null
    sortDir?: 'asc' | 'desc' | null
    limit?: number | null
    offset?: number | null
  }) =>
    [
      'transactions',
      params.includeTransfers,
      params.startDate ?? null,
      params.endDate ?? null,
      params.accountId ?? null,
      params.categoryId ?? null,
      params.subcategoryId ?? null,
      params.tagIdsKey ?? null,
      params.tagsMatchAny ?? null,
      params.search ?? null,
      params.sortBy ?? null,
      params.sortDir ?? null,
      params.limit ?? null,
      params.offset ?? null,
    ] as const,

  /** Row total for a filtered transactions list; under 'transactions' so list invalidations refresh it. */
  transactionsCount: (params: {
    includeTransfers: boolean
    startDate?: string
    endDate?: string
    accountId?: number | null
    categoryId?: number | null
    tagIdsKey?: string | null
    tagsMatchAny?: boolean | null
    search?: string | null
  }) =>
    [
      'transactions',
      'count',
      params.includeTransfers,
      params.startDate ?? null,
      params.endDate ?? null,
      params.accountId ?? null,
      params.categoryId ?? null,
      params.tagIdsKey ?? null,
      params.tagsMatchAny ?? null,
      params.search ?? null,
    ] as const,

  /** Transactions scoped to one account (hub / account detail). */
  transactionsForAccount: (accountId: number, includeTransfers: boolean) =>
    ['transactions', 'account', accountId, includeTransfers] as const,

  splitsAll: () => ['splits'] as const,
  splits: (txnId: number) => ['splits', txnId] as const,

  // Views endpoint takes a large parameter set; pass a stable string “paramsKey”.
  viewsAll: () => ['views'] as const,
  views: (paramsKey: string) => ['views', paramsKey] as const,

  reports: () => ['reports'] as const,
  reportsMonthly: (year: number, month: number) => ['reports', 'monthly', year, month] as const,
  netWorthHistory: (startDate: string, endDate: string) =>
    ['reports', 'net-worth', startDate, endDate] as const,

  importAdapters: () => ['import', 'adapters'] as const,
  csvPreview: (signature: string) => ['csvPreview', signature] as const,

  // Zero-based budgeting
  budgets: () => ['budgets'] as const,
  zbbMonths: () => ['budgets', 'month'] as const,
  zbbMonth: (year: number, month: number) => ['budgets', 'month', year, month] as const,
  zbbCategories: () => ['budgets', 'categories'] as const,

  // Transfer matching
  transfers: () => ['transfers'] as const,
  transferMatchCandidates: (scope: string) => ['transfers', 'match-candidates', scope] as const,
  paymentsHoldouts: () => ['transfers', 'payments-holdouts'] as const,

  // Recurring charges
  recurring: () => ['recurring'] as const,
  recurringSuggestions: () => ['recurring', 'suggestions'] as const,
  recurringOccurrences: (merchantNorm: string | null, amountAnchorCents: number | null) =>
    ['recurring', 'occurrences', merchantNorm, amountAnchorCents] as const,

  // SimpleFIN
  simplefinConnections: () => ['simplefin', 'connections'] as const,
  simplefinDailyBudgetAll: () => ['simplefin', 'daily-budget'] as const,
  simplefinDailyBudget: (connectionId: number | null) => ['simplefin', 'daily-budget', connectionId] as const,
  simplefinCachedAccounts: () => ['simplefin', 'cached-accounts'] as const,

  investments: () => ['investments'] as const,
  investmentsSummary: () => ['investments', 'summary'] as const,
  investmentPortfolio: (accountId: number) => ['investments', 'portfolio', accountId] as const,
  investmentHistory: (accountId: number, limit: number) =>
    ['investments', 'history', accountId, limit] as const,
}

export function normalizeNumberArrayKey(ids: number[] | null | undefined): string {
  if (!ids || ids.length === 0) return ''
  return [...ids].sort((a, b) => a - b).join(',')
}


/**
 * Mark stale everything derived from transaction rows: lists, splits, balances, rollups,
 * budgets (activity), investment activity, and transfer / recurring suggestions.
 * Call after any mutation that creates, edits, deletes, links, or imports transactions.
 */
export function invalidateTransactionData(queryClient: QueryClient): Promise<void> {
  const keys = [
    queryKeys.transactionsAll(),
    queryKeys.splitsAll(),
    queryKeys.accounts(),
    queryKeys.dashboard(),
    queryKeys.viewsAll(),
    queryKeys.reports(),
    queryKeys.budgets(),
    queryKeys.investments(),
    queryKeys.transfers(),
    queryKeys.recurring(),
  ]
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(() => undefined)
}
