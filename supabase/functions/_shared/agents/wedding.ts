// Wedding Planner: payments coming up, budget lines with no supplier,
// overspends, RSVPs to chase near the day, and a monthly progress summary.
// Pure. The checklist is ordinary tasks in the wedding category, so overdue
// checklist items are left to the Task Manager rather than flagged twice.
//
// Approving only ever adds a task ("Pay the florist"); nothing is paid.
import { addDays, daysBetween, type ISODate, nextWeekday, shortDay } from './dates.ts'
import { similarTitles } from './taskManager.ts'
import { formatPounds, type OpenTask, type SuggestionDraft } from './types.ts'

export const PAYMENT_WATCH_DAYS = 30
export const PAYMENT_URGENT_DAYS = 7
export const SUPPLIER_WATCH_DAYS = 120
export const MAX_SUPPLIER_GAPS = 3
export const RSVP_WATCH_DAYS = 90

export type BudgetItem = {
  id: string
  name: string
  category: string
  budget_minor: number
  paid_minor: number
  due_date: ISODate | null
  supplier_id: string | null
}

export type WeddingInput = {
  today: ISODate
  date: ISODate | null
  /** Only the month is known; date is the 1st of it. */
  dateApprox?: boolean
  categoryId: string | null
  budget: BudgetItem[]
  /** Role and name only; contact details are never loaded. */
  suppliers: { id: string; role: string; name: string }[]
  /** RSVP state only. */
  guests: { rsvp: string }[]
  checklist: { open: OpenTask[]; done: number }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthName = (iso: ISODate) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

export function analyseWedding(w: WeddingInput, enabled: string[]): SuggestionDraft[] {
  if (!enabled.length) return []
  const out: Omit<SuggestionDraft, 'recipients'>[] = []
  const saturday = nextWeekday(w.today, 6)
  const hasTask = (title: string) => w.checklist.open.some((t) => similarTitles(t.title, title))
  const daysToGo = w.date ? daysBetween(w.today, w.date) : null
  const monthsToGo = daysToGo !== null ? Math.round(daysToGo / 30.4) : null
  const task = (title: string, due: ISODate) =>
    ({ type: 'create_task', title, list: 'joint', due_date: due, category_id: w.categoryId, needs_both: false }) as const

  if (!w.date && !hasTask('Set the wedding date')) {
    out.push({
      dedupe_key: 'wedding:date',
      kind: 'set_date',
      severity: 2,
      title: 'The wedding date isn’t set',
      reason: 'Payment and checklist timing work from it. Once you have it, set it in Wedding settings.',
      task_id: null,
      action: task('Set the wedding date', saturday),
    })
  }

  for (const item of w.budget) {
    const left = item.budget_minor - item.paid_minor
    if (!item.due_date || left <= 0 || daysBetween(w.today, item.due_date) > PAYMENT_WATCH_DAYS) continue
    const days = daysBetween(w.today, item.due_date)
    const supplier = w.suppliers.find((s) => s.id === item.supplier_id)
    const title = `Pay ${item.name}`
    if (hasTask(title)) continue
    out.push({
      dedupe_key: `wedding:pay:${item.id}:${item.due_date}`,
      kind: 'payment',
      severity: days <= PAYMENT_URGENT_DAYS ? 3 : 2,
      title: `${item.name} payment ${days < 0 ? 'was due' : 'due'} ${shortDay(item.due_date, w.today)}`,
      reason: `${formatPounds(left)} left to pay${supplier ? ` to ${supplier.name}` : ''}. Approving adds a task to pay it; nothing is paid.`,
      task_id: null,
      action: task(title, days > 0 ? item.due_date : w.today),
    })
  }

  // Within a year, suppliers and invitations need the real day.
  if (w.date && w.dateApprox && daysToGo !== null && daysToGo <= 365 && !hasTask('Confirm the exact wedding date')) {
    out.push({
      dedupe_key: 'wedding:exact-date',
      kind: 'set_date',
      severity: 2,
      title: 'Time to fix the exact wedding date',
      reason: `It's set as around ${monthName(w.date)}, about ${monthsToGo} months away. Venues, suppliers and save-the-dates need the actual day.`,
      task_id: null,
      action: task('Confirm the exact wedding date', saturday),
    })
  }

  // Lines with money set aside but nobody booked, soonest first.
  out.push(
    ...w.budget
      .filter((i) => i.budget_minor > 0 && !i.supplier_id && i.paid_minor === 0)
      .filter((i) => (i.due_date && daysBetween(w.today, i.due_date) <= SUPPLIER_WATCH_DAYS) || (daysToGo !== null && daysToGo <= 365))
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || b.budget_minor - a.budget_minor)
      .filter((i) => !hasTask(`Get quotes for ${i.name}`))
      .slice(0, MAX_SUPPLIER_GAPS)
      .map((i) => ({
        dedupe_key: `wedding:supplier:${i.id}`,
        kind: 'supplier',
        severity: 1 as const,
        title: `No supplier for ${i.name} yet`,
        reason: `${formatPounds(i.budget_minor)} is budgeted${i.due_date ? `, first payment ${shortDay(i.due_date, w.today)}` : ''}. Quotes and contacts go in Wedding → Suppliers.`,
        task_id: null,
        action: task(`Get quotes for ${i.name}`, saturday),
      })),
  )

  for (const item of w.budget) {
    if (item.budget_minor <= 0 || item.paid_minor <= item.budget_minor) continue
    out.push({
      dedupe_key: `wedding:over:${item.id}`,
      kind: 'over_budget',
      severity: 1,
      title: `${item.name} is over budget`,
      reason: `Paid ${formatPounds(item.paid_minor)} against ${formatPounds(item.budget_minor)} budgeted, ${formatPounds(item.paid_minor - item.budget_minor)} over.`,
      task_id: null,
      action: null,
    })
  }

  const pending = w.guests.filter((g) => g.rsvp === 'pending').length
  if (!w.dateApprox && daysToGo !== null && daysToGo >= 0 && daysToGo <= RSVP_WATCH_DAYS && pending && !hasTask('Chase RSVPs')) {
    out.push({
      dedupe_key: `wedding:rsvp:${w.today.slice(0, 7)}`,
      kind: 'rsvp',
      severity: daysToGo <= 45 ? 3 : 2,
      title: `${pending} ${pending === 1 ? 'guest hasn’t' : 'guests haven’t'} replied`,
      reason: `${daysToGo} days to go, and numbers are needed for the venue and caterer.`,
      task_id: null,
      action: task('Chase RSVPs', addDays(w.today, 1) < saturday ? addDays(w.today, 1) : saturday),
    })
  }

  const total = w.checklist.open.length + w.checklist.done
  const budget = w.budget.reduce((n, i) => n + i.budget_minor, 0)
  if (total || budget) {
    const soon = w.checklist.open.filter((t) => t.due_date && t.due_date >= w.today && t.due_date <= addDays(w.today, 30)).length
    const late = w.checklist.open.filter((t) => t.due_date && t.due_date < w.today).length
    const paid = w.budget.reduce((n, i) => n + i.paid_minor, 0)
    out.push({
      dedupe_key: `wedding:summary:${w.today.slice(0, 7)}`,
      kind: 'wedding_summary',
      severity: 1,
      title: `Wedding: ${w.checklist.done} of ${total} checklist items done${
        daysToGo === null || daysToGo < 0 ? '' : w.dateApprox ? `, about ${monthsToGo} months to go` : `, ${daysToGo} days to go`
      }`,
      reason: [
        `${soon} due in the next 30 days${late ? `, ${late} overdue` : ''}.`,
        budget ? `${formatPounds(paid)} of ${formatPounds(budget)} paid.` : '',
        w.guests.length ? `${pending} of ${w.guests.length} guests still to reply.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      task_id: null,
      action: null,
    })
  }

  // The wedding is joint: everyone who has the planner on sees it all.
  return out.map((s) => ({ ...s, recipients: enabled }))
}
