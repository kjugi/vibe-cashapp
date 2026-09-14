const SCALE = 100

export function parseAmount(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, '').replace(',', '.')
  if (!normalized || !/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null
  const [whole, frac = ''] = normalized.replace('-', '').split('.')
  const minor = Number(whole) * SCALE + Number((frac + '00').slice(0, 2))
  if (!Number.isFinite(minor)) return null
  return normalized.startsWith('-') ? -minor : minor
}

export function formatAmount(minor: number, currency: string, locale?: string): string {
  const value = minor / SCALE
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

export function formatSigned(minor: number, currency: string, locale?: string): string {
  const text = formatAmount(Math.abs(minor), currency, locale)
  if (minor > 0) return `+${text}`
  if (minor < 0) return `−${text}`
  return text
}
