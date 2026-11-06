// Life Admin: reminders for things that expire (passport, MOT, insurance…),
// from the household's renewals list. Pure. Dates and names only; it never
// reads email or documents and never renews anything itself.
//
//   admin:<id>:<expiry>  due within the renewal's warning window, or already
//                        expired; offers a task, unless one already mentions it
//   admin:start          nothing on the list yet
//
// A personal renewal only reminds its owner; a joint one reminds both.
import { addDays, daysBetween, type ISODate, nextWeekday } from './dates.ts'
import type { OpenTask, SuggestionDraft } from './types.ts'

/** Within this many days (or past it), the reminder is urgent. */
export const URGENT_DAYS = 7

export type Renewal = {
  id: string
  name: string
  owner_id: string | null
  expires_on: ISODate
  warn_days: number
  every_months: number | null
}

export type RenewalPreset = {
  name: string
  /** Months between renewals; null when the date is set by hand each time. */
  every: number | null
  warn: number
  /** The task approving adds. */
  task: string
  hint: string
}

/** Common UK renewals, offered when adding one. The hints are general, not advice for a particular policy. */
export const RENEWAL_PRESETS: RenewalPreset[] = [
  { name: 'Passport', every: 120, warn: 180, task: 'Renew passport', hint: 'Some countries want months left on it when you travel, and renewing can take a few weeks.' },
  { name: 'Driving licence photocard', every: 120, warn: 60, task: 'Renew driving licence photocard', hint: 'The photocard needs renewing every 10 years.' },
  { name: 'MOT', every: 12, warn: 30, task: 'Book the MOT', hint: 'It can be done up to a month (less a day) early and keep the same renewal date.' },
  { name: 'Car tax', every: 12, warn: 21, task: 'Renew car tax', hint: 'Not needed if it’s paid by Direct Debit, which renews itself.' },
  { name: 'Car insurance', every: 12, warn: 28, task: 'Compare car insurance quotes', hint: 'Compare quotes before it renews automatically.' },
  { name: 'Home insurance', every: 12, warn: 28, task: 'Compare home insurance quotes', hint: 'Compare quotes before it renews automatically.' },
  { name: 'Breakdown cover', every: 12, warn: 21, task: 'Compare breakdown cover', hint: 'Compare before it renews automatically.' },
  { name: 'TV licence', every: 12, warn: 21, task: 'Renew TV licence', hint: 'Not needed if it’s paid by Direct Debit, which renews itself.' },
  { name: 'GHIC', every: 60, warn: 60, task: 'Renew GHIC', hint: 'It’s free from the NHS website; other sites charge for the same thing.' },
  { name: 'Energy fixed tariff', every: null, warn: 49, task: 'Choose a new energy tariff', hint: 'Near the end of a fix you can usually switch without exit fees.' },
  { name: 'Mortgage fixed rate', every: null, warn: 180, task: 'Look at mortgage deals', hint: 'Lenders often let you secure a new rate months before the fix ends.' },
  { name: 'Phone contract', every: null, warn: 30, task: 'Look at phone deals', hint: 'Once the contract ends, a SIM-only deal is often cheaper.' },
  { name: 'Broadband contract', every: null, warn: 30, task: 'Look at broadband deals', hint: 'Prices often rise when the contract ends.' },
]

const presetFor = (name: string) => RENEWAL_PRESETS.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "12 May 2027". */
export const longDate = (iso: ISODate) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

/** "expired 3 days ago", "expires today", "expires in 2 weeks", "expires in 5 months". */
export function whenText(days: number): string {
  if (days < -1) return `expired ${-days} days ago`
  if (days === -1) return 'expired yesterday'
  if (days === 0) return 'expires today'
  if (days === 1) return 'expires tomorrow'
  if (days < 14) return `expires in ${days} days`
  if (days < 60) return `expires in ${Math.round(days / 7)} weeks`
  return `expires in ${Math.round(days / 30.4)} months`
}

export function analyseLifeAdmin(today: ISODate, renewals: Renewal[], open: OpenTask[], enabled: string[]): SuggestionDraft[] {
  if (!enabled.length) return []
  if (!renewals.length) {
    return [
      {
        dedupe_key: 'admin:start',
        kind: 'admin_start',
        severity: 1,
        title: 'Add your renewals',
        reason: 'Passport, MOT, insurance… add them on the Life Admin card in AI Hub → Agents, and you’ll be reminded in good time.',
        task_id: null,
        action: null,
        recipients: enabled,
      },
    ]
  }

  const out: SuggestionDraft[] = []
  for (const r of [...renewals].sort((a, b) => a.expires_on.localeCompare(b.expires_on))) {
    const days = daysBetween(today, r.expires_on)
    if (days > r.warn_days) continue
    const recipients = r.owner_id ? enabled.filter((id) => id === r.owner_id) : enabled
    if (!recipients.length) continue
    const preset = presetFor(r.name)
    const taskTitle = preset?.task ?? `Renew ${r.name}`
    const name = r.name.toLowerCase()
    // Already on the list: the task is the reminder.
    if (open.some((t) => t.title.toLowerCase().includes(name) || t.title.toLowerCase() === taskTitle.toLowerCase())) continue

    const saturday = nextWeekday(today, 6)
    const due = saturday < r.expires_on ? saturday : [addDays(r.expires_on, -1), today].sort().at(-1)!
    out.push({
      dedupe_key: `admin:${r.id}:${r.expires_on}`,
      kind: 'renewal',
      severity: days <= URGENT_DAYS ? 3 : 2,
      title: `${r.name} ${whenText(days)}`,
      reason: [
        `${days < 0 ? 'It was' : 'It’s'} due on ${longDate(r.expires_on)}.`,
        preset?.hint ?? '',
        r.every_months ? 'Once it’s done, press Renewed on the Life Admin card to move the date on.' : 'Once it’s done, put the new date on the Life Admin card.',
      ]
        .filter(Boolean)
        .join(' '),
      task_id: null,
      action: { type: 'create_task', title: taskTitle, list: r.owner_id ? 'personal' : 'joint', due_date: due },
      recipients,
    })
  }
  return out
}

/** The next date after renewing: the expiry moved on by whole periods until it's in the future. */
export function renewedDate(r: Pick<Renewal, 'expires_on' | 'every_months'>, today: ISODate): ISODate | null {
  if (!r.every_months) return null
  const [year, month, d] = r.expires_on.split('-').map(Number)
  let y = year
  let m = month
  let next = r.expires_on
  while (next <= today || next === r.expires_on) {
    m += r.every_months
    y += Math.floor((m - 1) / 12)
    m = ((m - 1) % 12) + 1
    // 31 Jan + 1 month is the last day of February.
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    next = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
  }
  return next
}
