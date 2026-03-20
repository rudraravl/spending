import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '../components/PageHeader'
import { apiPostJson } from '../api/client'
import { queryKeys } from '../queryKeys'
import { getAccounts } from '../api/accounts'

type Account = { id: number; name: string }

type TransferPayload = {
  from_account_id: number
  to_account_id: number
  amount: number
  date: string
  notes: string | null
}

export default function TransferPage() {
  const queryClient = useQueryClient()
  const { data: accounts = [], isLoading, error: queryError } = useQuery<Account[], Error>({
    queryKey: ['accounts'],
    queryFn: () => getAccounts(),
  })
  const [fromAccountId, setFromAccountId] = useState<number | null>(null)
  const [toAccountId, setToAccountId] = useState<number | null>(null)

  const [amount, setAmount] = useState<number>(0)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  useEffect(() => {
    if (accounts.length < 2) return
    // Only set defaults once; don’t overwrite user input on subsequent refetches.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFromAccountId((prev) => prev ?? accounts[0].id)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToAccountId((prev) => prev ?? accounts[1].id)
  }, [accounts])

  const transferMutation = useMutation({
    mutationFn: (payload: TransferPayload) => apiPostJson('/api/transfers', payload),
    onSuccess: () => {
      setOk('✅ Transfer recorded!')
      setError(null)
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
            <label>
              From account
              <select
                value={fromAccountId ?? ''}
                onChange={(e) => setFromAccountId(Number(e.target.value))}
                style={{ width: '100%', padding: 10, marginTop: 4 }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              To account
              <select
                value={toAccountId ?? ''}
                onChange={(e) => setToAccountId(Number(e.target.value))}
                style={{ width: '100%', padding: 10, marginTop: 4 }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <label>
              Amount
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                style={{ width: '100%', padding: 10, marginTop: 4 }}
              />
            </label>
            <label>
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ width: '100%', padding: 10, marginTop: 4 }}
              />
            </label>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Notes (optional)</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ width: '100%', minHeight: 90, padding: 10 }}
            />
          </div>

          {error ? <div style={{ marginTop: 12, color: 'crimson' }}>{error}</div> : null}
          {ok ? <div style={{ marginTop: 12, color: 'green' }}>{ok}</div> : null}

          <button
            style={{ marginTop: 12, padding: '10px 14px' }}
            onClick={async () => {
              if (!fromAccountId || !toAccountId) return
              if (fromAccountId === toAccountId) {
                setError('From and To accounts must be different.')
                return
              }
              setError(null)
              setOk(null)
              transferMutation.mutate({
                from_account_id: fromAccountId,
                to_account_id: toAccountId,
                amount,
                date,
                notes: notes ? notes : null,
              })
            }}
            disabled={transferMutation.isPending}
          >
            Save transfer
          </button>
        </div>
      )}
    </div>
  )
}

