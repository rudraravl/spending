import { useEffect } from 'react'
import PlotlyDefault from 'react-plotly.js'
import PageHeader from '../components/PageHeader'
import { apiGet } from '../api/client'
import { useQuery } from '@tanstack/react-query'

// `react-plotly.js` is CJS; depending on bundler interop, the React component can be nested under one or more `default` keys.
const Plot: any =
  (PlotlyDefault as any)?.default?.default ?? (PlotlyDefault as any)?.default ?? PlotlyDefault

type DashboardResponse = {
  total_all_time_spend: number
  current_month_spend: number
  total_transactions: number
  recent_trend: Array<{ date: string; amount: number }>
  recent_activity: Array<{
    id: number
    Date: string
    Merchant: string
    Amount: number
    Category: string
    Subcategory: string
    Tags: string
    Notes: string
    Acct: string
  }>
}

export default function DashboardPage() {
  const { data, error, isLoading } = useQuery<DashboardResponse, Error>({
    queryKey: ['dashboard'],
    queryFn: () => apiGet<DashboardResponse>('/api/dashboard'),
  })
  const plotOk = typeof Plot === 'function' || (typeof Plot === 'object' && Boolean((Plot as any)?.$$typeof))

  useEffect(() => {
    if (!plotOk) {
      console.error('Plotly React component is not usable', { plotType: typeof Plot, plot: Plot })
    }
    // Only evaluate once; Plot is module-level constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="sp-page">
      <PageHeader
        icon="💰"
        title="Budget Dashboard"
        subtitle="See a quick snapshot of your totals and the latest activity."
      />

      {error ? <div style={{ color: 'crimson' }}>{error.message}</div> : null}
      {isLoading || !data ? (
        <div>Loading...</div>
      ) : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Total All-Time Spending</div>
              <div style={{ fontSize: 20 }}>${data.total_all_time_spend.toFixed(2)}</div>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Current Month</div>
              <div style={{ fontSize: 20 }}>${data.current_month_spend.toFixed(2)}</div>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Total Transactions</div>
              <div style={{ fontSize: 20 }}>{data.total_transactions}</div>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Recent trend (last 30 days)</div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
              {plotOk ? (
                <Plot
                  data={[
                    {
                      x: data.recent_trend.map((r) => r.date),
                      y: data.recent_trend.map((r) => r.amount),
                      type: 'bar',
                      marker: { color: 'rgba(170, 59, 255, 0.8)' },
                    },
                  ]}
                  layout={{
                    height: 260,
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

          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Recent activity (last 10)</div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
              <div style={{ overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  {/* Keep header/body column ordering fixed.
                      The backend object key order isn't guaranteed, so using Object.keys() can misalign columns. */}
                  {/*
                    Render <thead>/<tbody> with a stable column list instead.
                  */}
                  <thead>
                    <tr>
                      {(['Date', 'Merchant', 'Amount', 'Category', 'Subcategory', 'Tags', 'Notes', 'Acct'] as const).map((k) => (
                        <th key={k} style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_activity.map((r) => (
                      <tr key={r.id}>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.Date}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.Merchant}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>${Number(r.Amount).toFixed(2)}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.Category}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.Subcategory}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.Tags}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.Notes}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{r.Acct}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

