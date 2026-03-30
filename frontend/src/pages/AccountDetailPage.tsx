import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowLeft, Info, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteAccount, getAccount, getAccountSummary, patchAccount } from '../api/accounts'
import { getPortfolio } from '../api/investments'
import { getTransactions } from '../api/transactions'
import AccountTxnsTable from '../features/accounts/AccountTxnsTable'
import AccountPortfolioTab from '../features/investments/AccountPortfolioTab'
import { accountTypeLabel, accountViewKind } from '../features/accounts/accountViewKind'
import { queryKeys } from '../queryKeys'
import type { TransactionOut } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import NotFoundPage from './NotFoundPage'
import { toast } from 'sonner'

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

function formatImportedAt(iso: string | null | undefined) {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso
  }
}

function isNotFoundError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase()
  return msg.includes('not found') || msg.includes('404')
}

export default function AccountDetailPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { accountId: rawId } = useParams<{ accountId: string }>()
  const id = rawId ? Number.parseInt(rawId, 10) : NaN
  const validId = Number.isFinite(id)

  const accountQuery = useQuery({
    queryKey: queryKeys.accountDetail(id),
    queryFn: () => getAccount(id),
    enabled: validId,
    retry: false,
  })

  const summaryQuery = useQuery({
    queryKey: queryKeys.accountSummary(id),
    queryFn: () => getAccountSummary(id),
    enabled: validId,
    retry: false,
  })

  const view = accountQuery.data ? accountViewKind(accountQuery.data.type) : null
  const isInvestment = accountQuery.data?.type === 'investment'

  const portfolioQuery = useQuery({
    queryKey: queryKeys.investmentPortfolio(id),
    queryFn: () => getPortfolio(id),
    enabled: validId && isInvestment,
  })

  const txnsQuery = useQuery({
    queryKey: queryKeys.transactionsForAccount(id, true),
    queryFn: () =>
      getTransactions<TransactionOut[]>({
        includeTransfers: true,
        accountId: id,
      }),
    enabled: validId && view === 'credit_with_ledger',
  })

  const deleteAccountMutation = useMutation({
    mutationFn: (accountId: number) => deleteAccount(accountId),
  })

  const patchRobinhoodCryptoMutation = useMutation({
    mutationFn: (is_robinhood_crypto: boolean) => patchAccount(id, { is_robinhood_crypto }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.accountDetail(id), data)
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.investmentPortfolio(id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.investmentHistory(id, 365) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.investmentsSummary() })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function afterAccountDeleted() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
    await queryClient.invalidateQueries({ queryKey: queryKeys.settingsAll() })
    await queryClient.invalidateQueries({ queryKey: ['transactions'] })
    await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() })
    await queryClient.invalidateQueries({ queryKey: ['views'] })
    await queryClient.invalidateQueries({ queryKey: ['summaries'] })
    await queryClient.invalidateQueries({ queryKey: queryKeys.investmentsSummary() })
    await queryClient.invalidateQueries({ queryKey: ['investments'] })
    await queryClient.invalidateQueries({ queryKey: queryKeys.investmentsSummary() })
    await queryClient.invalidateQueries({ queryKey: ['investments'] })
  }

  if (!validId) {
    return <NotFoundPage />
  }

  if (accountQuery.isError && isNotFoundError(accountQuery.error)) {
    return <NotFoundPage />
  }

  if (accountQuery.isError) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">{(accountQuery.error as Error).message}</p>
        <Button variant="ghost" className="mt-4" asChild>
          <Link to="/accounts">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to accounts
          </Link>
        </Button>
      </div>
    )
  }

  if (accountQuery.isPending || !accountQuery.data) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-sm text-muted-foreground">Loading account…</p>
      </div>
    )
  }

  const acct = accountQuery.data
  const balance = summaryQuery.data?.balance ?? null
  const summary = summaryQuery.data
  const ledgerDiffers =
    summary != null && Math.abs(summary.balance - summary.ledger_balance) > 0.005
  const robinhoodCryptoMode =
    Boolean(acct.is_robinhood_crypto) ||
    Boolean(portfolioQuery.data?.account?.is_robinhood_crypto)
  // Local display names rarely match SimpleFIN’s remote "Crypto (####)" label after linking—show for
  // all investment accounts so Robinhood crypto sub-accounts can opt in regardless of name.
  const showRobinhoodCryptoToggle = acct.type === 'investment'

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <ConfirmDialog
        open={confirmOpen}
        title="Delete account?"
        message={`Remove "${acct.name}" and ALL transactions on this account?\n\nIf any of those transactions were transfer-linked, the other account's leg is kept but converted to a normal (unlinked) transaction.`}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setConfirmOpen(false)
          await deleteAccountMutation.mutateAsync(acct.id)
          await afterAccountDeleted()
          navigate('/accounts')
        }}
      />

      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <Button variant="ghost" size="sm" className="mb-6 -ml-2 text-muted-foreground" asChild>
          <Link to="/accounts">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Accounts
          </Link>
        </Button>

        <div className="flex flex-nowrap items-start justify-between gap-4 mb-6">
          <div className="min-w-0 flex-1 pr-2">
            <p className="text-sm text-muted-foreground mt-1">
              {accountTypeLabel(acct.type)} · {acct.currency}
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Badge variant={acct.is_linked ? 'default' : 'secondary'}>
                {acct.is_linked ? 'Linked' : 'Manual only'}
              </Badge>
              {acct.institution_name ? (
                <Badge variant="outline" className="font-normal">
                  {acct.institution_name}
                </Badge>
              ) : null}
            </div>
            {acct.is_linked && acct.last_synced_at ? (
              <p className="text-xs text-muted-foreground mt-2">
                Last synced: {formatImportedAt(acct.last_synced_at)}{' '}
                <Link to="/connections" className="text-primary underline-offset-4 hover:underline">
                  Manage link
                </Link>
              </p>
            ) : null}
            {showRobinhoodCryptoToggle ? (
              <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-md border border-border/50 bg-muted/25 py-1 pl-1.5 pr-2">
                <span className="inline-flex shrink-0 origin-left scale-[0.85]">
                  <Switch
                    id="rh-crypto-mode"
                    checked={Boolean(acct.is_robinhood_crypto)}
                    disabled={patchRobinhoodCryptoMutation.isPending}
                    onCheckedChange={(v) => patchRobinhoodCryptoMutation.mutate(v)}
                  />
                </span>
                <Label
                  htmlFor="rh-crypto-mode"
                  className="text-xs font-medium cursor-pointer leading-tight whitespace-nowrap"
                >
                  RH crypto
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground rounded-full p-0.5 shrink-0 -ml-0.5"
                      aria-label="About Robinhood crypto mode"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs text-xs">
                    Treat as Robinhood’s separate crypto sub-account: total value is the sum of holdings
                    (and manual positions), not custodian cash or the broker balance line.
                  </TooltipContent>
                </Tooltip>
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {acct.type === 'investment' ? (
              <Card className="min-w-[260px] border-primary/20 bg-muted/30">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Account value
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-4 px-4 space-y-3">
                  {portfolioQuery.isPending ? (
                    <p className="text-sm text-muted-foreground">…</p>
                  ) : portfolioQuery.data ? (
                    <>
                      <div>
                        <p className="text-2xl font-semibold tabular-nums tracking-tight">
                          {formatMoney(portfolioQuery.data.totals.total_value, acct.currency)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {robinhoodCryptoMode
                            ? 'Crypto sub-account: total matches sum of positions (custodian cash ignored).'
                            : portfolioQuery.data.latest_snapshot?.captured_at
                              ? `As of sync · ${formatImportedAt(portfolioQuery.data.latest_snapshot.captured_at)}`
                              : 'From last reported balance — sync to load holdings & split cash vs positions'}
                        </p>
                      </div>
                      <div className="space-y-2 text-sm border-t border-border/60 pt-3">
                        {!robinhoodCryptoMode ? (
                          <div className="flex justify-between gap-4 tabular-nums">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/50">
                                  Cash
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                Uninvested cash from the last SimpleFIN sync (account balance minus positions).
                              </TooltipContent>
                            </Tooltip>
                            <span className="font-medium">
                              {formatMoney(portfolioQuery.data.totals.cash_balance, acct.currency)}
                            </span>
                          </div>
                        ) : null}
                        <div className="flex justify-between gap-4 tabular-nums">
                          <span className="text-muted-foreground">Positions</span>
                          <span className="font-medium">
                            {formatMoney(portfolioQuery.data.totals.positions_value, acct.currency)}
                          </span>
                        </div>
                      </div>
                      {ledgerDiffers && summary ? (
                        <p className="text-xs text-muted-foreground pt-1 border-t border-border/40">
                          Sum of transactions: {formatMoney(summary.ledger_balance, acct.currency)}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {(portfolioQuery.error as Error)?.message ?? 'Could not load portfolio'}
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="min-w-[200px] border-primary/20 bg-muted/30">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Balance
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-4 px-4">
                  {summaryQuery.isPending ? (
                    <p className="text-sm text-muted-foreground">…</p>
                  ) : balance != null ? (
                    <div>
                      <p className="text-2xl font-semibold tabular-nums tracking-tight">{formatMoney(balance, acct.currency)}</p>
                      {ledgerDiffers && summary ? (
                        <p className="text-xs text-muted-foreground mt-2">
                          Sum of transactions: {formatMoney(summary.ledger_balance, acct.currency)}
                        </p>
                      ) : null}
                      {acct.reported_balance_at ? (
                        <p className="text-xs text-muted-foreground mt-2">
                          Bank balance from last import · {formatImportedAt(acct.reported_balance_at)}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </CardContent>
              </Card>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={deleteAccountMutation.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete account
            </Button>
          </div>
        </div>

        {view === 'credit_with_ledger' && acct.type === 'investment' ? (
          <Tabs defaultValue="activity" className="space-y-4">
            <TabsList>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
            </TabsList>
            <TabsContent value="activity" className="space-y-3">
              <h2 className="text-sm font-medium">Transactions</h2>
              <AccountTxnsTable
                rows={txnsQuery.data ?? []}
                currency={acct.currency}
                isLoading={txnsQuery.isPending}
              />
            </TabsContent>
            <TabsContent value="portfolio">
              <AccountPortfolioTab accountId={acct.id} currency={acct.currency} />
            </TabsContent>
          </Tabs>
        ) : view === 'credit_with_ledger' ? (
          <div className="space-y-3">
            <h2 className="text-sm font-medium">Transactions</h2>
            <AccountTxnsTable
              rows={txnsQuery.data ?? []}
              currency={acct.currency}
              isLoading={txnsQuery.isPending}
            />
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Detailed activity views for bank and investment accounts will appear here as you connect institutions.
            </CardContent>
          </Card>
        )}
      </motion.div>
    </div>
  )
}
