/** Optional first name for the home greeting, set via VITE_USER_NAME in frontend/.env.local. */
const USER_NAME: string = (import.meta.env.VITE_USER_NAME ?? '').trim()

function timeOfDay(now: Date): string {
  const h = now.getHours()
  if (h < 5) return 'Good evening'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function greeting(now = new Date()): string {
  return USER_NAME ? `${timeOfDay(now)}, ${USER_NAME}.` : `${timeOfDay(now)}.`
}
