import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { getDashboard, type DashboardResponse } from '@/api/dashboard'
import { toLocalIsoDate } from '@/lib/dates'
import { queryKeys } from '@/queryKeys'

export type YearMonth = { year: number; month: number } // month: 1-12

export function currentYearMonth(now = new Date()): YearMonth {
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const d = new Date(year, month - 1 + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

export function daysInMonth({ year, month }: YearMonth): number {
  return new Date(year, month, 0).getDate()
}

function monthRange(ym: YearMonth): [string, string] {
  return [
    toLocalIsoDate(new Date(ym.year, ym.month - 1, 1)),
    toLocalIsoDate(new Date(ym.year, ym.month - 1, daysInMonth(ym))),
  ]
}

function useMonthDashboard(ym: YearMonth) {
  const [start, end] = monthRange(ym)
  return useQuery<DashboardResponse, Error>({
    queryKey: queryKeys.dashboardRange('custom', start, end),
    queryFn: () => getDashboard('custom', start, end),
  })
}

/** Running net spend per day-of-month (index 0 = day 1). */
function cumulativeSpend(data: DashboardResponse | undefined): number[] {
  let run = 0
  return (data?.spending_over_time ?? []).map((r) => (run += Number(r.spending) - Number(r.credits)))
}

export type ChartPoint = { day: number; current: number | null; previous: number | null }

/**
 * Everything the home page needs for one calendar month, plus the prior month for comparison.
 * "Elapsed" days stop at today for the current month so pace/projection aren't diluted by future days.
 */
export function useMonthOverview(ym: YearMonth) {
  const current = useMonthDashboard(ym)
  const previous = useMonthDashboard(shiftMonth(ym, -1))

  const derived = useMemo(() => {
    const now = new Date()
    const isCurrentMonth = ym.year === now.getFullYear() && ym.month === now.getMonth() + 1
    const totalDays = daysInMonth(ym)
    const elapsedDays = isCurrentMonth ? now.getDate() : totalDays

    const cur = cumulativeSpend(current.data)
    const prev = cumulativeSpend(previous.data)

    const chart: ChartPoint[] = Array.from({ length: totalDays }, (_, i) => ({
      day: i + 1,
      current: i < elapsedDays ? (cur[i] ?? null) : null,
      // Last month's shorter/longer length: clamp so the dashed line ends at its own final value.
      previous: prev.length ? (prev[Math.min(i, prev.length - 1)] ?? null) : null,
    }))

    const spent = Number(current.data?.total_spending ?? 0)
    const income = Number(current.data?.total_income ?? 0)
    const prevTotal = Number(previous.data?.total_spending ?? 0)
    const prevAtSameDay = prev.length ? prev[Math.min(elapsedDays, prev.length) - 1] ?? 0 : null
    const dailyAverage = elapsedDays > 0 ? spent / elapsedDays : 0

    return {
      isCurrentMonth,
      totalDays,
      elapsedDays,
      chart,
      spent,
      income,
      net: income - spent,
      prevTotal,
      prevIncome: Number(previous.data?.total_income ?? 0),
      prevAtSameDay,
      dailyAverage,
      projected: isCurrentMonth ? dailyAverage * totalDays : null,
    }
  }, [current.data, previous.data, ym])

  return {
    current: current.data,
    previous: previous.data,
    isLoading: current.isLoading,
    error: current.error,
    ...derived,
  }
}
