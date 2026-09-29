export const CASH = 'Cash'
export const UNKNOWN = 'Unknown investment'

export function sliceColor(symbol: string, i: number): string {
  if (symbol === CASH) return 'hsl(var(--muted-foreground) / 0.45)'
  if (symbol === UNKNOWN) return 'hsl(var(--muted-foreground) / 0.25)'
  return `var(--cat-${(i % 8) + 1})`
}
