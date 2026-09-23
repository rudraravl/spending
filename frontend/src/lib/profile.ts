/** First name used in the home greeting. Single-user app, so this lives in code rather than settings. */
export const USER_FIRST_NAME = 'Rudra'

export function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h < 5) return 'Good evening'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
