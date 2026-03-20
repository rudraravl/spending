import { useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/PageHeader'
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

type Account = { id: number; name: string; type: string; currency: string }
type Category = { id: number; name: string }
type Subcategory = { id: number; name: string; category_id: number }
type Tag = { id: number; name: string }

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

const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'cash', 'investment'] as const

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [meta, setMeta] = useState<RuleMeta | null>(null)

  // Form: account
  const [accountName, setAccountName] = useState('')
  const [accountType, setAccountType] = useState<(typeof ACCOUNT_TYPES)[number]>('credit')

  // Form: category
  const [categoryName, setCategoryName] = useState('')

  // Form: subcategory
  const [subcategoryParentCategoryId, setSubcategoryParentCategoryId] = useState<number | null>(null)
  const [subcategoryName, setSubcategoryName] = useState('')
  const [subcategoriesForCreate, setSubcategoriesForCreate] = useState<Subcategory[]>([])

  // Form: tag
  const [tagName, setTagName] = useState('')

  // Form: rules create/update
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null)
  const [rulePriority, setRulePriority] = useState<number>(100)
  const [ruleField, setRuleField] = useState<string>('merchant')
  const [ruleOperator, setRuleOperator] = useState<string>('contains')
  const [ruleValue, setRuleValue] = useState<string>('')
  const [ruleCategoryId, setRuleCategoryId] = useState<number | null>(null)
  const [ruleSubcategoryId, setRuleSubcategoryId] = useState<number | null>(null)
  const [subcategoriesForRule, setSubcategoriesForRule] = useState<Subcategory[]>([])

  const subcategoryNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const s of subcategoriesForCreate) map.set(s.id, s.name)
    for (const s of subcategoriesForRule) map.set(s.id, s.name)
    return map
  }, [subcategoriesForCreate, subcategoriesForRule])

  const settingsAllQuery = useQuery({
    queryKey: ['settingsAll'],
    queryFn: async () => {
      const [acct, cat, tag, ruleResp, ruleMetaResp] = await Promise.all([
        getAccounts(),
        getCategories(),
        apiGet<Tag[]>('/api/tags'),
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
    await queryClient.refetchQueries({ queryKey: ['settingsAll'] })
  }

  const createSubsQuery = useQuery<Subcategory[], Error>({
    queryKey: queryKeys.subcategories(subcategoryParentCategoryId),
    queryFn: () => getSubcategories(subcategoryParentCategoryId!),
    enabled: subcategoryParentCategoryId != null,
  })

  const ruleSubsQuery = useQuery<Subcategory[], Error>({
    queryKey: queryKeys.subcategories(ruleCategoryId),
    queryFn: () => getSubcategories(ruleCategoryId!),
    enabled: ruleCategoryId != null,
  })

  useEffect(() => {
    const data = settingsAllQuery.data
    if (!data) return
    setAccounts(data.acct)
    setCategories(data.cat)
    setTags(data.tag)
    setRules(data.ruleResp)
    setMeta(data.ruleMetaResp)
    if (data.cat.length > 0) {
      setSubcategoryParentCategoryId(data.cat[0].id)
      setRuleCategoryId(data.cat[0].id)
    }
  }, [settingsAllQuery.data])

  useEffect(() => {
    if (subcategoryParentCategoryId == null) {
      setSubcategoriesForCreate([])
      return
    }
    setSubcategoriesForCreate(createSubsQuery.data ?? [])
  }, [subcategoryParentCategoryId, createSubsQuery.data])

  useEffect(() => {
    if (ruleCategoryId == null) {
      setSubcategoriesForRule([])
      return
    }
    const subs = ruleSubsQuery.data ?? []
    setSubcategoriesForRule(subs)
    if (!subs.find((s) => s.id === ruleSubcategoryId)) {
      setRuleSubcategoryId(subs[0]?.id ?? null)
    }
  }, [ruleCategoryId, ruleSubsQuery.data, ruleSubcategoryId])

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
    setRulePriority(r.priority)
    setRuleField(r.field)
    setRuleOperator(r.operator)
    setRuleValue(r.value)
    setRuleCategoryId(r.category_id)
    setRuleSubcategoryId(r.subcategory_id)
  }

  return (
    <div className="sp-page">
      <PageHeader
        icon="⚙️"
        title="Settings"
        subtitle="Manage accounts, categories, subcategories, tags, and rules."
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Accounts</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input
              placeholder="Account name"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              style={{ padding: 10 }}
            />
            <select
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as (typeof ACCOUNT_TYPES)[number])}
              style={{ padding: 10 }}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <button
            style={{ marginTop: 8, padding: '10px 14px' }}
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
          </button>

          <div style={{ marginTop: 16 }}>
            {accounts.map((a) => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{a.name}</div>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>{a.type}</div>
                </div>
                <button
                  onClick={async () => {
                    await deleteAccountMutation.mutateAsync(a.id)
                    await reloadAll()
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>

          <div style={{ fontWeight: 700, margin: '24px 0 8px' }}>Categories</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="Category name"
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              style={{ padding: 10, flex: 1 }}
            />
            <button
              style={{ padding: '10px 14px' }}
              onClick={async () => {
                await createCategoryMutation.mutateAsync({ name: categoryName })
                setCategoryName('')
                await reloadAll()
              }}
            >
              Create category
            </button>
          </div>

          <div style={{ marginTop: 16 }}>
            {categories.map((c) => (
              <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ fontWeight: 700 }}>{c.name}</div>
                  <button
                    onClick={async () => {
                      await deleteCategoryMutation.mutateAsync(c.id)
                      await reloadAll()
                    }}
                  >
                    Delete
                  </button>
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
            <select
              value={subcategoryParentCategoryId ?? ''}
              onChange={(e) => setSubcategoryParentCategoryId(Number(e.target.value))}
              style={{ padding: 10 }}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              placeholder="Subcategory name"
              value={subcategoryName}
              onChange={(e) => setSubcategoryName(e.target.value)}
              style={{ padding: 10 }}
            />
          </div>
          <button
            style={{ marginTop: 8, padding: '10px 14px' }}
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
          </button>

          <div style={{ fontWeight: 700, margin: '24px 0 8px' }}>Tags</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="Tag name"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              style={{ padding: 10, flex: 1 }}
            />
            <button
              style={{ padding: '10px 14px' }}
              onClick={async () => {
                await createTagMutation.mutateAsync({ name: tagName })
                setTagName('')
                await reloadAll()
              }}
            >
              Create tag
            </button>
          </div>

          <div style={{ marginTop: 16 }}>
            {tags.map((t) => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>{t.name}</div>
                <button
                  onClick={async () => {
                    await deleteTagMutation.mutateAsync(t.id)
                    await reloadAll()
                  }}
                >
                  Delete
                </button>
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
                  <label>
                    Priority
                    <input
                      type="number"
                      value={rulePriority}
                      onChange={(e) => setRulePriority(Number(e.target.value))}
                      style={{ width: '100%', padding: 10, marginTop: 4 }}
                    />
                  </label>
                  <label>
                    Field
                    <select
                      value={ruleField}
                      onChange={(e) => setRuleField(e.target.value)}
                      style={{ width: '100%', padding: 10, marginTop: 4 }}
                    >
                      {meta.allowed_fields.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                  <label>
                    Operator
                    <select
                      value={ruleOperator}
                      onChange={(e) => setRuleOperator(e.target.value)}
                      style={{ width: '100%', padding: 10, marginTop: 4 }}
                    >
                      {meta.allowed_operators.map((op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Value
                    <input
                      value={ruleValue}
                      onChange={(e) => setRuleValue(e.target.value)}
                      style={{ width: '100%', padding: 10, marginTop: 4 }}
                    />
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                  <label>
                    Category
                    <select
                      value={ruleCategoryId ?? ''}
                      onChange={(e) => setRuleCategoryId(Number(e.target.value))}
                      style={{ width: '100%', padding: 10, marginTop: 4 }}
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Subcategory
                    <select
                      value={ruleSubcategoryId ?? ''}
                      onChange={(e) => setRuleSubcategoryId(Number(e.target.value))}
                      style={{ width: '100%', padding: 10, marginTop: 4 }}
                    >
                      {subcategoriesForRule.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <button
                  style={{ marginTop: 12, padding: '10px 14px' }}
                  onClick={async () => {
                    if (!ruleCategoryId || !ruleSubcategoryId) return
                    const base = {
                      priority: rulePriority,
                      field: ruleField,
                      operator: ruleOperator,
                      value: ruleValue,
                      category_id: ruleCategoryId,
                      subcategory_id: ruleSubcategoryId,
                    }
                    await upsertRuleMutation.mutateAsync({ editingRuleId, base })
                    setEditingRuleId(null)
                    setRuleValue('')
                    await reloadAll()
                  }}
                >
                  {editingRuleId ? 'Save changes' : 'Create rule'}
                </button>
                {editingRuleId ? (
                  <button
                    style={{ marginTop: 8, padding: '10px 14px', marginLeft: 8 }}
                    onClick={() => {
                      setEditingRuleId(null)
                      setRuleValue('')
                    }}
                  >
                    Cancel
                  </button>
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
                      [{r.priority}] {r.field} {r.operator} {r.value} → {catName(r.category_id, categories)} / {subcategoryNameById.get(r.subcategory_id) ?? r.subcategory_id}
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => loadRuleIntoEditor(r)}
                      >
                        Edit
                      </button>
                      <button
                        onClick={async () => {
                          await deleteRuleMutation.mutateAsync(r.id)
                          await reloadAll()
                        }}
                      >
                        Delete
                      </button>
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

  function catName(categoryId: number, list: Category[]) {
    return list.find((c) => c.id === categoryId)?.name ?? `Category ${categoryId}`
  }
}

function SubcategoriesList({
  categoryId,
  onReload,
}: {
  categoryId: number
  onReload: () => Promise<void>
}) {
  const { data: subs = [] } = useQuery<Subcategory[], Error>({
    queryKey: queryKeys.subcategories(categoryId),
    queryFn: () => getSubcategories(categoryId),
  })

  const deleteSubcategoryMutation = useMutation({
    mutationFn: (id: number) => deleteSubcategory(id),
  })

  async function remove(id: number) {
    await deleteSubcategoryMutation.mutateAsync(id)
    await onReload()
  }

  return (
    <div>
      {subs.length === 0 ? <div style={{ opacity: 0.7, fontSize: 13 }}>No subcategories.</div> : null}
      {subs.map((s) => (
        <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
          <div style={{ paddingLeft: 10 }}>• {s.name}</div>
          <button onClick={() => remove(s.id)}>Delete</button>
        </div>
      ))}
    </div>
  )
}

