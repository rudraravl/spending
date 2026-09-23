import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import ConfirmDialog from '../components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { categoryColor } from '@/lib/categoryStyle'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidateTransactionData, queryKeys } from '../queryKeys'
import { createTag, deleteTag, getTags } from '../api/tags'
import { createRule, deleteRule, getRuleMeta, getRules, updateRule, type Rule, type RuleIn } from '../api/rules'
import { toast } from 'sonner'
import {
  createCategory,
  createSubcategory,
  deleteCategory,
  deleteSubcategory,
  getCategories,
  getSubcategories,
} from '../api/categories'

import type { CategoryOut, SubcategoryOut, TagOut } from '../types'

const EMPTY_CATEGORIES: CategoryOut[] = []
const EMPTY_TAGS: TagOut[] = []
const EMPTY_RULES: Rule[] = []
import { Link, useSearchParams } from 'react-router-dom'
import PageHeader from '@/components/PageHeader'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab = tabParam === 'tags' || tabParam === 'rules' ? tabParam : 'categories'

  const queryClient = useQueryClient()

  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    action: () => void
  } | null>(null)

  const [categoryName, setCategoryName] = useState('')

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

  const categoriesQuery = useQuery({ queryKey: queryKeys.categories(), queryFn: getCategories })
  const tagsQuery = useQuery({ queryKey: queryKeys.tags(), queryFn: getTags })
  const rulesQuery = useQuery({ queryKey: queryKeys.rules(), queryFn: getRules })
  const ruleMetaQuery = useQuery({ queryKey: queryKeys.rulesMeta(), queryFn: getRuleMeta })

  /** After any taxonomy / rule change: refresh the lists here and everything that shows category names. */
  async function reloadAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.categories() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tags() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.subcategoriesAll() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.rules() }),
      invalidateTransactionData(queryClient),
    ])
  }

  const onMutationError = (e: Error) => toast.error(e.message)

  const ruleSubsQuery = useQuery<SubcategoryOut[], Error>({
    queryKey: queryKeys.subcategories(ruleCategoryId),
    queryFn: () => getSubcategories(ruleCategoryId!),
    enabled: ruleCategoryId != null,
  })

  const categories = categoriesQuery.data ?? EMPTY_CATEGORIES
  const tags = tagsQuery.data ?? EMPTY_TAGS
  const rules = rulesQuery.data ?? EMPTY_RULES
  const meta = ruleMetaQuery.data ?? null

  const subcategoriesForRule = ruleCategoryId == null ? [] : (ruleSubsQuery.data ?? [])

  const subcategoryNameById = useQueries({
    queries: categories.map((c) => ({
      queryKey: queryKeys.subcategories(c.id),
      queryFn: () => getSubcategories(c.id),
    })),
    combine: (results) => {
      const map = new Map<number, string>()
      for (const q of results) {
        for (const s of q.data ?? []) map.set(s.id, s.name)
      }
      return map
    },
  })

  useEffect(() => {
    const cat = categoriesQuery.data
    if (!cat?.length) return
    if (ruleCategoryId == null) setRuleValueForm('category_id', cat[0].id)
  }, [categoriesQuery.data, ruleCategoryId, setRuleValueForm])

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
    onSuccess: reloadAll,
    onError: onMutationError,
  })

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: number) => deleteCategory(id),
    onSuccess: reloadAll,
    onError: onMutationError,
  })

  const createTagMutation = useMutation({
    mutationFn: (payload: { name: string }) => createTag(payload),
    onSuccess: reloadAll,
    onError: onMutationError,
  })

  const deleteTagMutation = useMutation({
    mutationFn: (id: number) => deleteTag(id),
    onSuccess: reloadAll,
    onError: onMutationError,
  })

  const upsertRuleMutation = useMutation({
    mutationFn: (args: { editingRuleId: number | null; base: RuleIn }) =>
      args.editingRuleId ? updateRule(args.editingRuleId, args.base) : createRule(args.base),
    onSuccess: reloadAll,
    onError: onMutationError,
  })

  const deleteRuleMutation = useMutation({
    mutationFn: (id: number) => deleteRule(id),
    onSuccess: reloadAll,
    onError: onMutationError,
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

  const isLoading =
    categoriesQuery.isLoading || tagsQuery.isLoading || rulesQuery.isLoading || ruleMetaQuery.isLoading

  return (
    <div className="page">
      <ConfirmDialog
        open={confirmState != null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => {
          if (!confirmState) return
          const fn = confirmState.action
          setConfirmState(null)
          fn()
        }}
      />
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams)
          if (value === 'categories') next.delete('tab')
          else next.set('tab', value)
          setSearchParams(next, { replace: true })
        }}
      >
        <PageHeader
          className="mb-5"
          title="Settings"
          description={
            <>
              Categories, tags, and auto-categorization rules. Accounts live on the{' '}
              <Link to="/accounts" className="text-primary underline-offset-4 hover:underline">
                Accounts
              </Link>{' '}
              page.
            </>
          }
          actions={
            <TabsList>
              <TabsTrigger value="categories">Categories</TabsTrigger>
              <TabsTrigger value="tags">Tags</TabsTrigger>
              <TabsTrigger value="rules">Rules</TabsTrigger>
            </TabsList>
          }
        />

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <TabsContent value="categories" className="mt-0 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Top-level groups drive reports, budgets, and charts; subcategories add detail inside each one.
                </p>
                <form
                  className="flex w-full gap-2 sm:w-auto"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!categoryName.trim()) return
                    createCategoryMutation.mutate({ name: categoryName.trim() }, { onSuccess: () => setCategoryName('') })
                  }}
                >
                  <Input
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                    placeholder="New category"
                    className="sm:w-56"
                    aria-label="New category name"
                  />
                  <Button type="submit" disabled={!categoryName.trim() || createCategoryMutation.isPending}>
                    <Plus className="h-4 w-4" /> Add
                  </Button>
                </form>
              </div>
              {categories.length === 0 ? (
                <p className="surface p-6 text-sm text-muted-foreground">No categories yet. Add one above.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {categories.map((c) => (
                    <CategoryCard
                      key={c.id}
                      category={c}
                      onReload={reloadAll}
                      onDelete={() =>
                        setConfirmState({
                          title: 'Delete category?',
                          message: `Remove "${c.name}" and its subcategory links? This cannot be undone.`,
                          action: () => deleteCategoryMutation.mutate(c.id),
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="tags" className="mt-0">
              <section className="surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Free-form labels for cross-cutting themes (trips, reimbursements, projects) alongside categories.
                  </p>
                  <form
                    className="flex w-full gap-2 sm:w-auto"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!tagName.trim()) return
                      createTagMutation.mutate({ name: tagName.trim() }, { onSuccess: () => setTagName('') })
                    }}
                  >
                    <Input
                      value={tagName}
                      onChange={(e) => setTagName(e.target.value)}
                      placeholder="New tag"
                      className="sm:w-56"
                      aria-label="New tag name"
                    />
                    <Button type="submit" disabled={!tagName.trim() || createTagMutation.isPending}>
                      <Plus className="h-4 w-4" /> Add
                    </Button>
                  </form>
                </div>
                <div className="mt-4 border-t border-border/70 pt-4">
                  {tags.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tags yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {tags.map((t) => (
                        <span
                          key={t.id}
                          className="group inline-flex items-center gap-1 rounded-full border bg-secondary/50 py-1 pl-3 pr-1 text-sm"
                        >
                          {t.name}
                          <button
                            type="button"
                            aria-label={`Delete tag ${t.name}`}
                            className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() =>
                              setConfirmState({
                                title: 'Delete tag?',
                                message: `Remove tag "${t.name}"?`,
                                action: () => deleteTagMutation.mutate(t.id),
                              })
                            }
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </TabsContent>

            <TabsContent value="rules" className="mt-0">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
                <section className="surface space-y-4 p-5 lg:sticky lg:top-24">
                  <div>
                    <h2 className="text-base font-semibold">{editingRuleId ? 'Edit rule' : 'New rule'}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Auto-assign a category when new or imported transactions match. Higher priority runs first.
                    </p>
                  </div>
                  {!meta ? (
                    <div className="text-sm text-muted-foreground">Loading rule options…</div>
                  ) : (
                    <>
                <div className="grid grid-cols-2 gap-3">
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
                <div className="grid grid-cols-2 gap-3">
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

                <div className="grid grid-cols-2 gap-3">
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
                    onClick={handleRuleSubmit((values) => {
                      if (!values.category_id || !values.subcategory_id) return
                      const base = {
                        priority: values.priority,
                        field: values.field,
                        operator: values.operator,
                        value: values.value,
                        category_id: values.category_id,
                        subcategory_id: values.subcategory_id,
                      }
                      upsertRuleMutation.mutate(
                        { editingRuleId, base },
                        {
                          onSuccess: () => {
                            setEditingRuleId(null)
                            setRuleValueForm('value', '')
                          },
                        },
                      )
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
                </section>

                <section className="surface overflow-hidden">
                  <div className="flex items-center justify-between border-b border-border/70 px-5 py-3">
                    <h2 className="text-base font-semibold">Saved rules</h2>
                    <span className="text-xs text-muted-foreground">{rules.length}</span>
                  </div>
                  {rules.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-muted-foreground">No rules yet.</p>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {rules.map((r) => (
                        <li
                          key={r.id}
                          className={`group flex items-center gap-3 px-5 py-2.5 text-sm ${editingRuleId === r.id ? 'bg-accent/60' : 'hover:bg-muted/40'}`}
                        >
                          <span className="w-10 shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-center text-xs tabular-nums text-muted-foreground">
                            {r.priority}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">
                              <span className="text-muted-foreground">{r.field} {r.operator}</span>{' '}
                              <span className="font-medium">{String(r.value)}</span>
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              → {catName(r.category_id, categories)} /{' '}
                              {subcategoryNameById.get(r.subcategory_id) ?? r.subcategory_id}
                            </span>
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground"
                            aria-label="Edit rule"
                            onClick={() => loadRuleIntoEditor(r)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                            aria-label="Delete rule"
                            onClick={() =>
                              setConfirmState({
                                title: 'Delete rule?',
                                message: 'Remove this categorization rule?',
                                action: () => deleteRuleMutation.mutate(r.id),
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  )
}

/** One category: its subcategories as removable chips plus an inline "add subcategory" field. */
function CategoryCard({
  category,
  onReload,
  onDelete,
}: {
  category: CategoryOut
  onReload: () => Promise<void>
  onDelete: () => void
}) {
  const [newSub, setNewSub] = useState('')
  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    action: () => void
  } | null>(null)

  const { data: subs = [] } = useQuery<SubcategoryOut[], Error>({
    queryKey: queryKeys.subcategories(category.id),
    queryFn: () => getSubcategories(category.id),
  })

  const createSub = useMutation({
    mutationFn: (name: string) => createSubcategory({ category_id: category.id, name }),
    onSuccess: async () => {
      setNewSub('')
      await onReload()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteSub = useMutation({
    mutationFn: (id: number) => deleteSubcategory(id),
    onSuccess: onReload,
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <section className="surface group/card flex flex-col p-4">
      <ConfirmDialog
        open={confirmState != null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => {
          if (!confirmState) return
          const fn = confirmState.action
          setConfirmState(null)
          fn()
        }}
      />
      <div className="flex items-center gap-2.5">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: categoryColor(category.id) }}
          aria-hidden
        />
        <h3 className="flex-1 truncate font-semibold">{category.name}</h3>
        <span className="text-xs text-muted-foreground">{subs.length}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/card:opacity-100"
          aria-label={`Delete category ${category.name}`}
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-3 flex flex-1 flex-wrap content-start gap-1.5">
        {subs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No subcategories yet.</p>
        ) : (
          subs.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-0.5 rounded-full bg-secondary py-0.5 pl-2.5 pr-0.5 text-xs"
            >
              {s.name}
              <button
                type="button"
                aria-label={`Delete subcategory ${s.name}`}
                className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() =>
                  setConfirmState({
                    title: 'Delete subcategory?',
                    message: `Remove "${s.name}" from ${category.name}?`,
                    action: () => deleteSub.mutate(s.id),
                  })
                }
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
      </div>

      <form
        className="mt-3 flex gap-2 border-t border-border/70 pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (newSub.trim()) createSub.mutate(newSub.trim())
        }}
      >
        <Input
          value={newSub}
          onChange={(e) => setNewSub(e.target.value)}
          placeholder="Add subcategory"
          className="h-8 text-sm"
          aria-label={`New subcategory in ${category.name}`}
        />
        <Button
          type="submit"
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          disabled={!newSub.trim() || createSub.isPending}
          aria-label="Add subcategory"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </form>
    </section>
  )
}
