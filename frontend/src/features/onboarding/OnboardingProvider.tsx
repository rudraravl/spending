import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAccounts } from '@/api/accounts'
import { queryKeys } from '@/queryKeys'
import BankSyncSetupDialog from './BankSyncSetupDialog'
import { OnboardingContext, type Onboarding, type WelcomeStep } from './onboardingContext'
import { markWelcomeDone, useOnboardingState } from './onboardingStore'
import WelcomeDialog from './WelcomeDialog'

type Open =
  | { kind: 'welcome'; id: number; step: WelcomeStep | 'intro' }
  | { kind: 'bank-sync'; id: number; localAccountId?: number }
  | null

/**
 * Hosts the welcome flow and bank-sync setup at the app root. The welcome flow opens on its own
 * the first time someone visits with no accounts; after that it's reachable from Settings → Help.
 */
export default function OnboardingProvider({ children }: { children: ReactNode }) {
  const { welcomeDone } = useOnboardingState()
  const [open, setOpen] = useState<Open>(null)
  const { data: accounts } = useQuery({ queryKey: queryKeys.accounts(), queryFn: () => getAccounts() })

  useEffect(() => {
    // Existing installs that predate onboarding already have accounts; don't greet them.
    if (!welcomeDone && accounts && accounts.length > 0) markWelcomeDone()
  }, [welcomeDone, accounts])
  // Latch the first-visit greeting into state so creating an account inside it doesn't close it.
  if (open === null && !welcomeDone && accounts?.length === 0) {
    setOpen({ kind: 'welcome', id: 0, step: 'intro' })
  }

  const openWelcome = useCallback((step: WelcomeStep = 'tour') => setOpen({ kind: 'welcome', id: Date.now(), step }), [])
  const openBankSyncSetup = useCallback(
    (localAccountId?: number) => setOpen({ kind: 'bank-sync', id: Date.now(), localAccountId }),
    [],
  )
  const value = useMemo<Onboarding>(() => ({ openWelcome, openBankSyncSetup }), [openWelcome, openBankSyncSetup])

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {open?.kind === 'welcome' ? (
        <WelcomeDialog
          key={open.id}
          initialStep={open.step}
          hasAccounts={(accounts?.length ?? 0) > 0}
          onClose={() => {
            markWelcomeDone()
            setOpen(null)
          }}
          onStartBankSync={(localAccountId) => {
            markWelcomeDone()
            openBankSyncSetup(localAccountId)
          }}
        />
      ) : null}
      {open?.kind === 'bank-sync' ? (
        <BankSyncSetupDialog key={open.id} localAccountId={open.localAccountId} onClose={() => setOpen(null)} />
      ) : null}
    </OnboardingContext.Provider>
  )
}
