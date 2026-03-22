import { Controller, type Control, type FieldArrayWithId, type UseFormSetValue } from 'react-hook-form'
import type { CategoryOut, SubcategoryOut } from '../../types'
import type { SplitsFormValues, TransactionRow } from './types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type TransactionFormProps = {
  splitsControl: Control<SplitsFormValues>
  setSplitsValue: UseFormSetValue<SplitsFormValues>
  splitFields: FieldArrayWithId<SplitsFormValues, 'splitRows', 'id'>[]
  splitRows: SplitsFormValues['splitRows']
  removeSplitRow: (index: number) => void
  appendDefaultSplitRow: () => void
  splitTxnId: number
  splitTargetRow: TransactionRow | null
  splitSelectionState: 'none' | 'one' | 'multiple'
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
  splitTargetRow,
  splitSelectionState,
  categories,
  subcategoriesByCategory,
  splitsLoading,
  splitErrorMessage,
  onSaveSplits,
  saveSplitsPending,
  metaReady,
}: TransactionFormProps) {
  return (
    <div className="px-6 lg:px-8 pb-8 max-w-6xl">
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Splits</CardTitle>
          <CardDescription>
            Select exactly one transaction in the table above (checkbox) to load and edit its category splits.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {splitSelectionState === 'none' ? (
            <p className="text-sm text-muted-foreground">Select a transaction using the row checkboxes to edit splits.</p>
          ) : null}
          {splitSelectionState === 'multiple' ? (
            <p className="text-sm text-muted-foreground">
              Splits apply to one transaction at a time. Leave only one row selected, or clear the selection.
            </p>
          ) : null}
          {splitSelectionState === 'one' && splitTargetRow ? (
            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Editing splits for</p>
              <p className="font-medium tabular-nums">
                {splitTargetRow.Date}
                <span className="text-muted-foreground font-normal"> · </span>
                {splitTargetRow.Merchant || '—'}
                <span className="text-muted-foreground font-normal"> · </span>
                {Number(splitTargetRow.Amount).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
          ) : null}

          {splitErrorMessage ? <p className="text-sm text-destructive">{splitErrorMessage}</p> : null}
          {splitsLoading ? <p className="text-sm text-muted-foreground">Loading splits…</p> : null}

          {splitTxnId > 0 && !splitsLoading && metaReady ? (
            <div className="space-y-4 rounded-xl border p-4">
              <p className="text-sm font-medium">Edit splits</p>
              {splitFields.map((sf, idx) => {
                const sr = splitRows[idx] ?? sf
                const subs = subcategoriesByCategory[sr.category_id] ?? []
                return (
                  <div
                    key={`${splitTxnId}-${idx}`}
                    className="grid grid-cols-1 md:grid-cols-[1fr_1fr_minmax(0,100px)_1fr_auto] gap-3 items-end"
                  >
                    <Controller
                      control={splitsControl}
                      name={`splitRows.${idx}.category_id`}
                      render={({ field }) => (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Category</Label>
                          <Select
                            value={String(field.value)}
                            onValueChange={(v) => {
                              const nextCat = Number(v)
                              const nextSubs = subcategoriesByCategory[nextCat] ?? []
                              const nextSub =
                                nextSubs.find((s) => s.id === sr.subcategory_id)?.id ?? nextSubs[0]?.id
                              field.onChange(nextCat)
                              setSplitsValue(`splitRows.${idx}.subcategory_id`, nextSub ?? sr.subcategory_id)
                            }}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {categories.map((c) => (
                                <SelectItem key={c.id} value={String(c.id)}>
                                  {c.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    />

                    <Controller
                      control={splitsControl}
                      name={`splitRows.${idx}.subcategory_id`}
                      render={({ field }) => (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Subcategory</Label>
                          <Select
                            value={String(field.value)}
                            onValueChange={(v) => field.onChange(Number(v))}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {subs.map((s) => (
                                <SelectItem key={s.id} value={String(s.id)}>
                                  {s.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    />

                    <Controller
                      control={splitsControl}
                      name={`splitRows.${idx}.amount`}
                      render={({ field }) => (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Amount</Label>
                          <Input
                            type="number"
                            step="0.01"
                            className="h-9"
                            value={field.value}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                          />
                        </div>
                      )}
                    />

                    <Controller
                      control={splitsControl}
                      name={`splitRows.${idx}.notes`}
                      render={({ field }) => (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Notes</Label>
                          <Input
                            className="h-9"
                            value={field.value ?? ''}
                            placeholder="Notes"
                            onChange={(e) => field.onChange(e.target.value ? e.target.value : null)}
                          />
                        </div>
                      )}
                    />

                    <Button type="button" variant="outline" size="sm" onClick={() => removeSplitRow(idx)}>
                      Remove
                    </Button>
                  </div>
                )
              })}

              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={appendDefaultSplitRow}>
                  Add split row
                </Button>
                <Button type="button" size="sm" onClick={onSaveSplits} disabled={saveSplitsPending || !metaReady}>
                  Save splits
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
