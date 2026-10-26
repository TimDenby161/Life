import { skipByDefault, suggestAccount } from './sheetLink'

const members = [
  { id: 'tim', display_name: 'Tim' },
  { id: 'sophie', display_name: 'Sophie' },
]
const row = (owner: string | null, institution: string, name: string, sectionKind: 'positive' | 'negative' | 'summary' | 'other' = 'positive') => ({
  owner,
  institution,
  name,
  sectionKind,
})

describe('suggestAccount', () => {
  it.each([
    [row('Tim', 'Santander', 'Current Account'), 'current', 'tim'],
    [row('Tim', 'Trading212', 'Personal'), 'investment', 'tim'],
    [row('Tim', 'Revolut', 'Saving'), 'savings', 'tim'],
    [row('Tim', 'Amex', 'BA', 'negative'), 'credit_card', 'tim'],
    [row('Sophie', 'FreeTrade', 'Stocks & Shares ISA'), 'investment', 'sophie'],
    [row('Joint', 'Revolut', 'Holiday'), 'savings', null],
    [row(null, 'Aviva', 'Sophie Pension', 'other'), 'pension', 'sophie'],
    [row(null, 'SOPHIE', 'LISA', 'other'), 'investment', 'sophie'],
    [row(null, 'Halifax/Lloyds', 'Mortgage', 'other'), 'mortgage', null],
    [row(null, '', 'House', 'summary'), 'other', null],
  ])('%o', (r, type, owner) => {
    const s = suggestAccount(r, members)
    expect(s.account_type).toBe(type)
    expect(s.owner_id).toBe(owner)
    expect(s.ownership).toBe(owner ? 'personal' : 'joint')
  })

  it('names accounts after institution and account', () => {
    expect(suggestAccount(row('Tim', 'Monzo', 'Main'), members)).toMatchObject({ name: 'Monzo Main', institution: 'Monzo' })
    expect(suggestAccount(row(null, '', 'House', 'summary'), members)).toMatchObject({ name: 'House', institution: null })
  })
})

describe('skipByDefault', () => {
  it('skips summary totals but not the house', () => {
    expect(skipByDefault({ key: 'summary||tim total', name: 'Tim Total', sectionKind: 'summary' }, [])).toBe(true)
    expect(skipByDefault({ key: 'summary||house', name: 'House', sectionKind: 'summary' }, [])).toBe(false)
  })

  it('follows the sheet arithmetic for account rows', () => {
    expect(skipByDefault({ key: 'a', name: 'Total Saver', sectionKind: 'positive' }, ['a'])).toBe(true)
    expect(skipByDefault({ key: 'b', name: 'Sophos', sectionKind: 'positive' }, ['a'])).toBe(false)
  })
})
