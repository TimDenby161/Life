// The Holidays Todo tab: everything still to book on the trips you're going on,
// as one list, most urgent first.
import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from 'date-fns'

type ItemKey = 'time_off' | 'transport' | 'stay' | 'insurance'
export const ITEM_LABELS: Record<ItemKey, string> = { time_off: 'Time off', transport: 'Travel', stay: 'Stay', insurance: 'Insurance' }

type Trip = { id: string; name: string; starts_on: string; confirmed: boolean } & Record<ItemKey, string>
type Booking = { id: string; trip_id: string; title: string; book_by: string | null; cost_minor: number | null; done: boolean; sort: number }

export type TodoItem =
  | { kind: 'booking'; id: string; trip: Trip; label: string; bookBy: string | null; cost: number | null }
  | { kind: 'item'; id: string; trip: Trip; key: ItemKey; label: string; bookBy: string }

export type Urgency = 'overdue' | 'month' | 'quarter' | 'later'
export const URGENCY_LABELS: Record<Urgency, string> = { overdue: 'Overdue', month: 'This month', quarter: 'Next 3 months', later: 'Later' }

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

/**
 * The trip's own items get a date from its bookings: time off and insurance are
 * needed before you pay for anything (the trip's first booking with a cost, so
 * research and checks don't count), and travel and
 * stay cover whatever's left, two months before you go. With no bookings, time
 * off and insurance fall back to three months before.
 */
function itemDate(trip: Trip, key: ItemKey, open: Booking[]) {
  const start = parseISO(trip.starts_on)
  if (key === 'transport' || key === 'stay') return iso(addMonths(start, -2))
  const first = open.filter((b) => b.cost_minor != null).map((b) => b.book_by).filter((d): d is string => !!d).sort()[0]
  return first ?? iso(addMonths(start, -3))
}

export function todoItems(trips: Trip[], bookings: Booking[]): TodoItem[] {
  const items: TodoItem[] = []
  for (const trip of trips.filter((t) => t.confirmed)) {
    const open = bookings.filter((b) => b.trip_id === trip.id && !b.done)
    for (const b of open) items.push({ kind: 'booking', id: b.id, trip, label: b.title, bookBy: b.book_by, cost: b.cost_minor })
    for (const key of Object.keys(ITEM_LABELS) as ItemKey[]) {
      if (trip[key] === 'todo') items.push({ kind: 'item', id: `${trip.id}:${key}`, trip, key, label: ITEM_LABELS[key], bookBy: itemDate(trip, key, open) })
    }
  }
  const order = new Map(bookings.map((b) => [b.id, b.sort]))
  // Soonest book-by first; undated last; ties by trip date, then the plan's order.
  return items.sort(
    (a, b) =>
      (a.bookBy ?? '9999').localeCompare(b.bookBy ?? '9999') ||
      a.trip.starts_on.localeCompare(b.trip.starts_on) ||
      (a.kind === b.kind ? (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) : a.kind === 'booking' ? -1 : 1),
  )
}

export function urgency(bookBy: string | null, today: string): Urgency {
  if (!bookBy) return 'later'
  const days = differenceInCalendarDays(parseISO(bookBy), parseISO(today))
  if (days < 0) return 'overdue'
  if (bookBy <= iso(addDays(parseISO(today), 31))) return 'month'
  if (bookBy <= iso(addMonths(parseISO(today), 3))) return 'quarter'
  return 'later'
}

/** "15 Dec", or "15 Dec 2027" outside this year. */
export function byDate(bookBy: string, today: string) {
  return format(parseISO(bookBy), bookBy.slice(0, 4) === today.slice(0, 4) ? 'd MMM' : 'd MMM yyyy')
}
