import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { getAccounts } from '@/api/accounts'
import { getCategories } from '@/api/categories'
import { getRecurringSuggestions } from '@/api/recurring'
import CategoryBreakdownCard from '@/features/home/CategoryBreakdownCard'
import { AccountsCard, RecentActivityCard, UpcomingCard } from '@/features/home/SidebarCards'
import SpendingHeroCard from '@/features/home/SpendingHeroCard'
import { CashflowCard, NetWorthCard } from '@/features/home/SummaryCards'
import { currentYearMonth, shiftMonth, useMonthOverview, type YearMonth } from '@/features/home/useMonthOverview'
import { greeting, USER_FIRST_NAME } from '@/lib/profile'
import { queryKeys } from '@/queryKeys'

const todayLong = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
const monthShort = new Intl.DateTimeFormat('en-US', { month: 'short' })

function sameMonth(a: YearMonth, b: YearMonth) {
  return a.year === b.year && a.month === b.month
}

export default function DashboardPage() {
  const thisMonth = currentYearMonth()
  const [ym, setYm] = useState<YearMonth>(thisMonth)
  const prevYm = shiftMonth(ym, -1)
  const overview = useMonthOverview(ym)

  const { data: accounts } = useQuery({ queryKey: queryKeys.accounts(), queryFn: () => getAccounts() })
  const { data: categories } = useQuery({ queryKey: queryKeys.categories(), queryFn: getCategories })
  const { data: recurring } = useQuery({
    queryKey: queryKeys.recurringSuggestions(),
    queryFn: getRecurringSuggestions,
  })

  const categoryIds = useMemo(() => new Map((categories ?? []).map((c) => [c.name, c.id])), [categories])
  const label = (m: YearMonth) => monthShort.format(new Date(m.year, m.month - 1, 1))

  return (
    <div className="page">
      <div className="mb-6">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">
          {greeting()}, {USER_FIRST_NAME}.
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{todayLong.format(new Date())}</p>
      </div>

      {overview.error ? (
        <div className="surface mb-6 border-destructive/40 p-4 text-sm text-destructive">{overview.error.message}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] xl:gap-6">
        <div className="min-w-0 space-y-5 xl:space-y-6">
          <SpendingHeroCard
            ym={ym}
            prevYm={prevYm}
            canGoForward={!sameMonth(ym, thisMonth)}
            onPrev={() => setYm(prevYm)}
            onNext={() => setYm(shiftMonth(ym, 1))}
            onToday={() => setYm(thisMonth)}
            loading={overview.isLoading}
            isCurrentMonth={overview.isCurrentMonth}
            spent={overview.spent}
            prevTotal={overview.prevTotal}
            prevAtSameDay={overview.prevAtSameDay}
            dailyAverage={overview.dailyAverage}
            projected={overview.projected}
            elapsedDays={overview.elapsedDays}
            totalDays={overview.totalDays}
            chart={overview.chart}
          />

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:gap-6">
            <NetWorthCard accounts={accounts} series={overview.current?.net_worth_over_time} monthLabel={label(ym)} />
            <CashflowCard
              income={overview.income}
              spent={overview.spent}
              loading={overview.isLoading}
              monthLabel={label(ym)}
            />
          </div>

          <CategoryBreakdownCard
            current={overview.current}
            previous={overview.previous}
            loading={overview.isLoading}
            prevLabel={label(prevYm)}
          />
        </div>

        <aside className="min-w-0 space-y-5 xl:space-y-6">
          <RecentActivityCard
            rows={overview.current?.recent_transactions}
            categoryIds={categoryIds}
            loading={overview.isLoading}
          />
          <UpcomingCard series={recurring} />
          <AccountsCard accounts={accounts} />
        </aside>
      </div>
    </div>
  )
}
