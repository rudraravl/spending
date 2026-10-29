import { useSyncExternalStore } from 'react'

/**
 * Per-browser onboarding progress: whether the welcome flow has been seen and which page tips
 * were closed. Kept in localStorage (like saved views) since it's UI state, not financial data.
 */
export type OnboardingState = {
  welcomeDone: boolean
  dismissedTips: string[]
}

const STORAGE_KEY = 'keep.onboarding.v1'
const DEFAULT_STATE: OnboardingState = { welcomeDone: false, dismissedTips: [] }

function load(): OnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<OnboardingState>
    return {
      welcomeDone: parsed.welcomeDone === true,
      dismissedTips: Array.isArray(parsed.dismissedTips)
        ? parsed.dismissedTips.filter((t): t is string => typeof t === 'string')
        : [],
    }
  } catch {
    return DEFAULT_STATE
  }
}

let state = load()
const listeners = new Set<() => void>()

function update(next: OnboardingState) {
  state = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota / private mode */
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useOnboardingState(): OnboardingState {
  return useSyncExternalStore(subscribe, () => state)
}

export function markWelcomeDone() {
  if (!state.welcomeDone) update({ ...state, welcomeDone: true })
}

export function dismissTip(id: string) {
  if (!state.dismissedTips.includes(id)) update({ ...state, dismissedTips: [...state.dismissedTips, id] })
}

export function restoreTips() {
  update({ ...state, dismissedTips: [] })
}
