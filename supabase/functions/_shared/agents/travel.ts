// Travel: what still needs sorting before each trip, from the household's trips
// list, and passports that run out too close to a trip (from the renewals
// list). Pure. No prices, bookings or outside sources; it never books anything.
//
//   trip:<id>:todo:<items>           time off, travel, stay or insurance still
//                                    to do inside its window, one card a trip
//   trip:<id>:pack                   leaving within three days
//   trip:<id>:deals:<window>         a big trip a year or more out with travel
//                                    still to book: ask operators for offers,
//                                    with an email to copy (you send it)
//   trip:<id>:passport:<person>      passport expires within six months of
//                                    coming home, or isn't on the renewals list
//
// A personal trip only reminds its owner; a joint one reminds both.
import { addDays, daysBetween, type ISODate, nextWeekday } from './dates.ts'
import { longDate, type Renewal } from './lifeAdmin.ts'
import { similarTitles } from './taskManager.ts'
import type { OpenTask, Severity, SuggestionDraft } from './types.ts'

export type ItemStatus = 'todo' | 'done' | 'not_needed'
export type Trip = {
  id: string
  name: string
  owner_id: string | null
  starts_on: ISODate
  ends_on: ISODate
  abroad: boolean
  transport: ItemStatus
  stay: ItemStatus
  insurance: ItemStatus
  time_off: ItemStatus
}

type Item = 'time_off' | 'transport' | 'stay' | 'insurance'

/** When each item starts being worth a reminder, in days before the trip. */
export const ITEMS: { key: Item; label: string; days: (t: Trip) => number; task: (name: string) => string; hint: string }[] = [
  { key: 'time_off', label: 'Time off', days: () => 84, task: (n) => `Book time off for ${n}`, hint: 'Leave goes quickly around holidays.' },
  {
    key: 'transport',
    label: 'Travel',
    days: (t) => (t.abroad ? 70 : 28),
    task: (n) => `Book travel for ${n}`,
    hint: 'Fares usually climb as the date gets closer.',
  },
  { key: 'stay', label: 'Stay', days: () => 56, task: (n) => `Book somewhere to stay for ${n}`, hint: 'The better places go first.' },
  {
    key: 'insurance',
    label: 'Insurance',
    days: (t) => (t.abroad ? 42 : 0),
    task: (n) => `Get travel insurance for ${n}`,
    hint: 'Buying it once the trip is booked means a cancellation is covered too.',
  },
]
export const PACK_DAYS = 3
/** When to ask operators about offers, in days before the trip: early-booking, then a second ask. */
export const DEAL_WINDOWS: { key: string; from: number; to: number }[] = [
  { key: 'early', from: 540, to: 366 },
  { key: 'again', from: 365, to: 240 },
]

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** An email to copy and send yourself: dates, a honeymoon if it is one, and what to ask for. */
export function dealEmail(trip: Trip, second: boolean): string {
  const when = `${MONTH_NAMES[Number(trip.starts_on.slice(5, 7)) - 1]} ${trip.starts_on.slice(0, 4)}`
  const honeymoon = /honeymoon/i.test(trip.name)
  return [
    `Hi, we’re planning ${trip.name.replace(/\s*\(?honeymoon\)?/i, '') || 'a trip'} for two in ${when}${honeymoon ? ', for our honeymoon' : ''}.`,
    second
      ? 'We asked earlier in the year and are now ready to book. Do you have any current offers, upcoming sales or upgrades we should know about?'
      : 'Before we book, do you offer early-booking discounts, honeymoon or couples offers, or sales later in the year we should wait for?',
    'Could you send prices and what’s included? Thanks.',
  ].join(' ')
}
/** Some countries want this long left on a passport after you leave. */
export const PASSPORT_SPARE_DAYS = 183
/** Passports are only checked for trips this close. */
export const PASSPORT_CHECK_DAYS = 365

const until = (days: number) => (days <= 0 ? 'now' : days === 1 ? 'tomorrow' : days < 14 ? `in ${days} days` : `in ${Math.round(days / 7)} weeks`)

