import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ZbbMonthOut, ZbbRolloverMode } from '@/types'
import type { BudgetMonthApi } from './useBudgetMonth'

type Props = {
  open: boolean
  data: ZbbMonthOut
  api: BudgetMonthApi
  onClose: () => void
}

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' }),
)

export default function BudgetSettingsDialog({ open, data, api, onClose }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {open ? <SettingsForm data={data} api={api} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function SettingsForm({ data, api, onClose }: Omit<Props, 'open'>) {
  const [mode, setMode] = useState<ZbbRolloverMode>(data.rollover_mode)
  const [startY, setStartY] = useState(data.budget_start_year)
  const [startM, setStartM] = useState(data.budget_start_month)
  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: 6 }, (_, i) => thisYear - 4 + i)

  const save = () => {
    api.settings.mutate(
      { rollover_mode: mode, budget_start_year: startY, budget_start_month: startM },
      { onSuccess: onClose },
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Budget settings</DialogTitle>
        <DialogDescription>These apply to every month.</DialogDescription>
      </DialogHeader>

      <div className="space-y-6 py-2">
        <section className="space-y-2">
          <Label className="text-sm font-medium">Budget starts in</Label>
          <p className="text-xs text-muted-foreground">
            Spending before this month is ignored and every envelope starts at $0. Move it forward to start fresh after a
            break.
          </p>
          <div className="flex gap-2">
            <Select value={String(startM)} onValueChange={(v) => setStartM(Number(v))}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={m} value={String(i + 1)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(startY)} onValueChange={(v) => setStartY(Number(v))}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className="space-y-2">
          <Label className="text-sm font-medium">When an envelope is overspent</Label>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as ZbbRolloverMode)} className="gap-2">
            <ModeOption
              value="flexible"
              title="Reset it next month (YNAB style)"
              body="The envelope starts next month at $0 and the overspent amount comes out of next month's Ready to Assign."
            />
            <ModeOption
              value="strict"
              title="Carry the negative balance forward"
              body="The envelope starts next month in the red until you assign enough to cover it (Actual Budget's rollover option)."
            />
          </RadioGroup>
        </section>

        <section className="space-y-1">
          <p className="text-sm font-medium">Accounts in the budget</p>
          <p className="text-xs text-muted-foreground">
            {data.accounts.length > 0 ? `${data.accounts.map((a) => a.name).join(', ')}. ` : 'None yet. '}
            Toggle “Budget” on the{' '}
            <Link to="/accounts" className="text-primary underline-offset-4 hover:underline" onClick={onClose}>
              Accounts
            </Link>{' '}
            page. Include the cards you spend on; leave out investment and retirement accounts.
          </p>
        </section>
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={api.settings.isPending}>
          Save
        </Button>
      </DialogFooter>
    </>
  )
}

function ModeOption({ value, title, body }: { value: ZbbRolloverMode; title: string; body: string }) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-xl border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
      <RadioGroupItem value={value} className="mt-0.5" />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
    </label>
  )
}
