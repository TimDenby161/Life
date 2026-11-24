import { byDate, todoItems, urgency } from './todo'

const trip = (id: string, starts_on: string, over: Partial<Record<string, string | boolean>> = {}) =>
  ({ id, name: id, starts_on, confirmed: true, time_off: 'done', transport: 'done', stay: 'done', insurance: 'done', ...over }) as never

describe('todoItems', () => {
  it('puts the soonest book-by first across trips, undated last, and skips booked ones and ideas', () => {
    const trips = [trip('china', '2028-04-10'), trip('cam', '2027-02-27'), trip('idea', '2027-05-01', { confirmed: false, stay: 'todo' })]
    const bookings = [
      { id: 'a', trip_id: 'china', title: 'Flights', book_by: '2027-08-31', cost_minor: null, done: false, sort: 1 },
      { id: 'b', trip_id: 'cam', title: 'Rooms', book_by: '2026-12-15', cost_minor: null, done: false, sort: 1 },
      { id: 'c', trip_id: 'cam', title: 'Ferry', book_by: '2027-01-31', cost_minor: null, done: true, sort: 2 },
      { id: 'd', trip_id: 'cam', title: 'Someday', book_by: null, cost_minor: null, done: false, sort: 3 },
    ]
    expect(todoItems(trips, bookings).map((i) => i.label)).toEqual(['Rooms', 'Flights', 'Someday'])
  })

  it('dates time off from the first paid booking (not research) and travel two months before', () => {
    const items = todoItems([trip('p', '2029-01-20', { time_off: 'todo', transport: 'todo' })], [
      { id: 'r', trip_id: 'p', title: 'Research', book_by: '2027-01-31', cost_minor: null, done: false, sort: 0 },
      { id: 'v', trip_id: 'p', title: 'Voyage', book_by: '2027-06-30', cost_minor: 1400000, done: false, sort: 1 },
    ])
    expect(items.map((i) => [i.label, i.bookBy])).toEqual([
      ['Research', '2027-01-31'],
      ['Voyage', '2027-06-30'],
      ['Time off', '2027-06-30'],
      ['Travel', '2028-11-20'],
    ])
  })
})

describe('urgency', () => {
  it('sorts dates into overdue, this month, next 3 months and later', () => {
    expect(urgency('2026-11-20', '2026-11-24')).toBe('overdue')
    expect(urgency('2026-12-15', '2026-11-24')).toBe('month')
    expect(urgency('2027-01-31', '2026-11-24')).toBe('quarter')
    expect(urgency('2027-06-30', '2026-11-24')).toBe('later')
    expect(urgency(null, '2026-11-24')).toBe('later')
  })

  it('writes the date short this year', () => {
    expect(byDate('2026-12-15', '2026-11-24')).toBe('15 Dec')
    expect(byDate('2027-06-30', '2026-11-24')).toBe('30 Jun 2027')
  })
})
