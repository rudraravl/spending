import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, Landmark, PenLine, Plug, Upload, Wallet } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { createAccount, patchAccount, type Account } from '@/api/accounts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ACCOUNT_TYPES, accountTypeLabel, type AccountType } from '@/features/accounts/accountViewKind'
import { cn } from '@/lib/utils'
import { queryKeys } from '@/queryKeys'
import type { WelcomeStep } from './onboardingContext'
import { TOUR_FEATURES } from './tourContent'

const TYPE_HINTS: Record<AccountType, string> = {
  checking: 'Everyday bank account',
  savings: 'Savings or high-yield account',
  credit: 'Credit card; balance shows as debt',
  cash: 'Wallet cash; balance only',
  investment: 'Brokerage or retirement',
}

/** Investment balances usually aren't spendable, so they stay out of the budget by default. */
const budgetByDefault = (type: AccountType) => type !== 'investment'

type Step = { kind: 'intro' } | { kind: 'tour'; index: number } | { kind: 'account' } | { kind: 'next'; account: Account }

type Props = {
  initialStep: WelcomeStep | 'intro'
  /** After the tour, existing users finish instead of being pushed into creating an account. */
  hasAccounts: boolean
  onClose: () => void
  onStartBankSync: (localAccountId?: number) => void
}

