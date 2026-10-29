import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ZbbCategoryRowOut, ZbbMoveMoneyIn } from '@/types'
import { cents, inputAmount, parseAssignInput, usd } from './budgetUtils'

const RTA = 'rta'

type Props = {
  /** The envelope the popover is anchored to; null when opened from Ready to Assign. */
  row: ZbbCategoryRowOut | null
  rows: ZbbCategoryRowOut[]
  readyToAssign: number
  onMove: (body: ZbbMoveMoneyIn) => Promise<unknown>
  children: ReactNode
  /** Controlled mode: `children` only anchors the popover; the caller opens it. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * YNAB-style money mover. On an overspent envelope it defaults to "cover" (bring money in);
 * on a funded one it defaults to moving money out; from Ready to Assign it assigns.
 */
export default function MoveMoneyPopover({ row, rows, readyToAssign, onMove, children, open, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false)
  const controlled = open !== undefined
  const isOpen = open ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  const covering = row == null || cents(row.available) < 0
  const [amount, setAmount] = useState('')
  const [other, setOther] = useState<string>(RTA)
  const [saving, setSaving] = useState(false)

  const reset = () => {
    if (row == null) {
      setAmount(inputAmount(Math.max(0, readyToAssign)))
      setOther('')
    } else if (covering) {
      setAmount(inputAmount(-row.available))
      setOther(cents(readyToAssign) > 0 ? RTA : richestEnvelope(rows, row.category_id))
    } else {
      setAmount(inputAmount(row.available))
      setOther(RTA)
    }
  }

  // Prefill fresh defaults every time it opens, however it was opened.
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) reset()
  }

  const options = rows
    .filter((r) => r.category_id !== row?.category_id)
    .map((r) => ({ value: String(r.category_id), label: r.category_name, balance: r.available }))
  const parsed = parseAssignInput(amount, 0)
  const valid = parsed != null && parsed > 0 && other !== ''

  const submit = async () => {
    if (!valid || parsed == null) return
    const otherId = other === RTA ? null : Number(other)
    const here = row?.category_id ?? null
    setSaving(true)
    try {
      await onMove(
        covering
          ? { from_category_id: row == null ? null : otherId, to_category_id: row == null ? otherId : here, amount: parsed }
          : { from_category_id: here, to_category_id: otherId, amount: parsed },
      )
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const title = row == null ? 'Assign money' : covering ? `Cover ${row.category_name}` : `Move from ${row.category_name}`
  const otherLabel = row == null ? 'To' : covering ? 'Take it from' : 'Move it to'

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      {controlled ? <PopoverAnchor asChild>{children}</PopoverAnchor> : <PopoverTrigger asChild>{children}</PopoverTrigger>}
      <PopoverContent align="end" className="w-72">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <p className="text-sm font-medium">{title}</p>
          <div className="space-y-1.5">
            <Label htmlFor="move-amount" className="text-xs text-muted-foreground">
              Amount
            </Label>
            <Input
              id="move-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{otherLabel}</Label>
            <Select value={other} onValueChange={setOther}>
              <SelectTrigger>
                <SelectValue placeholder="Pick an envelope" />
              </SelectTrigger>
              <SelectContent>
                {row != null ? (
                  <SelectItem value={RTA}>
                    <span className="flex w-full justify-between gap-4">
                      <span>Ready to Assign</span>
                      <span className="tabular-nums text-muted-foreground">{usd(readyToAssign)}</span>
                    </span>
                  </SelectItem>
                ) : null}
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className="flex w-full justify-between gap-4">
                      <span className="truncate">{o.label}</span>
                      <span className="tabular-nums text-muted-foreground">{usd(o.balance)}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!valid || saving}>
              {row == null ? 'Assign' : covering ? 'Cover' : 'Move'}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function richestEnvelope(rows: ZbbCategoryRowOut[], exclude: number): string {
  const best = rows
    .filter((r) => r.category_id !== exclude && cents(r.available) > 0)
    .sort((a, b) => b.available - a.available)[0]
  return best ? String(best.category_id) : RTA
}
