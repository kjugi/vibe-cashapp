function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayISO(): string {
  return toISODate(new Date())
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

function clampDay(year: number, monthIndex: number, day: number): number {
  return Math.min(day, daysInMonth(year, monthIndex))
}

export type Period = {
  start: string
  end: string
}

/** Inclusive period whose month starts on `startDay` (1–28). */
export function periodContaining(isoDate: string, startDay: number): Period {
  const day = Math.min(28, Math.max(1, startDay))
  const date = parseISODate(isoDate)
  const y = date.getFullYear()
  const m = date.getMonth()
  const d = date.getDate()

  let start: Date
  if (d >= day) {
    start = new Date(y, m, clampDay(y, m, day))
  } else {
    const prev = new Date(y, m - 1, 1)
    start = new Date(prev.getFullYear(), prev.getMonth(), clampDay(prev.getFullYear(), prev.getMonth(), day))
  }
  const next = new Date(start.getFullYear(), start.getMonth() + 1, 1)
  const nextStart = new Date(
    next.getFullYear(),
    next.getMonth(),
    clampDay(next.getFullYear(), next.getMonth(), day),
  )
  const end = new Date(nextStart)
  end.setDate(end.getDate() - 1)
  return { start: toISODate(start), end: toISODate(end) }
}

export function shiftPeriod(period: Period, months: number, startDay: number): Period {
  const start = parseISODate(period.start)
  start.setMonth(start.getMonth() + months)
  return periodContaining(toISODate(start), startDay)
}

export function periodLabel(period: Period, locale?: string): string {
  const start = parseISODate(period.start)
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(start)
}

export function addMonthsISO(iso: string, months: number): string {
  const d = parseISODate(iso)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  d.setDate(clampDay(d.getFullYear(), d.getMonth(), day))
  return toISODate(d)
}

export function addDaysISO(iso: string, days: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

export function addYearsISO(iso: string, years: number): string {
  return addMonthsISO(iso, years * 12)
}

export function formatDay(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(parseISODate(iso))
}
