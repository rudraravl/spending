import { Button, Checkbox, FormControlLabel, MenuItem, TextField } from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import type { GridColDef } from '@mui/x-data-grid'
import type { CategoryOut, TagOut } from '../../types'
import type { TransactionRow } from './types'

const columns: GridColDef[] = [
  { field: 'Date', headerName: 'Date', flex: 0.8, editable: true },
  { field: 'Merchant', headerName: 'Merchant', flex: 1.2, editable: true },
  { field: 'Amount', headerName: 'Amount', type: 'number', flex: 0.7, editable: true },
  { field: 'Category', headerName: 'Category', flex: 0.9, editable: true },
  { field: 'Subcategory', headerName: 'Subcategory', flex: 0.9, editable: true },
  { field: 'Acct', headerName: 'Acct', flex: 0.8, editable: true },
  { field: 'Tags', headerName: 'Tags', flex: 1.0, editable: true },
  { field: 'Notes', headerName: 'Notes', flex: 1.4, editable: true },
  { field: 'Split', headerName: 'Split', flex: 0.4, editable: false },
]

export type TransactionsTableProps = {
  categories: CategoryOut[]
  tags: TagOut[]
  merchantSearch: string
  onMerchantSearchChange: (v: string) => void
  fCategory: string
  onFCategoryChange: (v: string) => void
  fTag: string
  onFTagChange: (v: string) => void
  showOnlyRecent: boolean
  onShowOnlyRecentChange: (v: boolean) => void
  gridRows: TransactionRow[]
  onSelectionModelChange: (model: unknown) => void
  onProcessRowUpdate: (newRow: TransactionRow) => TransactionRow
  onSaveEdits: () => void
  onDeleteSelected: () => void
  getSelectedIds: () => number[]
  metaReady: boolean
  savePending: boolean
  deletePending: boolean
}

export default function TransactionsTable({
  categories,
  tags,
  merchantSearch,
  onMerchantSearchChange,
  fCategory,
  onFCategoryChange,
  fTag,
  onFTagChange,
  showOnlyRecent,
  onShowOnlyRecentChange,
  gridRows,
  onSelectionModelChange,
  onProcessRowUpdate,
  onSaveEdits,
  onDeleteSelected,
  getSelectedIds,
  metaReady,
  savePending,
  deletePending,
}: TransactionsTableProps) {
  return (
    <>
      <div style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, alignItems: 'flex-start' }}>
        <TextField
          label="Merchant / notes search"
          value={merchantSearch}
          onChange={(e) => onMerchantSearchChange(e.target.value)}
          fullWidth
        />
        <TextField select label="Category" value={fCategory} onChange={(e) => onFCategoryChange(e.target.value)} fullWidth>
          <MenuItem value="All">All</MenuItem>
          {categories.map((c) => (
            <MenuItem key={c.id} value={c.name}>
              {c.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField select label="Tag" value={fTag} onChange={(e) => onFTagChange(e.target.value)} fullWidth>
          <MenuItem value="All">All</MenuItem>
          {tags.map((t) => (
            <MenuItem key={t.id} value={t.name}>
              {t.name}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={<Checkbox checked={showOnlyRecent} onChange={(e) => onShowOnlyRecentChange(e.target.checked)} />}
          label="Limit to last 90 days"
        />
      </div>

      <div style={{ height: 520, width: '100%', border: '1px solid var(--border)', borderRadius: 14 }}>
        <DataGrid
          rows={gridRows}
          columns={columns}
          checkboxSelection
          editMode="cell"
          disableRowSelectionOnClick
          hideFooterSelectedRowCount
          onRowSelectionModelChange={(newSel) => onSelectionModelChange(newSel ?? [])}
          processRowUpdate={(newRow) => onProcessRowUpdate(newRow as TransactionRow)}
        />
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <Button variant="contained" onClick={onSaveEdits} disabled={savePending || !metaReady}>
          Save edits
        </Button>
        <Button
          variant="outlined"
          color="error"
          onClick={onDeleteSelected}
          disabled={getSelectedIds().length === 0 || deletePending || !metaReady}
        >
          Delete selected
        </Button>
      </div>
    </>
  )
}
