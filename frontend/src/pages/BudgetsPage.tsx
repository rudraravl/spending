import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getZbbCategories,
  getZbbMonth,
  patchZbbAssign,
  patchZbbSettings,
  postZbbCategory,
  postZbbMoveMoney,
} from '@/api/budgets'
import { getCategories, getSubcategories } from '@/api/categories'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

function money(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n)
}

function monthLabel(y: number, m: number) {
  const d = new Date(y, m - 1, 1)
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' })
}

export default function BudgetsPage() {
  const qc = useQueryClient()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const years = useMemo(() => {
    const y = now.getFullYear()
    return [y - 1, y, y + 1]
  }, [now])
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveFrom, setMoveFrom] = useState<string>('')
  const [moveTo, setMoveTo] = useState<string>('')
  const [moveAmount, setMoveAmount] = useState<string>('')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newTxnCategoryId, setNewTxnCategoryId] = useState<string>('none')
  const [newTxnSubcategoryId, setNewTxnSubcategoryId] = useState<string>('none')

  const zbbQ = useQuery({
    queryKey: ['zbbMonth', year, month],
    queryFn: () => getZbbMonth({ year, month }),
  })
  const zbbCategoriesQ = useQuery({
    queryKey: ['zbbCategories'],
    queryFn: () => getZbbCategories(),
  })
  const txnCategoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => getCategories(),
    staleTime: 5 * 60 * 1000,
  })
  const txnSubcategoriesQ = useQuery({
    queryKey: ['subcategoriesByCategory'],
    queryFn: async () => {
      const cats = await getCategories()
      const entries = await Promise.all(cats.map(async (c) => [c.id, await getSubcategories(c.id)] as const))
      return Object.fromEntries(entries) as Record<number, { id: number; name: string; category_id: number }[]>
    },
    staleTime: 5 * 60 * 1000,
  })

  const assignMut = useMutation({
    mutationFn: (payload: { category_id: number; assigned: number }) =>
      patchZbbAssign({ year, month, body: payload }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['zbbMonth', year, month] })
    },
  })

  const moveMut = useMutation({
    mutationFn: (payload: { from_category_id: number; to_category_id: number; amount: number }) =>
      postZbbMoveMoney({ year, month, body: payload }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['zbbMonth', year, month] })
      setMoveOpen(false)
      setMoveAmount('')
    },
  })

  const modeMut = useMutation({
    mutationFn: (rollover_mode: 'strict' | 'flexible') => patchZbbSettings({ rollover_mode }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['zbbMonth', year, month] })
    },
  })
  const createCategoryMut = useMutation({
    mutationFn: (body: { name: string; txn_category_id?: number | null; txn_subcategory_id?: number | null }) =>
      postZbbCategory(body),
    onSuccess: async () => {
      setNewCategoryName('')
      setNewTxnCategoryId('none')
      setNewTxnSubcategoryId('none')
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['zbbCategories'] }),
        qc.invalidateQueries({ queryKey: ['zbbMonth', year, month] }),
      ])
    },
  })

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <Tabs defaultValue="budget">
        <TabsList className="mb-2">
          <TabsTrigger value="budget">Budget</TabsTrigger>
          <TabsTrigger value="help">ZBB help</TabsTrigger>
        </TabsList>

        <TabsContent value="budget" className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Month</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-4">
              <div className="grid gap-1.5">
                <Label>Year</Label>
                <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label>Month</Label>
                <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Select month" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }).map((_, idx) => {
                      const m = idx + 1
                      return (
                        <SelectItem key={m} value={String(m)}>
                          {monthLabel(2000, m).replace('2000', '').trim()}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="ml-auto pt-5">
                <Button type="button" variant="outline" onClick={() => setMoveOpen(true)}>
                  Move money
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ready to Assign (RTA)</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  'text-3xl font-bold font-mono',
                  (zbbQ.data?.ready_to_assign ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600',
                )}
              >
                {money(zbbQ.data?.ready_to_assign ?? 0)}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Liquid Pool {money(zbbQ.data?.liquid_pool ?? 0)} • Assigned this month{' '}
                {money(zbbQ.data?.total_assigned ?? 0)}
              </p>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                RTA is what is left to assign after accounting for every envelope&apos;s{' '}
                <span className="font-medium text-foreground">Available</span> (money already covering
                categories) and, in <span className="font-medium text-foreground">flexible</span> mode,
                overspend pulled from prior months. See the <span className="font-medium text-foreground">ZBB help</span>{' '}
                tab for the exact formula and where each number is computed.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Label className="text-xs">Rollover mode</Label>
                <Select
                  value={(zbbQ.data?.rollover_mode as 'strict' | 'flexible' | undefined) ?? 'strict'}
                  onValueChange={(v) => modeMut.mutate(v as 'strict' | 'flexible')}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strict">Strict</SelectItem>
                    <SelectItem value="flexible">Flexible</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Strict:</span> negative category balances carry into next
                month. <span className="font-medium text-foreground">Flexible:</span> categories reset to $0 and the
                overspent amount is deducted from next month&apos;s Ready to Assign.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Envelope Grid ({monthLabel(year, month)})</CardTitle>
            </CardHeader>
            <CardContent>
              {zbbQ.isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
              {zbbQ.error ? <p className="text-sm text-destructive">{(zbbQ.error as Error).message}</p> : null}
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <div className="col-span-3">Category</div>
                  <div className="col-span-2">Assigned</div>
                  <div className="col-span-2 text-right">Rollover</div>
                  <div className="col-span-2 text-right">Activity</div>
                  <div className="col-span-3 text-right">Available</div>
                </div>
                {zbbQ.data?.rows.map((row) => (
                  <div key={row.category_id} className="grid grid-cols-12 gap-2 items-center border rounded-md px-3 py-2">
                    <div className="col-span-3 text-sm font-medium min-w-0">
                      {row.category_name}
                      {row.is_system && row.system_kind === 'cc_payment' ? (
                        <span className="ml-2 text-[10px] rounded bg-muted px-1.5 py-0.5">Protected</span>
                      ) : null}
                    </div>
                    <div className="col-span-2">
                      <Input
                        defaultValue={String(row.assigned)}
                        inputMode="decimal"
                        onBlur={(e) => {
                          const v = Number(e.target.value)
                          if (!Number.isFinite(v)) return
                          if (v === row.assigned) return
                          assignMut.mutate({ category_id: row.category_id, assigned: v })
                        }}
                      />
                    </div>
                    <div className="col-span-2 text-right">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground sm:hidden">Rollover</p>
                      <p className="text-xs text-muted-foreground font-mono tabular-nums">{money(row.rollover)}</p>
                    </div>
                    <div className="col-span-2 text-right">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground sm:hidden">Activity</p>
                      <p className="text-xs text-muted-foreground">{money(row.activity)}</p>
                    </div>
                    <div
                      className={cn(
                        'col-span-3 text-right font-mono text-sm tabular-nums',
                        row.available < 0 ? 'text-red-600' : '',
                      )}
                    >
                      <p className="text-[10px] font-sans uppercase tracking-wide text-muted-foreground sm:hidden">
                        Available
                      </p>
                      {money(row.available)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add Budget Category</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div className="md:col-span-1">
                <Label>Name</Label>
                <Input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Emergency Fund"
                />
              </div>
              <div className="md:col-span-1">
                <Label>Txn category (optional)</Label>
                <Select value={newTxnCategoryId} onValueChange={setNewTxnCategoryId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(txnCategoriesQ.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-1">
                <Label>Txn subcategory (optional)</Label>
                <Select value={newTxnSubcategoryId} onValueChange={setNewTxnSubcategoryId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(newTxnCategoryId !== 'none'
                      ? (txnSubcategoriesQ.data?.[Number(newTxnCategoryId)] ?? [])
                      : []
                    ).map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-1 flex justify-end">
                <Button
                  onClick={() =>
                    createCategoryMut.mutate({
                      name: newCategoryName,
                      txn_category_id: newTxnCategoryId === 'none' ? null : Number(newTxnCategoryId),
                      txn_subcategory_id:
                        newTxnSubcategoryId === 'none' ? null : Number(newTxnSubcategoryId),
                    })
                  }
                  disabled={!newCategoryName.trim() || createCategoryMut.isPending}
                >
                  Add
                </Button>
              </div>
              {zbbCategoriesQ.data ? (
                <p className="md:col-span-4 text-xs text-muted-foreground">
                  {zbbCategoriesQ.data.filter((c) => c.is_system).length} protected system categories are managed
                  automatically.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="help" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">How this app implements ZBB</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
              <p className="text-foreground/90">
                You already know the idea: give every dollar a job. This page is tied to a specific implementation in
                the app: a <span className="font-medium text-foreground">liquid pool</span> from selected accounts,
                per-month <span className="font-medium text-foreground">assigned</span> amounts you edit,
                <span className="font-medium text-foreground"> activity</span> derived from transactions, and{' '}
                <span className="font-medium text-foreground">rollover</span> from how last month ended. Nothing
                “recursive” runs in a loop; each number is computed once when you load or save the month.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Where each top-of-page number comes from</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
              <div className="space-y-2">
                <p className="font-medium text-foreground">Liquid Pool</p>
                <p>
                  Sum of <span className="font-medium text-foreground">display balances</span> for every account marked
                  as a budget account (on the Accounts screen). Display balance uses the bank/sync{' '}
                  <span className="font-mono text-xs">reported_balance</span> when set, otherwise the ledger sum of all
                  transactions including transfers. Credit cards are usually{' '}
                  <span className="font-medium text-foreground">not</span> included in the liquid pool unless you
                  explicitly treat them as budget accounts.
                </p>
              </div>
              <div className="space-y-2">
                <p className="font-medium text-foreground">Assigned (subtitle)</p>
                <p>
                  Sum of the <span className="font-medium text-foreground">Assigned</span> column for the month you
                  selected—only that calendar month&apos;s envelope plan, not history.
                </p>
              </div>
              <div className="space-y-2">
                <p className="font-medium text-foreground">Ready to Assign (RTA)</p>
                <p>
                  After the app knows how much is in the liquid pool and how much is already “covered” in envelopes
                  (see below), RTA is what is left to assign. Concretely:
                </p>
                <ul className="list-disc pl-5 space-y-1.5 font-mono text-xs text-foreground/80 bg-muted/50 rounded-md p-3 mt-2">
                  <li>RTA = LiquidPool − Σ max(0, Availableᵢ) − Σ max(0, −Availableᵢ) − priorDeficit</li>
                </ul>
                <p className="mt-2">
                  The middle two terms are “money already spoken for” in categories with positive{' '}
                  <span className="font-medium text-foreground">Available</span>, plus explicit overspend (negative
                  Available) so RTA does not pretend that missing dollars do not exist. In{' '}
                  <span className="font-medium text-foreground">flexible</span> rollover mode, overspend from earlier
                  months is also tracked as <span className="font-mono text-xs">priorDeficit</span> and subtracted once
                  from RTA (not in a loop with category rows).
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Envelope grid columns</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
              <p>
                For the selected <span className="font-medium text-foreground">Year / Month</span>, each row is one
                budget category (envelope). The columns are tied to fields returned by the server:
              </p>
              <dl className="space-y-3">
                <div>
                  <dt className="font-medium text-foreground">Assigned</dt>
                  <dd className="mt-1">
                    What you plan to budget into this envelope this month. Stored per month in the database; editing
                    and blurring the field saves. Increasing assignment reduces RTA until you hit the API guard
                    (assignments that would make RTA negative are rejected).
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Rollover</dt>
                  <dd className="mt-1">
                    What carried <span className="font-medium text-foreground">into this month</span> from how the{' '}
                    <span className="font-medium text-foreground">previous calendar month</span> ended—after that
                    month&apos;s own assigned and activity, and after applying your strict vs flexible rules. It is{' '}
                    <span className="font-medium text-foreground">not</span> editable; it is derived.
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Activity</dt>
                  <dd className="mt-1">
                    For normal categories: spending this month from categorized, non-transfer transactions—mapped from
                    your transaction <span className="font-medium text-foreground">category / subcategory</span> to
                    this budget category when you linked them. Amounts use your app&apos;s sign convention (outflows
                    negative); activity is shown as a spending-style positive number where applicable. For{' '}
                    <span className="font-medium text-foreground">Protected</span> CC payment rows, activity comes from
                    charges and payments on that credit account in the month, not from Food/Shopping categories.
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Available</dt>
                  <dd className="mt-1">
                    Single rule for every row:{' '}
                    <span className="font-mono text-xs text-foreground/90">
                      Available = Rollover + Assigned − Activity
                    </span>
                    . This is the envelope balance for the month so far. It is not stored independently; it is
                    recomputed whenever the month is loaded.
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Monthly flow (no double counting)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground leading-relaxed">
              <p>
                For each request, the server (1) refreshes <span className="font-medium text-foreground">activity</span>{' '}
                from transactions for that month only, (2) walks prior months only to compute starting{' '}
                <span className="font-medium text-foreground">rollover</span> and flexible deficit—using each prior
                month once in a chain with memoization, (3) computes <span className="font-medium text-foreground">available</span>{' '}
                and then <span className="font-medium text-foreground">RTA</span>. Assignments and activity are not
                applied twice to the same dollar in the same month.
              </p>
              <p>
                <span className="font-medium text-foreground">Move money</span> only adjusts{' '}
                <span className="font-medium text-foreground">Assigned</span> between two categories for that month;
                total assigned across all categories stays the same, and RTA is unchanged.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Strict vs flexible rollover</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground leading-relaxed">
              <p>
                <span className="font-medium text-foreground">Strict:</span> At the start of a new month, each
                envelope&apos;s rollover is last month&apos;s Available (positive or negative). Underspending and
                overspending both roll forward in the category.
              </p>
              <p>
                <span className="font-medium text-foreground">Flexible:</span> Negative Available at the end of a month
                is zeroed for the next month&apos;s rollover—that category starts fresh at 0 carried in—but the
                overspent amount is tracked and subtracted from next month&apos;s RTA so the books still balance.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Setup checklist</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground leading-relaxed">
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  Mark checking/savings/cash (and any account that should count as “cash to assign”) as budget accounts.
                </li>
                <li>
                  Categorize transactions: uncategorized non-transfer rows in the selected month block new assignments
                  (the API enforces this so Activity and RTA stay honest).
                </li>
                <li>
                  Optionally link a budget category to a transaction category/subcategory so Activity flows into the
                  right envelope.
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Protected (credit card payment) rows</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed">
              <p>
                One system envelope per credit card account. Their Activity reflects net card usage and payments in the
                month so Available tracks how much you still need for the payment. They are marked{' '}
                <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px]">Protected</span> from edits in
                category management; treat them as part of the plan, not optional slush.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move money</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>From</Label>
              <Select value={moveFrom} onValueChange={setMoveFrom}>
                <SelectTrigger><SelectValue placeholder="From category" /></SelectTrigger>
                <SelectContent>
                  {(zbbQ.data?.rows ?? []).map((row) => (
                    <SelectItem key={row.category_id} value={String(row.category_id)}>{row.category_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>To</Label>
              <Select value={moveTo} onValueChange={setMoveTo}>
                <SelectTrigger><SelectValue placeholder="To category" /></SelectTrigger>
                <SelectContent>
                  {(zbbQ.data?.rows ?? []).map((row) => (
                    <SelectItem key={row.category_id} value={String(row.category_id)}>{row.category_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount</Label>
              <Input value={moveAmount} onChange={(e) => setMoveAmount(e.target.value)} inputMode="decimal" />
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() =>
                  moveMut.mutate({
                    from_category_id: Number(moveFrom),
                    to_category_id: Number(moveTo),
                    amount: Number(moveAmount),
                  })
                }
                disabled={!moveFrom || !moveTo || !moveAmount || moveMut.isPending}
              >
                Move
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

