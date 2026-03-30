import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ChevronRight, Landmark, Plus, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { createAccount, deleteAccount, getAccounts } from '../api/accounts'
import { queryKeys } from '../queryKeys'
import { ACCOUNT_TYPES, accountTypeLabel } from '../features/accounts/accountViewKind'
import type { Account } from '../api/accounts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
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

function linkLabel(isLinked: boolean | undefined) {
  if (isLinked) return 'Linked'
  return 'Manual only'
}

function formatSyncTime(iso: string | null | undefined) {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(
      new Date(iso),
    )
  } catch {
    return iso
  }
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
}

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

async function invalidateAccountQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
  await queryClient.invalidateQueries({ queryKey: queryKeys.settingsAll() })
}

export default function AccountsPage() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<(typeof ACCOUNT_TYPES)[number]>('credit')
  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    action: () => Promise<void>
  } | null>(null)

  const { data: accounts = [], isLoading, error } = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => getAccounts(),
  })

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; type: string; currency: string }) => createAccount(payload),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteAccount(id),
  })

  async function handleCreateAccount() {
    const name = newName.trim()
    if (!name) return
    await createMutation.mutateAsync({ name, type: newType, currency: 'USD' })
    setNewName('')
    setCreateOpen(false)
    await invalidateAccountQueries(queryClient)
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      </div>
    )
  }

  const sections = groupAccountsByType(accounts)

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <ConfirmDialog
        open={confirmState != null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        onCancel={() => setConfirmState(null)}
        onConfirm={async () => {
          if (!confirmState) return
          const fn = confirmState.action
          setConfirmState(null)
          await fn()
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

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-xl leading-relaxed">
            Open an account for balances and activity. Link institutions on{' '}
            <Link to="/connections" className="text-primary underline-offset-4 hover:underline">
              Connections
            </Link>
            .
          </p>
        </motion.div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0 gap-2">
          <Plus className="h-4 w-4" />
          New account
        </Button>
      </div>

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
        <div className="space-y-10">
          {sections.map(({ type, items }, sectionIdx) => {
            const cardOffset = sections.slice(0, sectionIdx).reduce((n, s) => n + s.items.length, 0)
            return (
              <section key={type}>
                <h2 className="text-sm font-semibold text-foreground tracking-tight mb-4">
                  {accountTypeLabel(type)}
                </h2>
                <ul className="grid gap-4 sm:grid-cols-2">
                  {items.map((a, j) => (
                    <motion.li
                      key={a.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: (cardOffset + j) * 0.04 }}
                      className="min-w-0"
                    >
                      <Card className="group/card relative h-full overflow-hidden transition-colors hover:border-border">
                        <Link to={`/accounts/${a.id}`} className="block">
                          <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2 pr-14">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                                <Landmark className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium leading-tight truncate group-hover/card:text-primary transition-colors">
                                  {a.name}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">{a.currency}</p>
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover/card:opacity-100 transition-opacity" />
                          </CardHeader>
                          <CardContent className="pt-0 space-y-2 pb-4">
                            <p className="text-lg font-semibold tabular-nums tracking-tight">
                              {formatMoney(a.balance, a.currency)}
                            </p>
                            <Badge variant={a.is_linked ? 'default' : 'secondary'} className="text-[10px]">
                              {linkLabel(a.is_linked)}
                            </Badge>
                            {a.institution_name ? (
                              <p className="text-xs text-muted-foreground truncate">{a.institution_name}</p>
                            ) : null}
                            {a.is_linked && a.last_synced_at ? (
                              <p className="text-[10px] text-muted-foreground">
                                Synced {formatSyncTime(a.last_synced_at)}
                              </p>
                            ) : null}
                            {!a.is_linked ? (
                              <p className="text-[10px] text-muted-foreground">
                                Link this local account on Connections.
                              </p>
                            ) : null}
                          </CardContent>
                        </Link>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-2 top-3 z-10 h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover/card:opacity-100 transition-opacity"
                          title="Delete account"
                          onClick={() =>
                            setConfirmState({
                              title: 'Delete account?',
                              message: `Remove "${a.name}"? This cannot be undone.`,
                              action: async () => {
                                await deleteMutation.mutateAsync(a.id)
                                await invalidateAccountQueries(queryClient)
                              },
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </Card>
                    </motion.li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
