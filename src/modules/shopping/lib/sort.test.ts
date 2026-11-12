import { splitWants, urgency } from './sort'

const row = (name: string, need_by: string | null, bought_at: string | null = null, created_at = '2026-11-01T00:00:00Z') => ({ name, need_by, bought_at, created_at })

describe('splitWants', () => {
  it('puts deadlines first by date, the rest oldest first, and bought last', () => {
    const { dated, whenever, bought } = splitWants([
      row('Lamp', null, null, '2026-11-05T00:00:00Z'),
      row('Shoes', '2026-12-01'),
      row('Gift', '2026-11-20'),
      row('Sofa', null, null, '2026-11-02T00:00:00Z'),
      row('Kettle', '2026-11-10', '2026-11-09T10:00:00Z'),
    ])
    expect(dated.map((r) => r.name)).toEqual(['Gift', 'Shoes'])
    expect(whenever.map((r) => r.name)).toEqual(['Sofa', 'Lamp'])
    expect(bought.map((r) => r.name)).toEqual(['Kettle'])
  })
})

describe('urgency', () => {
  it('flags late and soon deadlines', () => {
    expect(urgency('2026-11-11', '2026-11-12')).toBe('late')
    expect(urgency('2026-11-12', '2026-11-12')).toBe('soon')
    expect(urgency('2026-11-19', '2026-11-12')).toBe('soon')
    expect(urgency('2026-11-20', '2026-11-12')).toBeNull()
  })
})
