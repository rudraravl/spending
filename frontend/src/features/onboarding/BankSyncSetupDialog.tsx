import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, Plug, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { createAccount, getAccounts, patchAccount } from '@/api/accounts'
import {
  claimConnection,
  discoverAccounts,
  getCachedAccounts,
  linkAccount,
  listConnections,
  type DiscoveredAccount,
} from '@/api/simplefin'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ACCOUNT_TYPES, accountTypeLabel, type AccountType } from '@/features/accounts/accountViewKind'
import { syncResultSummary, useSimplefinSync } from '@/features/simplefin/useSimplefinSync'
import { formatSignedUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { queryKeys } from '@/queryKeys'

const BRIDGE_URL = 'https://beta-bridge.simplefin.org/'
const NEW_ACCOUNT = 'new'

type Step = 'intro' | 'token' | 'link' | 'sync'
const STEPS: { key: Step; label: string }[] = [
  { key: 'intro', label: 'Get a token' },
  { key: 'token', label: 'Connect' },
  { key: 'link', label: 'Link an account' },
  { key: 'sync', label: 'Sync' },
]

/** Best guess at a local account type from the bank's account name. */
function guessType(remoteName: string): AccountType {
  if (/credit|card|visa|mastercard|amex|sapphire|freedom/i.test(remoteName)) return 'credit'
  if (/saving|money market|hysa/i.test(remoteName)) return 'savings'
  if (/brokerage|ira\b|401|roth|invest|individual/i.test(remoteName)) return 'investment'
  return 'checking'
}

type Props = {
  /** Local account to pre-select when linking (e.g. the one just created in the welcome flow). */
  localAccountId?: number
  onClose: () => void
}

/** Guided SimpleFIN setup: get a token, claim it, link one remote account, run the first sync. */
export default function BankSyncSetupDialog({ localAccountId, onClose }: Props) {
  const queryClient = useQueryClient()
  const connectionsQ = useQuery({ queryKey: queryKeys.simplefinConnections(), queryFn: listConnections })
  const connection = connectionsQ.data?.[0] ?? null
  const [chosenStep, setChosenStep] = useState<Step | null>(null)
  // Users who already connected skip straight to linking.
  const step: Step = chosenStep ?? (connection ? 'link' : 'intro')

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4" /> Set up bank sync
          </DialogTitle>
          <DialogDescription>Optional. Manual accounts and CSV import work fine without it.</DialogDescription>
        </DialogHeader>

        <ol className="grid grid-cols-4 gap-1.5" aria-label="Setup progress">
          {STEPS.map((s, i) => {
            const current = STEPS.findIndex((x) => x.key === step)
            return (
              <li key={s.key} className="space-y-1">
                <div className={cn('h-1 rounded-full', i <= current ? 'bg-primary' : 'bg-muted')} />
                <p className={cn('text-[11px]', i === current ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                  {s.label}
                </p>
              </li>
            )
          })}
        </ol>

        {connectionsQ.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : step === 'intro' ? (
          <IntroStep onNext={() => setChosenStep('token')} onClose={onClose} />
        ) : step === 'token' ? (
          <TokenStep
            onBack={() => setChosenStep('intro')}
            onClaimed={() => {
              void queryClient.invalidateQueries({ queryKey: queryKeys.simplefinConnections() })
              setChosenStep('link')
            }}
          />
        ) : step === 'link' ? (
          <LinkStep localAccountId={localAccountId} onLinked={() => setChosenStep('sync')} onClose={onClose} />
        ) : (
          <SyncStep connectionId={connection?.id} onLinkAnother={() => setChosenStep('link')} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function IntroStep({ onNext, onClose }: { onNext: () => void; onClose: () => void }) {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        <a href="https://www.simplefin.org/" target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
          SimpleFIN
        </a>{' '}
        gives Keep read-only access to your bank data. The easiest way to use it is SimpleFIN Bridge, a hosted service
        that costs a few dollars a month and connects to most US banks.
      </p>
      <ol className="space-y-3">
        <Numbered n={1}>
          Sign up at{' '}
          <a href={BRIDGE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
            SimpleFIN Bridge <ExternalLink className="h-3 w-3" />
          </a>{' '}
          and connect your banks there.
        </Numbered>
        <Numbered n={2}>
          Create a new <strong>app connection</strong> for Keep. Bridge shows a one-time <strong>setup token</strong> (a
          long string of letters and numbers).
        </Numbered>
        <Numbered n={3}>Copy the token and come back here.</Numbered>
      </ol>
      <p className="flex items-start gap-2 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-income" />
        Keep only reads data and never moves money. The connection is encrypted and stored in your local database.
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={onClose}>
          Not now
        </Button>
        <Button onClick={onNext}>I have a token</Button>
      </div>
    </div>
  )
}

function TokenStep({ onBack, onClaimed }: { onBack: () => void; onClaimed: () => void }) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')
  const claim = useMutation({
    mutationFn: async () => {
      await claimConnection(token.trim(), 'SimpleFIN')
      // Fill the remote-account cache so the next step has something to link.
      await discoverAccounts()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.simplefinCachedAccounts() })
      onClaimed()
    },
  })
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (token.trim() && !claim.isPending) claim.mutate()
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="sfin-token">Setup token</Label>
        <Textarea
          id="sfin-token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste your SimpleFIN setup token…"
          rows={4}
          className="font-mono text-xs"
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          Tokens work once. If claiming fails, generate a fresh one in Bridge and try again.
        </p>
      </div>
      {claim.error ? <p className="text-sm text-destructive">{claim.error.message}</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={!token.trim() || claim.isPending}>
          {claim.isPending ? 'Connecting…' : 'Claim & connect'}
        </Button>
      </div>
    </form>
  )
}

function LinkStep({
  localAccountId,
  onLinked,
  onClose,
}: {
  localAccountId?: number
  onLinked: () => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const cachedQ = useQuery({ queryKey: queryKeys.simplefinCachedAccounts(), queryFn: getCachedAccounts })
  const accountsQ = useQuery({ queryKey: queryKeys.accounts(), queryFn: () => getAccounts() })

  const remotes = useMemo(
    () => [...(cachedQ.data?.accounts ?? [])].sort((a, b) => Number(a.local_account_id != null) - Number(b.local_account_id != null)),
    [cachedQ.data],
  )
  const unlinkedLocals = useMemo(() => (accountsQ.data ?? []).filter((a) => !a.is_linked), [accountsQ.data])

  const [remoteKey, setRemoteKey] = useState<string | null>(null)
  const remote = remotes.find((r) => `${r.conn_id}:${r.account_id}` === remoteKey) ?? null
  const [localChoice, setLocalChoice] = useState<string | null>(null)
  const defaultLocal =
    localAccountId != null && unlinkedLocals.some((a) => a.id === localAccountId)
      ? String(localAccountId)
      : unlinkedLocals.length
        ? String(unlinkedLocals[0].id)
        : NEW_ACCOUNT
  const local = localChoice ?? defaultLocal
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<AccountType>('checking')

  const refresh = useMutation({
    mutationFn: () => discoverAccounts(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.simplefinCachedAccounts() }),
    onError: (e: Error) => toast.error(e.message),
  })

  const link = useMutation({
    mutationFn: async (target: DiscoveredAccount) => {
      let localId = Number(local)
      if (local === NEW_ACCOUNT) {
        const created = await createAccount({ name: newName.trim() || target.name, type: newType, currency: target.currency || 'USD' })
        if (newType !== 'investment') await patchAccount(created.id, { is_budget_account: true })
        localId = created.id
      }
      await linkAccount({
        conn_id: target.conn_id,
        account_id: target.account_id,
        local_account_id: localId,
        institution_name: target.conn_name,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.budgets() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.simplefinCachedAccounts() })
      onLinked()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function pickRemote(r: DiscoveredAccount) {
    setRemoteKey(`${r.conn_id}:${r.account_id}`)
    setNewName(r.name)
    setNewType(guessType(r.name))
  }

  if (cachedQ.isLoading) return <p className="py-6 text-center text-sm text-muted-foreground">Loading bank accounts…</p>

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>1. Pick a bank account from SimpleFIN</Label>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            <RefreshCw className={cn('h-3 w-3', refresh.isPending && 'animate-spin')} /> Refresh
          </Button>
        </div>
        {remotes.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
            SimpleFIN didn&apos;t return any accounts yet. Make sure your banks are connected in Bridge, then refresh.
          </p>
        ) : (
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1" role="radiogroup" aria-label="SimpleFIN account">
            {remotes.map((r) => {
              const key = `${r.conn_id}:${r.account_id}`
              const linked = r.local_account_id != null
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={remoteKey === key}
                  disabled={linked}
                  onClick={() => pickRemote(r)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:opacity-60',
                    remoteKey === key ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'enabled:hover:bg-muted/50',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{r.conn_name || r.conn_id}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs">
                    {linked ? (
                      <span className="flex items-center gap-1 text-income">
                        <Check className="h-3 w-3" /> Linked
                      </span>
                    ) : (
                      <span className="tabular-nums text-muted-foreground">{formatSignedUsd(Number(r.balance))}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {remote ? (
        <div className="space-y-2">
          <Label>2. Which account in Keep is it?</Label>
          <Select value={local} onValueChange={setLocalChoice}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {unlinkedLocals.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name} · {accountTypeLabel(a.type)}
                </SelectItem>
              ))}
              <SelectItem value={NEW_ACCOUNT}>+ Create a new account</SelectItem>
            </SelectContent>
          </Select>
          {local === NEW_ACCOUNT ? (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New account name" />
              <Select value={newType} onValueChange={(v) => setNewType(v as AccountType)}>
                <SelectTrigger className="w-36" aria-label="New account type">
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
          ) : null}
          <p className="text-xs text-muted-foreground">
            Synced transactions land in this account. Its existing transactions stay; duplicates are skipped.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={onClose}>
          Finish later
        </Button>
        <Button disabled={!remote || link.isPending} onClick={() => remote && link.mutate(remote)}>
          {link.isPending ? 'Linking…' : 'Link account'}
        </Button>
      </div>
    </div>
  )
}

function SyncStep({
  connectionId,
  onLinkAnother,
  onClose,
}: {
  connectionId?: number
  onLinkAnother: () => void
  onClose: () => void
}) {
  const [summary, setSummary] = useState<string | null>(null)
  const sync = useSimplefinSync(connectionId, {
    onSuccess: (result) => setSummary(syncResultSummary(result)),
    onError: (err) => toast.error(err.message),
  })
  return (
    <div className="space-y-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <Check className="h-4 w-4 text-income" /> Account linked.
      </p>
      {summary ? (
        <p className="rounded-xl border bg-muted/30 p-3">{summary}</p>
      ) : (
        <p className="text-muted-foreground">
          Run a first sync to pull in balances and recent transactions. After this, use the sync button in the top bar
          any time. SimpleFIN allows about 24 syncs a day.
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={onLinkAnother}>
          Link another account
        </Button>
        {summary ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <Button disabled={!connectionId || sync.isPending} onClick={() => sync.mutate()} className="gap-1.5">
            <RefreshCw className={cn('h-4 w-4', sync.isPending && 'animate-spin')} />
            {sync.isPending ? 'Syncing…' : 'Sync now'}
          </Button>
        )}
      </div>
    </div>
  )
}

function Numbered({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="brand-icon-well h-6 w-6 shrink-0 text-xs font-semibold text-brand">{n}</span>
      <p className="pt-0.5 text-muted-foreground">{children}</p>
    </li>
  )
}
