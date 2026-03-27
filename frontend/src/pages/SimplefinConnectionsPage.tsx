import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { LinkIcon, Plug, RefreshCw, Unlink } from 'lucide-react'
import { getAccounts } from '../api/accounts'
import {
  claimConnection,
  discoverAccounts,
  getCachedAccounts,
  getDailyBudget,
  linkAccount,
  listConnections,
  triggerSync,
  unlinkAccount,
} from '../api/simplefin'
import type { Account } from '../api/accounts'
import type { CachedDiscoveryResponse, DiscoveredAccount, SimpleFINDailyBudget, SyncResult } from '../api/simplefin'
import { queryKeys } from '../queryKeys'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

function formatDate(iso: string | null | undefined) {
  if (!iso) return 'Never'
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    )
  } catch {
    return iso
  }
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' {
  if (status === 'active') return 'default'
  if (status === 'error') return 'destructive'
  return 'secondary'
}

function budgetVariant(used: number, limit: number): 'default' | 'secondary' | 'destructive' {
  if (limit <= 0) return 'secondary'
  const pct = used / limit
  if (pct >= 0.9) return 'destructive'
  if (pct >= 0.7) return 'secondary'
  return 'default'
}

export default function SimplefinConnectionsPage() {
  const queryClient = useQueryClient()

  const { data: connections = [], isLoading } = useQuery({
    queryKey: queryKeys.simplefinConnections(),
    queryFn: listConnections,
  })
  const connection = connections[0] ?? null

  const { data: localAccounts = [] } = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: getAccounts,
  })

  const [token, setToken] = useState('')
  const [claimError, setClaimError] = useState<string | null>(null)
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null)

  const claimMutation = useMutation({
    mutationFn: () => claimConnection(token.trim(), 'SimpleFIN'),
    onSuccess: async () => {
      setToken('')
      setClaimError(null)
      await discoverAccounts()
      queryClient.invalidateQueries({ queryKey: queryKeys.simplefinConnections() })
      queryClient.invalidateQueries({ queryKey: ['simplefin', 'cached-accounts'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
    },
    onError: (err: Error) => setClaimError(err.message),
  })

  const syncMutation = useMutation({
    mutationFn: () => triggerSync({ connection_id: connection?.id ?? null }),
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
      queryClient.invalidateQueries({ queryKey: ['simplefin', 'cached-accounts'] })
    },
    onError: (err: Error) => setSyncFeedback(`Sync failed: ${err.message}`),
  })

  const linkMutation = useMutation({
    mutationFn: (payload: { remote: DiscoveredAccount; localAccountId: number }) =>
      linkAccount({
        conn_id: payload.remote.conn_id,
        account_id: payload.remote.account_id,
        local_account_id: payload.localAccountId,
        institution_name: payload.remote.conn_name,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simplefin', 'cached-accounts'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
    },
  })

  const unlinkMutation = useMutation({
    mutationFn: (localAccountId: number) => unlinkAccount(localAccountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simplefin', 'cached-accounts'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
    },
  })

  const budgetQuery = useQuery({
    queryKey: ['simplefin', 'daily-budget', connection?.id ?? 'none'],
    queryFn: () => getDailyBudget(connection?.id ?? null),
    enabled: connection != null,
  })

  const cachedAccountsQuery = useQuery({
    queryKey: ['simplefin', 'cached-accounts'],
    queryFn: getCachedAccounts,
  })

  const refreshAccountsMutation = useMutation({
    mutationFn: () => discoverAccounts(connection?.id ?? null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simplefin', 'cached-accounts'] })
    },
  })

  const dailyBudget = budgetQuery.data as SimpleFINDailyBudget | undefined
  const cachedSnapshot = cachedAccountsQuery.data as CachedDiscoveryResponse | undefined

  const localAccountOptions = useMemo(
    () =>
      localAccounts.filter(
        (a: Account) =>
          !a.is_linked || (a.provider === 'simplefin' && a.external_id != null),
      ),
    [localAccounts],
  )

  const claimConnectionCard = (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Plug className="h-4 w-4" />
          Add a root connection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>SimpleFIN Token</Label>
          <p className="text-xs text-muted-foreground">
            {connection
              ? 'Replace current connection: generate a new token from your provider `/create` page and claim it here.'
              : 'First-time setup: open your institution or Bridge `/create` page, generate a token, then paste it here.'}
          </p>
          <Textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste SimpleFIN token..."
            rows={3}
            className="font-mono text-xs"
          />
        </div>
        {claimError ? (
          <p className="text-sm text-destructive">{claimError}</p>
        ) : null}
        <Button
          onClick={() => claimMutation.mutate()}
          disabled={!token.trim() || claimMutation.isPending}
        >
          {claimMutation.isPending ? 'Claiming…' : 'Claim & Connect'}
        </Button>
      </CardContent>
    </Card>
  )

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-lg font-semibold tracking-tight">SimpleFIN Connections</h1>
        <p className="text-sm text-muted-foreground mt-1">
          One root connection only. Link your local accounts to remote SimpleFIN accounts here.
          {' '}
          <Link to="/accounts" className="text-primary underline-offset-4 hover:underline">
            View local accounts &rarr;
          </Link>
        </p>
      </motion.div>

      {!connection ? claimConnectionCard : null}

      {/* Sync feedback */}
      {syncFeedback ? (
        <div className="rounded-lg border bg-muted/40 p-4 text-sm">{syncFeedback}</div>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading connections…</p>
      ) : !connection ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No SimpleFIN connection configured yet. Follow the token steps above to claim your first access URL.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm">{connection.label}</p>
                  <Badge variant={statusVariant(connection.status)} className="text-[10px]">
                    {connection.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">Last synced: {formatDate(connection.last_synced_at)}</p>
                {dailyBudget ? (
                  <Badge variant={budgetVariant(dailyBudget.used, dailyBudget.limit)} className="text-[10px]">
                    Daily sync budget: {dailyBudget.used}/{dailyBudget.limit}
                  </Badge>
                ) : null}
                {connection.last_error ? <p className="text-xs text-destructive truncate">{connection.last_error}</p> : null}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={syncMutation.isPending || ((dailyBudget?.used ?? 0) >= (dailyBudget?.limit ?? Number.MAX_SAFE_INTEGER))}
                  onClick={() => syncMutation.mutate()}
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                  Sync now
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refreshAccountsMutation.mutate()}
                  disabled={refreshAccountsMutation.isPending}
                >
                  {refreshAccountsMutation.isPending ? 'Refreshing…' : 'Refresh cached accounts'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Available remote accounts (cached)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {cachedSnapshot?.captured_at ? (
                <p className="text-xs text-muted-foreground">Snapshot captured: {formatDate(cachedSnapshot.captured_at)}</p>
              ) : (
                <p className="text-xs text-muted-foreground">No cached snapshot yet. Click “Refresh cached accounts” or “Sync now”.</p>
              )}
              {cachedSnapshot?.errors?.map((e, i) => (
                <p key={`cache-err-${i}`} className="text-xs text-destructive">
                  [{e.code}] {e.message}
                </p>
              ))}
              {cachedSnapshot?.accounts?.length ? (
                <div className="space-y-3">
                  {cachedSnapshot.accounts.map((remote) => (
                    <RemoteAccountRow
                      key={`${remote.conn_id}:${remote.account_id}`}
                      remote={remote}
                      localAccounts={localAccountOptions}
                      onLink={(localAccountId) => linkMutation.mutate({ remote, localAccountId })}
                      onUnlink={(localAccountId) => unlinkMutation.mutate(localAccountId)}
                      isLinking={linkMutation.isPending}
                      isUnlinking={unlinkMutation.isPending}
                    />
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
      {connection ? claimConnectionCard : null}
    </div>
  )
}

function RemoteAccountRow({
  remote,
  localAccounts,
  onLink,
  onUnlink,
  isLinking,
  isUnlinking,
}: {
  remote: DiscoveredAccount
  localAccounts: Account[]
  onLink: (localAccountId: number) => void
  onUnlink: (localAccountId: number) => void
  isLinking: boolean
  isUnlinking: boolean
}) {
  const [selectedLocal, setSelectedLocal] = useState<string>(remote.local_account_id ? String(remote.local_account_id) : '')
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{remote.name}</p>
          <p className="text-xs text-muted-foreground">{remote.conn_name || remote.conn_id}</p>
        </div>
        {remote.local_account_id ? (
          <Badge className="text-[10px]">Linked to local #{remote.local_account_id}</Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px]">Unlinked</Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Select value={selectedLocal} onValueChange={setSelectedLocal}>
          <SelectTrigger className="h-8 text-xs max-w-xs">
            <SelectValue placeholder="Select local account" />
          </SelectTrigger>
          <SelectContent>
            {localAccounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedLocal || isLinking}
          onClick={() => onLink(Number(selectedLocal))}
        >
          <LinkIcon className="h-3.5 w-3.5 mr-1.5" />
          Link
        </Button>
        {remote.local_account_id ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={isUnlinking}
            onClick={() => onUnlink(remote.local_account_id!)}
          >
            <Unlink className="h-3.5 w-3.5 mr-1.5" />
            Unlink
          </Button>
        ) : null}
      </div>
    </div>
  )
}
