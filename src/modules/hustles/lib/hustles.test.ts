import { parseCashFlow, rowCells, rowRange, sheetAmount, sheetDate, spreadsheetIdFrom, totalsByProject } from '../../../../supabase/functions/_shared/hustles.ts'

// As the CashFlow tab comes back (unformatted values): a totals row, a blank, the header, then rows.
const SHEET = [
  ['Outgoings', '', '', 207.03, '', 'Income', '', '', 350],
  [],
  ['Date', 'Project', 'Desc', 'Amount', '', 'Date', 'Project', 'Desc', 'Amount'],
  ['23/09/2026', 'The Corner FC', 'Api-Football - Ultra', 22.42, '', 46287, 'Gamble', 'Profit', 350],
  ['24/09/2026', 'The Corner FC', 'Supabase - Pro', '£22.42'],
  ['24/09/2026', 'The Corner TT', 'thecornertt.com', 46.13],
  ['27/10//2026', 'The Corner FC', 'Claude Code', 18],
]

describe('The Corner sheet', () => {
  it('reads dates written as text or as sheet serial numbers', () => {
    expect(sheetDate('23/09/2026')).toBe('2026-09-23')
    expect(sheetDate(46287)).toBe('2026-09-22')
    expect(sheetDate('31/02/2026')).toBeNull()
    expect(sheetDate('27/10//2026')).toBeNull()
  })

  it('reads amounts as numbers or money text', () => {
    expect(sheetAmount(22.42)).toBe(2242)
    expect(sheetAmount('£1,250.5')).toBe(125050)
    expect(sheetAmount('lots')).toBeNull()
  })

  it('splits outgoings and income, flags rows it can’t read, and finds the next empty row', () => {
    const { entries, problems, nextRow } = parseCashFlow(SHEET)
    expect(entries.map((e) => `${e.side} ${e.row} ${e.date} ${e.project} ${e.amountMinor}`)).toEqual([
      'out 4 2026-09-23 The Corner FC 2242',
      'out 5 2026-09-24 The Corner FC 2242',
      'out 6 2026-09-24 The Corner TT 4613',
      'in 4 2026-09-22 Gamble 35000',
    ])
    expect(problems).toEqual([{ side: 'out', row: 7, text: '27/10//2026 · The Corner FC · Claude Code · 18' }])
    expect(nextRow).toEqual({ out: 8, in: 5 })
  })

  it('totals each project, all time and this month', () => {
    const { entries } = parseCashFlow(SHEET)
    expect(totalsByProject(entries, '2026-09').map((t) => [t.project, t.outAll, t.inAll, t.outMonth])).toEqual([
      ['Gamble', 0, 35000, 0],
      ['The Corner TT', 4613, 0, 4613],
      ['The Corner FC', 4484, 0, 4484],
    ])
  })

  it('writes a new row the way the sheet’s own rows look', () => {
    expect(rowCells({ date: '2026-11-24', project: 'The Corner FC', description: 'Supabase - Pro', amountMinor: 1926 })).toEqual(['24/11/2026', 'The Corner FC', 'Supabase - Pro', 19.26])
    expect(rowRange('CashFlow', 'in', 9)).toBe("'CashFlow'!F9:I9")
  })

  it('takes the spreadsheet id from a pasted link', () => {
    expect(spreadsheetIdFrom('https://docs.google.com/spreadsheets/d/1pBeL0orom1TQ3fbaZrP7h_DXKba-qurLMvq5T0dYIL4/edit?usp=drivesdk')).toBe('1pBeL0orom1TQ3fbaZrP7h_DXKba-qurLMvq5T0dYIL4')
    expect(spreadsheetIdFrom('not a link')).toBeNull()
  })
})
