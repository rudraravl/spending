import { useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Plus, Settings2, Wand2 } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import PageTip from '@/features/onboarding/PageTip'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import BudgetAlerts from '@/features/budget/BudgetAlerts'
import BudgetHero from '@/features/budget/BudgetHero'
import BudgetSettingsDialog from '@/features/budget/BudgetSettingsDialog'
import EnvelopeSheet from '@/features/budget/EnvelopeSheet'
import EnvelopeTable from '@/features/budget/EnvelopeTable'
import HowItWorksSheet from '@/features/budget/HowItWorksSheet'
import MoveMoneyPopover from '@/features/budget/MoveMoneyPopover'
import NewEnvelopeDialog, { type NewEnvelopePreset } from '@/features/budget/NewEnvelopeDialog'
import {
  cents,
  compareMonths,
  currentMonth,
  matchesFilter,
  monthLabel,
  shiftMonth,
  usd,
  type EnvelopeFilter,
  type YearMonth,
} from '@/features/budget/budgetUtils'
import { useBudgetMonth } from '@/features/budget/useBudgetMonth'
import type { ZbbQuickAssignStrategy } from '@/types'

export default function BudgetsPage() {
  const [ym, setYm] = useState<YearMonth>(currentMonth)
  const [filter, setFilter] = useState<EnvelopeFilter>('all')
  const [openEnvelope, setOpenEnvelope] = useState<number | null>(null)
  const [newEnvelope, setNewEnvelope] = useState<NewEnvelopePreset | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [assignRtaOpen, setAssignRtaOpen] = useState(false)

  const api = useBudgetMonth(ym)
  const data = api.monthQ.data
  const today = currentMonth()
  const isToday = compareMonths(ym, today) === 0
  const readOnly = Boolean(data?.is_before_budget_start)
  const pending = api.quickAssign.isPending || api.move.isPending || api.assign.isPending || api.settings.isPending

  const quick = (strategy: ZbbQuickAssignStrategy) => api.quickAssign.mutate({ strategy })
  const startHere = () => api.settings.mutate({ budget_start_year: ym.year, budget_start_month: ym.month })

  const counts = data
    ? {
        overspent: data.rows.filter((r) => matchesFilter(r, 'overspent')).length,
        underfunded: data.rows.filter((r) => matchesFilter(r, 'underfunded')).length,
      }
    : { overspent: 0, underfunded: 0 }
  const lastMonthTotal = data?.rows.reduce((n, r) => n + r.last_month_assigned, 0) ?? 0
  const avgSpentTotal = data?.rows.reduce((n, r) => n + r.avg_spent, 0) ?? 0

  return (
    <div className="page max-w-6xl space-y-5">
      <PageHeader
        className="mb-0"
        title="Budget"
        description="Give every dollar a job, then watch each envelope as you spend."
        actions={
          <>
            <div className="flex items-center rounded-xl border bg-card p-0.5 shadow-sm">
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Previous month" onClick={() => setYm(shiftMonth(ym, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[9.5rem] px-2 text-center text-sm font-semibold tabular-nums">{monthLabel(ym)}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Next month" onClick={() => setYm(shiftMonth(ym, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {!isToday ? (
              <Button variant="outline" size="sm" onClick={() => setYm(today)}>
                This month
              </Button>
            ) : null}
            <Button variant="ghost" size="icon" aria-label="How this budget works" onClick={() => setHelpOpen(true)}>
              <CircleHelp className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Budget settings" onClick={() => setSettingsOpen(true)} disabled={!data}>
              <Settings2 className="h-4 w-4" />
            </Button>
          </>
        }
      />

      <PageTip id="budget" className="mb-0" />

      {api.monthQ.error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {(api.monthQ.error as Error).message}
        </p>
      ) : null}

      {!data ? (
        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          {data.accounts.length === 0 ? (
            <div className="surface p-6 text-sm">
              <p className="font-medium">Pick which accounts fund your budget</p>
              <p className="mt-1 text-muted-foreground">
                Turn on “Budget” for your checking, savings and credit cards on the Accounts page. Their balances
                become the money you assign here.
              </p>
            </div>
          ) : null}

          <MoveMoneyPopover
            row={null}
            rows={data.rows}
            readyToAssign={data.ready_to_assign}
            onMove={(body) => api.move.mutateAsync(body)}
            open={assignRtaOpen}
            onOpenChange={setAssignRtaOpen}
          >
            <div>
              <BudgetHero
                data={data}
                pending={pending}
                onFundTargets={() => quick('targets')}
                onAssignRta={() => setAssignRtaOpen(true)}
              />
            </div>
          </MoveMoneyPopover>

          {readOnly ? (
            <div className="surface flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{monthLabel(ym)} is before your budget starts</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your budget begins in {monthLabel({ year: data.budget_start_year, month: data.budget_start_month })}.
                  Earlier months are view-only and don&apos;t affect your envelopes.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setYm({ year: data.budget_start_year, month: data.budget_start_month })}
                >
                  Go to {monthLabel({ year: data.budget_start_year, month: data.budget_start_month }, { short: true })}
                </Button>
                <Button onClick={startHere} disabled={pending}>
                  Start budget here
                </Button>
              </div>
            </div>
          ) : (
            <BudgetAlerts
              data={data}
              pending={pending}
              onShowOverspent={() => setFilter('overspent')}
              onCreateEnvelope={(id, name) => setNewEnvelope({ name, txnCategoryId: id })}
              onFreshStart={startHere}
            />
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <ToggleGroup
              type="single"
              value={filter}
              onValueChange={(v) => v && setFilter(v as EnvelopeFilter)}
              className="rounded-xl border bg-card p-0.5"
            >
              <FilterItem value="all" label="All" />
              <FilterItem value="overspent" label="Overspent" count={counts.overspent} />
              <FilterItem value="underfunded" label="Underfunded" count={counts.underfunded} />
              <FilterItem value="available" label="Funded" />
            </ToggleGroup>

            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5" disabled={readOnly || pending}>
                    <Wand2 className="h-3.5 w-3.5" /> Auto-assign <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    Sets each envelope to the amount shown. Increases come from Ready to Assign ({usd(data.ready_to_assign)}) and stop when it runs out.
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <QuickItem
                    label="Fund targets"
                    detail={cents(data.totals.underfunded) > 0 ? `${usd(data.totals.underfunded)} needed` : 'All met'}
                    disabled={cents(data.totals.underfunded) === 0}
                    onSelect={() => quick('targets')}
                  />
                  <QuickItem
                    label="Copy last month"
                    detail={usd(lastMonthTotal)}
                    disabled={cents(lastMonthTotal) === 0}
                    onSelect={() => quick('last_month')}
                  />
                  <QuickItem
                    label="Average spending (3 months)"
                    detail={usd(avgSpentTotal)}
                    disabled={cents(avgSpentTotal) === 0}
                    onSelect={() => quick('avg_spent')}
                  />
                  <DropdownMenuSeparator />
                  <QuickItem
                    label="Reset assigned to $0"
                    detail={usd(data.totals.assigned)}
                    disabled={cents(data.totals.assigned) === 0}
                    onSelect={() => quick('clear')}
                    destructive
                  />
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" className="gap-1.5" onClick={() => setNewEnvelope({ name: '', txnCategoryId: null })}>
                <Plus className="h-3.5 w-3.5" /> New envelope
              </Button>
            </div>
          </div>

          <EnvelopeTable
            data={data}
            filter={filter}
            readOnly={readOnly}
            onAssign={(category_id, assigned) => api.assign.mutateAsync({ category_id, assigned })}
            onMove={(body) => api.move.mutateAsync(body)}
            onOpen={setOpenEnvelope}
          />

          <EnvelopeSheet
            data={data}
            row={data.rows.find((r) => r.category_id === openEnvelope) ?? null}
            api={api}
            readOnly={readOnly}
            onClose={() => setOpenEnvelope(null)}
          />
          <BudgetSettingsDialog open={settingsOpen} data={data} api={api} onClose={() => setSettingsOpen(false)} />
        </>
      )}

      <NewEnvelopeDialog preset={newEnvelope} api={api} onClose={() => setNewEnvelope(null)} />
      <HowItWorksSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}

function FilterItem({ value, label, count }: { value: EnvelopeFilter; label: string; count?: number }) {
  return (
    <ToggleGroupItem value={value} size="sm" className="h-8 gap-1.5 rounded-lg px-3 text-xs data-[state=on]:bg-muted">
      {label}
      {count ? (
        <span className="rounded-full bg-foreground/10 px-1.5 text-[10px] font-semibold tabular-nums">{count}</span>
      ) : null}
    </ToggleGroupItem>
  )
}

function QuickItem({
  label,
  detail,
  disabled,
  destructive,
  onSelect,
}: {
  label: string
  detail: string
  disabled?: boolean
  destructive?: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect} className="flex justify-between gap-4">
      <span className={destructive ? 'text-expense' : undefined}>{label}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{detail}</span>
    </DropdownMenuItem>
  )
}
