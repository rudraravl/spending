import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Landmark, Plus, Trash2 } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { createAccount, deleteAccount, getAccounts, patchAccount } from '../api/accounts'
import { invalidateTransactionData, queryKeys } from '../queryKeys'
import { formatRelativeTime } from '@/lib/dates'
import { formatMoney, formatSignedUsd } from '@/lib/format'
import { toast } from 'sonner'
import { ACCOUNT_TYPES, accountTypeLabel } from '../features/accounts/accountViewKind'
import type { Account } from '../api/accounts'
import SimplefinConnectionsPage from './SimplefinConnectionsPage'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import PageHeader from '@/components/PageHeader'

const TYPE_ORDER = new Map(ACCOUNT_TYPES.map((t, i) => [t, i]))

function groupAccountsByType(accounts: Account[]): { type: string; items: Account[] }[] {
  const byType = new Map<string, Account[]>()
  for (const a of accounts) {
    const list = byType.get(a.type) ?? []
    list.push(a)
    byType.set(a.type, list)
  }
  for (const list of byType.values()) {
    list.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }))
  }
  const types = Array.from(byType.keys())
  types.sort((a, b) => {
    const ia = TYPE_ORDER.get(a as (typeof ACCOUNT_TYPES)[number])
    const ib = TYPE_ORDER.get(b as (typeof ACCOUNT_TYPES)[number])
    const da = ia === undefined ? 999 : ia
    const db = ib === undefined ? 999 : ib
    if (da !== db) return da - db
    return a.localeCompare(b)
  })
  return types.map((type) => ({ type, items: byType.get(type)! }))
}

export default function AccountsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') === 'connections' ? 'connections' : 'accounts'
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<(typeof ACCOUNT_TYPES)[number]>('credit')
  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    action: () => void
  } | null>(null)

  const { data: accounts = [], isLoading, error } = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => getAccounts(),
  })

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; type: string; currency: string }) => createAccount(payload),
    onSuccess: () => {
      setNewName('')
      setCreateOpen(false)
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteAccount(id),
    // Deleting an account deletes its transactions, so every rollup changes.
    onSuccess: () => invalidateTransactionData(queryClient),
    onError: (e: Error) => toast.error(e.message),
  })
  const patchMutation = useMutation({
    mutationFn: (params: { id: number; is_budget_account: boolean }) =>
      patchAccount(params.id, { is_budget_account: params.is_budget_account }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
      // Budget accounts fund the ZBB liquid pool / Ready to Assign.
      void queryClient.invalidateQueries({ queryKey: queryKeys.budgets() })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function handleCreateAccount() {
    const name = newName.trim()
    if (!name) return
    createMutation.mutate({ name, type: newType, currency: 'USD' })
  }

  if (error) {
    return (
      <div className="page">
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      </div>
    )
  }

  const sections = groupAccountsByType(accounts)
  const totals = accounts.reduce(
    (t, a) => {
      const b = Number(a.balance)
      t.net += b
      if (b > 0) t.assets += b
      else t.debts += -b
      if (a.is_budget_account) t.budget += b
      return t
    },
    { net: 0, assets: 0, debts: 0, budget: 0 },
  )

  return (
    <div className="page max-w-6xl">
      <PageHeader
        title="Accounts"
        description="Balances across linked and manual accounts."
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New account
          </Button>
        }
      />
      <ConfirmDialog
        open={confirmState != null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => {
          if (!confirmState) return
          const fn = confirmState.action
          setConfirmState(null)
          fn()
        }}
      />

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) {
            setNewName('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New account</DialogTitle>
            <DialogDescription>
              Manual accounts start at zero balance. Link a bank account later on Connections.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="acct-name">Account name</Label>
              <Input
                id="acct-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Checking"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as (typeof ACCOUNT_TYPES)[number])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {accountTypeLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleCreateAccount} disabled={createMutation.isPending}>
              Create account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams)
          if (value === 'connections') {
            next.set('tab', 'connections')
          } else {
            next.delete('tab')
          }
          setSearchParams(next, { replace: true })
        }}
      >
        <TabsList className="mb-6">
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="connections">Bank Sync</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading accounts…</p>
          ) : accounts.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center space-y-3">
                <p className="text-sm text-muted-foreground">No accounts yet.</p>
                <Button onClick={() => setCreateOpen(true)} variant="secondary" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create your first account
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-5">
              <div className="surface grid grid-cols-2 divide-border/70 sm:grid-cols-4 sm:divide-x">
                {[
                  { label: 'Net worth', value: totals.net },
                  { label: 'Assets', value: totals.assets },
                  { label: 'Debts', value: totals.debts },
                  { label: 'Budget pool', value: totals.budget },
                ].map((t) => (
                  <div key={t.label} className="px-5 py-4">
                    <p className="text-xs text-muted-foreground">{t.label}</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">{formatSignedUsd(t.value)}</p>
                  </div>
                ))}
              </div>

              {sections.map(({ type, items }) => {
                const sectionTotal = items.reduce((n, a) => n + Number(a.balance), 0)
                return (
                  <section key={type} className="surface overflow-hidden">
                    <div className="flex items-center justify-between border-b border-border/70 bg-muted/40 px-5 py-2.5">
                      <h2 className="eyebrow">
                        {accountTypeLabel(type)} <span className="ml-1 font-normal normal-case tracking-normal">· {items.length}</span>
                      </h2>
                      <p className="text-sm font-semibold tabular-nums">{formatSignedUsd(sectionTotal)}</p>
                    </div>
                    <ul className="divide-y divide-border/60">
                      {items.map((a) => (
                        <li key={a.id} className="group/row relative flex items-center gap-4 px-5 py-3 hover:bg-muted/40">
                          <Link to={`/accounts/${a.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary">
                              <Landmark className="h-4 w-4 text-muted-foreground" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium group-hover/row:text-primary">{a.name}</span>
                              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${a.is_linked ? 'bg-income' : 'bg-muted-foreground/50'}`}
                                  aria-hidden
                                />
                                <span className="truncate">
                                  {a.is_linked
                                    ? `${a.institution_name ?? 'Linked'}${a.last_synced_at ? ` · synced ${formatRelativeTime(a.last_synced_at)}` : ''}`
                                    : 'Manual · link on Bank Sync'}
                                  {a.currency !== 'USD' ? ` · ${a.currency}` : ''}
                                </span>
                              </span>
                            </span>
                          </Link>
                          <label className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                            Budget
                            <Switch
                              checked={Boolean(a.is_budget_account)}
                              onCheckedChange={(checked) => patchMutation.mutate({ id: a.id, is_budget_account: checked })}
                            />
                          </label>
                          <span className="w-28 shrink-0 text-right font-semibold tabular-nums">
                            {a.currency === 'USD' ? formatSignedUsd(Number(a.balance)) : formatMoney(a.balance, a.currency)}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/row:opacity-100"
                            title="Delete account"
                            onClick={() =>
                              setConfirmState({
                                title: 'Delete account?',
                                message: `Remove "${a.name}"? This cannot be undone.`,
                                action: () => deleteMutation.mutate(a.id),
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
          )}
        </TabsContent>
        <TabsContent value="connections">
          <SimplefinConnectionsPage embedded />
        </TabsContent>
      </Tabs>
    </div>
  )
}
