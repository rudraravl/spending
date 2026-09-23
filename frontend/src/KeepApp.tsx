import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Navigate } from 'react-router-dom'
import AppLayout from '@/components/AppLayout'
import TransferReviewProvider from '@/features/transfers/TransferReviewProvider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { lazy } from 'react'
import queryClient from './queryClient'
import NotFoundPage from './pages/NotFoundPage'

// Route-level code splitting: charts (recharts) and heavy tables load with the page that uses them.
const AccountDetailPage = lazy(() => import('./pages/AccountDetailPage'))
const AccountsPage = lazy(() => import('./pages/AccountsPage'))
const AllTransactionsPage = lazy(() => import('./pages/AllTransactionsPage'))
const BudgetsPage = lazy(() => import('./pages/BudgetsPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ImportCsvPage = lazy(() => import('./pages/ImportCsvPage'))
const InvestmentsPage = lazy(() => import('./pages/InvestmentsPage'))
const NetWorthOverTimePage = lazy(() => import('./pages/NetWorthOverTimePage'))
const RecurringChargesPage = lazy(() => import('./pages/RecurringChargesPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const ViewsPage = lazy(() => import('./pages/ViewsPage'))

export default function KeepApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <TooltipProvider>
          <Toaster />
          <BrowserRouter>
            <TransferReviewProvider>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/accounts" element={<AccountsPage />} />
                <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
                <Route path="/import" element={<ImportCsvPage />} />
                <Route path="/add-transaction" element={<Navigate to="/transactions?tab=add-transaction" replace />} />
                <Route path="/transfer" element={<Navigate to="/transactions?tab=transfers" replace />} />
                <Route path="/transfers/review" element={<Navigate to="/transactions?tab=transfers" replace />} />
                <Route path="/transactions" element={<AllTransactionsPage />} />
                <Route path="/recurring" element={<RecurringChargesPage />} />
                <Route path="/budgets" element={<BudgetsPage />} />
                <Route path="/views" element={<ViewsPage />} />
                <Route path="/investments" element={<InvestmentsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/summaries" element={<Navigate to="/reports" replace />} />
                <Route path="/net-worth" element={<NetWorthOverTimePage />} />
                <Route path="/connections" element={<Navigate to="/accounts?tab=connections" replace />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
            </TransferReviewProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
