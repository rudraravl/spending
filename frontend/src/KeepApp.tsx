import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Navigate } from 'react-router-dom'
import AppLayout from '@/components/AppLayout'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import queryClient from './queryClient'
import AccountDetailPage from './pages/AccountDetailPage'
import AccountsPage from './pages/AccountsPage'
import AllTransactionsPage from './pages/AllTransactionsPage'
import DashboardPage from './pages/DashboardPage'
import ImportCsvPage from './pages/ImportCsvPage'
import InvestmentsPage from './pages/InvestmentsPage'
import NotFoundPage from './pages/NotFoundPage'
import BudgetsPage from '@/pages/BudgetsPage'
import RecurringChargesPage from './pages/RecurringChargesPage'
import SettingsPage from './pages/SettingsPage'
import ReportsPage from './pages/ReportsPage'
import ViewsPage from './pages/ViewsPage'

export default function KeepApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
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
                <Route path="/connections" element={<Navigate to="/accounts?tab=connections" replace />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
