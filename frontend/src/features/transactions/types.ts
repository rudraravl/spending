import type { TransactionSplitIn } from '../../types'

export type TransactionRow = {
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

export type SplitsFormValues = {
  splitTxnId: number
  splitRows: TransactionSplitIn[]
}
