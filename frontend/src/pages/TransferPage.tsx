import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiPostJson } from '../api/client'
import { Link2, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  getPaymentsHoldouts,
  getTransferMatchCandidates,
  linkExistingTransfer,
  transferMatchLegLabels,
  type TransferMatchCandidate,
} from '../api/transfers'
import { queryKeys } from '../queryKeys'
import { getAccounts } from '../api/accounts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import type { AccountOut } from '../types'

function formatMoney(amount: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount)
}

type TransferPayload = {
  from_account_id: number
  to_account_id: number
  amount: number
  date: string
  notes: string | null
}

type TransferFormValues = {
  from_account_id: number | null
  to_account_id: number | null
  amount: number
  date: string
  notes: string
}

export default function TransferPage() {
  const queryClient = useQueryClient()
  const [scanEnabled, setScanEnabled] = useState(false)
  const [reviewActionError, setReviewActionError] = useState<string | null>(null)
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
      setReviewActionError(null)
      queryClient.invalidateQueries({ queryKey: ['transfer-match-candidates'] })
      queryClient.invalidateQueries({ queryKey: ['payments-holdouts'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (e: Error) => setReviewActionError(e.message),
  })
  const { data: accounts = [], isLoading, error: queryError } = useQuery<AccountOut[], Error>({
    queryKey: queryKeys.accounts(),
    queryFn: () => getAccounts(),
  })
  const { control, watch, setValue, handleSubmit, reset } = useForm<TransferFormValues>({
    defaultValues: {
      from_account_id: null,
      to_account_id: null,
      amount: 0,
      date: new Date().toISOString().slice(0, 10),
      notes: '',
    },
  })
  const fromAccountId = watch('from_account_id')
  const toAccountId = watch('to_account_id')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const candidates = candidatesQuery.data?.candidates ?? []
  const holdoutCount = holdoutsQuery.data?.count ?? 0

  useEffect(() => {
    if (accounts.length < 2) return
    if (fromAccountId == null) setValue('from_account_id', accounts[0].id)
    if (toAccountId == null) setValue('to_account_id', accounts[1].id)
  }, [accounts, fromAccountId, toAccountId, setValue])

  const transferMutation = useMutation({
    mutationFn: (payload: TransferPayload) => apiPostJson('/api/transfers', payload),
    onSuccess: () => {
      setOk('Transfer recorded.')
      setError(null)
      reset({
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        amount: 0,
        date: new Date().toISOString().slice(0, 10),
        notes: '',
      })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['splits'] })
      queryClient.invalidateQueries({ queryKey: ['views'] })
      queryClient.invalidateQueries({ queryKey: ['summaries'] })
    },
    onError: (e: unknown) => {
      const message = e instanceof Error ? e.message : 'Transfer failed'
      setError(message)
      setOk(null)
    },
  })

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <p className="text-muted-foreground mb-8">Review suggested transfer links, then add manual transfers.</p>

        {queryError ? <p className="text-sm text-destructive mb-4">{queryError.message}</p> : null}

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
              <CardTitle className="text-base flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Review transfers
              </CardTitle>
              <CardDescription>
                Same amount within $0.03 and within 8 days: card payments (bank outflow + card credit) and
                asset-to-asset moves (e.g. checking ↔ investment). Every ambiguous match is listed.
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
                {scanEnabled ? 'Rescan transfers' : 'Load transfers'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {candidatesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Scanning…</p>
            ) : candidatesQuery.isError ? (
              <p className="text-sm text-destructive">{(candidatesQuery.error as Error).message}</p>
            ) : !scanEnabled ? (
              <p className="text-sm text-muted-foreground">Click load transfers to search the last year of transactions.</p>
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
            {reviewActionError ? <p className="text-sm text-destructive mt-3">{reviewActionError}</p> : null}
          </CardContent>
        </Card>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : accounts.length < 2 ? (
          <p className="text-sm text-muted-foreground">Create at least two accounts on the Accounts page first.</p>
        ) : (
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Add new transfer</CardTitle>
              <CardDescription>From and to must be different accounts.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Controller
                  control={control}
                  name="from_account_id"
                  render={({ field }) => (
                    <div className="space-y-2">
                      <Label>From account</Label>
                      <Select
                        value={field.value != null ? String(field.value) : undefined}
                        onValueChange={(v) => field.onChange(Number(v))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((a) => (
                            <SelectItem key={a.id} value={String(a.id)}>
                              {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                />
                <Controller
                  control={control}
                  name="to_account_id"
                  render={({ field }) => (
                    <div className="space-y-2">
                      <Label>To account</Label>
                      <Select
                        value={field.value != null ? String(field.value) : undefined}
                        onValueChange={(v) => field.onChange(Number(v))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((a) => (
                            <SelectItem key={a.id} value={String(a.id)}>
                              {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Controller
                  control={control}
                  name="amount"
                  render={({ field }) => (
                    <div className="space-y-2">
                      <Label>Amount</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={field.value}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </div>
                  )}
                />
                <Controller
                  control={control}
                  name="date"
                  render={({ field }) => (
                    <div className="space-y-2">
                      <Label>Date</Label>
                      <Input type="date" {...field} />
                    </div>
                  )}
                />
              </div>

              <Controller
                control={control}
                name="notes"
                render={({ field }) => (
                  <div className="space-y-2">
                    <Label>Notes (optional)</Label>
                    <Textarea {...field} rows={3} />
                  </div>
                )}
              />

              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {ok ? <p className="text-sm text-income">{ok}</p> : null}

              <Button
                onClick={handleSubmit((values) => {
                  if (!values.from_account_id || !values.to_account_id) return
                  if (values.from_account_id === values.to_account_id) {
                    setError('From and To accounts must be different.')
                    return
                  }
                  setError(null)
                  setOk(null)
                  transferMutation.mutate({
                    from_account_id: values.from_account_id,
                    to_account_id: values.to_account_id,
                    amount: values.amount,
                    date: values.date,
                    notes: values.notes ? values.notes : null,
                  })
                })}
                disabled={transferMutation.isPending}
              >
                Save transfer
              </Button>
            </CardContent>
          </Card>
        )}
      </motion.div>
    </div>
  )
}
