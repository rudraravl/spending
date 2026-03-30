import { useSearchParams } from 'react-router-dom'
import AddTransactionPage from './AddTransactionPage'
import TransferPage from './TransferPage'
import TransactionForm from '../features/transactions/TransactionForm'
import TransactionsTable from '../features/transactions/TransactionsTable'
import { useTransactions } from '../features/transactions/useTransactions'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function AllTransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = (() => {
    const tab = searchParams.get('tab')
    if (tab === 'add-transaction') return 'add-transaction'
    if (tab === 'transfers') return 'transfers'
    return 'transactions'
  })()
  const { bannerError, filters, categories, tags, accounts, subcategoriesByCategory, table, splits } =
    useTransactions()

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams)
          if (value === 'transactions') next.delete('tab')
          else next.set('tab', value)
          setSearchParams(next, { replace: true })
        }}
      >
        <TabsList className="mb-6">
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="add-transaction">Add transaction</TabsTrigger>
          <TabsTrigger value="transfers">Transfers</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions">
          {bannerError ? <div className="text-destructive text-sm pb-4">{bannerError}</div> : null}
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
            onUnlinkTransfer={table.unlinkTransfer}
            getSelectedIds={table.getSelectedIds}
            metaReady={table.metaReady}
            savePending={table.saveDirtyPending}
            deletePending={table.deletePending}
            linkCardPaymentPending={table.linkCardPaymentPending}
            unlinkTransferPending={table.unlinkTransferPending}
            onNextPage={table.nextPage}
            canNextPage={table.canNextPage}
            nextPagePending={table.nextPagePending}
            pageSize={table.pageSize}
            onPageSizeChange={table.setPageSize}
            pageSizeOptions={table.pageSizeOptions}
            pageNumber={table.pageNumber}
            currentPageCount={table.currentPageCount}
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
        </TabsContent>

        <TabsContent value="add-transaction">
          <AddTransactionPage embedded />
        </TabsContent>

        <TabsContent value="transfers">
          <TransferPage embedded />
        </TabsContent>
      </Tabs>
    </div>
  )
}

