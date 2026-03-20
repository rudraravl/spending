import { Button, MenuItem, TextField } from '@mui/material'
import { Controller, type Control, type FieldArrayWithId, type UseFormSetValue } from 'react-hook-form'
import type { CategoryOut, SubcategoryOut } from '../../types'
import type { SplitsFormValues } from './types'

export type TransactionFormProps = {
  splitsControl: Control<SplitsFormValues>
  setSplitsValue: UseFormSetValue<SplitsFormValues>
  splitFields: FieldArrayWithId<SplitsFormValues, 'splitRows', 'id'>[]
  splitRows: SplitsFormValues['splitRows']
  removeSplitRow: (index: number) => void
  appendDefaultSplitRow: () => void
  splitTxnId: number
  categories: CategoryOut[]
  subcategoriesByCategory: Record<number, SubcategoryOut[]>
  splitsLoading: boolean
  splitErrorMessage: string | null
  onSaveSplits: () => void
  saveSplitsPending: boolean
  metaReady: boolean
}

export default function TransactionForm({
  splitsControl,
  setSplitsValue,
  splitFields,
  splitRows,
  removeSplitRow,
  appendDefaultSplitRow,
  splitTxnId,
  categories,
  subcategoriesByCategory,
  splitsLoading,
  splitErrorMessage,
  onSaveSplits,
  saveSplitsPending,
  metaReady,
}: TransactionFormProps) {
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Splits</div>
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span>Enter a Transaction ID to edit splits:</span>
        <Controller
          control={splitsControl}
          name="splitTxnId"
          render={({ field }) => (
            <TextField
              type="number"
              value={field.value}
              inputProps={{ min: 0 }}
              onChange={(e) => field.onChange(Number(e.target.value))}
              size="small"
              sx={{ width: 140 }}
            />
          )}
        />
      </div>

      {splitErrorMessage ? <div style={{ color: 'crimson' }}>{splitErrorMessage}</div> : null}
      {splitsLoading ? <div>Loading splits...</div> : null}

      {splitTxnId > 0 && !splitsLoading && metaReady ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>Edit splits</div>
          {splitFields.map((sf, idx) => {
            const sr = splitRows[idx] ?? sf
            const subs = subcategoriesByCategory[sr.category_id] ?? []
            return (
              <div
                key={`${splitTxnId}-${idx}`}
                style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 0.8fr 1.2fr auto', gap: 8, marginBottom: 8 }}
              >
                <Controller
                  control={splitsControl}
                  name={`splitRows.${idx}.category_id`}
                  render={({ field }) => (
                    <TextField
                      select
                      value={field.value}
                      onChange={(e) => {
                        const nextCat = Number(e.target.value)
                        const nextSubs = subcategoriesByCategory[nextCat] ?? []
                        const nextSub = nextSubs.find((s) => s.id === sr.subcategory_id)?.id ?? nextSubs[0]?.id
                        field.onChange(nextCat)
                        setSplitsValue(`splitRows.${idx}.subcategory_id`, nextSub ?? sr.subcategory_id)
                      }}
                      size="small"
                      fullWidth
                    >
                      {categories.map((c) => (
                        <MenuItem key={c.id} value={c.id}>
                          {c.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />

                <Controller
                  control={splitsControl}
                  name={`splitRows.${idx}.subcategory_id`}
                  render={({ field }) => (
                    <TextField select value={field.value} onChange={(e) => field.onChange(Number(e.target.value))} size="small" fullWidth>
                      {subs.map((s) => (
                        <MenuItem key={s.id} value={s.id}>
                          {s.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />

                <Controller
                  control={splitsControl}
                  name={`splitRows.${idx}.amount`}
                  render={({ field }) => (
                    <TextField
                      type="number"
                      inputProps={{ step: '0.01' }}
                      value={field.value}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      size="small"
                      fullWidth
                    />
                  )}
                />

                <Controller
                  control={splitsControl}
                  name={`splitRows.${idx}.notes`}
                  render={({ field }) => (
                    <TextField
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value ? e.target.value : null)}
                      placeholder="Notes"
                      size="small"
                      fullWidth
                    />
                  )}
                />

                <Button color="error" variant="outlined" onClick={() => removeSplitRow(idx)}>
                  Remove
                </Button>
              </div>
            )
          })}

          <Button variant="outlined" onClick={appendDefaultSplitRow}>
            Add split row
          </Button>

          <Button variant="contained" sx={{ marginLeft: 1 }} onClick={onSaveSplits} disabled={saveSplitsPending || !metaReady}>
            Save splits
          </Button>
        </div>
      ) : null}
    </div>
  )
}
