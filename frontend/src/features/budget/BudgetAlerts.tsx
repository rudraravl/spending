import type { ReactNode } from 'react'
import { AlertTriangle, History, Info, Tag } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ZbbMonthOut } from '@/types'
import { cents, monthLabel, usd } from './budgetUtils'

type Props = {
  data: ZbbMonthOut
  onShowOverspent: () => void
  onCreateEnvelope: (txnCategoryId: number, name: string) => void
  onFreshStart: () => void
  pending: boolean
}

/** Only the things that need attention this month; nothing renders when the budget is healthy. */
export default function BudgetAlerts({ data, onShowOverspent, onCreateEnvelope, onFreshStart, pending }: Props) {
  const t = data.totals
  const carriedDebt = data.rows.reduce((n, r) => n + Math.min(0, r.rollover), 0)
  const items: ReactNode[] = []

  if (t.overspent_count > 0) {
    items.push(
      <Alert key="overspent" tone="danger" icon={<AlertTriangle className="h-4 w-4" />}>
        <span>
          <strong>
            {t.overspent_count} envelope{t.overspent_count === 1 ? ' is' : 's are'} overspent by {usd(t.overspent)}.
          </strong>{' '}
          Cover it by moving money in from Ready to Assign or another envelope.
        </span>
        <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={onShowOverspent}>
          Show
        </Button>
      </Alert>,
    )
  }

  if (cents(carriedDebt) < 0 && data.rollover_mode === 'strict') {
    items.push(
      <Alert key="fresh" tone="warning" icon={<History className="h-4 w-4" />}>
        <span>
          <strong>{usd(-carriedDebt)} of overspending from earlier months</strong> is still carried in these envelopes.
          If you took a break from budgeting, start fresh: earlier months stop counting and envelopes reset to $0.
        </span>
        <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={onFreshStart} disabled={pending}>
          Start fresh from {monthLabel(data, { short: true })}
        </Button>
      </Alert>,
    )
  }

  if (data.unbudgeted.length > 0) {
    items.push(
      <Alert key="unbudgeted" tone="warning" icon={<Tag className="h-4 w-4" />}>
        <div className="min-w-0 space-y-1.5">
          <p>
            <strong>{usd(Math.abs(t.unbudgeted))} spent in categories without an envelope.</strong> It came straight out of
            Ready to Assign.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.unbudgeted.map((u) =>
              u.txn_category_id != null ? (
                <Button
                  key={u.txn_category_id}
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs"
                  onClick={() => onCreateEnvelope(u.txn_category_id!, u.txn_category_name)}
                >
                  + Envelope for {u.txn_category_name} ({usd(u.amount)})
                </Button>
              ) : (
                <span key="none" className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
                  Uncategorized {usd(u.amount)}
                </span>
              ),
            )}
          </div>
        </div>
      </Alert>,
    )
  }

  if (t.uncategorized_count > 0) {
    items.push(
      <Alert key="uncat" tone="info" icon={<Info className="h-4 w-4" />}>
        <span>
          {t.uncategorized_count} transaction{t.uncategorized_count === 1 ? '' : 's'} this month{' '}
          {t.uncategorized_count === 1 ? 'is' : 'are'} uncategorized, so {t.uncategorized_count === 1 ? 'it lands' : 'they land'}{' '}
          in Other or nowhere.
        </span>
        <Button asChild size="sm" variant="outline" className="h-7 shrink-0">
          <Link to="/transactions">Categorize</Link>
        </Button>
      </Alert>,
    )
  }

  if (cents(t.reset_overspending) > 0) {
    items.push(
      <Alert key="reset" tone="info" icon={<Info className="h-4 w-4" />}>
        <span>
          Last month&apos;s overspending ({usd(t.reset_overspending)}) was reset to $0 and taken out of Ready to Assign.
        </span>
      </Alert>,
    )
  }

  if (!data.budget_start_is_set) {
    items.push(
      <Alert key="start" tone="info" icon={<Info className="h-4 w-4" />}>
        <span>
          Your budget starts in {monthLabel({ year: data.budget_start_year, month: data.budget_start_month })}. Spending
          before then is ignored; change it in budget settings.
        </span>
      </Alert>,
    )
  }

  if (items.length === 0) return null
  return <div className="space-y-2">{items}</div>
}

function Alert({
  tone,
  icon,
  children,
}: {
  tone: 'danger' | 'warning' | 'info'
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div
      role={tone === 'info' ? 'status' : 'alert'}
      className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm',
        tone === 'danger' && 'border-expense/30 bg-expense/[0.06]',
        tone === 'warning' && 'border-amber-500/30 bg-amber-500/[0.07]',
        tone === 'info' && 'border-border bg-muted/40',
      )}
    >
      <span
        className={cn(
          'mt-0.5 shrink-0',
          tone === 'danger' && 'text-expense',
          tone === 'warning' && 'text-amber-600 dark:text-amber-400',
          tone === 'info' && 'text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">{children}</div>
    </div>
  )
}
