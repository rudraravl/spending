import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCategories, getSubcategories } from '@/api/categories'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { queryKeys } from '@/queryKeys'
import type { BudgetMonthApi } from './useBudgetMonth'
import { parseAssignInput } from './budgetUtils'

const NONE = 'none'

export type NewEnvelopePreset = { name: string; txnCategoryId: number | null }

type Props = {
  preset: NewEnvelopePreset | null
  api: BudgetMonthApi
  onClose: () => void
}

export default function NewEnvelopeDialog({ preset, api, onClose }: Props) {
  return (
    <Dialog open={preset != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {preset ? <NewEnvelopeForm preset={preset} api={api} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function NewEnvelopeForm({ preset, api, onClose }: { preset: NewEnvelopePreset; api: BudgetMonthApi; onClose: () => void }) {
  const [name, setName] = useState(preset.name)
  const [cat, setCat] = useState(preset.txnCategoryId != null ? String(preset.txnCategoryId) : NONE)
  const [sub, setSub] = useState(NONE)
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const catsQ = useQuery({ queryKey: queryKeys.categories(), queryFn: getCategories, staleTime: 5 * 60 * 1000 })
  const catNum = cat !== NONE ? Number(cat) : null
  const subsQ = useQuery({
    queryKey: queryKeys.subcategories(catNum),
    queryFn: () => getSubcategories(catNum!),
    enabled: catNum != null,
    staleTime: 5 * 60 * 1000,
  })
  const targetNum = target.trim() === '' ? null : parseAssignInput(target, 0)

  const submit = () => {
    setError(null)
    api.createEnvelope.mutate(
      {
        name: name.trim(),
        txn_category_id: catNum,
        txn_subcategory_id: sub !== NONE ? Number(sub) : null,
        monthly_target: targetNum,
      },
      { onSuccess: onClose, onError: (e) => setError(e.message) },
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>New envelope</DialogTitle>
        <DialogDescription>
          Link it to a spending category so purchases come out of it automatically, or leave it unlinked for a
          savings goal like an emergency fund.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="env-name">Name</Label>
          <Input id="env-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Groceries" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select
              value={cat}
              onValueChange={(v) => {
                setCat(v)
                setSub(NONE)
                const picked = catsQ.data?.find((c) => String(c.id) === v)
                if (picked && !name.trim()) setName(picked.name)
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not linked</SelectItem>
                {(catsQ.data ?? [])
                  .filter((c) => c.name !== 'Income')
                  .map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Subcategory</Label>
            <Select value={sub} onValueChange={setSub} disabled={catNum == null}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>All</SelectItem>
                {(catNum != null ? (subsQ.data ?? []) : []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="env-target">Monthly target (optional)</Label>
          <Input id="env-target" value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder="e.g. 400" />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!name.trim() || (target.trim() !== '' && targetNum == null) || api.createEnvelope.isPending}
        >
          Create envelope
        </Button>
      </DialogFooter>
    </form>
  )
}
