import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'
import { cn } from '@/lib/utils'

export type BreakdownRow = {
  total: number
  count?: number
  percent: number
  tag?: string
  category?: string
  subcategory?: string
  category_id?: number
}

export type RawSlice = {
  name: string
  value: number
  pct: number
  categoryId?: number
}

type PieSlice = RawSlice & {
  isEtAl: boolean
  fill: string
}

type LegendRow = {
  name: string
  pct: number
  color: string
  inEtAlGroup?: boolean
}

const pieColors = [
  'hsl(217, 91%, 54%)',
  'hsl(199, 80%, 48%)',
  'hsl(160, 84%, 38%)',
  'hsl(262, 52%, 52%)',
  'hsl(239, 58%, 58%)',
  'hsl(330, 65%, 52%)',
  'hsl(38, 92%, 50%)',
  'hsl(220, 11%, 58%)',
]

const ET_AL_COLOR = 'hsl(var(--muted-foreground) / 0.35)'
const ET_AL_SLICE_FILL = 'hsl(var(--muted) / 0.55)'

const SMALL_SLICE_PCT = 1

export const breakdownMotionContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
}

export const breakdownMotionItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
}

function consolidatePieSlices(raw: RawSlice[]): { pieSlices: PieSlice[]; legendRows: LegendRow[] } {
  if (raw.length === 0) return { pieSlices: [], legendRows: [] }
  const sorted = [...raw].sort((a, b) => b.value - a.value)
  const major = sorted.filter((s) => s.pct >= SMALL_SLICE_PCT)
  const minor = sorted.filter((s) => s.pct < SMALL_SLICE_PCT)

  const pieSlices: PieSlice[] = []
  const legendRows: LegendRow[] = []

  major.forEach((s, i) => {
    const fill = pieColors[i % pieColors.length]
    pieSlices.push({ ...s, isEtAl: false, fill })
    legendRows.push({ name: s.name, pct: s.pct, color: fill })
  })

  if (minor.length > 0) {
    const sumV = minor.reduce((a, b) => a + b.value, 0)
    const sumP = minor.reduce((a, b) => a + b.pct, 0)
    pieSlices.push({
      name: 'et al.',
      value: sumV,
      pct: sumP,
      isEtAl: true,
      fill: ET_AL_SLICE_FILL,
    })
    minor.forEach((s) => {
      legendRows.push({
        name: s.name,
        pct: s.pct,
        color: ET_AL_COLOR,
        inEtAlGroup: true,
      })
    })
  }

  return { pieSlices, legendRows }
}

export function rawSlicesFromRows(
  rows: BreakdownRow[],
  nameKey: 'tag' | 'category' | 'subcategory',
  idKey?: 'category_id',
): RawSlice[] {
  const out: RawSlice[] = []
  for (const row of rows) {
    const raw = Number(row.total)
    if (!Number.isFinite(raw)) continue
    const magnitude = Math.abs(raw)
    if (magnitude <= 0) continue
    const label = String(row[nameKey] ?? 'Unknown').trim() || 'Unknown'
    const slice: RawSlice = {
      name: label,
      value: magnitude,
      pct: Number(row.percent),
    }
    if (idKey && row.category_id != null) {
      slice.categoryId = row.category_id
    }
    out.push(slice)
  }
  return out
}

