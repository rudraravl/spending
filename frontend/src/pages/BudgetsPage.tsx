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
          <CardTitle className="text-base">Ready to Assign</CardTitle>
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
            Liquid Pool {money(zbbQ.data?.liquid_pool ?? 0)} • Assigned {money(zbbQ.data?.total_assigned ?? 0)}
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
            {zbbQ.data?.rows.map((row) => (
              <div key={row.category_id} className="grid grid-cols-12 gap-2 items-center border rounded-md px-3 py-2">
                <div className="col-span-4 text-sm font-medium">
                  {row.category_name}
                  {row.is_system && row.system_kind === 'cc_payment' ? (
                    <span className="ml-2 text-[10px] rounded bg-muted px-1.5 py-0.5">Protected</span>
                  ) : null}
                </div>
                <div className="col-span-3">
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
                <div className="col-span-2 text-xs text-muted-foreground text-right">{money(row.activity)}</div>
                <div className={cn('col-span-3 text-right font-mono text-sm', row.available < 0 ? 'text-red-600' : '')}>
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
            <Input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Emergency Fund" />
          </div>
          <div className="md:col-span-1">
            <Label>Txn category (optional)</Label>
            <Select value={newTxnCategoryId} onValueChange={setNewTxnCategoryId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {(txnCategoriesQ.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-1">
            <Label>Txn subcategory (optional)</Label>
            <Select value={newTxnSubcategoryId} onValueChange={setNewTxnSubcategoryId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {(newTxnCategoryId !== 'none' ? (txnSubcategoriesQ.data?.[Number(newTxnCategoryId)] ?? []) : []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
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
                  txn_subcategory_id: newTxnSubcategoryId === 'none' ? null : Number(newTxnSubcategoryId),
                })
              }
              disabled={!newCategoryName.trim() || createCategoryMut.isPending}
            >
              Add
            </Button>
          </div>
          {zbbCategoriesQ.data ? (
            <p className="md:col-span-4 text-xs text-muted-foreground">
              {zbbCategoriesQ.data.filter((c) => c.is_system).length} protected system categories are managed automatically.
            </p>
          ) : null}
        </CardContent>
      </Card>

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

