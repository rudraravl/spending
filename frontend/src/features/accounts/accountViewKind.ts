/**
 * Canonical account `type` strings (aligned with backend / Settings).
 */
export const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'cash', 'investment'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

/**
 * Which shell to render on the account detail page.
 * - credit_with_ledger: balance + transaction list (credit, checking, savings, investment)
 * - balance_only: balance only (cash for now)
 */
export type AccountViewKind = 'credit_with_ledger' | 'balance_only'

const TYPES_WITH_TXN_TABLE = new Set(['credit', 'checking', 'savings', 'investment'])

export function accountViewKind(type: string): AccountViewKind {
  if (TYPES_WITH_TXN_TABLE.has(type)) return 'credit_with_ledger'
  return 'balance_only'
}

export function accountTypeLabel(type: string): string {
  const map: Record<string, string> = {
    checking: 'Checking',
    savings: 'Savings',
    credit: 'Credit card',
    cash: 'Cash',
    investment: 'Investment',
  }
  return map[type] ?? type
}
