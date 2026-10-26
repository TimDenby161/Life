// Parser for the household's "MonthReport" Google Sheet: a monthly snapshot of
// every account, one column per snapshot date. Pure (no Deno or DOM APIs) so
// the finance-sheet-sync Edge Function and the Vitest suite share it.
//
// Layout (column B = label, column C = second label, then one column per date):
//
//   Date               | 14/07/2026 | 16/08/2026 | …   <- first group: summary
//   Combined Net Worth | £312,874   | …                  rows (totals; House)
//   …
//   (blank row)
//   Tim       | Positive | £33,450  | …                <- group header + total
//   Santander | Current Account | £5,199 | …          <- accounts
//   (blank row)
//   Tim       | Negative | …                           <- balances owed, shown
//   Amex      | BA       | £3,261   | …                   positive: negated here
//   (blank row)
//   Long Term |          | …                           <- header without a kind
//
// Groups are found by blank rows, not fixed positions, so adding an account or
// a new date column never breaks the import. Amounts are integer minor units.

export type ISODate = string

export type SheetSection = {
  /** Header label, e.g. "Tim Positive", "Long Term" or "Summary". */
  label: string
  owner: string | null
  kind: 'positive' | 'negative' | 'summary' | 'other'
  /** The header row's own figures (the sheet's subtotal), signed like its rows. */
  totals: (number | null)[]
}

export type SheetRow = {
  /** Stable link key: section + labels, lower-cased. Unique within a sheet. */
  key: string
  section: string
  sectionKind: SheetSection['kind']
  owner: string | null
  institution: string
  name: string
  /** 1-based sheet row number, for messages only (keys don't depend on it). */
  sheetRow: number
  /** One signed balance per date column; null where the cell is empty. */
  values: (number | null)[]
}

export type MonthReport = { dates: ISODate[]; sections: SheetSection[]; rows: SheetRow[] }

const LABEL_COL = 1 // column B
const SUBLABEL_COL = 2 // column C

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim().replace(/\s+/g, ' ')

/** Sheets date serial (days since 1899-12-30) to ISO date. */
export function serialToISODate(serial: number): ISODate {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Cell value to minor units without float arithmetic: numbers are rounded to
 * pence by toFixed (exact for any balance a household will have), strings like
 * "-£1,234.56" are parsed digit by digit.
 */
export function cellToMinor(v: unknown): number | null {
  let s: string
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    s = v.toFixed(2)
  } else if (typeof v === 'string') {
    s = v.replace(/[£$€,\s]/g, '')
    if (/^\(.*\)$/.test(s)) s = `-${s.slice(1, -1)}`
  } else {
    return null
  }
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return null
  const minor = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'))
  return m[1] && minor !== 0 ? -minor : minor
}

function sectionOf(label: string, sub: string): Omit<SheetSection, 'totals'> {
  const kind = /^positive$/i.test(sub) ? 'positive' : /^negative$/i.test(sub) ? 'negative' : 'other'
  return { label: [label, sub].filter(Boolean).join(' '), owner: kind === 'other' ? null : label, kind }
}

/** Parses the sheet's values (as returned by the Sheets API, row-major). */
export function parseMonthReport(values: readonly (readonly unknown[])[]): MonthReport {
  const dateRowIndex = values.findIndex((r) => /^date$/i.test(text(r[LABEL_COL])))
  if (dateRowIndex < 0) throw new Error('No "Date" row found in column B')
  const dateRow = values[dateRowIndex]

  // Date columns: every cell right of the labels holding a date serial.
  const columns: { col: number; date: ISODate }[] = []
  for (let col = SUBLABEL_COL + 1; col < dateRow.length; col++) {
    const v = dateRow[col]
    if (typeof v === 'number' && v > 20_000 && v < 80_000) columns.push({ col, date: serialToISODate(v) })
  }
  if (!columns.length) throw new Error('No dates found in the "Date" row')

  const sections: SheetSection[] = []
  const rows: SheetRow[] = []
  const seen = new Map<string, number>()
  // The rows straight after the Date row are the summary group; every later
  // group starts with a header row.
  let inSummary = true
  let section: SheetSection | null = null
  const read = (r: readonly unknown[], sign: number) =>
    columns.map(({ col }) => {
      const minor = cellToMinor(r[col])
      return minor === null ? null : minor * sign || 0
    })

  for (let i = dateRowIndex + 1; i < values.length; i++) {
    const r = values[i] ?? []
    const label = text(r[LABEL_COL])
    const sub = text(r[SUBLABEL_COL])
    if (!label && !sub) {
      inSummary = false // a blank row closes the group
      section = null
      continue
    }
    if (!inSummary && section === null) {
      const s = sectionOf(label, sub)
      section = { ...s, totals: read(r, s.kind === 'negative' ? -1 : 1) }
      sections.push(section)
      continue
    }
    const vals = read(r, section?.kind === 'negative' ? -1 : 1)

    const sectionLabel = section?.label ?? 'Summary'
    const institution = inSummary ? '' : label
    const name = inSummary ? label : sub
    let key = `${sectionLabel}|${institution}|${name}`.toLowerCase()
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    if (n > 1) key += `#${n}`
    rows.push({
      key,
      section: sectionLabel,
      sectionKind: section?.kind ?? 'summary',
      owner: section?.owner ?? null,
      institution,
      name,
      sheetRow: i + 1,
      values: vals,
    })
  }

  return { dates: columns.map((c) => c.date), sections, rows }
}

