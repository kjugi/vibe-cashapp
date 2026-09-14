import { parseCsv } from './csv'
import { toISODate } from './period'

export type SpendeeRow = {
  date: string
  wallet: string
  type: string
  category: string
  amount: number
  currency: string
  note: string
}

function headerIndex(headers: string[], ...names: string[]): number {
  const lower = headers.map((h) => h.trim().toLowerCase())
  for (const name of names) {
    const i = lower.indexOf(name.toLowerCase())
    if (i >= 0) return i
  }
  return -1
}

function toLocalDate(raw: string): string {
  const d = new Date(raw)
  if (!Number.isNaN(d.getTime())) return toISODate(d)
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]
  throw new Error(`Could not parse Spendee date: ${raw}`)
}

function toMinor(raw: string): number {
  const n = Number(String(raw).trim().replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(n)) throw new Error(`Could not parse amount: ${raw}`)
  return Math.round(Math.abs(n) * 100)
}

export function parseSpendeeCsv(text: string): SpendeeRow[] {
  const table = parseCsv(text)
  if (table.length < 2) throw new Error('Spendee CSV has no rows.')
  const headers = table[0]
  const iDate = headerIndex(headers, 'Date')
  const iWallet = headerIndex(headers, 'Wallet')
  const iType = headerIndex(headers, 'Type')
  const iCat = headerIndex(headers, 'Category name', 'Category')
  const iAmt = headerIndex(headers, 'Amount')
  const iCur = headerIndex(headers, 'Currency')
  const iNote = headerIndex(headers, 'Note')
  if ([iDate, iWallet, iType, iCat, iAmt, iCur].some((i) => i < 0)) {
    throw new Error(
      'CSV is missing Spendee columns. Need Date, Wallet, Type, Category name, Amount, Currency.',
    )
  }
  return table.slice(1).map((cols) => ({
    date: toLocalDate(cols[iDate] ?? ''),
    wallet: (cols[iWallet] ?? '').trim(),
    type: (cols[iType] ?? '').trim(),
    category: (cols[iCat] ?? '').trim(),
    amount: toMinor(cols[iAmt] ?? '0'),
    currency: (cols[iCur] ?? '').trim() || 'CZK',
    note: (iNote >= 0 ? cols[iNote] ?? '' : '').trim(),
  }))
}
