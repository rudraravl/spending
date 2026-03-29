/** SimpleFIN / Robinhood often names the crypto sub-account like `Crypto (1234)`. */
export function isRobinhoodCryptoStyleAccountName(name: string): boolean {
  return /^crypto\s*\(\d+\)\s*$/i.test(name.trim())
}
