import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Check, LinkIcon, RefreshCw } from 'lucide-react'
import {
  discoverAccounts,
  getDailyBudget,
  linkAccount,
  listConnections,
  triggerSync,
} from '../api/simplefin'
import type { DiscoveredAccount, SimpleFINDailyBudget, SyncResult } from '../api/simplefin'
import { queryKeys } from '../queryKeys'
import { ACCOUNT_TYPES } from '../features/accounts/accountViewKind'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

function formatBalance(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

function formatEpoch(epoch: number) {
  if (!epoch) return '—'
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(epoch * 1000))
  } catch {
    return String(epoch)
  }
}

export default function SimplefinAccountSyncPage() {
  const queryClient = useQueryClient()

  const { data: connections = [], isLoading: connsLoading } = useQuery({
    queryKey: queryKeys.simplefinConnections(),
    queryFn: listConnections,
  })

  const activeConns = connections.filter((c) => c.status === 'active')
  const [selectedConnId, setSelectedConnId] = useState<number | null>(null)
  const effectiveConnId = selectedConnId ?? (activeConns.length === 1 ? activeConns[0].id : null)

  const discoveryQuery = useQuery({
    queryKey: queryKeys.simplefinDiscovery(effectiveConnId!),
    queryFn: () => discoverAccounts(effectiveConnId!),
    enabled: false,
  })

  const dailyBudgetQuery = useQuery({
    queryKey: queryKeys.simplefinDailyBudget(effectiveConnId ?? -1),
    queryFn: () => getDailyBudget(effectiveConnId!),
    enabled: effectiveConnId != null,
  })

  const [syncFeedback, setSyncFeedback] = useState<string | null>(null)
  const dailyBudgetReached =
    dailyBudgetQuery.data != null && dailyBudgetQuery.data.used >= dailyBudgetQuery.data.limit

  const syncMutation = useMutation({
    mutationFn: () => triggerSync({ connection_id: effectiveConnId }),
    onSuccess: (result: SyncResult) => {
      setSyncFeedback(
        `Synced ${result.accounts_synced} account(s), imported ${result.transactions_imported} transaction(s).` +
          (result.errors?.length ? ` Warnings: ${result.errors.join('; ')}` : ''),
      )
      queryClient.invalidateQueries({ queryKey: queryKeys.simplefinConnections() })
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['simplefin', 'daily-budget'] })
      if (effectiveConnId != null) {
        queryClient.invalidateQueries({ queryKey: queryKeys.simplefinDiscovery(effectiveConnId) })
      }
    },
    onError: (err: Error) => setSyncFeedback(`Sync failed: ${err.message}`),
  })

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-lg font-semibold tracking-tight">Account Sync Setup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Discover and link accounts available under the selected SimpleFIN connection.{' '}
          <Link to="/connections" className="text-primary underline-offset-4 hover:underline">
            Manage connections &rarr;
          </Link>
        </p>
      </motion.div>
      {dailyBudgetQuery.data ? (
        <DailyBudgetCue budget={dailyBudgetQuery.data} />
      ) : null}

      {/* Connection picker */}
      {connsLoading ? (
        <p className="text-sm text-muted-foreground">Loading connections…</p>
      ) : activeConns.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No active connections.{' '}
            <Link to="/connections" className="text-primary underline-offset-4 hover:underline">
              Add a SimpleFIN connection first.
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {activeConns.length > 1 ? (
            <div className="space-y-2 max-w-xs">
              <Label>Connection</Label>
              <Select
                value={effectiveConnId != null ? String(effectiveConnId) : undefined}
                onValueChange={(v) => setSelectedConnId(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select connection" />
                </SelectTrigger>
                <SelectContent>
                  {activeConns.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {effectiveConnId == null ? (
            <p className="text-sm text-muted-foreground">Select a connection above to discover accounts.</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => discoveryQuery.refetch()}
                  disabled={discoveryQuery.isFetching}
                >
                  <RefreshCw
                    className={`h-4 w-4 mr-2 ${discoveryQuery.isFetching ? 'animate-spin' : ''}`}
                  />
                  {discoveryQuery.isFetching ? 'Loading accounts…' : 'Load accounts'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Account discovery is manual to avoid consuming SimpleFIN daily quota on page refresh.
                </p>
              </div>

              {discoveryQuery.isFetching ? (
            <p className="text-sm text-muted-foreground">Discovering accounts…</p>
          ) : discoveryQuery.isError ? (
            <p className="text-sm text-destructive">
              {(discoveryQuery.error as Error).message}
            </p>
          ) : !discoveryQuery.data ? (
            <p className="text-sm text-muted-foreground">
              Click <strong>Load accounts</strong> to fetch accounts for this connection.
            </p>
          ) : (
            <>
              {/* Errors from SimpleFIN */}
              {discoveryQuery.data?.errors?.length ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-1">
                  {discoveryQuery.data.errors.map((e, i) => (
                    <p key={i} className="text-sm text-destructive">
                      [{e.code}] {e.message}
                    </p>
                  ))}
                </div>
              ) : null}

              {/* Discovered accounts */}
              <div className="space-y-4">
                {discoveryQuery.data?.accounts.map((acct) => (
                  <DiscoveredAccountCard
                    key={`${acct.conn_id}:${acct.account_id}`}
                    account={acct}
                    connectionId={effectiveConnId}
                  />
                ))}
              </div>

              {/* Sync now */}
              <div className="flex items-center gap-4 pt-4">
                <Button
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending || dailyBudgetReached}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                  {syncMutation.isPending ? 'Syncing…' : 'Sync now'}
                </Button>
                {syncFeedback ? (
                  <p className="text-sm text-muted-foreground">{syncFeedback}</p>
                ) : null}
              </div>
            </>
          )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function DailyBudgetCue({ budget }: { budget: SimpleFINDailyBudget }) {
  const pct = budget.limit > 0 ? budget.used / budget.limit : 0
  const color =
    pct >= 0.9
      ? 'border-destructive/30 bg-destructive/5 text-destructive'
      : pct >= 0.7
        ? 'border-amber-300/40 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
        : 'border-border bg-muted/40 text-muted-foreground'
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${color}`}>
      Daily SimpleFIN request budget for this connection: {budget.used}/{budget.limit} used.
      {pct >= 0.9 ? ' Near limit — avoid repeated manual syncs today.' : null}
    </div>
  )
}

function DiscoveredAccountCard({
  account,
  connectionId,
}: {
  account: DiscoveredAccount
  connectionId: number
}) {
  const queryClient = useQueryClient()
  const isLinked = account.local_account_id != null

  const [localName, setLocalName] = useState(account.name)
  const [localType, setLocalType] = useState<string>('checking')

  const linkMutation = useMutation({
    mutationFn: () =>
      linkAccount({
        connection_id: connectionId,
        conn_id: account.conn_id,
        account_id: account.account_id,
        local_name: localName,
        local_type: localType,
        currency: account.currency,
        institution_name: account.conn_name,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.simplefinDiscovery(connectionId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
    },
  })

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card className={isLinked ? 'border-primary/30 bg-primary/5' : ''}>
        <CardContent className="py-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-sm">{account.name}</p>
            {account.conn_name ? (
              <Badge variant="outline" className="font-normal text-[10px]">
                {account.conn_name}
              </Badge>
            ) : null}
            {isLinked ? (
              <Badge variant="default" className="text-[10px]">
                <Check className="h-3 w-3 mr-1" />
                Linked
              </Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>{account.currency}</span>
            <span>Balance: {formatBalance(account.balance, account.currency)}</span>
            <span>As of: {formatEpoch(account.balance_date)}</span>
          </div>

          {isLinked ? (
            <p className="text-xs text-muted-foreground">
              Mapped to local account #{account.local_account_id}
            </p>
          ) : (
            <div className="flex flex-col sm:flex-row gap-3 items-start pt-1">
              <div className="space-y-1 flex-1 min-w-[180px]">
                <Label className="text-xs">Local name</Label>
                <Input
                  value={localName}
                  onChange={(e) => setLocalName(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1 min-w-[140px]">
                <Label className="text-xs">Account type</Label>
                <Select value={localType} onValueChange={setLocalType}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                className="sm:mt-5"
                onClick={() => linkMutation.mutate()}
                disabled={linkMutation.isPending || !localName.trim()}
              >
                <LinkIcon className="h-3.5 w-3.5 mr-1.5" />
                {linkMutation.isPending ? 'Linking…' : 'Link'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
