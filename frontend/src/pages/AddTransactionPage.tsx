import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import { apiGet, apiPostJson } from '../api/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'

type Account = { id: number; name: string }
type Category = { id: number; name: string }
type Tag = { id: number; name: string }
type Subcategory = { id: number; name: string; category_id: number }

type CreatePayload = {
  date: string
  amount: number
  merchant: string
  account_id: number
  category_id: number
  subcategory_id: number
  notes?: string | null
  tag_ids?: number[] | null
}

export default function AddTransactionPage() {
  const queryClient = useQueryClient()

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState<number>(0)
  const [merchant, setMerchant] = useState('')

  const [accountId, setAccountId] = useState<number | null>(null)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [subcategoryId, setSubcategoryId] = useState<number | null>(null)

  const [notes, setNotes] = useState<string>('')
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])

  const accountsQuery = useQuery<Account[], Error>({
    queryKey: queryKeys.accounts(),
    queryFn: () => apiGet<Account[]>('/api/accounts'),
  })
  const categoriesQuery = useQuery<Category[], Error>({
    queryKey: queryKeys.categories(),
    queryFn: () => apiGet<Category[]>('/api/categories'),
  })
  const tagsQuery = useQuery<Tag[], Error>({
    queryKey: queryKeys.tags(),
    queryFn: () => apiGet<Tag[]>('/api/tags'),
  })
  const subcategoriesQuery = useQuery<Subcategory[], Error>({
    queryKey: queryKeys.subcategories(categoryId),
    queryFn: () => apiGet<Subcategory[]>(`/api/categories/${categoryId}/subcategories`),
    enabled: categoryId != null,
  })

  const accounts = accountsQuery.data ?? []
  const categories = categoriesQuery.data ?? []
  const tags = tagsQuery.data ?? []
  const subcategoryOptions = subcategoriesQuery.data ?? []

  // Default selections once data arrives.
  useEffect(() => {
    if (accountId != null) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (accounts.length > 0) setAccountId(accounts[0].id)
  }, [accounts, accountId])

  useEffect(() => {
    if (categoryId != null) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (categories.length > 0) setCategoryId(categories[0].id)
  }, [categories, categoryId])

  useEffect(() => {
    if (categoryId == null) return
    if (subcategoryOptions.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubcategoryId(null)
      return
    }
    if (subcategoryId == null || !subcategoryOptions.some((s) => s.id === subcategoryId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubcategoryId(subcategoryOptions[0].id)
    }
  }, [categoryId, subcategoryOptions, subcategoryId])

  const createTransactionMutation = useMutation({
    mutationFn: (payload: CreatePayload) => apiPostJson('/api/transactions', payload),
    onSuccess: () => {
      setMerchant('')
      setNotes('')
      setSelectedTagIds([])
      alert('✅ Transaction added!')
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['views'] })
      queryClient.invalidateQueries({ queryKey: ['summaries'] })
    },
    onError: (e: unknown) => {
      alert(`Error: ${e instanceof Error ? e.message : 'Failed to create transaction'}`)
    },
  })

  return (
    <div className="sp-page">
      <PageHeader
        icon="➕"
        title="Add transaction"
        subtitle="Capture a single purchase or transfer with full context."
      />

      <div style={{ maxWidth: 900 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={{ marginBottom: 8 }}>Basics</div>
            <label style={{ display: 'block', marginBottom: 8 }}>
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ width: '100%', padding: 10, marginTop: 4 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              Amount
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                style={{ width: '100%', padding: 10, marginTop: 4 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              Merchant
              <input
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                style={{ width: '100%', padding: 10, marginTop: 4 }}
              />
            </label>
          </div>

          <div>
            <div style={{ marginBottom: 8 }}>Classification</div>
            <label style={{ display: 'block', marginBottom: 8 }}>
              Account
              <select
                value={accountId ?? ''}
                onChange={(e) => setAccountId(Number(e.target.value))}
                style={{ width: '100%', padding: 10, marginTop: 4 }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              Category
              <select
                value={categoryId ?? ''}
                onChange={(e) => setCategoryId(Number(e.target.value))}
                style={{ width: '100%', padding: 10, marginTop: 4 }}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              Subcategory
              <select
                value={subcategoryId ?? ''}
                onChange={(e) => setSubcategoryId(Number(e.target.value))}
                style={{ width: '100%', padding: 10, marginTop: 4 }}
              >
                {subcategoryOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              Tags (optional)
              <select
                multiple
                value={selectedTagIds.map(String)}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions).map((o) => Number(o.value))
                  setSelectedTagIds(selected)
                }}
                style={{ width: '100%', padding: 10, marginTop: 4, minHeight: 90 }}
              >
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>Notes</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ width: '100%', minHeight: 90, padding: 10 }}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <button
            style={{ padding: '10px 14px' }}
            onClick={() => {
              if (!accountId || !categoryId || !subcategoryId) return
              const payload: CreatePayload = {
                date,
                amount: amount,
                merchant,
                account_id: accountId,
                category_id: categoryId,
                subcategory_id: subcategoryId,
                notes: notes ? notes : null,
                tag_ids: selectedTagIds.length ? selectedTagIds : null,
              }
              createTransactionMutation.mutate(payload)
            }}
            disabled={createTransactionMutation.isPending}
          >
            Save transaction
          </button>
        </div>
      </div>
    </div>
  )
}

