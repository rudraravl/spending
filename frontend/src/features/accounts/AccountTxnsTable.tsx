import type { TransactionOut } from '../../types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

type Props = {
  rows: TransactionOut[]
  currency: string
  isLoading?: boolean
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

export default function AccountTxnsTable({ rows, currency, isLoading }: Props) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-6">Loading transactions…</p>
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-6">No transactions on this account yet.</p>
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[110px]">Date</TableHead>
            <TableHead>Merchant</TableHead>
            <TableHead className="text-right w-[120px]">Amount</TableHead>
            <TableHead className="hidden md:table-cell">Category</TableHead>
            <TableHead className="hidden lg:table-cell">Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-mono text-xs whitespace-nowrap">
                {typeof t.date === 'string' ? t.date.slice(0, 10) : String(t.date)}
              </TableCell>
              <TableCell className="max-w-[200px] truncate">
                {t.merchant}
                {t.is_transfer ? (
                  <span className="ml-2 text-[10px] uppercase text-muted-foreground">Transfer</span>
                ) : null}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right font-mono text-sm tabular-nums',
                  t.amount < 0 ? 'text-emerald-600 dark:text-emerald-400' : '',
                )}
              >
                {formatMoney(t.amount, currency)}
              </TableCell>
              <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                {t.has_splits ? '—' : [t.category_name, t.subcategory_name].filter(Boolean).join(' · ') || '—'}
              </TableCell>
              <TableCell className="hidden lg:table-cell text-muted-foreground text-sm max-w-[180px] truncate">
                {t.notes ?? ''}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
