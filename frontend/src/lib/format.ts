const currencyFormatters = new Map<string, Intl.NumberFormat>()

function currencyFormatter(currency: string): Intl.NumberFormat | null {
  let fmt = currencyFormatters.get(currency)
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency })
    } catch {
      return null // Unknown ISO currency code.
    }
    currencyFormatters.set(currency, fmt)
  }
  return fmt
}

/** Locale currency string, e.g. "$1,234.56". Formatters are cached; bad currency codes fall back to "1234.56 XYZ". */
export function formatMoney(amount: number, currency = 'USD'): string {
  const fmt = currencyFormatter(currency)
  return fmt ? fmt.format(amount) : `${amount.toFixed(2)} ${currency}`
}

const usdCents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const usdWhole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** Report-style USD with a typographic minus: "−$1,234.56". */
export function formatSignedUsd(n: number): string {
  return `${n < 0 ? '−' : ''}$${usdCents.format(Math.abs(n))}`
}

/** Axis-tick USD without cents: "−$1,235". */
export function formatSignedUsdWhole(n: number): string {
  return `${n < 0 ? '−' : ''}$${usdWhole.format(Math.abs(n))}`
}
