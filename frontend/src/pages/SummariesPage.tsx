import { useMemo, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { PlotlyComponent as Plot, plotlyComponentOk } from '../components/charts/plotlyShared'
import { Button } from '@/components/ui/button'
import { SortableHtmlTh } from '@/components/sortable-table-head'
import { cycleSort, sortByColumn, type ColumnSortState } from '@/lib/tableSort'
import { apiGet } from '../api/client'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic API row shape from summaries endpoint
type SummaryRow = Record<string, any>

type SummariesResponse = {
  start_date: string
  end_date: string
  total: number
  by_tag: SummaryRow[]
  by_category: SummaryRow[]
  by_subcategory: SummaryRow[]
}

const rangeMap = [
  { key: 'month', label: 'Current Month Summary' },
  { key: 'year', label: 'Current Year Summary' },
  { key: 'semester', label: 'Current Semester Summary' },
] as const

const grid2: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  gap: 16,
  marginTop: 16,
}

const tableFixed: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
}

const th: CSSProperties = {
  textAlign: 'left',
  padding: 8,
  borderBottom: '1px solid var(--border)',
}

const td: CSSProperties = {
  padding: 8,
  borderBottom: '1px solid var(--border)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const chartSlot: CSSProperties = {
  minWidth: 0,
  width: '100%',
  height: 320,
}

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
    <div style={chartSlot}>
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
          autosize: true,
          margin: { t: 30, b: 10, l: 10, r: 10 },
          showlegend: false,
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
        }}
        style={{ width: '100%', height: '100%' }}
        config={{ displayModeBar: false, responsive: true }}
      />
    </div>
  ) : (
    <div style={{ padding: 8, opacity: 0.75 }}>Plotly unavailable</div>
  )
}

function ChartPlaceholder({ message }: { message: string }) {
  return (
    <div
      style={{
        ...chartSlot,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.65,
        fontSize: 14,
      }}
    >
      {message}
    </div>
  )
}

function buildPieData(rows: SummaryRow[], labelKey: string): { labels: string[]; values: number[] } {
  const labels: string[] = []
  const values: number[] = []
  for (const row of rows) {
    const raw = Number(row.total)
    if (!Number.isFinite(raw)) continue
    const magnitude = Math.abs(raw)
    if (magnitude <= 0) continue
    labels.push(String(row[labelKey] ?? 'Unknown'))
    values.push(magnitude)
  }
  return { labels, values }
}