export default function WelcomeDialog({ initialStep, hasAccounts, onClose, onStartBankSync }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>(
    initialStep === 'tour' ? { kind: 'tour', index: 0 } : { kind: initialStep },
  )
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('checking')
  const [inBudget, setInBudget] = useState(true)

  const create = useMutation({
    mutationFn: async () => {
      const account = await createAccount({ name: name.trim(), type, currency: 'USD' })
      if (inBudget) await patchAccount(account.id, { is_budget_account: true })
      return account
    },
    onSuccess: (account) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.budgets() })
      setStep({ kind: 'next', account })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const go = (to: string) => {
    onClose()
    navigate(to)
  }

  const afterTour = () => (hasAccounts ? onClose() : setStep({ kind: 'account' }))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {step.kind === 'intro' ? (
          <>
            <DialogHeader>
              <span className="brand-icon-well mb-2 h-11 w-11">
                <Wallet className="h-5 w-5 text-brand" />
              </span>
              <DialogTitle className="text-xl">Welcome to Keep</DialogTitle>
              <DialogDescription>
                A local-first finance app. Everything you add stays in a database file on this computer.
              </DialogDescription>
            </DialogHeader>
            <ol className="space-y-3 text-sm">
              <IntroItem n={1} title="A quick tour">See what each part of the app does. About a minute.</IntroItem>
              <IntroItem n={2} title="Add your first account">A card, checking account, or cash wallet to track.</IntroItem>
              <IntroItem n={3} title="Bring in transactions">
                Import a CSV, enter them by hand, or (optionally) connect bank sync.
              </IntroItem>
            </ol>
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={() => setStep({ kind: 'account' })}>
                Skip tour
              </Button>
              <Button onClick={() => setStep({ kind: 'tour', index: 0 })} className="gap-1.5">
                Start the tour <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        ) : null}

        {step.kind === 'tour' ? (
          <TourSlide
            index={step.index}
            onBack={() => (step.index === 0 ? setStep({ kind: 'intro' }) : setStep({ kind: 'tour', index: step.index - 1 }))}
            onNext={() =>
              step.index === TOUR_FEATURES.length - 1 ? afterTour() : setStep({ kind: 'tour', index: step.index + 1 })
            }
            onJump={(index) => setStep({ kind: 'tour', index })}
            onSkip={afterTour}
            lastLabel={hasAccounts ? 'Finish' : 'Add an account'}
          />
        ) : null}

        {step.kind === 'account' ? (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim() && !create.isPending) create.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>Add your first account</DialogTitle>
              <DialogDescription>
                Start with the card or bank account you use most. You can add the rest later from Accounts.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label>What kind of account?</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Account type">
                {ACCOUNT_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={type === t}
                    onClick={() => {
                      setType(t)
                      setInBudget(budgetByDefault(t))
                    }}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      type === t ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50',
                    )}
                  >
                    <span className="block text-sm font-medium">{accountTypeLabel(t)}</span>
                    <span className="block text-xs leading-snug text-muted-foreground">{TYPE_HINTS[t]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="onboarding-acct-name">Name</Label>
              <Input
                id="onboarding-acct-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={type === 'credit' ? 'e.g. Chase Sapphire' : type === 'cash' ? 'e.g. Wallet' : 'e.g. Everyday checking'}
                autoFocus
              />
            </div>

            <label className="flex items-start justify-between gap-4 rounded-xl border bg-muted/30 p-3">
              <span className="text-sm">
                <span className="block font-medium">Count toward my budget</span>
                <span className="block text-xs text-muted-foreground">
                  Budget accounts fund your envelopes. Turn off for money you don&apos;t spend from, like a brokerage.
                </span>
              </span>
              <Switch checked={inBudget} onCheckedChange={setInBudget} />
            </label>

            <p className="text-xs text-muted-foreground">
              The balance starts at $0 and is built from the transactions you import or add.
            </p>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button type="button" variant="ghost" onClick={onClose}>
                I&apos;ll do this later
              </Button>
              <Button type="submit" disabled={!name.trim() || create.isPending}>
                {create.isPending ? 'Creating…' : 'Create account'}
              </Button>
            </div>
          </form>
        ) : null}

        {step.kind === 'next' ? (
          <>
            <DialogHeader>
              <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-income/10">
                <Check className="h-5 w-5 text-income" />
              </span>
              <DialogTitle>{step.account.name} is ready</DialogTitle>
              <DialogDescription>Now get some transactions into it. Pick whichever fits.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <NextOption
                icon={Upload}
                title="Import a CSV"
                description="Download a statement export from your bank's website and import it."
                onClick={() => go('/import')}
              />
              <NextOption
                icon={PenLine}
                title="Add transactions by hand"
                description="Good for cash purchases or getting started quickly."
                onClick={() => go('/transactions?tab=add-transaction')}
              />
              <NextOption
                icon={Plug}
                title="Connect bank sync"
                badge="Optional"
                description="Pull balances and transactions automatically with SimpleFIN (a paid third-party service)."
                onClick={() => onStartBankSync(step.account.id)}
              />
              <NextOption
                icon={Landmark}
                title="Add another account"
                description="Set up the rest of your cards and bank accounts."
                onClick={() => {
                  setName('')
                  setStep({ kind: 'account' })
                }}
              />
            </div>
            <div className="flex justify-end pt-1">
              <Button variant="ghost" onClick={onClose}>
                Done for now
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function IntroItem({ n, title, children }: { n: number; title: string; children: string }) {
  return (
    <li className="flex gap-3">
      <span className="brand-icon-well h-7 w-7 shrink-0 text-xs font-semibold text-brand">{n}</span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{children}</p>
      </div>
    </li>
  )
}

function TourSlide({
  index,
  onBack,
  onNext,
  onJump,
  onSkip,
  lastLabel,
}: {
  index: number
  onBack: () => void
  onNext: () => void
  onJump: (index: number) => void
  onSkip: () => void
  lastLabel: string
}) {
  const feature = TOUR_FEATURES[index]
  const Icon = feature.icon
  const isLast = index === TOUR_FEATURES.length - 1
  return (
    <>
      <DialogHeader>
        <p className="eyebrow">
          Tour · {index + 1} of {TOUR_FEATURES.length}
        </p>
        <div className="flex items-center gap-3 pt-1">
          <span className="brand-icon-well h-10 w-10 shrink-0">
            <Icon className="h-5 w-5 text-brand" />
          </span>
          <DialogTitle className="text-xl">{feature.title}</DialogTitle>
        </div>
        <DialogDescription className="pt-2 text-sm leading-relaxed">{feature.summary}</DialogDescription>
      </DialogHeader>
      <div className="flex justify-center gap-1.5 py-1" aria-label="Tour progress">
        {TOUR_FEATURES.map((f, i) => (
          <button
            key={f.id}
            type="button"
            aria-label={`Go to ${f.title}`}
            aria-current={i === index ? 'step' : undefined}
            onClick={() => onJump(i)}
            className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30')}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onSkip}>
          Skip
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" aria-label="Back" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button onClick={onNext} className="gap-1.5">
            {isLast ? lastLabel : 'Next'} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  )
}

function NextOption({
  icon: Icon,
  title,
  description,
  badge,
  onClick,
}: {
  icon: typeof Upload
  title: string
  description: string
  badge?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          {title}
          {badge ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{badge}</span>
          ) : null}
        </span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  )
}
