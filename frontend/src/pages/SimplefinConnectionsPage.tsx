import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { RefreshCw, Trash2, Plug } from 'lucide-react'
import {
  claimConnection,
  deleteConnection,
  getDailyBudget,
  listConnections,
  triggerSync,
  updateConnection,
} from '../api/simplefin'
import type { SimpleFINDailyBudget, SyncResult } from '../api/simplefin'
import { queryKeys } from '../queryKeys'
import ConfirmDialog from '../components/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

  const [token, setToken] = useState('')
  const [label, setLabel] = useState('')
  const [claimError, setClaimError] = useState<string | null>(null)
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null)

  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    action: () => Promise<void>
  } | null>(null)

  const claimMutation = useMutation({
    mutationFn: () => claimConnection(token.trim(), label.trim() || undefined),
    onSuccess: () => {
      setToken('')
      setLabel('')
      setClaimError(null)
      queryClient.invalidateQueries({ queryKey: queryKeys.simplefinConnections() })
    },
    onError: (err: Error) => setClaimError(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.simplefinConnections() })
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
    },
  })

  const syncMutation = useMutation({
    mutationFn: (connectionId: number) => triggerSync({ connection_id: connectionId }),
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
    },
    onError: (err: Error) => setSyncFeedback(`Sync failed: ${err.message}`),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, newStatus }: { id: number; newStatus: string }) =>
      updateConnection(id, { status: newStatus }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.simplefinConnections() }),
  })

  const budgetQueries = useQuery({
    queryKey: ['simplefin', 'daily-budget', connections.map((c) => c.id).join(',')],
    queryFn: async () => {
      const entries = await Promise.all(
        connections.map(async (c) => [c.id, await getDailyBudget(c.id)] as const),
      )
      return Object.fromEntries(entries) as Record<number, SimpleFINDailyBudget>
    },
    enabled: connections.length > 0,
  })

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-lg font-semibold tracking-tight">SimpleFIN Connections</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage root SimpleFIN connections (one connection can contain multiple accounts).{' '}
          <Link to="/sync" className="text-primary underline-offset-4 hover:underline">
            Discover and link accounts &rarr;
          </Link>
        </p>
      </motion.div>

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

      {/* Claim a new connection */}
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
            <Textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste token for a connection that may include multiple accounts…"
              rows={3}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label>Label (optional)</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Chase, Wells Fargo"
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

      {/* Sync feedback */}
      {syncFeedback ? (
        <div className="rounded-lg border bg-muted/40 p-4 text-sm">{syncFeedback}</div>
      ) : null}

      {/* Connection list */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading connections…</p>
      ) : connections.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No SimpleFIN connections yet. Add one root connection token above to get started, then link accounts in Account Sync Setup. Or add{' '}
            <code className="text-xs">SIMPLEFIN_ACCESS_URL_PROD</code> to your <code>.env</code>{' '}
            and restart the server.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {connections.map((conn, idx) => (
            <motion.div
              key={conn.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
            >
              <Card>
                <CardContent className="py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm">{conn.label}</p>
                      <Badge variant={statusVariant(conn.status)} className="text-[10px]">
                        {conn.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Last synced: {formatDate(conn.last_synced_at)}
                    </p>
                    {budgetQueries.data?.[conn.id] ? (
                      <div className="pt-1">
                        <Badge
                          variant={budgetVariant(
                            budgetQueries.data[conn.id].used,
                            budgetQueries.data[conn.id].limit,
                          )}
                          className="text-[10px]"
                        >
                          Daily sync budget: {budgetQueries.data[conn.id].used}/
                          {budgetQueries.data[conn.id].limit}
                        </Badge>
                      </div>
                    ) : null}
                    {conn.last_error ? (
                      <p className="text-xs text-destructive truncate">{conn.last_error}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        syncMutation.isPending ||
                        ((budgetQueries.data?.[conn.id]?.used ?? 0) >=
                          (budgetQueries.data?.[conn.id]?.limit ?? Number.MAX_SAFE_INTEGER))
                      }
                      onClick={() => syncMutation.mutate(conn.id)}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                      Sync now
                    </Button>
                    {conn.status === 'active' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleMutation.mutate({ id: conn.id, newStatus: 'disabled' })}
                      >
                        Disable
                      </Button>
                    ) : conn.status === 'disabled' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleMutation.mutate({ id: conn.id, newStatus: 'active' })}
                      >
                        Enable
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() =>
                        setConfirmState({
                          title: 'Disconnect?',
                          message: `Remove "${conn.label}"? Linked accounts will be unlinked but not deleted.`,
                          action: async () => {
                            await deleteMutation.mutateAsync(conn.id)
                          },
                        })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
