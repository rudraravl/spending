import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import DashboardPage from './pages/DashboardPage'
import ImportCsvPage from './pages/ImportCsvPage'
import AddTransactionPage from './pages/AddTransactionPage'
import TransferPage from './pages/TransferPage'
import AllTransactionsPage from './pages/AllTransactionsPage'
import ViewsPage from './pages/ViewsPage'
import SummariesPage from './pages/SummariesPage'
import SettingsPage from './pages/SettingsPage'
import queryClient from './queryClient'
import './spending.css'

function NavItem({ to, label }: { to: string; label: string }) {
  const location = useLocation()
  const active = location.pathname === to
  return (
    <Link className={`sp-nav-item ${active ? 'sp-nav-item-active' : ''}`} to={to}>
      {label}
    </Link>
  )
}

export default function SpendingApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="sp-layout">
          <aside className="sp-sidebar">
            <div className="sp-sidebar-title">💰 SPENDING</div>
            <div className="sp-sidebar-subtitle">Local-first budget tracking for your semester.</div>

            <div className="sp-sidebar-section-label">Navigation</div>
            <nav className="sp-nav">
              <NavItem to="/" label="Dashboard" />
              <NavItem to="/import" label="Import CSV" />
              <NavItem to="/add-transaction" label="Add Transaction" />
              <NavItem to="/transfer" label="Transfer" />
              <NavItem to="/transactions" label="All Transactions" />
              <NavItem to="/views" label="Views" />
              <NavItem to="/summaries" label="Summaries" />
            </nav>

            <div className="sp-sidebar-section-label">Admin</div>
            <div className="sp-nav">
              <Link className={`sp-nav-item sp-nav-item-admin`} to="/settings">
                Settings
              </Link>
            </div>
          </aside>

          <main className="sp-main">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/import" element={<ImportCsvPage />} />
              <Route path="/add-transaction" element={<AddTransactionPage />} />
              <Route path="/transfer" element={<TransferPage />} />
              <Route path="/transactions" element={<AllTransactionsPage />} />
              <Route path="/views" element={<ViewsPage />} />
              <Route path="/summaries" element={<SummariesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<DashboardPage />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

