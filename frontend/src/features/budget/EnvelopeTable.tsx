import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ZbbCategoryRowOut, ZbbMonthOut, ZbbMoveMoneyIn } from '@/types'
import MoveMoneyPopover from './MoveMoneyPopover'
import { cents, inputAmount, matchesFilter, parseAssignInput, usd, type EnvelopeFilter } from './budgetUtils'

type Props = {
  data: ZbbMonthOut
  filter: EnvelopeFilter
  readOnly: boolean
  onAssign: (categoryId: number, assigned: number) => Promise<unknown>
  onMove: (body: ZbbMoveMoneyIn) => Promise<unknown>
  onOpen: (categoryId: number) => void
}

const GRID =
  'grid grid-cols-[minmax(0,1fr)_5.5rem_5.75rem] items-center gap-x-2 sm:grid-cols-[minmax(0,1fr)_8rem_7rem_7.5rem] sm:gap-x-3'

export default function EnvelopeTable({ data, filter, readOnly, onAssign, onMove, onOpen }: Props) {
  const rows = data.rows.filter((r) => matchesFilter(r, filter))
  const t = data.totals

  return (
    <div className="surface overflow-hidden">
      <div
        className={cn(
          GRID,
          'border-b border-border/70 bg-muted/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground',
        )}
      >
        <div>Envelope</div>
        <div className="text-right">Assigned</div>
        <div className="hidden text-right sm:block">Spent</div>
        <div className="text-right">Available</div>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          {data.rows.length === 0 ? 'No envelopes yet. Create one to start budgeting.' : 'No envelopes match this filter.'}
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((r) => (
            <EnvelopeRow
              key={r.category_id}
              row={r}
              data={data}
              readOnly={readOnly}
              onAssign={onAssign}
              onMove={onMove}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}

      {filter === 'all' && data.rows.length > 0 ? (
        <div className={cn(GRID, 'border-t border-border/70 bg-muted/30 px-4 py-3 text-sm font-semibold tabular-nums')}>
          <div>Total</div>
          <div className="pr-2 text-right">{usd(t.assigned)}</div>
          <div className="hidden text-right sm:block">{usd(-t.activity)}</div>
          <div className={cn('pr-2.5 text-right', cents(t.available) < 0 && 'text-expense')}>{usd(t.available)}</div>
        </div>
      ) : null}
    </div>
  )
}

function EnvelopeRow({
  row,
  data,
  readOnly,
  onAssign,
  onMove,
  onOpen,
}: {
  row: ZbbCategoryRowOut
  data: ZbbMonthOut
  readOnly: boolean
  onAssign: Props['onAssign']
  onMove: Props['onMove']
  onOpen: Props['onOpen']
}) {
  const spent = -row.activity
  const funded = row.rollover + row.assigned
  const over = cents(row.available) < 0
  // Bar = share of this month's money already spent; full and red once overspent.
  const pct = over ? 100 : funded > 0 ? Math.min(100, Math.max(0, (spent / funded) * 100)) : 0
  const mapping = row.txn_subcategory_name
    ? `${row.txn_category_name} › ${row.txn_subcategory_name}`
    : row.txn_category_name == null
      ? 'Savings goal'
      : row.txn_category_name !== row.category_name
        ? row.txn_category_name
        : null

  return (
    <li className={cn(GRID, 'group px-4 py-2.5 transition-colors hover:bg-muted/30')}>
      <button
        type="button"
        onClick={() => onOpen(row.category_id)}
        className="min-w-0 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-1">
          <span className="truncate text-sm font-medium">{row.category_name}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span className="h-1.5 w-full max-w-[14rem] overflow-hidden rounded-full bg-muted">
            <span
              className={cn('block h-full rounded-full', over ? 'bg-expense' : pct >= 90 ? 'bg-amber-500' : 'bg-income')}
              style={{ width: `${pct}%` }}
            />
          </span>
          {mapping ? <span className="hidden truncate text-[11px] text-muted-foreground md:inline">{mapping}</span> : null}
        </span>
      </button>

      <AssignedCell row={row} readOnly={readOnly} onAssign={onAssign} />

      <div className="hidden text-right text-sm tabular-nums text-muted-foreground sm:block">
        {cents(spent) === 0 ? '—' : cents(spent) < 0 ? <span className="text-income">+{usd(-spent)}</span> : usd(spent)}
      </div>

      <div className="flex justify-end">
        {readOnly ? (
          <AvailablePill row={row} />
        ) : (
          <MoveMoneyPopover row={row} rows={data.rows} readyToAssign={data.ready_to_assign} onMove={onMove}>
            <button type="button" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <AvailablePill row={row} interactive />
            </button>
          </MoveMoneyPopover>
        )}
      </div>
    </li>
  )
}

function AvailablePill({ row, interactive }: { row: ZbbCategoryRowOut; interactive?: boolean }) {
  const c = cents(row.available)
  const underfunded = cents(row.underfunded) > 0
  return (
    <span
      title={
        c < 0
          ? 'Overspent: click to cover it'
          : underfunded
            ? `${usd(row.underfunded)} short of this month's target`
            : interactive
              ? 'Click to move money'
              : undefined
      }
      className={cn(
        'inline-flex justify-end rounded-full px-2 py-1 text-sm font-semibold tabular-nums transition-colors sm:min-w-[5.5rem] sm:px-2.5',
        c < 0 && 'bg-expense/15 text-expense',
        c > 0 && underfunded && 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
        c > 0 && !underfunded && 'bg-income/15 text-income',
        c === 0 && (underfunded ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-muted text-muted-foreground'),
        interactive && 'hover:ring-1 hover:ring-current/30',
      )}
    >
      {usd(row.available)}
    </span>
  )
}

function AssignedCell({
  row,
  readOnly,
  onAssign,
}: {
  row: ZbbCategoryRowOut
  readOnly: boolean
  onAssign: Props['onAssign']
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)

  const commit = async () => {
    if (draft === null) return
    const next = parseAssignInput(draft, row.assigned)
    if (next === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (cents(next) !== cents(row.assigned)) {
      try {
        await onAssign(row.category_id, next)
      } catch {
        // Toast already shown; fall through to reset the field.
      }
    }
    setDraft(null)
  }

  const underfunded = cents(row.underfunded) > 0

  return (
    <div className="text-right">
      <input
        aria-label={`Assigned to ${row.category_name}`}
        disabled={readOnly}
        value={draft ?? usd(row.assigned)}
        inputMode="decimal"
        onFocus={(e) => {
          setDraft(inputAmount(row.assigned))
          requestAnimationFrame(() => e.target.select())
        }}
        onChange={(e) => {
          setInvalid(false)
          setDraft(e.target.value)
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(null)
            setInvalid(false)
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
          }
        }}
        className={cn(
          'h-8 w-full rounded-md border border-transparent bg-transparent px-1 text-right sm:px-2 text-sm tabular-nums outline-none transition-colors',
          'hover:border-input focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/30',
          'disabled:cursor-not-allowed disabled:opacity-60',
          invalid && 'border-expense focus:border-expense',
          cents(row.assigned) === 0 && draft === null && 'text-muted-foreground',
        )}
      />
      {row.target != null ? (
        <p
          className={cn(
            'truncate pr-1 text-[11px] tabular-nums sm:pr-2',
            underfunded ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
          )}
        >
          {underfunded ? `${usd(row.underfunded)} to target` : `Target ${usd(row.target)} ✓`}
        </p>
      ) : null}
    </div>
  )
}