export default function SummariesPage() {
  const [tab, setTab] = useState<(typeof rangeMap)[number]['key']>('month')
  const [tagSort, setTagSort] = useState<ColumnSortState | null>(null)
  const [categorySort, setCategorySort] = useState<ColumnSortState | null>(null)
  const [subcategorySort, setSubcategorySort] = useState<ColumnSortState | null>(null)
  const plotOk = plotlyComponentOk(Plot)

  const { data, error, isPending, isFetching } = useQuery<SummariesResponse, Error>({
    queryKey: ['summaries', tab],
    queryFn: () => apiGet<SummariesResponse>(`/api/summaries?range_type=${encodeURIComponent(tab)}`),
    staleTime: 5 * 60 * 1000,
  })

  const awaitingData = !data && !error && (isPending || isFetching)
  const loadFailed = Boolean(error) && !data

  const sortedByTag = useMemo((): SummaryRow[] => {
    if (!data?.by_tag?.length) return data?.by_tag ?? []
    return sortByColumn(data.by_tag as Record<string, unknown>[], tagSort, ['total', 'count', 'percent']) as SummaryRow[]
  }, [data?.by_tag, tagSort])

  const sortedByCategory = useMemo((): SummaryRow[] => {
    if (!data?.by_category?.length) return data?.by_category ?? []
    return sortByColumn(data.by_category as Record<string, unknown>[], categorySort, [
      'total',
      'count',
      'percent',
    ]) as SummaryRow[]
  }, [data?.by_category, categorySort])

  const sortedBySubcategory = useMemo((): SummaryRow[] => {
    if (!data?.by_subcategory?.length) return data?.by_subcategory ?? []
    return sortByColumn(data.by_subcategory as Record<string, unknown>[], subcategorySort, [
      'total',
      'count',
      'percent',
    ]) as SummaryRow[]
  }, [data?.by_subcategory, subcategorySort])

  const tagPieData = useMemo(() => buildPieData(data?.by_tag ?? [], 'tag'), [data?.by_tag])
  const categoryPieData = useMemo(() => buildPieData(data?.by_category ?? [], 'category'), [data?.by_category])
  const subcategoryPieData = useMemo(
    () => buildPieData(data?.by_subcategory ?? [], 'subcategory'),
    [data?.by_subcategory]
  )

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h1 className="text-2xl font-semibold mb-1">Summaries</h1>
        <p className="text-muted-foreground mb-0">Jump straight to month, year, or semester overviews.</p>
      </motion.div>

      {error ? <div className="text-sm text-destructive">{error.message}</div> : null}

      {loadFailed ? (
        <div style={{ marginTop: 12, opacity: 0.85 }}>Unable to load summaries.</div>
      ) : null}

      {loadFailed ? null : (
      <div style={{ opacity: awaitingData ? 0.72 : 1, transition: 'opacity 0.15s ease' }}>
        <div className="flex flex-wrap gap-2 mb-4 items-center">
          {rangeMap.map((t) => (
            <Button
              key={t.key}
              type="button"
              variant={tab === t.key ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </Button>
          ))}
          {isFetching && data ? (
            <span style={{ fontSize: 13, opacity: 0.75 }}>Updating…</span>
          ) : null}
        </div>

        <div className="rounded-xl border bg-card shadow-card p-4 min-w-0 mb-0">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Total Spend</div>
          {awaitingData ? (
            <div style={{ fontSize: 26, opacity: 0.5 }}>—</div>
          ) : (
            <div style={{ fontSize: 26 }}>${data!.total.toFixed(2)}</div>
          )}
          <div style={{ opacity: 0.7, marginTop: 6, fontSize: 13 }}>
            {awaitingData ? '…' : `${data!.start_date} → ${data!.end_date}`}
          </div>
        </div>

        <div style={grid2}>
          <div className="rounded-xl border bg-card shadow-card p-4 min-w-0">
            <div style={{ fontWeight: 700, marginBottom: 8 }}>By Tag</div>
            <div style={{ overflow: 'auto' }}>
              <table style={tableFixed}>
                <colgroup>
                  <col style={{ width: '38%' }} />
                  <col style={{ width: '24%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '24%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <SortableHtmlTh
                      label="tag"
                      columnKey="tag"
                      sort={tagSort}
                      onSort={(k) => setTagSort((p) => cycleSort(p, k))}
                      style={th}
                    />
                    <SortableHtmlTh
                      label="total"
                      columnKey="total"
                      sort={tagSort}
                      onSort={(k) => setTagSort((p) => cycleSort(p, k))}
                      style={th}
                    />
                    <SortableHtmlTh
                      label="count"
                      columnKey="count"
                      sort={tagSort}
                      onSort={(k) => setTagSort((p) => cycleSort(p, k))}
                      style={th}
                    />
                    <SortableHtmlTh
                      label="percent"
                      columnKey="percent"
                      sort={tagSort}
                      onSort={(k) => setTagSort((p) => cycleSort(p, k))}
                      style={th}
                    />
                  </tr>
                </thead>
                <tbody>
                  {awaitingData ? (
                    <tr>
                      <td colSpan={4} style={{ ...td, whiteSpace: 'normal' }}>
                        Loading…
                      </td>
                    </tr>
                  ) : data!.by_tag.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ ...td, whiteSpace: 'normal', opacity: 0.7 }}>
                        No tagged transactions.
                      </td>
                    </tr>
                  ) : (
                    sortedByTag.map((r, idx) => (
                      <tr key={idx}>
                        <td style={td} title={String(r.tag)}>
                          {r.tag}
                        </td>
                        <td style={td}>${Number(r.total).toFixed(2)}</td>
                        <td style={td}>{r.count}</td>
                        <td style={td}>{Number(r.percent).toFixed(2)}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-xl border bg-card shadow-card p-4 min-w-0">
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Spend by Tag</div>
            {awaitingData ? (
              <ChartPlaceholder message="Loading chart…" />
            ) : tagPieData.values.length === 0 ? (
              <div style={{ opacity: 0.7 }}>No data.</div>
            ) : (
              <Pie
                plotOk={plotOk}
                labels={tagPieData.labels}
                values={tagPieData.values}
                title="Spend by Tag"
              />
            )}
          </div>
        </div>

        <div style={grid2}>
          <div className="rounded-xl border bg-card shadow-card p-4 min-w-0">
            <div style={{ fontWeight: 700, marginBottom: 8 }}>By Category</div>
            <div style={{ overflow: 'auto' }}>
              <table style={tableFixed}>
                <colgroup>
                  <col style={{ width: '38%' }} />
                  <col style={{ width: '24%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '24%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <SortableHtmlTh
                      label="category"
                      columnKey="category"
                      sort={categorySort}
                      onSort={(k) => setCategorySort((p) => cycleSort(p, k))}
                      style={th}
                    />
                    <SortableHtmlTh
                      label="total"
                      columnKey="total"
                      sort={categorySort}
                      onSort={(k) => setCategorySort((p) => cycleSort(p, k))}
                      style={th}
                    />
                    <SortableHtmlTh
                      label="count"
                      columnKey="count"
                      sort={categorySort}
                      onSort={(k) => setCategorySort((p) => cycleSort(p, k))}
                      style={th}
                    />
                    <SortableHtmlTh
                      label="percent"
                      columnKey="percent"
                      sort={categorySort}
                      onSort={(k) => setCategorySort((p) => cycleSort(p, k))}
                      style={th}
                    />
                  </tr>
                </thead>
                <tbody>
                  {awaitingData ? (
                    <tr>
                      <td colSpan={4} style={{ ...td, whiteSpace: 'normal' }}>
                        Loading…
                      </td>
                    </tr>
                  ) : data!.by_category.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ ...td, whiteSpace: 'normal', opacity: 0.7 }}>
                        No categorized transactions.
                      </td>
                    </tr>
                  ) : (
                    sortedByCategory.map((r, idx) => (
                      <tr key={idx}>
                        <td style={td} title={String(r.category)}>
                          {r.category}
                        </td>
                        <td style={td}>${Number(r.total).toFixed(2)}</td>
                        <td style={td}>{r.count}</td>
                        <td style={td}>{Number(r.percent).toFixed(2)}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-xl border bg-card shadow-card p-4 min-w-0">
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Spend by Category</div>
            {awaitingData ? (
              <ChartPlaceholder message="Loading chart…" />
            ) : categoryPieData.values.length === 0 ? (
              <div style={{ opacity: 0.7 }}>No data.</div>
            ) : (
              <Pie
                plotOk={plotOk}
                labels={categoryPieData.labels}
                values={categoryPieData.values}
                title="Spend by Category"
              />
            )}
          </div>
        </div>

        <div style={grid2}>
          <div className="rounded-xl border bg-card shadow-card p-4 min-w-0">
            <div style={{ fontWeight: 700, marginBottom: 8 }}>By Subcategory</div>
            <div style={{ overflow: 'auto' }}>
              <table style={tableFixed}>
                <colgroup>
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '28%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '22%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <SortableHtmlTh
                      label="category"
                      columnKey="category"
                      sort={subcategorySort}
                      onSort={(k) => setSubcategorySort((p) => cycleSort(p, k))}
                      style={th}
                    />
                    <SortableHtmlTh
                      label="subcategory"
                      columnKey="subcategory"
                      sort={subcategorySort}
                      onSort={(k) => setSubcategorySort((p) => cycleSort(p, k))}
                      style={th}
                    />
                    <SortableHtmlTh
                      label="total"
                      columnKey="total"
                      sort={subcategorySort}
                      onSort={(k) => setSubcategorySort((p) => cycleSort(p, k))}
                      style={th}
                    />
                    <SortableHtmlTh
                      label="count"
                      columnKey="count"
                      sort={subcategorySort}
                      onSort={(k) => setSubcategorySort((p) => cycleSort(p, k))}
                      style={th}
                    />
                    <SortableHtmlTh
                      label="percent"
                      columnKey="percent"
                      sort={subcategorySort}
                      onSort={(k) => setSubcategorySort((p) => cycleSort(p, k))}
                      style={th}
                    />
                  </tr>
                </thead>
                <tbody>
                  {awaitingData ? (
                    <tr>
                      <td colSpan={5} style={{ ...td, whiteSpace: 'normal' }}>
                        Loading…
                      </td>
                    </tr>
                  ) : data!.by_subcategory.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ ...td, whiteSpace: 'normal', opacity: 0.7 }}>
                        No subcategorized transactions.
                      </td>
                    </tr>
                  ) : (
                    sortedBySubcategory.map((r, idx) => (
                      <tr key={idx}>
                        <td style={td} title={String(r.category)}>
                          {r.category}
                        </td>
                        <td style={td} title={String(r.subcategory)}>
                          {r.subcategory}
                        </td>
                        <td style={td}>${Number(r.total).toFixed(2)}</td>
                        <td style={td}>{r.count}</td>
                        <td style={td}>{Number(r.percent).toFixed(2)}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-xl border bg-card shadow-card p-4 min-w-0">
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Spend by Subcategory</div>
            {awaitingData ? (
              <ChartPlaceholder message="Loading chart…" />
            ) : subcategoryPieData.values.length === 0 ? (
              <div style={{ opacity: 0.7 }}>No data.</div>
            ) : (
              <Pie
                plotOk={plotOk}
                labels={subcategoryPieData.labels}
                values={subcategoryPieData.values}
                title="Spend by Subcategory"
              />
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
