import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Link2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getPaymentsHoldouts,
  getTransferMatchCandidates,
  linkExistingTransfer,
  transferMatchLegLabels,
  type TransferMatchCandidate,
} from '../api/transfers'
import { queryKeys } from '../queryKeys'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function formatMoney(amount: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount)
}

export default function TransferReviewPage() {
  const queryClient = useQueryClient()
  const [scanEnabled, setScanEnabled] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const holdoutsQuery = useQuery({
    queryKey: ['payments-holdouts'],
    queryFn: () => getPaymentsHoldouts(),
  })

  const candidatesQuery = useQuery({
    queryKey: ['transfer-match-candidates', 'full'],
    queryFn: () => getTransferMatchCandidates({ lookbackDays: 365 }),
    enabled: scanEnabled,
  })

  const linkMutation = useMutation({
    mutationFn: (c: TransferMatchCandidate) =>
      linkExistingTransfer({
        transaction_id_a: c.asset_transaction_id,
        transaction_id_b: c.credit_transaction_id,
        canonical_amount: c.canonical_amount,
      }),
    onSuccess: () => {
      setActionError(null)
      queryClient.invalidateQueries({ queryKey: ['transfer-match-candidates'] })
      queryClient.invalidateQueries({ queryKey: ['payments-holdouts'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (e: Error) => setActionError(e.message),
  })

  const candidates = candidatesQuery.data?.candidates ?? []
  const holdoutCount = holdoutsQuery.data?.count ?? 0

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Review transfer suggestions
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Match card payments (bank outflow + card credit) and moves between asset accounts (e.g. checking ↔
          investment). Link pairs so spending totals stay accurate.
        </p>
      </motion.div>

      {holdoutCount > 0 ? (
        <Card className="mb-6 border-primary/25 bg-primary/[0.06] dark:bg-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Legacy &quot;Payments&quot; subcategory</CardTitle>
            <CardDescription>
              {holdoutCount} transaction{holdoutCount === 1 ? '' : 's'} still tagged under Bills → Payments. Link pairs
              below or recategorize in{' '}
              <Link to="/transactions" className="text-primary underline-offset-4 hover:underline">
                All transactions
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">Suggested pairs</CardTitle>
            <CardDescription>
              Same amount within $0.03 and within 8 days. Card suggestions pair a bank outflow with a credit-card
              credit; asset suggestions pair two asset accounts (outflow and inflow). Ambiguous matches list every
              possibility—link the right one and skip the rest.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setScanEnabled(true)
                void candidatesQuery.refetch()
              }}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Scan
            </Button>
            {!scanEnabled ? (
              <Button type="button" size="sm" onClick={() => setScanEnabled(true)}>
                Load suggestions
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {candidatesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Scanning…</p>
          ) : candidatesQuery.isError ? (
            <p className="text-sm text-destructive">{(candidatesQuery.error as Error).message}</p>
          ) : !scanEnabled ? (
            <p className="text-sm text-muted-foreground">Click load or scan to search the last year of transactions.</p>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No suggested pairs right now.</p>
          ) : (
            <ul className="space-y-4">
              {candidates.map((c) => {
                const labels = transferMatchLegLabels(c.kind ?? 'card_payment')
                return (
                <li
                  key={`${c.kind ?? 'card_payment'}-${c.asset_transaction_id}-${c.credit_transaction_id}`}
                  className="rounded-lg border p-4 grid grid-cols-1 md:grid-cols-2 gap-4"
                >
                  <div className="space-y-1 text-sm">
                    <p className="text-xs font-medium text-muted-foreground">{labels.outflow}</p>
                    <p className="font-medium">{c.asset.account_name}</p>
                    <p className="text-muted-foreground truncate">{c.asset.merchant}</p>
                    <p className="tabular-nums">{formatMoney(c.asset.amount)}</p>
                    <p className="text-xs text-muted-foreground">{c.asset.date}</p>
                  </div>
                  <div className="space-y-1 text-sm">
                    <p className="text-xs font-medium text-muted-foreground">{labels.inflow}</p>
                    <p className="font-medium">{c.credit.account_name}</p>
                    <p className="text-muted-foreground truncate">{c.credit.merchant}</p>
                    <p className="tabular-nums">{formatMoney(c.credit.amount)}</p>
                    <p className="text-xs text-muted-foreground">{c.credit.date}</p>
                  </div>
                  <div className="md:col-span-2 flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={linkMutation.isPending}
                      onClick={() => linkMutation.mutate(c)}
                    >
                      Link as transfer
                    </Button>
                  </div>
                </li>
                )
              })}
            </ul>
          )}
          {actionError ? <p className="text-sm text-destructive mt-3">{actionError}</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}
