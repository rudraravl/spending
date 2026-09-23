import { useMemo } from 'react'
import { SortableTableHead } from '@/components/sortable-table-head'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { cycleSort, sortByColumn, type ColumnSortState } from '@/lib/tableSort'
import { formatSignedUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { BreakdownRow } from './breakdown'

const NUMERIC_KEYS = ['total', 'count', 'percent'] as const

type LabelColumn = {
  key: 'tag' | 'category' | 'subcategory'
  label: string
  className?: string
}

/** Sortable table of tag / category / subcategory totals with count and share columns. */
export function BreakdownTable({
  rows,
  labelColumns,
  emptyMessage,
  sort,
  onSortChange,
}: {
  rows: BreakdownRow[]
  labelColumns: LabelColumn[]
  emptyMessage: string
  sort: ColumnSortState | null
  onSortChange: (next: ColumnSortState) => void
}) {
  const sortedRows = useMemo(() => sortByColumn(rows, sort, NUMERIC_KEYS), [rows, sort])
  const head = (label: string, columnKey: string) => (
    <SortableTableHead
      key={columnKey}
      label={label}
      columnKey={columnKey}
      sort={sort}
      onSort={(k) => onSortChange(cycleSort(sort, k))}
    />
  )

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {labelColumns.map((c) => head(c.label, c.key))}
          {head('Total', 'total')}
          {head('Count', 'count')}
          {head('%', 'percent')}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedRows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={labelColumns.length + 3} className="text-muted-foreground">
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          sortedRows.map((r) => {
            const inflow = Number(r.total) > 0
            return (
              <TableRow key={labelColumns.map((c) => r[c.key] ?? '').join('|') + `|${r.category_id ?? ''}`}>
                {labelColumns.map((c, i) => (
                  <TableCell key={c.key} className={cn(i === 0 && 'font-medium', c.className)}>
                    {String(r[c.key])}
                  </TableCell>
                ))}
                <TableCell className="tabular-nums">{formatSignedUsd(Number(r.total))}</TableCell>
                <TableCell className="tabular-nums">{String(r.count ?? '')}</TableCell>
                <TableCell
                  className={cn('tabular-nums', inflow && 'text-income')}
                  title={inflow ? 'Share of net inflows (refunds/income) in this view' : 'Share of net spending in this view'}
                >
                  {Number(r.percent).toFixed(1)}%
                </TableCell>
              </TableRow>
            )
          })
        )}
      </TableBody>
    </Table>
  )
}
