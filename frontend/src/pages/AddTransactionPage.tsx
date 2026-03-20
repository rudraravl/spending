import { useEffect, useState } from 'react'
import { Button, MenuItem, TextField } from '@mui/material'
import PageHeader from '../components/PageHeader'
import FeedbackDialog from '../components/FeedbackDialog'
import { apiGet } from '../api/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'
import { getAccounts } from '../api/accounts'
import { getCategories, getSubcategories } from '../api/categories'
import { createTransaction } from '../api/transactions'

import type { AccountOut, CategoryOut, SubcategoryOut, TagOut } from '../types'

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

  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackTitle, setFeedbackTitle] = useState('')
  const [feedbackMessage, setFeedbackMessage] = useState('')

  const accountsQuery = useQuery<AccountOut[], Error>({
    queryKey: queryKeys.accounts(),
    queryFn: () => getAccounts(),
  })
  const categoriesQuery = useQuery<CategoryOut[], Error>({
    queryKey: queryKeys.categories(),
    queryFn: () => getCategories(),
  })
  const tagsQuery = useQuery<TagOut[], Error>({
    queryKey: queryKeys.tags(),
    queryFn: () => apiGet<TagOut[]>('/api/tags'),
  })
  const subcategoriesQuery = useQuery<SubcategoryOut[], Error>({
    queryKey: queryKeys.subcategories(categoryId),
    queryFn: () => getSubcategories(categoryId!),
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
    mutationFn: (payload: CreatePayload) => createTransaction(payload),
    onSuccess: () => {
      setMerchant('')
      setNotes('')
      setSelectedTagIds([])
      setFeedbackTitle('Transaction added')
      setFeedbackMessage('✅ Transaction added!')
      setFeedbackOpen(true)
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['views'] })
      queryClient.invalidateQueries({ queryKey: ['summaries'] })
    },
    onError: (e: unknown) => {
      setFeedbackTitle('Failed to add transaction')
      setFeedbackMessage(e instanceof Error ? e.message : 'Failed to create transaction')
      setFeedbackOpen(true)
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
            <TextField
              label="Date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
              sx={{ marginBottom: 2 }}
            />
            <TextField
              label="Amount"
              type="number"
              inputProps={{ step: '0.01' }}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              fullWidth
              sx={{ marginBottom: 2 }}
            />
            <TextField
              label="Merchant"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              fullWidth
              sx={{ marginBottom: 2 }}
            />
          </div>

          <div>
            <div style={{ marginBottom: 8 }}>Classification</div>
            <TextField
              select
              label="Account"
              value={accountId ?? ''}
              onChange={(e) => setAccountId(Number(e.target.value))}
              fullWidth
              sx={{ marginBottom: 2 }}
            >
              {accounts.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {a.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Category"
              value={categoryId ?? ''}
              onChange={(e) => setCategoryId(Number(e.target.value))}
              fullWidth
              sx={{ marginBottom: 2 }}
            >
              {categories.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Subcategory"
              value={subcategoryId ?? ''}
              onChange={(e) => setSubcategoryId(Number(e.target.value))}
              fullWidth
              sx={{ marginBottom: 2 }}
            >
              {subcategoryOptions.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="Tags (optional)"
              value={selectedTagIds}
              onChange={(e) => {
                const raw = e.target.value as unknown
                const arr = Array.isArray(raw) ? raw : [raw]
                setSelectedTagIds(arr.map((v) => Number(v)))
              }}
              SelectProps={{
                multiple: true,
                renderValue: (selected) => {
                  const ids = selected as number[]
                  return ids
                    .map((id) => tags.find((t) => t.id === id)?.name ?? String(id))
                    .join(', ')
                },
              }}
              fullWidth
              sx={{ marginBottom: 2 }}
            >
              {tags.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>Notes</div>
          <TextField
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            fullWidth
            multiline
            minRows={3}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <Button
            variant="contained"
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
          </Button>
        </div>
      </div>

      <FeedbackDialog
        open={feedbackOpen}
        title={feedbackTitle}
        message={feedbackMessage}
        onClose={() => setFeedbackOpen(false)}
      />
    </div>
  )
}

