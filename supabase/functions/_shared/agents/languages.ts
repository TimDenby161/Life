// Language Coach: reads each person's spaced-repetition progress (the
// Languages page does the teaching and scheduling) and points out what the
// schedule alone doesn't: a review pile-up, words that keep slipping, and a
// language left alone for days. It never introduces new words, so nothing
// already mastered comes back through it. Pure; each person hears only about
// their own languages.
import { daysBetween, type ISODate, isoWeekKey, shortDay } from './dates.ts'
import type { SuggestionDraft } from './types.ts'

export const BACKLOG_REVIEWS = 20
export const WEAK_LAPSES = 2
/** Still at a short interval, so it hasn't stuck yet. */
export const WEAK_MAX_INTERVAL = 3
export const MAX_WEAK = 5
export const STALLED_DAYS = 5

export const LANGUAGE_NAMES: Record<string, string> = { zh: 'Mandarin', es: 'Spanish' }

export type Study = { user_id: string; language: string; active: boolean }
export type Progress = {
  user_id: string
  language: string
  item: string
  learned_on: ISODate
  due_on: ISODate
  interval_days: number
  lapses: number
  last_reviewed_on: ISODate | null
}

export function analyseLanguages(today: ISODate, study: Study[], progress: Progress[], enabled: string[]): SuggestionDraft[] {
  const out: SuggestionDraft[] = []
  for (const s of study) {
    if (!s.active || !enabled.includes(s.user_id)) continue
    const lang = LANGUAGE_NAMES[s.language] ?? s.language
    const mine = progress.filter((p) => p.user_id === s.user_id && p.language === s.language)
    if (!mine.length) continue
    const base = { task_id: null, recipients: [s.user_id] }
    const prefix = `lang:${s.user_id.slice(0, 8)}:${s.language}`

    const due = mine.filter((p) => p.due_on <= today).length
    if (due >= BACKLOG_REVIEWS) {
      out.push({
        ...base,
        dedupe_key: `${prefix}:backlog:${isoWeekKey(today)}`,
        kind: 'reviews_due',
        severity: 2,
        title: `${due} ${lang} reviews waiting`,
        reason: 'A pile-up makes it easy to give up. Ten minutes a day on reviews only, no new words, brings it down within a week.',
        action: null,
      })
    }

    const weak = mine
      .filter((p) => p.lapses >= WEAK_LAPSES && p.interval_days <= WEAK_MAX_INTERVAL)
      .sort((a, b) => b.lapses - a.lapses || a.item.localeCompare(b.item))
      .slice(0, MAX_WEAK)
    if (weak.length) {
      const items = weak.map((p) => p.item)
      out.push({
        ...base,
        dedupe_key: `${prefix}:weak:${[...items].sort().join(',')}`.slice(0, 120),
        kind: 'weak_words',
        severity: 1,
        title: `${weak.length} ${lang} ${weak.length === 1 ? 'word keeps' : 'words keep'} slipping`,
        reason: `${items.join(', ')}: forgotten ${weak.reduce((n, p) => n + p.lapses, 0)} times between them. A few minutes of focused revision helps more than waiting for the next review.`,
        action: { type: 'create_task', title: `Revise ${lang}: ${items.join(', ')}`.slice(0, 200), list: 'personal', due_date: today },
      })
    }

    const last = mine.reduce((d, p) => [d, p.learned_on, p.last_reviewed_on ?? ''].sort().at(-1)!, '')
    const idle = daysBetween(last, today)
    if (idle >= STALLED_DAYS) {
      out.push({
        ...base,
        dedupe_key: `${prefix}:stalled:${last}`,
        kind: 'lang_stalled',
        severity: 1,
        title: `No ${lang} for ${idle} days`,
        reason: `Last practised ${shortDay(last, today)}${due ? `, and ${due} reviews are waiting` : ''}. One short review session is enough to restart.`,
        action: null,
      })
    }
  }
  return out
}
