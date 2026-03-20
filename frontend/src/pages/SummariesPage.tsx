import { useState } from 'react'
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
      }}
      config={{ displayModeBar: false, responsive: true }}
    />
  ) : (
    <div style={{ padding: 8, opacity: 0.75 }}>Plotly unavailable</div>
  )
}

export default function SummariesPage() {
  const [tab, setTab] = useState<(typeof rangeMap)[number]['key']>('month')
  const plotOk = typeof Plot === 'function' || (typeof Plot === 'object' && Boolean((Plot as any)?.$$typeof))

  const { data, error, isLoading } = useQuery<SummariesResponse, Error>({
    queryKey: ['summaries', tab],
    queryFn: () => apiGet<SummariesResponse>(`/api/summaries?range_type=${encodeURIComponent(tab)}`),
  })

  return (
    <div className="sp-page">
      <PageHeader
        icon="📊"
        title="Summaries"
        subtitle="Jump straight to month, year, or semester overviews."
      />

      {error ? <div style={{ color: 'crimson' }}>{error.message}</div> : null}
      {isLoading || !data ? (
        <div>Loading...</div>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            {rangeMap.map((t) => (
              <button
                key={t.key}
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
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Total Spend</div>
            <div style={{ fontSize: 26 }}>${data.total.toFixed(2)}</div>
            <div style={{ opacity: 0.7, marginTop: 6, fontSize: 13 }}>
              {data.start_date} → {data.end_date}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
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
                          No tagged transactions.
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
            <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Spend by Tag</div>
              {data.by_tag.length === 0 ? (
                <div style={{ opacity: 0.7 }}>No data.</div>
              ) : (
                <Pie
                  plotOk={plotOk}
                  labels={data.by_tag.map((r) => r.tag)}
                  values={data.by_tag.map((r) => Number(r.total))}
                  title="Spend by Tag"
                />
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
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
                          No categorized transactions.
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
            <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Spend by Category</div>
              {data.by_category.length === 0 ? (
                <div style={{ opacity: 0.7 }}>No data.</div>
              ) : (
                <Pie
                  plotOk={plotOk}
                  labels={data.by_category.map((r) => r.category)}
                  values={data.by_category.map((r) => Number(r.total))}
                  title="Spend by Category"
                />
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
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
                          No subcategorized transactions.
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
            <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Spend by Subcategory</div>
              {data.by_subcategory.length === 0 ? (
                <div style={{ opacity: 0.7 }}>No data.</div>
              ) : (
                <Pie
                  plotOk={plotOk}
                  labels={data.by_subcategory.map((r) => r.subcategory)}
                  values={data.by_subcategory.map((r) => Number(r.total))}
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

