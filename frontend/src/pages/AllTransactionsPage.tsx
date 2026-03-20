import PageHeader from '../components/PageHeader'
import TransactionForm from '../features/transactions/TransactionForm'
import TransactionsTable from '../features/transactions/TransactionsTable'
import { useTransactions } from '../features/transactions/useTransactions'

export default function AllTransactionsPage() {
  const { bannerError, filters, categories, tags, table, splits } = useTransactions()

  return (
    <div className="sp-page">
      <PageHeader
        icon="📋"
        title="All transactions"
        subtitle="Search, edit, and clean up any transaction in your history."
      />

      {bannerError ? <div style={{ color: 'crimson', marginBottom: 10 }}>{bannerError}</div> : null}

      <TransactionsTable
        categories={categories}
        tags={tags}
        merchantSearch={filters.merchantSearch}
        onMerchantSearchChange={filters.setMerchantSearch}
        fCategory={filters.fCategory}
        onFCategoryChange={filters.setFCategory}
        fTag={filters.fTag}
        onFTagChange={filters.setFTag}
        showOnlyRecent={filters.showOnlyRecent}
        onShowOnlyRecentChange={filters.setShowOnlyRecent}
        gridRows={table.gridRows}
        onSelectionModelChange={table.setSelectionModel}
        onProcessRowUpdate={table.processRowUpdate}
        onSaveEdits={table.saveDirtyEdits}
        onDeleteSelected={table.deleteSelected}
        getSelectedIds={table.getSelectedIds}
        metaReady={table.metaReady}
        savePending={table.saveDirtyPending}
        deletePending={table.deletePending}
      />

      <TransactionForm
        splitsControl={splits.splitsControl}
        setSplitsValue={splits.setSplitsValue}
        splitFields={splits.splitFields}
        splitRows={splits.splitRows}
        removeSplitRow={splits.removeSplitRow}
        appendDefaultSplitRow={splits.appendDefaultSplitRow}
        splitTxnId={splits.splitTxnId}
        categories={categories}
        subcategoriesByCategory={splits.subcategoriesByCategory}
        splitsLoading={splits.splitsLoading}
        splitErrorMessage={splits.splitErrorMessage}
        onSaveSplits={splits.saveSplits}
        saveSplitsPending={splits.saveSplitsPending}
        metaReady={splits.metaReady}
      />
    </div>
  )
}
