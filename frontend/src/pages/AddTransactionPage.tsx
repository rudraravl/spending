import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { motion } from 'framer-motion'
import FeedbackDialog from '../components/FeedbackDialog'
import { apiGet } from '../api/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'
import { getAccounts } from '../api/accounts'
import { getCategories, getSubcategories } from '../api/categories'
import { createTransaction } from '../api/transactions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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

/** Radix Select must stay controlled; avoid `undefined` value (uncontrolled) then a string (controlled). */
const SELECT_NONE = '__none__'

function selectIdValue(id: number | null | undefined, options: { id: number }[]): string {
  if (id != null && options.some((o) => o.id === id)) return String(id)
  return SELECT_NONE
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
  const tagIds = watch('tag_ids')

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

  // Stabilize `[]` when data is undefined — a fresh `[]` each render breaks useEffect deps and can loop on setValue.
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data])
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data])
  const tags = useMemo(() => tagsQuery.data ?? [], [tagsQuery.data])
  const subcategoryOptions = useMemo(() => subcategoriesQuery.data ?? [], [subcategoriesQuery.data])

  useEffect(() => {
    if (accountId != null) return
    if (accounts.length > 0) setValue('account_id', accounts[0].id)
  }, [accounts, accountId, setValue])

  useEffect(() => {
    if (categoryId != null) return
    if (categories.length > 0) setValue('category_id', categories[0].id)
  }, [categories, categoryId, setValue])

  useEffect(() => {
    if (categoryId == null) return
    if (subcategoryOptions.length === 0) {
      if (subcategoryId != null) setValue('subcategory_id', null)
      return
    }
    const first = subcategoryOptions[0].id
    if (subcategoryId == null || !subcategoryOptions.some((s) => s.id === subcategoryId)) {
      if (subcategoryId !== first) setValue('subcategory_id', first)
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
      setFeedbackMessage('Transaction added successfully.')
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

  function toggleTag(id: number, checked: boolean) {
    const next = new Set(tagIds)
    if (checked) next.add(id)
    else next.delete(id)
    setValue('tag_ids', Array.from(next))
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h1 className="text-2xl font-semibold mb-1">Add transaction</h1>
        <p className="text-muted-foreground mb-2">
          Capture a single purchase or income with full context.
        </p>
        <div className="mb-8 px-4 py-2 bg-yellow-50 border-l-4 border-yellow-400 text-yellow-800 rounded">
          <span className="font-semibold">Note:</span> Adding transactions on accounts that report a balance <em>will eventually cause accounting issues</em> as reported balances will not align with your ledger balances. We recommend adding manual transactions under a separate account (such as Cash, Venmo, etc.) to maintain proper accounting.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Basics</CardTitle>
              <CardDescription>When, how much, and where.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                    <p className="text-xs text-muted-foreground">
                      Negative = spending or outflow; positive = income or inflow.
                    </p>
                  </div>
                )}
              />
              <Controller
                control={control}
                name="merchant"
                render={({ field }) => (
                  <div className="space-y-2">
                    <Label>Merchant</Label>
                    <Input {...field} />
                  </div>
                )}
              />
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Classification</CardTitle>
              <CardDescription>Account, category, tags.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Controller
                control={control}
                name="account_id"
                render={({ field }) => (
                  <div className="space-y-2">
                    <Label>Account</Label>
                    <Select
                      value={selectIdValue(field.value, accounts)}
                      onValueChange={(v) => field.onChange(v === SELECT_NONE ? null : Number(v))}
                      disabled={accounts.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Account" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SELECT_NONE} disabled className="text-muted-foreground">
                          Select account
                        </SelectItem>
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
                name="category_id"
                render={({ field }) => (
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={selectIdValue(field.value, categories)}
                      onValueChange={(v) => field.onChange(v === SELECT_NONE ? null : Number(v))}
                      disabled={categories.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SELECT_NONE} disabled className="text-muted-foreground">
                          Select category
                        </SelectItem>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />
              <Controller
                control={control}
                name="subcategory_id"
                render={({ field }) => (
                  <div className="space-y-2">
                    <Label>Subcategory</Label>
                    <Select
                      value={selectIdValue(field.value, subcategoryOptions)}
                      onValueChange={(v) => field.onChange(v === SELECT_NONE ? null : Number(v))}
                      disabled={subcategoryOptions.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Subcategory" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SELECT_NONE} disabled className="text-muted-foreground">
                          {categoryId == null ? 'Select a category first' : 'Select subcategory'}
                        </SelectItem>
                        {subcategoryOptions.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />

              <div className="space-y-2">
                <Label>Tags (optional)</Label>
                <div className="flex flex-wrap gap-3 rounded-lg border p-3">
                  {tags.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={tagIds.includes(t.id)}
                        onCheckedChange={(c) => toggleTag(t.id, c === true)}
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-card mt-6">
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Controller
              control={control}
              name="notes"
              render={({ field }) => <Textarea {...field} rows={4} className="resize-y min-h-[100px]" />}
            />
          </CardContent>
        </Card>

        <div className="mt-6">
          <Button
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
      </motion.div>

      <FeedbackDialog
        open={feedbackOpen}
        title={feedbackTitle}
        message={feedbackMessage}
        onClose={() => setFeedbackOpen(false)}
      />
    </div>
  )
}
