import {
  ArrowLeftRight,
  BarChart3,
  Home,
  Landmark,
  LineChart,
  PiggyBank,
  Repeat,
  Settings,
  Upload,
  type LucideIcon,
} from 'lucide-react'

export type TourFeature = {
  /** Also the page-tip id, so closing a tip and the Help list stay in sync. */
  id: string
  title: string
  route: string
  icon: LucideIcon
  /** One or two sentences for the tour slide and the Help guide. */
  summary: string
  /** Short hint shown at the top of the page until dismissed. */
  tip: string
}

/** The app's main areas, in the order the welcome tour walks through them. */
export const TOUR_FEATURES: TourFeature[] = [
  {
    id: 'home',
    title: 'Home',
    route: '/',
    icon: Home,
    summary:
      'Your month at a glance: spending against last month, cash flow, net worth, recent activity, and upcoming recurring charges.',
    tip: 'This is your month at a glance. Use the arrows on the spending card to look back at earlier months.',
  },
  {
    id: 'accounts',
    title: 'Accounts',
    route: '/accounts',
    icon: Landmark,
    summary:
      'Every card, bank, cash, and brokerage account you track. Accounts are manual by default; you can link them to SimpleFIN bank sync later.',
    tip: 'Add an account for each card or bank you track. The Budget switch decides which balances fund your budget. Bank Sync is optional.',
  },
  {
    id: 'transactions',
    title: 'Transactions',
    route: '/transactions',
    icon: ArrowLeftRight,
    summary:
      'Search, categorize, tag, and split activity across every account. Add one-off entries by hand and mark transfers between your own accounts so they don’t count as spending.',
    tip: 'Click a category to change it. Use Add transaction for cash purchases, and Transfers for money moved between your own accounts.',
  },
  {
    id: 'import',
    title: 'Import CSV',
    route: '/import',
    icon: Upload,
    summary:
      'Download a statement export from your bank and import it. Built-in adapters cover Chase, Capital One, Citi, Discover, Wells Fargo, and Bilt; the generic mapper handles anything else.',
    tip: 'Pick the account, pick an adapter (or Generic), and review the preview. Duplicate rows are skipped, so re-importing an overlapping range is safe.',
  },
  {
    id: 'budget',
    title: 'Budget',
    route: '/budgets',
    icon: PiggyBank,
    summary:
      'Zero-based envelopes: assign the money in your budget accounts until Ready to Assign reads $0, then spending comes out of each envelope as it happens.',
    tip: 'Assign money to envelopes until Ready to Assign is $0. The ? button explains overspending, credit cards, and rollover.',
  },
  {
    id: 'recurring',
    title: 'Recurring',
    route: '/recurring',
    icon: Repeat,
    summary:
      'Keep spots charges that repeat at a steady amount and rhythm, like subscriptions and rent. Confirm the real ones and ignore the rest.',
    tip: 'Run a scan after you have a couple of months of transactions. Confirmed series show up as upcoming charges on Home.',
  },
  {
    id: 'investments',
    title: 'Investments',
    route: '/investments',
    icon: LineChart,
    summary: 'Holdings, cost basis, allocation, and performance across your investment accounts.',
    tip: 'Holdings come from bank sync for linked brokerage accounts. You can also add positions by hand on an investment account.',
  },
  {
    id: 'insights',
    title: 'Insights',
    route: '/reports',
    icon: BarChart3,
    summary: 'Reports for monthly spending breakdowns, Views for saved custom filters, and net worth tracked over time.',
    tip: 'Break spending down by category, subcategory, or tag over any date range.',
  },
  {
    id: 'settings',
    title: 'Categories & rules',
    route: '/settings',
    icon: Settings,
    summary:
      'Rename or add categories and subcategories, create tags, and set rules that categorize imported and synced transactions automatically.',
    tip: 'Rules run on every import and sync. A few merchant rules save a lot of manual categorizing.',
  },
]

export function tourFeature(id: string): TourFeature | undefined {
  return TOUR_FEATURES.find((f) => f.id === id)
}
