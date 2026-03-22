import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import PlotlyDefault from 'react-plotly.js'
import { apiGet } from '../api/client'
import { Button } from '@/components/ui/button'
import { queryKeys } from '../queryKeys'
import { getAccounts } from '../api/accounts'
import { getCategories, getSubcategories } from '../api/categories'
import type { AccountOut, CategoryOut, SubcategoryOut, TagOut } from '../types'

// `react-plotly.js` is CJS; depending on bundler interop, the React component can be nested under one or more `default` keys.
const Plot: any =
  (PlotlyDefault as any)?.default?.default ?? (PlotlyDefault as any)?.default ?? PlotlyDefault

function Pie({
  labels,
  values,
  title,
  plotOk,
}: {
  labels: string[]
  values: number[]
  title: string
  plotOk: boolean
}) {
  return plotOk ? (
    <Plot
      data={[
        {
          type: 'pie',
          labels,
          values,
          hole: 0.2,
        },
      ]}
      layout={{
        title,
        height: 320,
        margin: { t: 30, b: 10, l: 10, r: 10 },
        showlegend: false,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
      }}
      config={{ displayModeBar: false, responsive: true }}
    />
  ) : (
    <div style={{ padding: 8, opacity: 0.75 }}>Plotly unavailable</div>
  )
}

type ViewsResponse = {
  start_date: string
  end_date: string
  total: number
  transaction_count: number
  spending_over_time: Array<{ date: string; amount: number }>
  by_tag: Array<Record<string, any>>
  by_category: Array<Record<string, any>>
  by_subcategory: Array<Record<string, any>>
  transactions: Array<Record<string, any>>
}

type Preset = 'Custom' | 'Last 7 days' | 'Last 30 days' | 'Year to date'

