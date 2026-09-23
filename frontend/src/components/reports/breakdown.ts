import type { BreakdownRow } from '@/api/reports'

export type { BreakdownRow }

export type RawSlice = {
  name: string
  value: number
  pct: number
  categoryId?: number
  /** Signed contribution from backend row.total (negative=outflow/spending). */
  signedTotal: number
}

export const breakdownMotionContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
}

export const breakdownMotionItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
}

export function rawSlicesFromRows(
  rows: BreakdownRow[],
  nameKey: 'tag' | 'category' | 'subcategory',
  idKey?: 'category_id',
): RawSlice[] {
  const out: RawSlice[] = []
  for (const row of rows) {
    const rawSigned = Number(row.total)
    if (!Number.isFinite(rawSigned)) continue
    const magnitude = Math.abs(rawSigned)
    if (magnitude <= 0) continue
    const label = String(row[nameKey] ?? 'Unknown').trim() || 'Unknown'

    // Exclude Income category from visualization entirely.
    // For subcategories we can still inspect the parent category name.
    const parentCategoryName = String(row.category ?? '').toLowerCase()
    const isIncomeCategory = label.toLowerCase() === 'income' || parentCategoryName === 'income'
    if ((nameKey === 'category' && label.toLowerCase() === 'income') || (nameKey === 'subcategory' && isIncomeCategory)) {
      continue
    }

    const slice: RawSlice = {
      name: label,
      value: magnitude,
      // `pct` is recomputed in `consolidatePieSlices` from outflow magnitudes, but we
      // keep a numeric field to satisfy the type contract.
      pct: 0,
      signedTotal: rawSigned,
    }
    if (idKey && row.category_id != null) {
      slice.categoryId = row.category_id
    }
    out.push(slice)
  }
  return out
}

/**
 * Re-derive `percent` within a subset of rows, matching the backend rule: outflow rows
 * share total outflow, inflow rows share total inflow.
 */
export function withSignedShare<T extends { total: number; percent: number }>(rows: T[]): T[] {
  let outflow = 0
  let inflow = 0
  for (const r of rows) {
    const t = Number(r.total)
    if (t < 0) outflow -= t
    else if (t > 0) inflow += t
  }
  return rows.map((r) => {
    const t = Number(r.total)
    const percent = t < 0 && outflow > 0 ? (-t / outflow) * 100 : t > 0 && inflow > 0 ? (t / inflow) * 100 : 0
    return { ...r, percent }
  })
}

/** Subcategory slices labelled "Category › Subcategory", optionally limited to one category. */
export function subcategorySlices(rows: BreakdownRow[], categoryId: number | null): RawSlice[] {
  const filtered = categoryId == null ? rows : rows.filter((r) => r.category_id === categoryId)
  const mapped: BreakdownRow[] = filtered.map((r) => ({
    ...r,
    subcategory: r.category ? `${r.category} › ${r.subcategory ?? '—'}` : String(r.subcategory ?? ''),
  }))
  return rawSlicesFromRows(mapped, 'subcategory')
}