/**
 * Rows the sheet itself leaves out of totals, found by arithmetic so they can
 * be suggested as "skip" rather than double counted:
 *  - a row equal to the sum of the rows straight after it on every date
 *    (e.g. "Total Saver" = "Not Sophos" + "Sophos"), and
 *  - a single row whose removal makes the section add up to its header total
 *    on every date (e.g. "Not Sophos", money held but not counted).
 * Returns the keys to skip and, per section, whether the rows (minus those)
 * reproduce the sheet's subtotal.
 */
export function reconcile(report: MonthReport): { skip: Set<string>; matches: Map<string, boolean> } {
  const skip = new Set<string>()
  const matches = new Map<string, boolean>()
  const sameOnEveryDate = (a: (number | null)[], b: (number | null)[]) => a.every((v, i) => (v ?? 0) === (b[i] ?? 0))
  const sum = (rs: SheetRow[]) => report.dates.map((_, d) => rs.reduce((t, r) => t + (r.values[d] ?? 0), 0))

  for (const section of report.sections) {
    const rows = report.rows.filter((r) => r.section === section.label)
    for (let i = 0; i < rows.length; i++) {
      for (let k = i + 2; k < rows.length; k++) {
        if (sameOnEveryDate(rows[i].values, sum(rows.slice(i + 1, k + 1))) && rows[i].values.some((v) => v)) {
          skip.add(rows[i].key)
          break
        }
      }
    }
    let kept = rows.filter((r) => !skip.has(r.key))
    if (!sameOnEveryDate(sum(kept), section.totals)) {
      const diff = sum(kept).map((v, d) => v - (section.totals[d] ?? 0))
      const culprits = kept.filter((r) => sameOnEveryDate(r.values, diff))
      if (culprits.length === 1) {
        skip.add(culprits[0].key)
        kept = kept.filter((r) => r !== culprits[0])
      }
    }
    matches.set(section.label, sameOnEveryDate(sum(kept), section.totals))
  }
  return { skip, matches }
}

export type AccountBalance = {
  account_id: string
  as_of: ISODate
  balance_minor: number
  /** The sheet rows behind the balance, in sheet order (one entry when not combined). */
  breakdown: { label: string; balance_minor: number }[]
}

export const rowLabel = (r: Pick<SheetRow, 'institution' | 'name'>) => [r.institution, r.name].filter(Boolean).join(' · ')

/**
 * One balance per linked account and date: the sum of the account's rows.
 * A date where none of its rows has a figure is left out (so a cleared
 * column removes the balance); a row with an empty cell just doesn't count.
 * Breakdown entries use the row's display label when it has one.
 */
export function accountBalances(report: MonthReport, links: ReadonlyMap<string, string>, labels: ReadonlyMap<string, string> = new Map()): AccountBalance[] {
  const out: AccountBalance[] = []
  const accounts = [...new Set(report.rows.flatMap((r) => links.get(r.key) ?? []))]
  for (const accountId of accounts) {
    const rows = report.rows.filter((r) => links.get(r.key) === accountId)
    report.dates.forEach((date, d) => {
      const parts = rows.flatMap((r) => (r.values[d] === null ? [] : [{ label: labels.get(r.key) ?? rowLabel(r), balance_minor: r.values[d]! }]))
      if (!parts.length) return
      out.push({ account_id: accountId, as_of: date, balance_minor: parts.reduce((t, p) => t + p.balance_minor, 0), breakdown: parts })
    })
  }
  return out
}
