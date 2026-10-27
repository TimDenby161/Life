// The usual wedding to-do list, each with roughly how many months before the
// day it's done (typical UK timings; notice of marriage in England must be
// given 29 days to 12 months before).
import { subMonths } from 'date-fns'
import { type ISODate, parseISODate, toISODate } from '@/lib/dates'

/** Used for due dates until the exact date is set in wedding settings. */
export const ASSUMED_WEDDING_DATE: ISODate = '2028-09-01'

export const STARTER_CHECKLIST: { title: string; monthsBefore: number }[] = [
  { title: 'Agree the overall budget', monthsBefore: 23 },
  { title: 'Draft the guest list', monthsBefore: 22 },
  { title: 'Shortlist and visit venues', monthsBefore: 21 },
  { title: 'Book the venue', monthsBefore: 20 },
  { title: 'Book the registrar or celebrant', monthsBefore: 19 },
  { title: 'Book the photographer', monthsBefore: 18 },
  { title: 'Book the videographer', monthsBefore: 17 },
  { title: 'Book catering (if not through the venue)', monthsBefore: 17 },
  { title: 'Book the band or DJ', monthsBefore: 15 },
  { title: 'Start looking at outfits', monthsBefore: 14 },
  { title: 'Send save the dates', monthsBefore: 12 },
  { title: 'Book hair and make-up', monthsBefore: 12 },
  { title: 'Order wedding outfits', monthsBefore: 10 },
  { title: 'Book the florist', monthsBefore: 10 },
  { title: 'Book the honeymoon', monthsBefore: 9 },
  { title: 'Arrange rooms for guests near the venue', monthsBefore: 9 },
  { title: 'Choose the cake', monthsBefore: 8 },
  { title: 'Book the wedding car', monthsBefore: 8 },
  { title: 'Order invitations', monthsBefore: 7 },
  { title: 'Buy wedding rings', monthsBefore: 5 },
  { title: 'Give notice of marriage at the register office', monthsBefore: 4 },
  { title: 'Send invitations', monthsBefore: 4 },
  { title: 'Plan the order of the day', monthsBefore: 3 },
  { title: 'First outfit fittings', monthsBefore: 3 },
  { title: 'Order on-the-day stationery', monthsBefore: 2 },
  { title: 'Chase RSVPs', monthsBefore: 2 },
  { title: 'Final numbers and dietary needs to the venue', monthsBefore: 1 },
  { title: 'Plan the seating', monthsBefore: 1 },
  { title: 'Write speeches and vows', monthsBefore: 1 },
  { title: 'Final outfit fittings', monthsBefore: 1 },
  { title: 'Confirm timings and final payments with suppliers', monthsBefore: 1 },
]

/**
 * Starter tasks not already on the checklist (matched by title, ignoring case),
 * dated back from the wedding. A date already past becomes today, so nothing
 * starts out overdue.
 */
export function missingStarterTasks(existing: readonly { title: string }[], weddingDate: ISODate, today: ISODate) {
  const have = new Set(existing.map((t) => t.title.trim().toLowerCase()))
  return STARTER_CHECKLIST.filter((t) => !have.has(t.title.toLowerCase())).map((t) => {
    const due = toISODate(subMonths(parseISODate(weddingDate), t.monthsBefore))
    return { title: t.title, due_date: due < today ? today : due }
  })
}
