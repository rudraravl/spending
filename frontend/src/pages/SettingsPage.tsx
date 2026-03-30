import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { motion } from 'framer-motion'
import ConfirmDialog from '../components/ConfirmDialog'
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
import { apiDelete, apiGet, apiPatchJson, apiPostJson } from '../api/client'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'
import {
  createCategory,
  createSubcategory,
  deleteCategory,
  deleteSubcategory,
  getCategories,
  getSubcategories,
} from '../api/categories'

import type { CategoryOut, SubcategoryOut, TagOut } from '../types'
import { Separator } from '@/components/ui/separator'
import { Link } from 'react-router-dom'

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
  const sectionLinks = [
    { id: 'categories', label: 'Categories' },
    { id: 'subcategories', label: 'Subcategories' },
    { id: 'tags', label: 'Tags' },
    { id: 'rules', label: 'Rules' },
  ] as const

  const queryClient = useQueryClient()

  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    action: () => Promise<void>
  } | null>(null)

  const [categoryName, setCategoryName] = useState('')

  const [subcategoryParentCategoryId, setSubcategoryParentCategoryId] = useState<number | null>(null)
  const [subcategoryName, setSubcategoryName] = useState('')
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
      const [cat, tag, ruleResp, ruleMetaResp] = await Promise.all([
        getCategories(),
        apiGet<TagOut[]>('/api/tags'),
        apiGet<Rule[]>('/api/rules'),
        apiGet<RuleMeta>('/api/rules/meta'),
      ])
      return { cat, tag, ruleResp, ruleMetaResp }
    },
  })

  async function reloadAll() {
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

  const isLoading = settingsAllQuery.isLoading

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="grid gap-8 md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden md:block">
          <div className="sticky top-24 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85">
            <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Settings</p>
            <nav className="space-y-1">
              {sectionLinks.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="block rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {section.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <div className="space-y-10">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Categories, tags, and rules for labeling transactions. Manage accounts on the{' '}
              <Link to="/accounts" className="text-primary underline-offset-4 hover:underline">
                Accounts
              </Link>{' '}
              page.
            </p>
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

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-8">
          <section id="categories" className="scroll-mt-24">
            <Card className="shadow-card border-border/80">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Categories</CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                Top-level groups for your spending—think Food, Bills, or Travel. They drive reports, budgets, and how
                money rolls up in charts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row gap-3 items-end">
                <div className="space-y-2 flex-1 w-full">
                  <Label>New category name</Label>
                  <Input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="e.g. Food" />
                </div>
                <Button
                  className="w-full sm:w-auto"
                  onClick={async () => {
                    await createCategoryMutation.mutateAsync({ name: categoryName })
                    setCategoryName('')
                    await reloadAll()
                  }}
                >
                  Add category
                </Button>
              </div>
              <Separator />
              <div className="space-y-4">
                {categories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No categories yet. Add one above.</p>
                ) : (
                  categories.map((c) => (
                    <div key={c.id} className="rounded-lg border bg-muted/30 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">{c.name}</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive shrink-0"
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
                        <p className="text-xs font-medium text-muted-foreground mb-2">Subcategories in this group</p>
                        <SubcategoriesList categoryId={c.id} onReload={reloadAll} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
            </Card>
          </section>

          <section id="subcategories" className="scroll-mt-24">
            <Card className="shadow-card border-border/80">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Subcategories</CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                Optional finer labels inside a category—e.g. Groceries under Food—so you get detail without exploding your
                top-level list.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  <Input
                    value={subcategoryName}
                    onChange={(e) => setSubcategoryName(e.target.value)}
                    placeholder="e.g. Groceries"
                  />
                </div>
              </div>
              <Button
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
                Add subcategory
              </Button>
            </CardContent>
            </Card>
          </section>

          <section id="tags" className="scroll-mt-24">
            <Card className="shadow-card border-border/80">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Tags</CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                Free-form labels you attach to individual transactions. Use them for cross-cutting themes—trips,
                reimbursements, a side project—alongside categories.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3 items-end">
                <div className="space-y-2 flex-1 w-full">
                  <Label>New tag</Label>
                  <Input value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="e.g. Tax 2026" />
                </div>
                <Button
                  className="w-full sm:w-auto"
                  onClick={async () => {
                    await createTagMutation.mutateAsync({ name: tagName })
                    setTagName('')
                    await reloadAll()
                  }}
                >
                  Add tag
                </Button>
              </div>
              {tags.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tags yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {tags.map((t) => (
                    <div
                      key={t.id}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-secondary/40 px-3 py-1 text-sm"
                    >
                      <span>{t.name}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 rounded-full text-muted-foreground hover:text-destructive"
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
              )}
            </CardContent>
            </Card>
          </section>

          <section id="rules" className="scroll-mt-24">
            <Card className="shadow-card border-border/80">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Rules</CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                Auto-assign a category and subcategory when imported or new transactions match a condition—such as
                merchant contains a store name. Higher priority runs first when several rules could match.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border bg-card p-4 space-y-4">
                {!meta ? (
                  <div className="text-sm text-muted-foreground">Loading rule options…</div>
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
                          Cancel edit
                        </Button>
                      ) : null}
                    </div>
                  </>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-3">Saved rules</p>
                {rules.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No rules yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {rules.map((r) => (
                      <li key={r.id} className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
                        <p className="font-medium leading-snug">
                          [{r.priority}] {r.field} {r.operator} {String(r.value)}
                        </p>
                        <p className="text-muted-foreground text-xs mt-1">
                          → {catName(r.category_id, categories)} /{' '}
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
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
            </Card>
          </section>
            </div>
          )}
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
      {subs.length === 0 ? (
        <p className="text-xs text-muted-foreground">None yet—use the Subcategories section below to add one.</p>
      ) : (
        <ul className="space-y-1.5">
          {subs.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground pl-1 border-l-2 border-border">{s.name}</span>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive shrink-0 h-7"
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
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
