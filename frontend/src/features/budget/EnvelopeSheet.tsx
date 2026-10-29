import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getCategories, getSubcategories } from '@/api/categories'
import { getTransactions } from '@/api/transactions'
import ConfirmDialog from '@/components/ConfirmDialog'
import InlineRename from '@/components/InlineRename'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { queryKeys } from '@/queryKeys'
import type { TransactionOut, ZbbCategoryRowOut, ZbbMonthOut } from '@/types'
import type { BudgetMonthApi } from './useBudgetMonth'
import { cents, inputAmount, monthLabel, monthRange, parseAssignInput, usd } from './budgetUtils'

type Props = {
  data: ZbbMonthOut
  row: ZbbCategoryRowOut | null
  api: BudgetMonthApi
  readOnly: boolean
  onClose: () => void
}

export default function EnvelopeSheet({ data, row, api, readOnly, onClose }: Props) {
  return (
    <Sheet open={row != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {row ? <EnvelopeDetails key={row.category_id} data={data} row={row} api={api} readOnly={readOnly} onClose={onClose} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function EnvelopeDetails({ data, row, api, readOnly, onClose }: Props & { row: ZbbCategoryRowOut }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const assignTo = (v: number) => api.assign.mutate({ category_id: row.category_id, assigned: v })

  const suggestions = [
    { label: 'Last month', value: row.last_month_assigned },
    { label: 'Avg. spent (3 mo)', value: Math.round(row.avg_spent * 100) / 100 },
    ...(row.target != null ? [{ label: 'Target', value: row.target }] : []),
  ].filter((s) => cents(s.value) > 0)

  return (
    <>
      <SheetHeader className="text-left">
        <SheetTitle className="text-xl">
          <InlineRename
            label="envelope"
            value={row.category_name}
            onRename={(name) =>
              api.updateEnvelope.mutateAsync({ id: row.category_id, body: { name } }).catch((e: Error) => {
                toast.error(e.message)
                throw e
              })
            }
          />
        </SheetTitle>
        <SheetDescription>{monthLabel(data)}</SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-6">
        <section className="rounded-xl border bg-muted/30 p-4">
          <dl className="space-y-1.5 text-sm tabular-nums">
            <Line label={row.rollover < 0 ? 'Overspent last month' : 'Carried over'} value={usd(row.rollover)} />
            <Line label="Assigned this month" value={`+ ${usd(row.assigned)}`} />
            <Line
              label={row.activity > 0 ? 'Refunds' : 'Spent'}
              value={row.activity > 0 ? `+ ${usd(row.activity)}` : `− ${usd(-row.activity)}`}
            />
            <div className="border-t pt-1.5">
              <Line
                label="Available"
                value={usd(row.available)}
                strong
                className={cn(cents(row.available) < 0 && 'text-expense', cents(row.available) > 0 && 'text-income')}
              />
            </div>
          </dl>
          {!readOnly && suggestions.length > 0 ? (
            <div className="mt-4">
              <p className="eyebrow mb-2">Quick assign</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <Button
                    key={s.label}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={api.assign.isPending || cents(s.value) === cents(row.assigned)}
                    onClick={() => assignTo(s.value)}
                  >
                    {s.label}: {usd(s.value)}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <TargetEditor row={row} api={api} />
        <LinkEditor row={row} api={api} />
        <EnvelopeTransactions data={data} row={row} />

        <div className="border-t pt-4">
          <Button variant="ghost" size="sm" className="gap-1.5 text-expense hover:text-expense" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" /> Delete envelope
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${row.category_name}"?`}
        message="Its assigned amounts in every month are removed and that money returns to Ready to Assign. Transactions are not affected; their spending will show as unbudgeted."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false)
          await api.deleteEnvelope.mutateAsync(row.category_id)
          onClose()
        }}
      />
    </>
  )
}

function TargetEditor({ row, api }: { row: ZbbCategoryRowOut; api: BudgetMonthApi }) {
  const [draft, setDraft] = useState(row.target != null ? inputAmount(row.target) : '')
  const parsed = draft.trim() === '' ? null : parseAssignInput(draft, 0)
  const changed = (parsed == null ? null : cents(parsed)) !== (row.target == null ? null : cents(row.target))
  const save = () =>
    api.updateEnvelope.mutate(
      { id: row.category_id, body: { monthly_target: parsed } },
      { onError: (e) => toast.error(e.message), onSuccess: () => toast.success('Target saved') },
    )

  return (
    <section className="space-y-2">
      <Label htmlFor="target" className="eyebrow">
        Monthly target
      </Label>
      <p className="text-xs text-muted-foreground">
        How much this envelope needs each month. “Fund targets” tops every envelope up to it.
        {cents(row.avg_spent) > 0 ? ` You've spent about ${usd(row.avg_spent)}/mo lately.` : ''}
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (changed && (draft.trim() === '' || parsed != null)) save()
        }}
      >
        <Input id="target" value={draft} onChange={(e) => setDraft(e.target.value)} inputMode="decimal" placeholder="No target" />
        <Button type="submit" variant="secondary" disabled={!changed || (draft.trim() !== '' && parsed == null) || api.updateEnvelope.isPending}>
          Save
        </Button>
      </form>
    </section>
  )
}

const NONE = 'none'

function LinkEditor({ row, api }: { row: ZbbCategoryRowOut; api: BudgetMonthApi }) {
  const [cat, setCat] = useState(row.txn_category_id != null ? String(row.txn_category_id) : NONE)
  const [sub, setSub] = useState(row.txn_subcategory_id != null ? String(row.txn_subcategory_id) : NONE)
  const catsQ = useQuery({ queryKey: queryKeys.categories(), queryFn: getCategories, staleTime: 5 * 60 * 1000 })
  const catNum = cat !== NONE ? Number(cat) : null
  const subsQ = useQuery({
    queryKey: queryKeys.subcategories(catNum),
    queryFn: () => getSubcategories(catNum!),
    enabled: catNum != null,
    staleTime: 5 * 60 * 1000,
  })
  const changed =
    cat !== (row.txn_category_id != null ? String(row.txn_category_id) : NONE) ||
    sub !== (row.txn_subcategory_id != null ? String(row.txn_subcategory_id) : NONE)

  return (
    <section className="space-y-2">
      <p className="eyebrow">Tracks spending in</p>
      <p className="text-xs text-muted-foreground">
        Transactions in this category count against the envelope. Leave it unlinked for a savings goal.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={cat}
          onValueChange={(v) => {
            setCat(v)
            setSub(NONE)
          }}
        >
          <SelectTrigger aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not linked</SelectItem>
            {(catsQ.data ?? [])
              .filter((c) => c.name !== 'Income')
              .map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={sub} onValueChange={setSub} disabled={catNum == null}>
          <SelectTrigger aria-label="Subcategory">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>All subcategories</SelectItem>
            {(catNum != null ? (subsQ.data ?? []) : []).map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {changed ? (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            disabled={api.updateEnvelope.isPending}
            onClick={() =>
              api.updateEnvelope.mutate(
                {
                  id: row.category_id,
                  body: {
                    txn_category_id: catNum,
                    txn_subcategory_id: sub !== NONE ? Number(sub) : null,
                  },
                },
                { onError: (e) => toast.error(e.message), onSuccess: () => toast.success('Link updated') },
              )
            }
          >
            Save link
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function EnvelopeTransactions({ data, row }: { data: ZbbMonthOut; row: ZbbCategoryRowOut }) {
  const range = monthRange(data)
  const linked = row.txn_category_id != null
  const txQ = useQuery({
    queryKey: [...queryKeys.budgets(), 'envelope-txns', row.txn_category_id, row.txn_subcategory_id, range.startDate],
    queryFn: () =>
      getTransactions<TransactionOut[]>({
        includeTransfers: false,
        startDate: range.startDate,
        endDate: range.endDate,
        categoryId: row.txn_category_id ?? undefined,
        subcategoryId: row.txn_subcategory_id ?? undefined,
        sortBy: 'date',
        sortDir: 'desc',
        limit: 200,
      }),
    enabled: linked,
  })

  // Mirror the budget's matching: only budget accounts, and subcategories that have their
  // own envelope belong to that envelope instead of this category-wide one.
  const budgetAccounts = new Set(data.accounts.map((a) => a.id))
  const claimedSubs = new Set(
    row.txn_subcategory_id == null
      ? data.rows
          .filter((r) => r.txn_category_id === row.txn_category_id && r.txn_subcategory_id != null)
          .map((r) => r.txn_subcategory_id)
      : [],
  )
  const txns = (txQ.data ?? []).filter(
    (t) => t.account_id != null && budgetAccounts.has(t.account_id) && !claimedSubs.has(t.subcategory_id),
  )

  return (
    <section className="space-y-2">
      <p className="eyebrow">Transactions this month</p>
      {!linked ? (
        <p className="text-sm text-muted-foreground">Not linked to a category, so nothing is spent from it automatically.</p>
      ) : txQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : txns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transactions yet.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {txns.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{t.merchant}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {new Date(`${t.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  {' · '}
                  {t.account_name}
                  {t.subcategory_name ? ` · ${t.subcategory_name}` : ''}
                  {t.has_splits ? ' · split' : ''}
                </p>
              </div>
              <span className={cn('shrink-0 tabular-nums', t.amount > 0 && 'text-income')}>{usd(t.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Line({ label, value, strong, className }: { label: string; value: string; strong?: boolean; className?: string }) {
  return (
    <div className={cn('flex justify-between gap-3', strong && 'font-semibold', className)}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
