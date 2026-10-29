import { ArrowRight, Compass, Landmark, Lightbulb, Plug, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useOnboarding } from './onboardingContext'
import { restoreTips, useOnboardingState } from './onboardingStore'
import { TOUR_FEATURES } from './tourContent'

/** Settings → Help: re-run the guided flows, bring back closed page tips, and a feature guide. */
export default function HelpPanel() {
  const { openWelcome, openBankSyncSetup } = useOnboarding()
  const { dismissedTips } = useOnboardingState()

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <HelpAction
          icon={Compass}
          title="Take the tour"
          description="A one-minute walkthrough of every part of the app."
          action="Start tour"
          onClick={() => openWelcome('tour')}
        />
        <HelpAction
          icon={Landmark}
          title="Add an account"
          description="Step-by-step setup for a manual card, bank, cash, or investment account."
          action="Add account"
          onClick={() => openWelcome('account')}
        />
        <HelpAction
          icon={Plug}
          title="Set up bank sync"
          badge="Optional"
          description="Connect SimpleFIN, link a bank account, and run your first sync."
          action="Start setup"
          onClick={() => openBankSyncSetup()}
        />
      </div>

      <section className="surface flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex items-start gap-3">
          <span className="brand-icon-well h-9 w-9 shrink-0">
            <Lightbulb className="h-4 w-4 text-brand" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Page tips</h2>
            <p className="text-sm text-muted-foreground">
              {dismissedTips.length === 0
                ? 'All tips are showing at the top of their pages.'
                : `You've closed ${dismissedTips.length} of ${TOUR_FEATURES.length} tips.`}
            </p>
          </div>
        </div>
        <Button variant="outline" disabled={dismissedTips.length === 0} onClick={restoreTips}>
          Show all tips again
        </Button>
      </section>

      <section className="surface overflow-hidden">
        <div className="border-b border-border/70 bg-muted/40 px-5 py-2.5">
          <h2 className="eyebrow">Feature guide</h2>
        </div>
        <ul className="divide-y divide-border/60">
          {TOUR_FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <li key={f.id}>
                <Link to={f.route} className="group flex items-start gap-3 px-5 py-3.5 hover:bg-muted/40">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium group-hover:text-primary">{f.title}</span>
                    <span className="block text-sm text-muted-foreground">{f.summary}</span>
                  </span>
                  <ArrowRight className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

function HelpAction({
  icon: Icon,
  title,
  description,
  action,
  badge,
  onClick,
}: {
  icon: LucideIcon
  title: string
  description: string
  action: string
  badge?: string
  onClick: () => void
}) {
  return (
    <section className="surface flex flex-col p-5">
      <span className="brand-icon-well h-9 w-9">
        <Icon className="h-4 w-4 text-brand" />
      </span>
      <h2 className="mt-3 flex items-center gap-2 text-base font-semibold">
        {title}
        {badge ? (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{badge}</span>
        ) : null}
      </h2>
      <p className="mt-1 flex-1 text-sm text-muted-foreground">{description}</p>
      <Button variant="secondary" className="mt-4 self-start" onClick={onClick}>
        {action}
      </Button>
    </section>
  )
}
