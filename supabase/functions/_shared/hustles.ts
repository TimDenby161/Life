// The side hustles' money, from the "The Corner" Google Sheet (CashFlow tab).
// Outgoings sit in columns A-D and income in F-I, each Date / Project / Desc /
// Amount under a header row whose first cell is "Date". Pure (no Deno, no
// imports) so the app and the side-hustles function share it.

export type Side = 'out' | 'in'
export type Entry = { side: Side; row: number; date: string; project: string; description: string; amountMinor: number }
export type Problem = { side: Side; row: number; text: string }

const BLOCK: Record<Side, number> = { out: 0, in: 5 }
const DAY_MS = 86_400_000
// Google Sheets day 0 is 30 December 1899.
const SHEETS_EPOCH = Date.UTC(1899, 11, 30)

/** A sheet date as YYYY-MM-DD: a serial day number, or text written day/month/year. Null when it isn't one. */
export function sheetDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 80000) {
    return new Date(SHEETS_EPOCH + Math.floor(value) * DAY_MS).toISOString().slice(0, 10)
  }
  if (typeof value !== 'string') return null
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(value)
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.UTC(y, mo - 1, d)
  const iso = new Date(t).toISOString().slice(0, 10)
  return iso === `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` ? iso : null
}

/** An amount in pence: a number of pounds, or text such as "£22.42" or "1,250". Null when it isn't one. */
export function sheetAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100)
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[£,\s]/g, '')
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null
  return Math.round(Number(cleaned) * 100)
}

const cell = (row: unknown[] | undefined, i: number) => (row ? row[i] : undefined)
const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim())
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : typeof v === 'number' ? String(v) : '')

/**
 * The CashFlow tab as entries, rows that can't be read (shown so they can be
 * fixed in the sheet), and the next empty row (1-based) in each block.
 */
export function parseCashFlow(values: unknown[][]): { entries: Entry[]; problems: Problem[]; nextRow: Record<Side, number> } {
  const header = values.findIndex((r) => Array.isArray(r) && typeof r[0] === 'string' && r[0].trim().toLowerCase() === 'date')
  const first = header >= 0 ? header + 1 : 3
  const entries: Entry[] = []
  const problems: Problem[] = []
  const nextRow: Record<Side, number> = { out: first + 1, in: first + 1 }
  for (const side of ['out', 'in'] as const) {
    const c = BLOCK[side]
    for (let i = first; i < values.length; i++) {
      const row = values[i]
      const cells = [0, 1, 2, 3].map((k) => cell(row, c + k))
      if (cells.every(blank)) continue
      nextRow[side] = i + 2
      const date = sheetDate(cells[0])
      const amountMinor = sheetAmount(cells[3])
      const project = text(cells[1], 60)
      if (!date || amountMinor === null || !project) {
        problems.push({ side, row: i + 1, text: cells.map((v) => text(v, 40)).filter(Boolean).join(' · ') })
        continue
      }
      entries.push({ side, row: i + 1, date, project, description: text(cells[2], 120), amountMinor })
    }
  }
  return { entries, problems, nextRow }
}

export type ProjectTotals = { project: string; outAll: number; inAll: number; outMonth: number; inMonth: number; last: string | null }

/** Money in and out per project, all time and this month (`month` is YYYY-MM), busiest first. */
export function totalsByProject(entries: readonly Entry[], month: string): ProjectTotals[] {
  const out = new Map<string, ProjectTotals>()
  for (const e of entries) {
    const key = e.project.toLowerCase()
    const t = out.get(key) ?? { project: e.project, outAll: 0, inAll: 0, outMonth: 0, inMonth: 0, last: null }
    if (e.side === 'out') t.outAll += e.amountMinor
    else t.inAll += e.amountMinor
    if (e.date.startsWith(month)) {
      if (e.side === 'out') t.outMonth += e.amountMinor
      else t.inMonth += e.amountMinor
    }
    if (!t.last || e.date > t.last) t.last = e.date
    out.set(key, t)
  }
  return [...out.values()].sort((a, b) => b.outAll + b.inAll - (a.outAll + a.inAll))
}

/** The cells for a new row, written as the sheet's own rows are: day/month/year, project, description, pounds. */
export function rowCells(entry: { date: string; project: string; description: string; amountMinor: number }): (string | number)[] {
  const [y, m, d] = entry.date.split('-')
  return [`${d}/${m}/${y}`, entry.project, entry.description, entry.amountMinor / 100]
}

/** A1 range for a new row in a block. */
export function rowRange(sheetName: string, side: Side, row: number): string {
  const [from, to] = side === 'out' ? ['A', 'D'] : ['F', 'I']
  return `'${sheetName.replace(/'/g, "''")}'!${from}${row}:${to}${row}`
}

/** A Google Sheets id from a pasted link or the id itself; null when it isn't one. */
export function spreadsheetIdFrom(input: string): string | null {
  const t = input.trim()
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})/.exec(t) ?? /^([A-Za-z0-9_-]{20,100})$/.exec(t)
  return m ? m[1] : null
}
