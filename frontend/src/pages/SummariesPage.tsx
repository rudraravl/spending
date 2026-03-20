import { useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import PlotlyDefault from 'react-plotly.js'
import PageHeader from '../components/PageHeader'
import { apiGet } from '../api/client'

// `react-plotly.js` is CJS; depending on bundler interop, the React component can be nested under one or more `default` keys.
const Plot: any =
  (PlotlyDefault as any)?.default?.default ?? (PlotlyDefault as any)?.default ?? PlotlyDefault

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

const panel: CSSProperties = {
  minWidth: 0,
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 12,
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

export default function SummariesPage() {
  const [tab, setTab] = useState<(typeof rangeMap)[number]['key']>('month')
  const plotOk = typeof Plot === 'function' || (typeof Plot === 'object' && Boolean((Plot as any)?.$$typeof))

  const { data, error, isPending, isFetching } = useQuery<SummariesResponse, Error>({
    queryKey: ['summaries', tab],
    queryFn: () => apiGet<SummariesResponse>(`/api/summaries?range_type=${encodeURIComponent(tab)}`),
    staleTime: 5 * 60 * 1000,
  })

  const awaitingData = !data && !error && (isPending || isFetching)
  const loadFailed = Boolean(error) && !data

  return (
    <div className="sp-page">
      <PageHeader
        icon="📊"
        title="Summaries"
        subtitle="Jump straight to month, year, or semester overviews."
      />

      {error ? <div style={{ color: 'crimson' }}>{error.message}</div> : null}

      {loadFailed ? (
        <div style={{ marginTop: 12, opacity: 0.85 }}>Unable to load summaries.</div>
      ) : null}

      {loadFailed ? null : (
      <div style={{ opacity: awaitingData ? 0.72 : 1, transition: 'opacity 0.15s ease' }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          {rangeMap.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                border: tab === t.key ? '2px solid var(--accent-border)' : '1px solid var(--border)',
                background: tab === t.key ? 'rgba(170, 59, 255, 0.12)' : 'transparent',
              }}
            >
              {t.label}
            </button>
          ))}
          {isFetching && data ? (
            <span style={{ fontSize: 13, opacity: 0.75 }}>Updating…</span>
          ) : null}
        </div>

        <div style={{ ...panel, marginBottom: 0 }}>
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
          <div style={panel}>
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
                    <th style={th}>tag</th>
                    <th style={th}>total</th>
                    <th style={th}>count</th>
                    <th style={th}>percent</th>
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
                    data!.by_tag.map((r, idx) => (
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
          <div style={panel}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Spend by Tag</div>
            {awaitingData ? (
              <ChartPlaceholder message="Loading chart…" />
            ) : data!.by_tag.length === 0 ? (
              <div style={{ opacity: 0.7 }}>No data.</div>
            ) : (
              <Pie
                plotOk={plotOk}
                labels={data!.by_tag.map((r) => r.tag)}
                values={data!.by_tag.map((r) => Number(r.total))}
                title="Spend by Tag"
              />
            )}
          </div>
        </div>

        <div style={grid2}>
          <div style={panel}>
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
                    <th style={th}>category</th>
                    <th style={th}>total</th>
                    <th style={th}>count</th>
                    <th style={th}>percent</th>
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
                    data!.by_category.map((r, idx) => (
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
          <div style={panel}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Spend by Category</div>
            {awaitingData ? (
              <ChartPlaceholder message="Loading chart…" />
            ) : data!.by_category.length === 0 ? (
              <div style={{ opacity: 0.7 }}>No data.</div>
            ) : (
              <Pie
                plotOk={plotOk}
                labels={data!.by_category.map((r) => r.category)}
                values={data!.by_category.map((r) => Number(r.total))}
                title="Spend by Category"
              />
            )}
          </div>
        </div>

        <div style={grid2}>
          <div style={panel}>
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
                    <th style={th}>category</th>
                    <th style={th}>subcategory</th>
                    <th style={th}>total</th>
                    <th style={th}>count</th>
                    <th style={th}>percent</th>
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
                    data!.by_subcategory.map((r, idx) => (
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
          <div style={panel}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Spend by Subcategory</div>
            {awaitingData ? (
              <ChartPlaceholder message="Loading chart…" />
            ) : data!.by_subcategory.length === 0 ? (
              <div style={{ opacity: 0.7 }}>No data.</div>
            ) : (
              <Pie
                plotOk={plotOk}
                labels={data!.by_subcategory.map((r) => r.subcategory)}
                values={data!.by_subcategory.map((r) => Number(r.total))}
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
