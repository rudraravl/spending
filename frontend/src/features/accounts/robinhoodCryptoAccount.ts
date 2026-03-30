/**
 * Robinhood’s SimpleFIN feed often labels the crypto sub-account with a name like `Crypto (6417)`.
 * Local account names are usually user-defined when the account is created, so match as a substring.
 */
export function isRobinhoodCryptoStyleAccountName(name: string): boolean {
  const t = name.trim()
  if (!t) return false
  return /\bcrypto\s*\(\d+\)/i.test(t)
}
