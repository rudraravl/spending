import { useMemo, useState } from 'react'
import type { TransactionOut } from '../../types'
import { SortableTableHead } from '@/components/sortable-table-head'
import { cycleSort, sortBySelector, type ColumnSortState } from '@/lib/tableSort'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
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
  const [sort, setSort] = useState<ColumnSortState | null>(null)

  const sortedRows = useMemo(
    () =>
      sortBySelector(rows, sort, {
        date: (t) => (typeof t.date === 'string' ? t.date.slice(0, 10) : String(t.date)),
        merchant: (t) => t.merchant ?? '',
        amount: (t) => t.amount,
        category: (t) =>
          t.has_splits
            ? '—'
            : [t.category_name, t.subcategory_name].filter(Boolean).join(' · ') || '—',
        notes: (t) => t.notes ?? '',
      }),
    [rows, sort],
  )

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-6">Loading transactions…</p>
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-6">No transactions on this account yet.</p>
  }

  const onSort = (k: string) => setSort((prev) => cycleSort(prev, k))

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableTableHead className="w-[110px]" label="Date" columnKey="date" sort={sort} onSort={onSort} />
            <SortableTableHead label="Merchant" columnKey="merchant" sort={sort} onSort={onSort} />
            <SortableTableHead
              className="w-[120px]"
              label="Amount"
              columnKey="amount"
              sort={sort}
              onSort={onSort}
              align="right"
            />
            <SortableTableHead
              className="hidden md:table-cell"
              label="Category"
              columnKey="category"
              sort={sort}
              onSort={onSort}
            />
            <SortableTableHead
              className="hidden lg:table-cell"
              label="Notes"
              columnKey="notes"
              sort={sort}
              onSort={onSort}
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRows.map((t) => (
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
                  t.amount > 0 ? 'text-income' : t.amount < 0 ? 'text-expense' : '',
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
