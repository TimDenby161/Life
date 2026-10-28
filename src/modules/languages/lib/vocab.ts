// The study lists and what to learn or review today. Pure: no data fetching.
import type { ISODate } from '@/lib/dates'

export type Kind = 'word' | 'character'

export type VocabItem = {
  kind: Kind
  text: string
  pinyin: string
  /** Empty for characters that only appear inside words; show `examples` instead. */
  meaning: string
  level: number
  examples: string[]
}

export type Vocab = { source: string; words: VocabItem[]; characters: VocabItem[] }

type RawHsk = {
  source: string
  words: [string, string, string, number][]
  characters: [string, string, string, number, string[]][]
}

export function parseHsk(raw: RawHsk): Vocab {
  return {
    source: raw.source,
    words: raw.words.map(([text, pinyin, meaning, level]) => ({ kind: 'word', text, pinyin, meaning, level, examples: [] })),
    characters: raw.characters.map(([text, pinyin, meaning, level, examples]) => ({ kind: 'character', text, pinyin, meaning, level, examples })),
  }
}

/** HSK words and characters (levels 1-6), loaded on demand: it's a few hundred KB. */
export async function loadHsk(): Promise<Vocab> {
  const raw = (await import('../data/hsk.json')).default as unknown as RawHsk
  return parseHsk(raw)
}

export type ProgressRow = { kind: string; item: string; learned_on: ISODate; due_on: ISODate }

/** The next `count` items not yet learned, from `startLevel` up, in list order. */
export function nextToLearn(items: VocabItem[], learned: ReadonlySet<string>, startLevel: number, count: number): VocabItem[] {
  const out: VocabItem[] = []
  for (const item of items) {
    if (out.length >= count) break
    if (item.level >= startLevel && !learned.has(item.text)) out.push(item)
  }
  return out
}

/** How many still to learn today to reach the daily target. */
export function remainingToday(progress: ProgressRow[], kind: Kind, today: ISODate, perDay: number): number {
  const learnedToday = progress.filter((p) => p.kind === kind && p.learned_on === today).length
  return Math.max(0, perDay - learnedToday)
}

/** Items due for review today, most overdue first. Things learned today wait until tomorrow. */
export function dueForReview<T extends ProgressRow>(progress: T[], today: ISODate): T[] {
  return progress.filter((p) => p.due_on <= today && p.learned_on < today).toSorted((a, b) => a.due_on.localeCompare(b.due_on))
}

/** Learned / total per HSK level, for the progress bars. */
export function levelProgress(items: VocabItem[], learned: ReadonlySet<string>) {
  const levels = new Map<number, { level: number; learned: number; total: number }>()
  for (const item of items) {
    const row = levels.get(item.level) ?? { level: item.level, learned: 0, total: 0 }
    row.total += 1
    if (learned.has(item.text)) row.learned += 1
    levels.set(item.level, row)
  }
  return [...levels.values()].sort((a, b) => a.level - b.level)
}
