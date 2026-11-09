// Language Coach: reads each person's spaced-repetition progress (the
// Languages page does the teaching and scheduling) and points out what the
// schedule alone doesn't: a review pile-up, words that keep slipping, and a
// language left alone for days. It never introduces new words, so nothing
// already mastered comes back through it. Pure; each person hears only about
// their own languages.
//
// With a target (a language, a date and what it's for, e.g. Spanish by
// Guatemala), each week brings one speaking topic for the language whose
// target comes first; the others keep to reviews until then. A target more
// than six months out also gets a monthly nudge to speak with a real person.
import { addDays, daysBetween, type ISODate, isoWeekKey, shortDay } from './dates.ts'
import type { SuggestionDraft } from './types.ts'

export const BACKLOG_REVIEWS = 20
export const WEAK_LAPSES = 2
/** Still at a short interval, so it hasn't stuck yet. */
export const WEAK_MAX_INTERVAL = 3
export const MAX_WEAK = 5
export const STALLED_DAYS = 5

export const LANGUAGE_NAMES: Record<string, string> = { zh: 'Mandarin', es: 'Spanish' }
export const SPEAKING_FROM_DAYS = 183

/** Speaking topics in the order travel needs them, one a week. */
export const TOPICS: Record<string, string[]> = {
  es: [
    'greetings and introducing yourself',
    'numbers and prices',
    'ordering food and drink',
    'directions and getting around',
    'checking in at a hotel',
    'shopping and markets',
    'buses, shuttles and tickets',
    'asking someone to repeat or slow down',
    'small talk: where you’re from, work, family',
    'times, days and booking a tour',
    'health, pharmacy and emergencies',
    'weather, plans and the day ahead',
  ],
  zh: [
    'greetings and introducing yourself',
    'numbers, money and prices',
    'ordering food and drink',
    'taxis, the metro and directions',
    'checking in at a hotel',
    'shopping and bargaining',
    'times, dates and making plans',
    'family and work',
    'hobbies and what you like',
    'tone pairs: say ten two-syllable words aloud',
    'asking someone to repeat or slow down',
    'travel plans and places in China',
    'measure words you use every day',
    'telling a short story about your week',
  ],
}

export type LanguageTarget = { language: string; by: ISODate; label: string }

/** Targets as saved in agent_settings.config, cleaned. */
export function parseLanguageTargets(config: unknown): LanguageTarget[] {
  const t = (config as { targets?: unknown } | null)?.targets
  return (Array.isArray(t) ? t : [])
    .map((x) => x as { language?: unknown; by?: unknown; label?: unknown })
    .filter((x) => typeof x.language === 'string' && x.language in LANGUAGE_NAMES && typeof x.by === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.by))
    .slice(0, 4)
    .map((x) => ({ language: x.language as string, by: x.by as ISODate, label: typeof x.label === 'string' ? x.label.trim().slice(0, 40) : '' }))
}

const weeksTo = (today: ISODate, date: ISODate) => Math.max(0, Math.round(daysBetween(today, date) / 7))
const until = (today: ISODate, date: ISODate) => {
  const weeks = weeksTo(today, date)
  return weeks >= 17 ? `${Math.round(weeks / 4.35)} months` : `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`
}

/** This week's topic and the speaking nudge, for each person's targets. */
export function analyseTargets(today: ISODate, enabled: string[], targetsFor: (userId: string) => LanguageTarget[]): SuggestionDraft[] {
  const out: SuggestionDraft[] = []
  const week = isoWeekKey(today)
  const weekNo = Number(week.slice(-2))
  for (const person of enabled) {
    const targets = targetsFor(person).filter((t) => t.by >= today).sort((a, b) => a.by.localeCompare(b.by))
    const focus = targets[0]
    if (!focus) continue
    const lang = LANGUAGE_NAMES[focus.language]
    const topics = TOPICS[focus.language]
    // The last weeks before the target run through the topics in order, ending
    // with the last; further out they rotate by week.
    const weeksLeft = weeksTo(today, focus.by)
    const topic = topics[weeksLeft <= topics.length ? Math.max(0, topics.length - weeksLeft) : weekNo % topics.length]
    const others = [...new Set(targets.slice(1).map((t) => LANGUAGE_NAMES[t.language]).filter((l) => l !== lang))]
    const what = focus.label || shortDay(focus.by, today)
    out.push({
      dedupe_key: `lang:${person.slice(0, 8)}:${focus.language}:topic:${week}`,
      kind: 'lang_topic',
      severity: 1,
      title: `${what} in ${until(today, focus.by)}: this week’s ${lang} is ${topic}`,
      reason: [
        'Learn ten useful phrases for it and say them aloud, then use them in a made-up conversation.',
        others.length ? `Keep ${others.join(' and ')} to reviews until then.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      task_id: null,
      action: { type: 'create_task', title: `${lang}: ${topic} phrases (15 min)`, list: 'personal', due_date: today },
      recipients: [person],
    })
    if (daysBetween(today, focus.by) >= SPEAKING_FROM_DAYS && Number(today.slice(8, 10)) <= 7) {
      out.push({
        dedupe_key: `lang:${person.slice(0, 8)}:${focus.language}:speak:${today.slice(0, 7)}`,
        kind: 'lang_speak',
        severity: 1,
        title: `Speak ${lang} with a real person this month`,
        reason: 'Conversation is what reviews can’t train. A 30-minute online lesson or a language exchange once a month makes the words come out when you need them.',
        task_id: null,
        action: { type: 'create_task', title: `Book a 30-min ${lang} conversation`, list: 'personal', due_date: addDays(today, 3) },
        recipients: [person],
      })
    }
  }
  return out
}

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