export function analyseTravel(
  today: ISODate,
  trips: Trip[],
  renewals: Renewal[],
  open: OpenTask[],
  enabled: string[],
): SuggestionDraft[] {
  if (!enabled.length) return []
  const out: SuggestionDraft[] = []
  const saturday = nextWeekday(today, 6)
  const hasTask = (title: string) => open.some((t) => similarTitles(t.title, title))
  const dueBy = (start: ISODate) => (saturday < start ? saturday : [addDays(start, -1), today].sort().at(-1)!)

  for (const trip of [...trips].sort((a, b) => a.starts_on.localeCompare(b.starts_on))) {
    const days = daysBetween(today, trip.starts_on)
    if (days < 0) continue // under way or over
    const recipients = trip.owner_id ? enabled.filter((id) => id === trip.owner_id) : enabled
    if (!recipients.length) continue
    const list = trip.owner_id ? 'personal' : 'joint'
    const severity: Severity = days <= 14 ? 3 : 2

    // Everything still to do whose window has opened, as one card per trip.
    const due = ITEMS.filter((item) => trip[item.key] === 'todo' && item.days(trip) && days <= item.days(trip) && !hasTask(item.task(trip.name)))
    if (due.length) {
      const labels = due.map((i) => i.label.toLowerCase())
      const items = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
      const task = due.length === 1 ? due[0].task(trip.name) : `Sort out ${trip.name}: ${labels.join(', ')}`
      if (!hasTask(task)) {
        out.push({
          dedupe_key: `trip:${trip.id}:todo:${due.map((i) => i.key).join(',')}`,
          kind: 'trip_item',
          severity,
          title: due.length === 1 ? task : `${trip.name} is ${until(days)}: ${items} to sort`,
          reason: `${longDate(trip.starts_on)}. ${due.map((i) => i.hint).join(' ')} Tick each one on the trip in AI Hub → Agents → Travel once it’s sorted.`,
          task_id: null,
          action: { type: 'create_task', title: task, list, due_date: dueBy(trip.starts_on) },
          recipients,
        })
      }
    }

    // Big trips booked a long way out: ask for offers before paying full price.
    const window = DEAL_WINDOWS.find((w) => days <= w.from && days >= w.to)
    const ask = `Email 3 operators about ${trip.name} offers`
    if (window && trip.abroad && trip.transport === 'todo' && !hasTask(ask)) {
      out.push({
        dedupe_key: `trip:${trip.id}:deals:${window.key}`,
        kind: 'trip_deals',
        severity: 1,
        title: window.key === 'early' ? `${trip.name}: ask about early-booking offers` : `${trip.name}: ask again before booking`,
        reason: `Operators often have early-booking or honeymoon offers they only mention if asked. Copy this to three of them: “${dealEmail(trip, window.key !== 'early')}”`,
        task_id: null,
        action: { type: 'create_task', title: ask, list, due_date: saturday },
        recipients,
      })
    }

    if (days <= PACK_DAYS && !hasTask(`Pack for ${trip.name}`)) {
      out.push({
        dedupe_key: `trip:${trip.id}:pack`,
        kind: 'trip_item',
        severity: 2,
        title: `${trip.name} is ${until(days)}`,
        reason: 'Time to pack, and to check tickets, documents and anything at home that needs sorting while you’re away.',
        task_id: null,
        action: { type: 'create_task', title: `Pack for ${trip.name}`, list, due_date: days === 0 ? today : addDays(trip.starts_on, -1) },
        recipients,
      })
    }

    // Passports for trips abroad in the next year.
    if (!trip.abroad || days > PASSPORT_CHECK_DAYS) continue
    for (const person of recipients) {
      const passport = renewals.find((r) => /passport/i.test(r.name) && r.owner_id === person)
      if (!passport) {
        out.push({
          dedupe_key: `trip:${trip.id}:passport:${person}`,
          kind: 'trip_passport_unknown',
          severity: 1,
          title: `Is your passport OK for ${trip.name}?`,
          reason: 'Add the passport to Renewals (AI Hub → Agents → Life Admin) with its expiry date, and Travel will check it against your trips.',
          task_id: null,
          action: null,
          recipients: [person],
        })
      } else if (passport.expires_on < addDays(trip.ends_on, PASSPORT_SPARE_DAYS)) {
        const expired = passport.expires_on < trip.ends_on
        out.push({
          dedupe_key: `trip:${trip.id}:passport:${person}`,
          kind: 'trip_passport',
          severity: expired || days <= 60 ? 3 : 2,
          title: expired ? `Passport runs out before ${trip.name} ends` : `Passport has under six months left after ${trip.name}`,
          reason: `It expires on ${longDate(passport.expires_on)}. ${expired ? 'You can’t travel on it.' : 'Some countries won’t let you in with less than six months left, so check the entry rules.'} Renewing can take a few weeks.`,
          task_id: null,
          action: hasTask('Renew passport') ? null : { type: 'create_task', title: 'Renew passport', list: 'personal', due_date: saturday },
          recipients: [person],
        })
      }
    }
  }
  return out
}
