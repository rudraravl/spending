import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { getAccount, getAccountSummary } from '../api/accounts'
import { getTransactions } from '../api/transactions'
import AccountTxnsTable from '../features/accounts/AccountTxnsTable'
import { accountTypeLabel, accountViewKind } from '../features/accounts/accountViewKind'
import { queryKeys } from '../queryKeys'
import type { TransactionOut } from '../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import NotFoundPage from './NotFoundPage'

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

function isNotFoundError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase()
  return msg.includes('not found') || msg.includes('404')
}

export default function AccountDetailPage() {
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

  const txnsQuery = useQuery({
    queryKey: queryKeys.transactionsForAccount(id, true),
    queryFn: () =>
      getTransactions<TransactionOut[]>({
        includeTransfers: true,
        accountId: id,
      }),
    enabled: validId && view === 'credit_with_ledger',
  })

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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <Button variant="ghost" size="sm" className="mb-6 -ml-2 text-muted-foreground" asChild>
          <Link to="/accounts">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Accounts
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{acct.name}</h1>
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
          </div>
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
                <p className="text-2xl font-semibold tabular-nums tracking-tight">{formatMoney(balance, acct.currency)}</p>
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </CardContent>
          </Card>
        </div>

        {view === 'credit_with_ledger' ? (
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
