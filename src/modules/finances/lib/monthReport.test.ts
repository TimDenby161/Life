import { cellToMinor, parseMonthReport, reconcile, serialToISODate } from '../../../../supabase/functions/_shared/month-report.ts'

// Same shape as the household's MonthReport sheet (made-up amounts), as the
// Sheets API returns it with UNFORMATTED_VALUE + SERIAL_NUMBER dates.
// 46217 = 14 Jul 2026, 46250 = 16 Aug 2026.
const SHEET: unknown[][] = [
  [],
  ['', 'Date', '', 46217, 46250],
  ['', 'Combined Net Worth', '', 1500.5, 1600],
  ['', 'House', '', 400000, 400000],
  ['', 'Mortgage', '', -200000, -199000],
  [],
  ['', 'Tim', 'Positive', 300.5, 350],
  ['', 'Santander', 'Current Account', 100.25, 150],
  ['', 'Revolut', 'Saving', 200.25, 200],
  ['', 'Santander', 'Edge Saver', '', 0],
  [],
  ['', 'Tim', 'Negative', 76.11, 0],
  ['', 'Amex', 'BA', 76.11, 0],
  [],
  ['', 'Sophie', 'Positive', 600, 700],
  ['', 'Santander', 'Current Account', 100, 150],
  ['', 'Santander', 'Total Saver', 1500, 1550],
  ['', 'Santander', 'Not Sophos', 1000, 1000],
  ['', 'Santander', 'Sophos', 500, 550],
  [],
  ['', 'Long Term', '', -199900, -198850],
  ['', 'Aviva', 'Sophie Pension', 100, 150],
  ['', 'Halifax/Lloyds', 'Mortgage', -200000, -199000],
]

describe('cellToMinor', () => {
  it.each([
    [312874.07, 31287407],
    [-235472.84, -23547284],
    [0, 0],
    [0.1 + 0.2, 30],
    ['£1,234.56', 123456],
    ['-£20', -2000],
    ['(15.50)', -1550],
    ['', null],
    ['n/a', null],
    [null, null],
  ])('%s -> %s', (input, expected) => {
    expect(cellToMinor(input)).toBe(expected)
  })
})

describe('parseMonthReport', () => {
  const report = parseMonthReport(SHEET)

  it('reads the date columns', () => {
    expect(serialToISODate(46217)).toBe('2026-07-14')
    expect(report.dates).toEqual(['2026-07-14', '2026-08-16'])
  })

  it('finds each group by its header row', () => {
    expect(report.sections.map((s) => [s.label, s.owner, s.kind])).toEqual([
      ['Tim Positive', 'Tim', 'positive'],
      ['Tim Negative', 'Tim', 'negative'],
      ['Sophie Positive', 'Sophie', 'positive'],
      ['Long Term', null, 'other'],
    ])
  })

  it('keeps summary rows separate and keys rows by section and labels', () => {
    const house = report.rows.find((r) => r.name === 'House')!
    expect(house).toMatchObject({ key: 'summary||house', sectionKind: 'summary', values: [40000000, 40000000], sheetRow: 4 })
    const keys = report.rows.map((r) => r.key)
    expect(keys).toContain('tim positive|santander|current account')
    expect(keys).toContain('sophie positive|santander|current account')
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('stores money owed as negative balances and empty cells as missing', () => {
    expect(report.rows.find((r) => r.name === 'BA')!.values).toEqual([-7611, 0])
    expect(report.rows.find((r) => r.name === 'Edge Saver')!.values).toEqual([null, 0])
    expect(report.rows.find((r) => r.institution === 'Halifax/Lloyds')!.values).toEqual([-20000000, -19900000])
  })

  it('does not depend on row positions', () => {
    const shifted = parseMonthReport([[], [], ...SHEET.slice(0, 9), ['', 'Monzo', 'Main', 5, 6], ...SHEET.slice(9)])
    expect(shifted.rows.find((r) => r.key === 'tim negative|amex|ba')!.values).toEqual([-7611, 0])
    expect(shifted.rows.find((r) => r.key === 'tim positive|monzo|main')!.values).toEqual([500, 600])
  })

  it('rejects a sheet without a Date row', () => {
    expect(() => parseMonthReport([['', 'Totals', '', 1]])).toThrow(/Date/)
  })
})

describe('reconcile', () => {
  const { skip, matches } = reconcile(parseMonthReport(SHEET))

  it('skips a row that is the sum of the rows below it, and a row the subtotal leaves out', () => {
    expect([...skip].sort()).toEqual(['sophie positive|santander|not sophos', 'sophie positive|santander|total saver'])
  })

  it('confirms every section then adds up to the sheet subtotal', () => {
    expect(Object.fromEntries(matches)).toEqual({ 'Tim Positive': true, 'Tim Negative': true, 'Sophie Positive': true, 'Long Term': true })
  })
})
