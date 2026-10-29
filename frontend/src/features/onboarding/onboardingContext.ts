import { createContext, useContext } from 'react'

export type WelcomeStep = 'tour' | 'account'

export type Onboarding = {
  /** Opens the welcome flow: the feature tour, or straight to creating an account. */
  openWelcome: (step?: WelcomeStep) => void
  /** Opens the guided SimpleFIN setup, optionally pre-selecting the local account to link. */
  openBankSyncSetup: (localAccountId?: number) => void
}

export const OnboardingContext = createContext<Onboarding>({
  openWelcome: () => {},
  openBankSyncSetup: () => {},
})

export function useOnboarding(): Onboarding {
  return useContext(OnboardingContext)
}
