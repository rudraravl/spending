import { useEffect, useMemo, useState } from 'react'
import { Button, MenuItem, TextField } from '@mui/material'
import { Controller, useForm } from 'react-hook-form'
import PageHeader from '../components/PageHeader'
import ConfirmDialog from '../components/ConfirmDialog'
import { apiDelete, apiGet, apiPatchJson, apiPostJson } from '../api/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'cash', 'investment'] as const

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

  const createSubsQuery = useQuery<SubcategoryOut[], Error>({
    queryKey: queryKeys.subcategories(subcategoryParentCategoryId),
    queryFn: () => getSubcategories(subcategoryParentCategoryId!),
    enabled: subcategoryParentCategoryId != null,
  })

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

  const subcategoriesForCreate =
    subcategoryParentCategoryId == null ? [] : (createSubsQuery.data ?? [])
  const subcategoriesForRule = ruleCategoryId == null ? [] : (ruleSubsQuery.data ?? [])

  const subcategoryNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const s of subcategoriesForCreate) map.set(s.id, s.name)
    for (const s of subcategoriesForRule) map.set(s.id, s.name)
    return map
  }, [subcategoriesForCreate, subcategoriesForRule])

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
    <div className="sp-page">
      <PageHeader
        icon="⚙️"
        title="Settings"
        subtitle="Manage accounts, categories, subcategories, tags, and rules."
      />

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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Accounts</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <TextField
              label="Account name"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              fullWidth
            />
            <TextField
              select
              label="Type"
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as (typeof ACCOUNT_TYPES)[number])}
              fullWidth
            >
              {ACCOUNT_TYPES.map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </TextField>
          </div>
          <Button
            variant="contained"
            sx={{ marginTop: 1 }}
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

          <div style={{ marginTop: 16 }}>
            {accounts.map((a) => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{a.name}</div>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>{a.type}</div>
                </div>
                <Button
                  color="error"
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

          <div style={{ fontWeight: 700, margin: '24px 0 8px' }}>Categories</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <TextField
              label="Category name"
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              sx={{ flex: 1 }}
            />
            <Button
              variant="contained"
              onClick={async () => {
                await createCategoryMutation.mutateAsync({ name: categoryName })
                setCategoryName('')
                await reloadAll()
              }}
            >
              Create category
            </Button>
          </div>

          <div style={{ marginTop: 16 }}>
            {categories.map((c) => (
              <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ fontWeight: 700 }}>{c.name}</div>
                  <Button
                    color="error"
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
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Subcategories</div>
                  <SubcategoriesList categoryId={c.id} onReload={reloadAll} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Add Subcategory</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <TextField
              select
              label="Parent category"
              value={subcategoryParentCategoryId ?? ''}
              onChange={(e) => setSubcategoryParentCategoryId(Number(e.target.value))}
              fullWidth
            >
              {categories.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Subcategory name"
              value={subcategoryName}
              onChange={(e) => setSubcategoryName(e.target.value)}
              fullWidth
            />
          </div>
          <Button
            variant="contained"
            sx={{ marginTop: 1 }}
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

          <div style={{ fontWeight: 700, margin: '24px 0 8px' }}>Tags</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <TextField label="Tag name" value={tagName} onChange={(e) => setTagName(e.target.value)} sx={{ flex: 1 }} />
            <Button
              variant="contained"
              onClick={async () => {
                await createTagMutation.mutateAsync({ name: tagName })
                setTagName('')
                await reloadAll()
              }}
            >
              Create tag
            </Button>
          </div>

          <div style={{ marginTop: 16 }}>
            {tags.map((t) => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>{t.name}</div>
                <Button
                  color="error"
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
                  Delete
                </Button>
              </div>
            ))}
          </div>

          <div style={{ fontWeight: 700, margin: '24px 0 8px' }}>Rules</div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
            {!meta ? (
              <div>Loading rule meta...</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Controller
                    control={ruleControl}
                    name="priority"
                    render={({ field }) => (
                      <TextField
                        label="Priority"
                        type="number"
                        value={field.value}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        fullWidth
                      />
                    )}
                  />
                  <Controller
                    control={ruleControl}
                    name="field"
                    render={({ field }) => (
                      <TextField select label="Field" value={field.value} onChange={field.onChange} fullWidth>
                        {meta.allowed_fields.map((f) => (
                          <MenuItem key={f} value={f}>
                            {f}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                  <Controller
                    control={ruleControl}
                    name="operator"
                    render={({ field }) => (
                      <TextField
                        select
                        label="Operator"
                        value={field.value}
                        onChange={field.onChange}
                        fullWidth
                      >
                        {meta.allowed_operators.map((op) => (
                          <MenuItem key={op} value={op}>
                            {op}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  />
                  <Controller
                    control={ruleControl}
                    name="value"
                    render={({ field }) => <TextField label="Value" value={field.value} onChange={field.onChange} fullWidth />}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                  <Controller
                    control={ruleControl}
                    name="category_id"
                    render={({ field }) => (
                      <TextField
                        select
                        label="Category"
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        fullWidth
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
                    control={ruleControl}
                    name="subcategory_id"
                    render={({ field }) => (
                      <TextField
                        select
                        label="Subcategory"
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        fullWidth
                      >
                        {subcategoriesForRule.map((s) => (
                          <MenuItem key={s.id} value={s.id}>
                            {s.name}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  />
                </div>

                <Button
                  variant="contained"
                  sx={{ marginTop: 1.5 }}
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
                  <Button sx={{ marginLeft: 1 }} onClick={() => { setEditingRuleId(null); setRuleValueForm('value', '') }}>
                    Cancel
                  </Button>
                ) : null}
              </>
            )}
          </div>

          <div style={{ marginTop: 16 }}>
            {rules.length === 0 ? (
              <div>No rules yet.</div>
            ) : (
              <div>
                {rules.map((r) => (
                  <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 12 }}>
                    <div style={{ fontWeight: 700 }}>
                      [{r.priority}] {r.field} {r.operator} {r.value} → {catName(r.category_id, categories)} /{' '}
                      {subcategoryNameById.get(r.subcategory_id) ?? r.subcategory_id}
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                      <Button onClick={() => loadRuleIntoEditor(r)}>Edit</Button>
                      <Button
                        color="error"
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
                ))}
              </div>
            )}
          </div>
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
            color="error"
            size="small"
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
