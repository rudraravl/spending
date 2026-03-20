import { useEffect, useState } from 'react'
import { Button, MenuItem, TextField } from '@mui/material'
import { Controller, useForm } from 'react-hook-form'
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

type AddTransactionFormValues = {
  date: string
  amount: number
  merchant: string
  account_id: number | null
  category_id: number | null
  subcategory_id: number | null
  notes: string
  tag_ids: number[]
}

export default function AddTransactionPage() {
  const queryClient = useQueryClient()
  const form = useForm<AddTransactionFormValues>({
    defaultValues: {
      date: new Date().toISOString().slice(0, 10),
      amount: 0,
      merchant: '',
      account_id: null,
      category_id: null,
      subcategory_id: null,
      notes: '',
      tag_ids: [],
    },
  })
  const { control, handleSubmit, setValue, watch, reset } = form
  const accountId = watch('account_id')
  const categoryId = watch('category_id')
  const subcategoryId = watch('subcategory_id')

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
    if (accounts.length > 0) setValue('account_id', accounts[0].id)
  }, [accounts, accountId, setValue])

  useEffect(() => {
    if (categoryId != null) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (categories.length > 0) setValue('category_id', categories[0].id)
  }, [categories, categoryId, setValue])

  useEffect(() => {
    if (categoryId == null) return
    if (subcategoryOptions.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue('subcategory_id', null)
      return
    }
    if (subcategoryId == null || !subcategoryOptions.some((s) => s.id === subcategoryId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue('subcategory_id', subcategoryOptions[0].id)
    }
  }, [categoryId, subcategoryOptions, subcategoryId, setValue])

  const createTransactionMutation = useMutation({
    mutationFn: (payload: CreatePayload) => createTransaction(payload),
    onSuccess: () => {
      reset({
        date: new Date().toISOString().slice(0, 10),
        amount: 0,
        merchant: '',
        account_id: accountId,
        category_id: categoryId,
        subcategory_id: subcategoryId,
        notes: '',
        tag_ids: [],
      })
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
                  sx={{ marginBottom: 2 }}
                />
              )}
            />
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
                  sx={{ marginBottom: 2 }}
                />
              )}
            />
            <Controller
              control={control}
              name="merchant"
              render={({ field }) => (
                <TextField
                  label="Merchant"
                  {...field}
                  fullWidth
                  sx={{ marginBottom: 2 }}
                />
              )}
            />
          </div>

          <div>
            <div style={{ marginBottom: 8 }}>Classification</div>
            <Controller
              control={control}
              name="account_id"
              render={({ field }) => (
                <TextField
                  select
                  label="Account"
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                  fullWidth
                  sx={{ marginBottom: 2 }}
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
              name="category_id"
              render={({ field }) => (
                <TextField
                  select
                  label="Category"
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                  fullWidth
                  sx={{ marginBottom: 2 }}
                >
                  {categories.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
            <Controller
              control={control}
              name="subcategory_id"
              render={({ field }) => (
                <TextField
                  select
                  label="Subcategory"
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                  fullWidth
                  sx={{ marginBottom: 2 }}
                >
                  {subcategoryOptions.map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      {s.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />

            <Controller
              control={control}
              name="tag_ids"
              render={({ field }) => (
                <TextField
                  select
                  label="Tags (optional)"
                  value={field.value}
                  onChange={(e) => {
                    const raw = e.target.value as unknown
                    const arr = Array.isArray(raw) ? raw : [raw]
                    field.onChange(arr.map((v) => Number(v)))
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
              )}
            />
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>Notes</div>
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

        <div style={{ marginTop: 12 }}>
          <Button
            variant="contained"
            onClick={handleSubmit((values) => {
              if (!values.account_id || !values.category_id || !values.subcategory_id) return
              const payload: CreatePayload = {
                date: values.date,
                amount: values.amount,
                merchant: values.merchant,
                account_id: values.account_id,
                category_id: values.category_id,
                subcategory_id: values.subcategory_id,
                notes: values.notes ? values.notes : null,
                tag_ids: values.tag_ids.length ? values.tag_ids : null,
              }
              createTransactionMutation.mutate(payload)
            })}
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

