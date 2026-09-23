import type { TransferMatchConfidence } from '@/api/transfers'

export const CONFIDENCE_LABEL: Record<TransferMatchConfidence, string> = {
  high: 'Likely transfer',
  medium: 'Possible transfer',
  low: 'Check carefully',
}

export const CONFIDENCE_BADGE_VARIANT: Record<TransferMatchConfidence, 'default' | 'secondary' | 'outline'> = {
  high: 'default',
  medium: 'secondary',
  low: 'outline',
}

export const DUPLICATE_TRANSFER_WARNING =
  "You already recorded a transfer between these accounts for this amount. Linking these too would count the money twice."
