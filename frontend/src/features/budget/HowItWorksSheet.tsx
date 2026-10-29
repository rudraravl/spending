import type { ReactNode } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

type Props = { open: boolean; onClose: () => void }

export default function HowItWorksSheet({ open, onClose }: Props) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="text-left">
          <SheetTitle>How this budget works</SheetTitle>
          <SheetDescription>Zero-based budgeting: give every dollar you have a job.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-6 text-sm leading-relaxed">
          <Step n={1} title="Assign the money you have">
            <strong>Ready to Assign</strong> is the cash in your budget accounts that isn&apos;t in an envelope yet. Type
            amounts into the <strong>Assigned</strong> column (or use <strong>Fund targets</strong>) until it reads $0.
            Type <code className="rounded bg-muted px-1">+50</code> to add to what&apos;s there.
          </Step>
          <Step n={2} title="Spend, and the envelopes follow">
            Transactions in a linked category come out of that envelope automatically. Refunds go back in.{' '}
            <strong>Available</strong> is what&apos;s left: carried over + assigned − spent.
          </Step>
          <Step n={3} title="Roll with the punches">
            Overspent? Click the red amount to <strong>cover</strong> it from Ready to Assign or another envelope. Need
            money elsewhere? Click any Available amount to move it.
          </Step>
          <Step n={4} title="Next month">
            Leftover money stays in its envelope. Income that arrives goes to Ready to Assign, so you budget it as it
            comes in. Use <strong>Copy last month</strong> to repeat a plan.
          </Step>

          <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
            <p className="font-medium">Good to know</p>
            <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">
              <li>
                <strong className="text-foreground">Credit cards</strong> count as budget accounts with a negative
                balance. A card purchase moves money out of an envelope just like cash, and paying the card is just a
                transfer, so it doesn&apos;t touch the budget. If Ready to Assign is $0 or more and nothing is
                overspent, your card balances are fully covered.
              </li>
              <li>
                <strong className="text-foreground">Income</strong> isn&apos;t an envelope. Anything in the Income
                category adds to Ready to Assign.
              </li>
              <li>
                <strong className="text-foreground">Spending with no envelope</strong> (or uncategorized) comes straight
                out of Ready to Assign. The page flags it so you can add an envelope.
              </li>
              <li>
                <strong className="text-foreground">Savings goals</strong> are envelopes with no linked category. Money
                piles up until you move it out.
              </li>
              <li>
                <strong className="text-foreground">Transfers</strong> to accounts outside the budget (e.g. a brokerage)
                lower Ready to Assign, because that money left the budget.
              </li>
            </ul>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="brand-icon-well h-7 w-7 shrink-0 text-xs font-semibold text-brand">{n}</span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-muted-foreground">{children}</p>
      </div>
    </div>
  )
}