export function formatMoney(n: number) {
  const sign = n < 0 ? '−' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function PieLegendList({
  rows,
  showEtAlNote,
  large,
}: {
  rows: LegendRow[]
  showEtAlNote: boolean
  large?: boolean
}) {
  return (
    <div>
      {showEtAlNote ? (
        <p
          className={cn(
            'text-muted-foreground mb-2 leading-snug',
            large ? 'text-xs' : 'text-[10px]',
          )}
        >
          Segments under 1% are drawn as one &quot;et al.&quot; slice; each category still appears here.
        </p>
      ) : null}
      <ul
        className={cn(
          'leading-snug max-h-[min(52vh,360px)] overflow-y-auto pr-1',
          large ? 'space-y-2 text-sm' : 'space-y-1.5 text-[11px]',
        )}
      >
        {rows.map((row, i) => (
          <li key={`${row.name}-${i}`} className="flex items-start gap-2 min-w-0">
            <span
              className={cn(
                'shrink-0 rounded-sm',
                large ? 'mt-0.5 h-3 w-3' : 'mt-1 h-2.5 w-2.5',
              )}
              style={{ backgroundColor: row.color }}
              aria-hidden
            />
            <span className={row.inEtAlGroup ? 'text-muted-foreground' : 'text-foreground'}>
              <span className="break-words">{row.name}</span>
              <span className="tabular-nums text-muted-foreground"> — {row.pct.toFixed(1)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SpendPieCard({
  title,
  subtitle,
  rawSlices,
  emptyHint,
  interactiveCategory,
  selectedCategoryId,
  onCategorySliceClick,
  twoThirdsPieLayout,
}: {
  title: string
  subtitle?: string
  rawSlices: RawSlice[]
  emptyHint: string
  interactiveCategory?: boolean
  selectedCategoryId?: number | null
  onCategorySliceClick?: (categoryId: number) => void
  twoThirdsPieLayout?: boolean
}) {
  const { pieSlices, legendRows } = useMemo(() => consolidatePieSlices(rawSlices), [rawSlices])
  const showEtAlNote = legendRows.some((r) => r.inEtAlGroup)

  if (rawSlices.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 shadow-card flex flex-col min-h-[320px]">
        <h2 className="text-sm font-semibold mb-1">{title}</h2>
        {subtitle ? <p className="text-xs text-muted-foreground mb-4">{subtitle}</p> : null}
        <p className="text-sm text-muted-foreground flex-1 flex items-center justify-center">{emptyHint}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-6 shadow-card min-w-0">
      <h2 className="text-sm font-semibold mb-1">{title}</h2>
      {subtitle ? <p className="text-xs text-muted-foreground mb-4">{subtitle}</p> : null}
      <div className="flex flex-col lg:flex-row lg:items-stretch gap-4 min-w-0">
        <div
          className={cn(
            'h-[min(52vh,420px)] min-h-[260px] min-w-0',
            twoThirdsPieLayout ? 'lg:flex-[2]' : 'flex-1',
          )}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <Pie
                data={pieSlices}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="44%"
                outerRadius="76%"
                paddingAngle={1.2}
                strokeWidth={1}
                stroke="hsl(var(--background))"
                label={false}
                cursor={interactiveCategory ? 'pointer' : 'default'}
                onClick={
                  interactiveCategory && onCategorySliceClick
                    ? (_, index) => {
                        const s = pieSlices[index]
                        if (!s || s.isEtAl || s.categoryId == null) return
                        onCategorySliceClick(s.categoryId)
                      }
                    : undefined
                }
              >
                {pieSlices.map((s, i) => {
                  const selected =
                    interactiveCategory &&
                    !s.isEtAl &&
                    s.categoryId != null &&
                    selectedCategoryId === s.categoryId
                  return (
                    <Cell
                      key={i}
                      fill={s.fill}
                      stroke={selected ? 'hsl(var(--primary))' : 'hsl(var(--background))'}
                      strokeWidth={selected ? 3 : 1}
                      className={interactiveCategory ? 'outline-none' : ''}
                    />
                  )
                })}
              </Pie>
              <RechartsTooltip
                formatter={(value: number, _n, item: { payload?: PieSlice }) => {
                  const name = item.payload?.name ?? ''
                  return [
                    `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                    name,
                  ]
                }}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: '1px solid hsl(var(--border))',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div
          className={cn(
            'w-full shrink-0 lg:border-l lg:border-border/60 lg:pl-4',
            twoThirdsPieLayout ? 'lg:flex-1 lg:min-w-0' : 'lg:w-[min(100%,280px)]',
          )}
        >
          <p
            className={cn(
              'font-medium uppercase tracking-wide text-muted-foreground mb-2',
              twoThirdsPieLayout ? 'text-xs' : 'text-[10px]',
            )}
          >
            Legend
          </p>
          <PieLegendList rows={legendRows} showEtAlNote={showEtAlNote} large={twoThirdsPieLayout} />
        </div>
      </div>
    </div>
  )
}
