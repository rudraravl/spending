export const queryKeys = {
  dashboard: () => ['dashboard'] as const,
  accounts: () => ['accounts'] as const,
  categories: () => ['categories'] as const,
  tags: () => ['tags'] as const,
  rules: () => ['rules'] as const,
  rulesMeta: () => ['rules', 'meta'] as const,
  subcategories: (categoryId: number | null | undefined) => ['subcategories', categoryId] as const,

  // Server-backed transactions list. Keep keys based on the server params we actually pass.
  transactions: (params: {
    includeTransfers: boolean
    startDate?: string
    endDate?: string
  }) =>
    ['transactions', params.includeTransfers, params.startDate ?? null, params.endDate ?? null] as const,

  splits: (txnId: number) => ['splits', txnId] as const,

  // Views endpoint takes a large parameter set; pass a stable string “paramsKey”.
  views: (paramsKey: string) => ['views', paramsKey] as const,

  summaries: (rangeType: string) => ['summaries', rangeType] as const,

  importAdapters: () => ['import', 'adapters'] as const,
  csvPreview: (signature: string) => ['csvPreview', signature] as const,
}

export function normalizeNumberArrayKey(ids: number[] | null | undefined): string {
  if (!ids || ids.length === 0) return ''
  return [...ids].sort((a, b) => a - b).join(',')
}

