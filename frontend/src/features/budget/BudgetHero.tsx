import { CheckCircle2, Info, Wand2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { ZbbMonthOut } from '@/types'
import { cents, monthLabel, usd } from './budgetUtils'

type Props = {
  data: ZbbMonthOut
  onFundTargets: () => void
  onAssignRta: () => void
  pending: boolean
}

/** Ready to Assign front and centre, with the month's flow beside it (YNAB/Actual-style header). */
export default function BudgetHero({ data, onFundTargets, onAssignRta, pending }: Props) {
  const rta = data.ready_to_assign
  const state = cents(rta) > 0 ? 'positive' : cents(rta) < 0 ? 'negative' : 'zero'
  const t = data.totals
  const spent = -t.activity

  return (
    <section className="surface grid overflow-hidden lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div
        className={cn(
          'flex flex-col justify-between gap-4 p-5 sm:p-6',
          state === 'positive' && 'bg-income/[0.07]',
          state === 'negative' && 'bg-expense/[0.07]',
          state === 'zero' && 'bg-muted/40',
        )}
      >
        <div>
          <div className="flex items-center gap-1.5">
            <p className="eyebrow">Ready to assign</p>
            <RtaExplainer data={data} />
          </div>
          <p
            className={cn(
              'mt-1 text-4xl font-semibold tracking-tight tabular-nums sm:text-[2.75rem]',
              state === 'positive' && 'text-income',
              state === 'negative' && 'text-expense',
            )}
          >
            {usd(rta)}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {state === 'positive' && 'Waiting for a job. Assign it to envelopes below.'}
            {state === 'zero' && (
              <span className="inline-flex items-center gap-1.5 text-foreground">
                <CheckCircle2 className="h-4 w-4 text-income" /> Every dollar has a job.
              </span>
            )}
            {state === 'negative' &&
              `You've assigned ${usd(-rta)} more than you have. Take it back from an envelope.`}
          </p>
        </div>
        {state === 'positive' && !data.is_before_budget_start ? (
          <div className="flex flex-wrap gap-2">
            {cents(t.underfunded) > 0 ? (
              <Button size="sm" onClick={onFundTargets} disabled={pending} className="gap-1.5">
                <Wand2 className="h-3.5 w-3.5" />
                Fund targets ({usd(Math.min(t.underfunded, rta))})
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={onAssignRta} disabled={pending}>
              Assign to an envelope…
            </Button>
          </div>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 divide-border/70 border-t border-border/70 lg:border-l lg:border-t-0">
        <Stat label="Income" value={usd(t.income)} hint={`Income received in ${monthLabel(data, { short: true })}`} />
        <Stat label="Assigned" value={usd(t.assigned)} hint="Given to envelopes this month" />
        <Stat
          label="Spent"
          value={usd(spent)}
          hint="Net spending in envelopes this month (refunds count back)"
          className="border-t border-border/70"
        />
        <Stat
          label="Available"
          value={usd(t.available)}
          hint="Left across all envelopes"
          tone={cents(t.available) < 0 ? 'negative' : undefined}
          className="border-t border-border/70"
        />
      </dl>
    </section>
  )
}

function Stat({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: string
  value: string
  hint: string
  tone?: 'negative'
  className?: string
}) {
  return (
    <div className={cn('px-5 py-4 odd:border-r odd:border-border/70', className)} title={hint}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 text-lg font-semibold tabular-nums tracking-tight', tone === 'negative' && 'text-expense')}>
        {value}
      </dd>
    </div>
  )
}

/** The arithmetic behind Ready to Assign, so the number is never a mystery. */
function RtaExplainer({ data }: { data: ZbbMonthOut }) {
  const envelopes = data.cash_on_budget - data.ready_to_assign
  const horizonIsView = data.horizon_year === data.year && data.horizon_month === data.month
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label="How Ready to Assign is calculated"
        className="rounded-full text-muted-foreground/70 hover:text-foreground"
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-sm">
        <p className="font-medium">How it&apos;s calculated</p>
        <div className="mt-3 space-y-1.5 tabular-nums">
          <Line label="Cash in budget accounts" value={usd(data.cash_on_budget)} />
          <ul className="space-y-1 border-l pl-3 text-xs text-muted-foreground">
            {data.accounts.map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span className="truncate">{a.name}</span>
                <span>{usd(a.balance)}</span>
              </li>
            ))}
            {data.accounts.length === 0 ? <li>No budget accounts yet.</li> : null}
          </ul>
          <Line label="Already in envelopes" value={`− ${usd(envelopes)}`} />
          <div className="border-t pt-1.5">
            <Line label="Ready to assign" value={usd(data.ready_to_assign)} strong />
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Credit card balances are subtracted from cash, so card spending is already paid for.
          {horizonIsView
            ? null
            : ` Envelopes are counted as of ${monthLabel({ year: data.horizon_year, month: data.horizon_month })}, the latest month you've budgeted.`}{' '}
          Choose which accounts count on the{' '}
          <Link to="/accounts" className="text-primary underline-offset-4 hover:underline">
            Accounts
          </Link>{' '}
          page.
        </p>
      </PopoverContent>
    </Popover>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-3', strong && 'font-semibold')}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
