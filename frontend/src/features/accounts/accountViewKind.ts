/**
 * Canonical account `type` strings (aligned with backend / Settings).
 */
export const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'cash', 'investment'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

/**
 * Which shell to render on the account detail page.
 * - credit_with_ledger: balance + full transaction history for this account
 * - balance_only: balance only (banks / cash / investment for now)
 */
export type AccountViewKind = 'credit_with_ledger' | 'balance_only'

export function accountViewKind(type: string): AccountViewKind {
  if (type === 'credit') return 'credit_with_ledger'
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
