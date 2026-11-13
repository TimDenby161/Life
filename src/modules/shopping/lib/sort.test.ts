import { fromChecklist, splitWants, urgency } from './sort'

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

describe('the Shoppinglist checklist', () => {
  const item = (title: string, extra: Partial<{ is_done: boolean; done_at: string | null; due_date: string | null }> = {}) => ({
    id: title, title, is_done: false, done_at: null, due_date: null, created_at: '2026-11-03T00:00:00Z', ...extra,
  })

  it('sorts in with the rest: dated, whenever and ticked off', () => {
    const { dated, whenever, bought } = splitWants([
      row('Shoes', '2026-12-01'),
      fromChecklist(item('Milk')),
      fromChecklist(item('Card for Mum', { due_date: '2026-11-20' })),
      fromChecklist(item('Bin bags', { is_done: true, done_at: '2026-11-12T09:00:00Z' })),
    ])
    expect(dated.map((r) => r.name)).toEqual(['Card for Mum', 'Shoes'])
    expect(whenever.map((r) => r.name)).toEqual(['Milk'])
    expect(bought.map((r) => r.name)).toEqual(['Bin bags'])
  })

  it('counts an item ticked with no time as bought', () => {
    expect(fromChecklist(item('Old', { is_done: true })).bought_at).toBe('2026-11-03T00:00:00Z')
  })
})
