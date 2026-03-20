import { useEffect, useState } from 'react'
import { Button, MenuItem, TextField } from '@mui/material'
import { Controller, useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '../components/PageHeader'
import { apiPostJson } from '../api/client'
import { queryKeys } from '../queryKeys'
import { getAccounts } from '../api/accounts'

import type { AccountOut } from '../types'

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
  const { data: accounts = [], isLoading, error: queryError } = useQuery<AccountOut[], Error>({
    queryKey: ['accounts'],
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

  useEffect(() => {
    if (accounts.length < 2) return
    // Only set defaults once; don’t overwrite user input on subsequent refetches.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fromAccountId == null) setValue('from_account_id', accounts[0].id)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (toAccountId == null) setValue('to_account_id', accounts[1].id)
  }, [accounts, fromAccountId, toAccountId, setValue])

  const transferMutation = useMutation({
    mutationFn: (payload: TransferPayload) => apiPostJson('/api/transfers', payload),
    onSuccess: () => {
      setOk('✅ Transfer recorded!')
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
    <div className="sp-page">
      <PageHeader
        icon="🔁"
        title="Transfer between accounts"
        subtitle="Move money between your spending totals."
      />

      {queryError ? <div style={{ marginTop: 12, color: 'crimson' }}>{queryError.message}</div> : null}

      {isLoading ? (
        <div>Loading...</div>
      ) : accounts.length < 2 ? (
        <div>Create at least two accounts in Settings first.</div>
      ) : (
        <div style={{ maxWidth: 800 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Controller
              control={control}
              name="from_account_id"
              render={({ field }) => (
                <TextField
                  select
                  label="From account"
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                  fullWidth
                >
                  {accounts.map((a) => (
                    <MenuItem key={a.id} value={a.id}>
                      {a.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
            <Controller
              control={control}
              name="to_account_id"
              render={({ field }) => (
                <TextField
                  select
                  label="To account"
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                  fullWidth
                >
                  {accounts.map((a) => (
                    <MenuItem key={a.id} value={a.id}>
                      {a.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
          </div>

          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Controller
              control={control}
              name="amount"
              render={({ field }) => (
                <TextField
                  label="Amount"
                  type="number"
                  inputProps={{ step: '0.01' }}
                  value={field.value}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                  fullWidth
                />
              )}
            />
            <Controller
              control={control}
              name="date"
              render={({ field }) => (
                <TextField
                  label="Date"
                  type="date"
                  {...field}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                />
              )}
            />
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Notes (optional)</div>
            <Controller
              control={control}
              name="notes"
              render={({ field }) => (
                <TextField
                  {...field}
                  fullWidth
                  multiline
                  minRows={3}
                />
              )}
            />
          </div>

          {error ? <div style={{ marginTop: 12, color: 'crimson' }}>{error}</div> : null}
          {ok ? <div style={{ marginTop: 12, color: 'green' }}>{ok}</div> : null}

          <Button
            variant="contained"
            sx={{ marginTop: 1.5 }}
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
        </div>
      )}
    </div>
  )
}

