// Money is always an integer number of minor units (pence). Integers are exact
// in JS up to Number.MAX_SAFE_INTEGER (~£90 trillion), which is ample here.
// Parsing works on the string so no floating-point arithmetic is involved.

const MINOR_DIGITS: Record<string, number> = { JPY: 0, KRW: 0, ISK: 0, BHD: 3, KWD: 3, OMR: 3 }

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency] ?? 2
}

export function formatMoney(
  minor: number,
  currency = 'GBP',
  opts: { signed?: boolean; compact?: boolean; hidePence?: boolean } = {},
): string {
  const digits = minorDigits(currency)
  const major = minor / 10 ** digits
  const showMinor = !opts.hidePence && !opts.compact
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    notation: opts.compact ? 'compact' : 'standard',
    minimumFractionDigits: showMinor ? digits : 0,
    maximumFractionDigits: opts.compact ? 1 : showMinor ? digits : 0,
    signDisplay: opts.signed ? 'exceptZero' : 'auto',
  }).format(major)
}

/**
 * Parses user input like "1,234.56", "£12", "-3.5" into minor units.
 * Returns null for anything that is not a valid amount.
 */
export function parseMoney(input: string, currency = 'GBP'): number | null {
  const digits = minorDigits(currency)
  const cleaned = input.trim().replace(/[£$€,\s]/g, '')
  const match = /^(-)?(\d+)(?:\.(\d*))?$/.exec(cleaned) ?? /^(-)?()\.(\d+)$/.exec(cleaned)
  if (!match) return null
  const [, sign, whole, fraction = ''] = match
  if (fraction.length > digits) return null
  const minorStr = (whole || '0') + fraction.padEnd(digits, '0')
  const value = Number.parseInt(minorStr, 10)
  if (!Number.isSafeInteger(value)) return null
  return sign ? -value : value
}

/** Minor units -> plain editable string, e.g. 123456 -> "1234.56". */
export function toMoneyInput(minor: number, currency = 'GBP'): string {
  const digits = minorDigits(currency)
  const negative = minor < 0
  const abs = Math.abs(minor).toString().padStart(digits + 1, '0')
  const whole = digits ? abs.slice(0, -digits) : abs
  const fraction = digits ? abs.slice(-digits) : ''
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}
