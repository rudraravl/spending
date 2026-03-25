import TransactionForm from '../features/transactions/TransactionForm'
import TransactionsTable from '../features/transactions/TransactionsTable'
import { useTransactions } from '../features/transactions/useTransactions'

export default function AllTransactionsPage() {
  const { bannerError, filters, categories, tags, accounts, subcategoriesByCategory, table, splits } =
    useTransactions()

  return (
    <div>
      {bannerError ? <div className="text-destructive text-sm px-6 lg:px-8 pt-6">{bannerError}</div> : null}

      <TransactionsTable
        categories={categories}
        tags={tags}
        accounts={accounts}
        subcategoriesByCategory={subcategoriesByCategory}
        merchantSearch={filters.merchantSearch}
        onMerchantSearchChange={filters.setMerchantSearch}
        fCategory={filters.fCategory}
        onFCategoryChange={filters.setFCategory}
        fTag={filters.fTag}
        onFTagChange={filters.setFTag}
        fAccountId={filters.fAccountId}
        onFAccountChange={filters.setFAccountId}
        showOnlyRecent={filters.showOnlyRecent}
        onShowOnlyRecentChange={filters.setShowOnlyRecent}
        gridRows={table.gridRows}
        rowSelection={table.rowSelection}
        setRowSelection={table.setRowSelection}
        onProcessRowUpdate={table.processRowUpdate}
        onSaveEdits={table.saveDirtyEdits}
        onDeleteSelected={table.deleteSelected}
        onLinkCardPayment={table.linkCardPayment}
        getSelectedIds={table.getSelectedIds}
        metaReady={table.metaReady}
        savePending={table.saveDirtyPending}
        deletePending={table.deletePending}
        linkCardPaymentPending={table.linkCardPaymentPending}
      />

      <TransactionForm
        splitsControl={splits.splitsControl}
        setSplitsValue={splits.setSplitsValue}
        splitFields={splits.splitFields}
        splitRows={splits.splitRows}
        removeSplitRow={splits.removeSplitRow}
        appendDefaultSplitRow={splits.appendDefaultSplitRow}
        splitTxnId={splits.splitTxnId}
        splitTargetRow={splits.splitTargetRow}
        splitSelectionState={splits.splitSelectionState}
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

