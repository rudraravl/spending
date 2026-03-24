import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { motion } from 'framer-motion'
import ConfirmDialog from '../components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { apiDelete, apiGet, apiPatchJson, apiPostJson } from '../api/client'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'
import { createAccount, deleteAccount, getAccounts } from '../api/accounts'
import {
  createCategory,
  createSubcategory,
  deleteCategory,
  deleteSubcategory,
  getCategories,
  getSubcategories,
} from '../api/categories'

import { ACCOUNT_TYPES } from '../features/accounts/accountViewKind'
import type { CategoryOut, SubcategoryOut, TagOut } from '../types'

type RuleMeta = { allowed_fields: string[]; allowed_operators: string[] }
type Rule = {
  id: number
  priority: number
  field: string
  operator: string
  value: string
  category_id: number
  subcategory_id: number
}
type RuleFormValues = {
  priority: number
  field: string
  operator: string
  value: string
  category_id: number | null
  subcategory_id: number | null
}

function catName(categoryId: number, list: CategoryOut[]) {
  return list.find((c) => c.id === categoryId)?.name ?? `Category ${categoryId}`
}

export default function SettingsPage() {
  const queryClient = useQueryClient()

  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    action: () => Promise<void>
  } | null>(null)

  // Form: account
  const [accountName, setAccountName] = useState('')
  const [accountType, setAccountType] = useState<(typeof ACCOUNT_TYPES)[number]>('credit')

  // Form: category
  const [categoryName, setCategoryName] = useState('')

  // Form: subcategory
  const [subcategoryParentCategoryId, setSubcategoryParentCategoryId] = useState<number | null>(null)
  const [subcategoryName, setSubcategoryName] = useState('')
  // Form: tag
  const [tagName, setTagName] = useState('')

  const [editingRuleId, setEditingRuleId] = useState<number | null>(null)
  const ruleForm = useForm<RuleFormValues>({
    defaultValues: {
      priority: 100,
      field: 'merchant',
      operator: 'contains',
      value: '',
      category_id: null,
      subcategory_id: null,
    },
  })
  const { control: ruleControl, watch: watchRule, setValue: setRuleValueForm, handleSubmit: handleRuleSubmit } = ruleForm
  const ruleCategoryId = watchRule('category_id')
  const ruleSubcategoryId = watchRule('subcategory_id')

  const settingsAllQuery = useQuery({
    queryKey: queryKeys.settingsAll(),
    queryFn: async () => {
      const [acct, cat, tag, ruleResp, ruleMetaResp] = await Promise.all([
        getAccounts(),
        getCategories(),
        apiGet<TagOut[]>('/api/tags'),
        apiGet<Rule[]>('/api/rules'),
        apiGet<RuleMeta>('/api/rules/meta'),
      ])
      return { acct, cat, tag, ruleResp, ruleMetaResp }
    },
  })

  async function reloadAll() {
    queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
    queryClient.invalidateQueries({ queryKey: queryKeys.categories() })
    queryClient.invalidateQueries({ queryKey: queryKeys.tags() })
    queryClient.invalidateQueries({ queryKey: ['subcategories'] })
    queryClient.invalidateQueries({ queryKey: ['transactions'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['views'] })
    queryClient.invalidateQueries({ queryKey: ['summaries'] })
    await queryClient.refetchQueries({ queryKey: queryKeys.settingsAll() })
  }

  const ruleSubsQuery = useQuery<SubcategoryOut[], Error>({
    queryKey: queryKeys.subcategories(ruleCategoryId),
    queryFn: () => getSubcategories(ruleCategoryId!),
    enabled: ruleCategoryId != null,
  })

  const accounts = settingsAllQuery.data?.acct ?? []
  const categories = settingsAllQuery.data?.cat ?? []
  const tags = settingsAllQuery.data?.tag ?? []
  const rules = settingsAllQuery.data?.ruleResp ?? []
  const meta = settingsAllQuery.data?.ruleMetaResp ?? null

  const subcategoriesForRule = ruleCategoryId == null ? [] : (ruleSubsQuery.data ?? [])

  const categoryIds = useMemo(() => categories.map((c) => c.id), [categories])
  const allSubcategoriesQueries = useQueries({
    queries: categoryIds.map((categoryId) => ({
      queryKey: queryKeys.subcategories(categoryId),
      queryFn: () => getSubcategories(categoryId),
      enabled: categoryIds.length > 0,
    })),
  })
  const subcategoryNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const q of allSubcategoriesQueries) {
      for (const s of q.data ?? []) map.set(s.id, s.name)
    }
    return map
  }, [
    allSubcategoriesQueries
      .flatMap((q) => q.data ?? [])
      .map((s) => `${s.id}:${s.name}`)
      .sort()
      .join('|'),
  ])

  useEffect(() => {
    const cat = settingsAllQuery.data?.cat
    if (!cat?.length) return
    setSubcategoryParentCategoryId((prev) => prev ?? cat[0].id)
    if (ruleCategoryId == null) setRuleValueForm('category_id', cat[0].id)
  }, [settingsAllQuery.data, ruleCategoryId, setRuleValueForm])

  useEffect(() => {
    if (ruleCategoryId == null) return
    const subs = ruleSubsQuery.data ?? []
    if (!subs.length) return
    if (!subs.some((s) => s.id === ruleSubcategoryId)) {
      setRuleValueForm('subcategory_id', subs[0]?.id ?? null)
    }
  }, [ruleCategoryId, ruleSubsQuery.data, ruleSubcategoryId, setRuleValueForm])

  const createAccountMutation = useMutation({
    mutationFn: (payload: { name: string; type: string; currency: string }) => createAccount(payload),
  })

  const deleteAccountMutation = useMutation({
    mutationFn: (id: number) => deleteAccount(id),
  })

  const createCategoryMutation = useMutation({
    mutationFn: (payload: { name: string }) => createCategory(payload),
  })

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: number) => deleteCategory(id),
  })

  const createSubcategoryMutation = useMutation({
    mutationFn: (payload: { category_id: number; name: string }) => createSubcategory(payload),
  })

  const createTagMutation = useMutation({
    mutationFn: (payload: { name: string }) => apiPostJson('/api/tags', payload),
  })

  const deleteTagMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/tags/${id}`),
  })

  const upsertRuleMutation = useMutation({
    mutationFn: async (args: { editingRuleId: number | null; base: Omit<Rule, 'id'> }) => {
      if (args.editingRuleId) {
        await apiPatchJson(`/api/rules/${args.editingRuleId}`, args.base)
        return
      }
      await apiPostJson('/api/rules', args.base)
    },
  })

  const deleteRuleMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/rules/${id}`),
  })

  function loadRuleIntoEditor(r: Rule) {
    setEditingRuleId(r.id)
    setRuleValueForm('priority', r.priority)
    setRuleValueForm('field', r.field)
    setRuleValueForm('operator', r.operator)
    setRuleValueForm('value', r.value)
    setRuleValueForm('category_id', r.category_id)
    setRuleValueForm('subcategory_id', r.subcategory_id)
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-8">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h1 className="text-2xl font-semibold mb-1">Settings</h1>
        <p className="text-muted-foreground mb-0">Manage accounts, categories, subcategories, tags, and rules.</p>
      </motion.div>

      <ConfirmDialog
        open={confirmState != null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        onCancel={() => setConfirmState(null)}
        onConfirm={async () => {
          if (!confirmState) return
          const fn = confirmState.action
          setConfirmState(null)
          await fn()
        }}
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
        <div className="space-y-8">
          <section>
            <h2 className="text-lg font-semibold mb-4">Accounts</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="space-y-2">
                <Label>Account name</Label>
                <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={accountType}
                  onValueChange={(v) => setAccountType(v as (typeof ACCOUNT_TYPES)[number])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              className="mt-2"
              onClick={async () => {
                await createAccountMutation.mutateAsync({
                  name: accountName,
                  type: accountType,
                  currency: 'USD',
                })
                setAccountName('')
                await reloadAll()
              }}
            >
              Create account
            </Button>

            <div className="mt-4 space-y-3">
              {accounts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-card group"
                >
                  <div>
                    <p className="text-sm font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{a.type} · USD</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() =>
                      setConfirmState({
                        title: 'Delete account?',
                        message: `Remove "${a.name}"? This cannot be undone.`,
                        action: async () => {
                          await deleteAccountMutation.mutateAsync(a.id)
                          await reloadAll()
                        },
                      })
                    }
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-4">Categories</h2>
            <div className="flex flex-col sm:flex-row gap-3 items-start mb-4">
              <div className="space-y-2 flex-1 w-full">
                <Label>Category name</Label>
                <Input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
              </div>
              <Button
                className="sm:mt-7"
                onClick={async () => {
                  await createCategoryMutation.mutateAsync({ name: categoryName })
                  setCategoryName('')
                  await reloadAll()
                }}
              >
                Create category
              </Button>
            </div>

            <div className="space-y-3">
              {categories.map((c) => (
                <div key={c.id} className="rounded-xl border bg-card p-4 shadow-card group">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <p className="text-sm font-medium">{c.name}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() =>
                        setConfirmState({
                          title: 'Delete category?',
                          message: `Remove "${c.name}" and its subcategory links? This cannot be undone.`,
                          action: async () => {
                            await deleteCategoryMutation.mutateAsync(c.id)
                            await reloadAll()
                          },
                        })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Subcategories</p>
                    <SubcategoriesList categoryId={c.id} onReload={reloadAll} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <section>
            <h2 className="text-lg font-semibold mb-4">Add subcategory</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="space-y-2">
                <Label>Parent category</Label>
                <Select
                  value={subcategoryParentCategoryId != null ? String(subcategoryParentCategoryId) : undefined}
                  onValueChange={(v) => setSubcategoryParentCategoryId(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Subcategory name</Label>
                <Input value={subcategoryName} onChange={(e) => setSubcategoryName(e.target.value)} />
              </div>
            </div>
            <Button
              className="mt-2"
              onClick={async () => {
                if (!subcategoryParentCategoryId) return
                await createSubcategoryMutation.mutateAsync({
                  category_id: subcategoryParentCategoryId,
                  name: subcategoryName,
                })
                setSubcategoryName('')
                await reloadAll()
              }}
            >
              Create subcategory
            </Button>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-4">Tags</h2>
            <div className="flex flex-col sm:flex-row gap-3 items-start mb-4">
              <div className="space-y-2 flex-1 w-full">
                <Label>Tag name</Label>
                <Input value={tagName} onChange={(e) => setTagName(e.target.value)} />
              </div>
              <Button
                className="sm:mt-7"
                onClick={async () => {
                  await createTagMutation.mutateAsync({ name: tagName })
                  setTagName('')
                  await reloadAll()
                }}
              >
                Create tag
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <div
                  key={t.id}
                  className="inline-flex items-center gap-2 rounded-md border bg-secondary/50 px-3 py-1.5 text-sm"
                >
                  <span>{t.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1 text-destructive"
                    onClick={() =>
                      setConfirmState({
                        title: 'Delete tag?',
                        message: `Remove tag "${t.name}"?`,
                        action: async () => {
                          await deleteTagMutation.mutateAsync(t.id)
                          await reloadAll()
                        },
                      })
                    }
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-4">Rules</h2>
            <div className="rounded-xl border bg-card shadow-card p-4 space-y-4">
              {!meta ? (
                <div className="text-sm text-muted-foreground">Loading rule meta…</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Controller
                      control={ruleControl}
                      name="priority"
                      render={({ field }) => (
                        <div className="space-y-2">
                          <Label>Priority</Label>
                          <Input
                            type="number"
                            value={field.value}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                          />
                        </div>
                      )}
                    />
                    <Controller
                      control={ruleControl}
                      name="field"
                      render={({ field }) => (
                        <div className="space-y-2">
                          <Label>Field</Label>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {meta.allowed_fields.map((f) => (
                                <SelectItem key={f} value={f}>
                                  {f}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Controller
                      control={ruleControl}
                      name="operator"
                      render={({ field }) => (
                        <div className="space-y-2">
                          <Label>Operator</Label>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {meta.allowed_operators.map((op) => (
                                <SelectItem key={op} value={op}>
                                  {op}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    />
                    <Controller
                      control={ruleControl}
                      name="value"
                      render={({ field }) => (
                        <div className="space-y-2">
                          <Label>Value</Label>
                          <Input value={field.value} onChange={field.onChange} />
                        </div>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Controller
                      control={ruleControl}
                      name="category_id"
                      render={({ field }) => (
                        <div className="space-y-2">
                          <Label>Category</Label>
                          <Select
                            value={field.value != null ? String(field.value) : undefined}
                            onValueChange={(v) => field.onChange(Number(v))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Category" />
                            </SelectTrigger>
                            <SelectContent>
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
                      control={ruleControl}
                      name="subcategory_id"
                      render={({ field }) => (
                        <div className="space-y-2">
                          <Label>Subcategory</Label>
                          <Select
                            value={field.value != null ? String(field.value) : undefined}
                            onValueChange={(v) => field.onChange(Number(v))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Subcategory" />
                            </SelectTrigger>
                            <SelectContent>
                              {subcategoriesForRule.map((s) => (
                                <SelectItem key={s.id} value={String(s.id)}>
                                  {s.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      onClick={handleRuleSubmit(async (values) => {
                        if (!values.category_id || !values.subcategory_id) return
                        const base = {
                          priority: values.priority,
                          field: values.field,
                          operator: values.operator,
                          value: values.value,
                          category_id: values.category_id,
                          subcategory_id: values.subcategory_id,
                        }
                        await upsertRuleMutation.mutateAsync({ editingRuleId, base })
                        setEditingRuleId(null)
                        setRuleValueForm('value', '')
                        await reloadAll()
                      })}
                    >
                      {editingRuleId ? 'Save changes' : 'Create rule'}
                    </Button>
                    {editingRuleId ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEditingRuleId(null)
                          setRuleValueForm('value', '')
                        }}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </>
              )}
            </div>

            <div className="mt-6 space-y-3">
              {rules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rules yet.</p>
              ) : (
                rules.map((r) => (
                  <div key={r.id} className="rounded-xl border bg-card shadow-card p-4">
                    <p className="text-sm font-medium">
                      [{r.priority}] {r.field} {r.operator} {r.value} → {catName(r.category_id, categories)} /{' '}
                      {subcategoryNameById.get(r.subcategory_id) ?? r.subcategory_id}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => loadRuleIntoEditor(r)}>
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() =>
                          setConfirmState({
                            title: 'Delete rule?',
                            message: 'Remove this categorization rule?',
                            action: async () => {
                              await deleteRuleMutation.mutateAsync(r.id)
                              await reloadAll()
                            },
                          })
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function SubcategoriesList({
  categoryId,
  onReload,
}: {
  categoryId: number
  onReload: () => Promise<void>
}) {
  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    action: () => Promise<void>
  } | null>(null)

  const { data: subs = [] } = useQuery<SubcategoryOut[], Error>({
    queryKey: queryKeys.subcategories(categoryId),
    queryFn: () => getSubcategories(categoryId),
  })

  const deleteSubcategoryMutation = useMutation({
    mutationFn: (id: number) => deleteSubcategory(id),
  })

  return (
    <div>
      <ConfirmDialog
        open={confirmState != null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        onCancel={() => setConfirmState(null)}
        onConfirm={async () => {
          if (!confirmState) return
          const fn = confirmState.action
          setConfirmState(null)
          await fn()
        }}
      />
      {subs.length === 0 ? <div style={{ opacity: 0.7, fontSize: 13 }}>No subcategories.</div> : null}
      {subs.map((s) => (
        <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
          <div style={{ paddingLeft: 10 }}>• {s.name}</div>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive shrink-0"
            onClick={() =>
              setConfirmState({
                title: 'Delete subcategory?',
                message: `Remove "${s.name}"?`,
                action: async () => {
                  await deleteSubcategoryMutation.mutateAsync(s.id)
                  await onReload()
                },
              })
            }
          >
            Delete
          </Button>
        </div>
      ))}
    </div>
  )
}