export default function ViewsPage() {
  const [preset, setPreset] = useState<Preset>('Custom')
  const [startDate, setStartDate] = useState(() => '2024-01-01')
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))

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

  const accounts = accountsQuery.data ?? []
  const categories = categoriesQuery.data ?? []
  const tags = tagsQuery.data ?? []

  const [subcategories, setSubcategories] = useState<SubcategoryOut[]>([])

  const [accountId, setAccountId] = useState<number | null>(null)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [subcategoryId, setSubcategoryId] = useState<number | null>(null)

  const subcategoriesQuery = useQuery<SubcategoryOut[], Error>({
    queryKey: queryKeys.subcategories(categoryId),
    queryFn: () => getSubcategories(categoryId!),
    enabled: categoryId != null,
  })

  useEffect(() => {
    if (!categoryId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubcategories([])
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubcategoryId(null)
      return
    }
    if (!subcategoriesQuery.data) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubcategories(subcategoriesQuery.data)
    if (!subcategoriesQuery.data.find((s) => s.id === subcategoryId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubcategoryId(subcategoriesQuery.data[0]?.id ?? null)
    }
  }, [categoryId, subcategoriesQuery.data, subcategoryId])

  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [tagsMatchAny, setTagsMatchAny] = useState(false)
  const [minAmount, setMinAmount] = useState<number>(0)
  const [maxAmount, setMaxAmount] = useState<number>(0)

  const [tab, setTab] = useState<'tag' | 'category' | 'subcategory'>('tag')
  const plotOk = typeof Plot === 'function' || (typeof Plot === 'object' && Boolean((Plot as any)?.$$typeof))

  // Meta (accounts/categories/tags) comes from React Query.

  useEffect(() => {
    const today = new Date()
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    if (preset === 'Custom') return
    if (preset === 'Last 7 days') {
      const start = new Date(today.getTime() - 7 * 24 * 3600 * 1000)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStartDate(iso(start))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEndDate(iso(today))
    } else if (preset === 'Last 30 days') {
      const start = new Date(today.getTime() - 30 * 24 * 3600 * 1000)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStartDate(iso(start))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEndDate(iso(today))
    } else if (preset === 'Year to date') {
      const start = new Date(today.getFullYear(), 0, 1)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStartDate(iso(start))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEndDate(iso(today))
    }
  }, [preset])

  const shouldMinMaxInclude = useMemo(() => {
    const min = minAmount > 0 ? minAmount : undefined
    const max = maxAmount > 0 ? maxAmount : undefined
    return { min, max }
  }, [minAmount, maxAmount])

  const normalizedTagIds = useMemo(() => [...selectedTagIds].sort((a, b) => a - b), [selectedTagIds])
  const viewsParamsKey = JSON.stringify({
    startDate,
    endDate,
    accountId,
    categoryId,
    subcategoryId,
    tagIds: normalizedTagIds,
    tagsMatchAny,
    min: shouldMinMaxInclude.min ?? null,
    max: shouldMinMaxInclude.max ?? null,
  })

  const viewsQuery = useQuery<ViewsResponse, Error>({
    queryKey: queryKeys.views(viewsParamsKey),
    enabled: Boolean(startDate && endDate),
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('start_date', startDate)
      params.set('end_date', endDate)
      if (accountId) params.set('account_id', String(accountId))
      if (categoryId) params.set('category_id', String(categoryId))
      if (subcategoryId) params.set('subcategory_id', String(subcategoryId))

      if (normalizedTagIds.length) {
        for (const id of normalizedTagIds) params.append('tag_ids', String(id))
      }
      params.set('tags_match_any', tagsMatchAny ? 'true' : 'false')

      if (shouldMinMaxInclude.min !== undefined) params.set('min_amount', String(shouldMinMaxInclude.min))
      if (shouldMinMaxInclude.max !== undefined) params.set('max_amount', String(shouldMinMaxInclude.max))

      return apiGet<ViewsResponse>(`/api/views?${params.toString()}`)
    },
  })

  const data = viewsQuery.data ?? null
  const error = viewsQuery.error?.message ?? null
  const loading = viewsQuery.isLoading

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h1 className="text-2xl font-semibold mb-1">Views</h1>
        <p className="text-muted-foreground mb-0">Mix and match filters to explore your spending from any angle.</p>
      </motion.div>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}
      {!data && loading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}

      <div className="rounded-xl border bg-card shadow-card p-4">
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Filters</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
          <label>
            Quick range
            <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} style={{ width: '100%', padding: 10, marginTop: 4 }}>
              {(['Custom', 'Last 7 days', 'Last 30 days', 'Year to date'] as Preset[]).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start date
            <input type="date" value={startDate} onChange={(e) => { setPreset('Custom'); setStartDate(e.target.value) }} style={{ width: '100%', padding: 10, marginTop: 4 }} />
          </label>
          <label>
            End date
            <input type="date" value={endDate} onChange={(e) => { setPreset('Custom'); setEndDate(e.target.value) }} style={{ width: '100%', padding: 10, marginTop: 4 }} />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 12 }}>
          <label>
            Account (optional)
            <select value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)} style={{ width: '100%', padding: 10, marginTop: 4 }}>
              <option value="">All</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category (optional)
            <select value={categoryId ?? ''} onChange={(e) => { setCategoryId(e.target.value ? Number(e.target.value) : null); }} style={{ width: '100%', padding: 10, marginTop: 4 }}>
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Subcategory (optional)
            <select value={subcategoryId ?? ''} onChange={(e) => setSubcategoryId(e.target.value ? Number(e.target.value) : null)} style={{ width: '100%', padding: 10, marginTop: 4 }} disabled={!categoryId}>
              <option value="">All</option>
              {subcategories.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tags (optional)
            <select
              multiple
              value={selectedTagIds.map(String)}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions).map((o) => Number(o.value))
                setSelectedTagIds(selected)
              }}
              style={{ width: '100%', padding: 10, marginTop: 4, minHeight: 80 }}
            >
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={tagsMatchAny} onChange={(e) => setTagsMatchAny(e.target.checked)} />
            Match any tag (OR)
          </label>
          <label style={{ flex: 1 }}>
            Min amount (optional)
            <input type="number" step="0.01" value={minAmount} onChange={(e) => setMinAmount(Number(e.target.value))} style={{ width: '100%', padding: 10, marginTop: 4 }} />
          </label>
          <label style={{ flex: 1 }}>
            Max amount (optional)
            <input type="number" step="0.01" value={maxAmount} onChange={(e) => setMaxAmount(Number(e.target.value))} style={{ width: '100%', padding: 10, marginTop: 4 }} />
          </label>
        </div>
      </div>

      {data ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 16 }}>
            <div className="rounded-xl border bg-card shadow-card p-4">
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Total</div>
              <div style={{ fontSize: 26 }}>${data.total.toFixed(2)}</div>
              <div style={{ opacity: 0.7, marginTop: 8, fontSize: 13 }}>
                Across {data.transaction_count} matching transactions from {data.start_date} to {data.end_date}.
              </div>
            </div>

            <div className="rounded-xl border bg-card shadow-card p-4">
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Spending over time</div>
              {plotOk ? (
                <Plot
                  data={[
                    {
                      x: data.spending_over_time.map((r) => r.date),
                      y: data.spending_over_time.map((r) => r.amount),
                      type: 'bar',
                      marker: { color: 'rgba(170, 59, 255, 0.8)' },
                    },
                  ]}
                  layout={{
                    height: 280,
                    margin: { t: 20, b: 40, l: 40, r: 20 },
                    title: 'Daily spending',
                    xaxis: { tickformat: '%b %d' },
                  }}
                  config={{ displayModeBar: false, responsive: true }}
                />
              ) : (
                <div style={{ padding: 8, opacity: 0.75 }}>Plotly unavailable</div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="flex flex-wrap gap-2 mb-3">
              <Button variant={tab === 'tag' ? 'default' : 'outline'} size="sm" onClick={() => setTab('tag')}>
                By tag
              </Button>
              <Button variant={tab === 'category' ? 'default' : 'outline'} size="sm" onClick={() => setTab('category')}>
                By category
              </Button>
              <Button variant={tab === 'subcategory' ? 'default' : 'outline'} size="sm" onClick={() => setTab('subcategory')}>
                By subcategory
              </Button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {tab === 'tag' ? (
                <>
                  <div className="rounded-xl border bg-card shadow-card p-4">
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>By Tag</div>
                    <div style={{ overflow: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>tag</th>
                            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>total</th>
                            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>count</th>
                            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>percent</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.by_tag.length === 0 ? (
                            <tr>
                              <td colSpan={4} style={{ padding: 8, opacity: 0.7 }}>
                                No tags assigned.
                              </td>
                            </tr>
                          ) : (
                            data.by_tag.map((r, idx) => (
                              <tr key={idx}>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.tag}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>${Number(r.total).toFixed(2)}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.count}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{Number(r.percent).toFixed(2)}%</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="rounded-xl border bg-card shadow-card p-4">
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>Spend by Tag</div>
                    {data.by_tag.length ? (
                      <Pie
                        plotOk={plotOk}
                        labels={data.by_tag.map((r) => r.tag)}
                        values={data.by_tag.map((r) => Number(r.total))}
                        title="Spend by Tag"
                      />
                    ) : (
                      <div style={{ opacity: 0.7 }}>No data.</div>
                    )}
                  </div>
                </>
              ) : null}

              {tab === 'category' ? (
                <>
                  <div className="rounded-xl border bg-card shadow-card p-4">
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>By Category</div>
                    <div style={{ overflow: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>category</th>
                            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>total</th>
                            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>count</th>
                            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>percent</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.by_category.length === 0 ? (
                            <tr>
                              <td colSpan={4} style={{ padding: 8, opacity: 0.7 }}>
                                No categories.
                              </td>
                            </tr>
                          ) : (
                            data.by_category.map((r, idx) => (
                              <tr key={idx}>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.category}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>${Number(r.total).toFixed(2)}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.count}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{Number(r.percent).toFixed(2)}%</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="rounded-xl border bg-card shadow-card p-4">
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>Spend by Category</div>
                    {data.by_category.length ? (
                      <Pie
                        plotOk={plotOk}
                        labels={data.by_category.map((r) => r.category)}
                        values={data.by_category.map((r) => Number(r.total))}
                        title="Spend by Category"
                      />
                    ) : (
                      <div style={{ opacity: 0.7 }}>No data.</div>
                    )}
                  </div>
                </>
              ) : null}

              {tab === 'subcategory' ? (
                <>
                  <div className="rounded-xl border bg-card shadow-card p-4">
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>By Subcategory</div>
                    <div style={{ overflow: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>category</th>
                            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>subcategory</th>
                            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>total</th>
                            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>count</th>
                            <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>percent</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.by_subcategory.length === 0 ? (
                            <tr>
                              <td colSpan={5} style={{ padding: 8, opacity: 0.7 }}>
                                No subcategories.
                              </td>
                            </tr>
                          ) : (
                            data.by_subcategory.map((r, idx) => (
                              <tr key={idx}>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.category}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.subcategory}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>${Number(r.total).toFixed(2)}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.count}</td>
                                <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{Number(r.percent).toFixed(2)}%</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="rounded-xl border bg-card shadow-card p-4">
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>Spend by Subcategory</div>
                    {data.by_subcategory.length ? (
                      <Pie
                        plotOk={plotOk}
                        labels={data.by_subcategory.map((r) => r.subcategory)}
                        values={data.by_subcategory.map((r) => Number(r.total))}
                        title="Spend by Subcategory"
                      />
                    ) : (
                      <div style={{ opacity: 0.7 }}>No data.</div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Transactions</div>
            <div className="rounded-xl border bg-card shadow-card p-4 overflow-auto">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Date', 'Merchant', 'Amount', 'Category', 'Subcategory', 'Tags', 'Notes', 'Acct'].map((k) => (
                      <th key={k} style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 8, opacity: 0.7 }}>
                        No transactions found.
                      </td>
                    </tr>
                  ) : (
                    data.transactions.map((r: any, idx: number) => (
                      <tr key={idx}>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.Date}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.Merchant}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>${Number(r.Amount).toFixed(2)}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.Category}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.Subcategory}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.Tags}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.Notes}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.Acct}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

