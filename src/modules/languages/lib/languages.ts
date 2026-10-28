// The languages the app teaches. Word lists load on demand (a few hundred KB each).
import { type Kind, parseVocab, type RawVocab, type Vocab } from './vocab'

export type Language = 'zh' | 'es'

export type LanguageConfig = {
  name: string
  description: string
  credit: string
  /** BCP 47 tag for text-to-speech and the lang attribute. */
  speech: string
  hasCharacters: boolean
  levels: number[]
  levelLabel: (level: number) => string
  levelsTitle: string
  /** Finds a person's jobs for this language by name, before they link any. */
  jobPattern: RegExp
  defaults: { words_per_day: number; characters_per_day: number }
  /** Large type for characters, smaller for Spanish words that can be long. */
  big: string
  load: () => Promise<Vocab>
}

const SPANISH_BANDS = ['Top 250', '251–500', '501–1,000', '1,001–2,000', '2,001–3,500', '3,501–5,000']

export const LANGUAGES: Record<Language, LanguageConfig> = {
  zh: {
    name: 'Mandarin',
    description: 'HSK words and characters, a few a day, with reviews spaced out so they stick.',
    credit: 'Word lists: HSK 3.0 (2025 syllabus) from complete-hsk-vocabulary. Definitions from CC-CEDICT (CC BY-SA 4.0).',
    speech: 'zh-CN',
    hasCharacters: true,
    levels: [1, 2, 3, 4, 5, 6],
    levelLabel: (l) => `HSK ${l}`,
    levelsTitle: 'HSK levels',
    jobPattern: /mandarin|chinese/i,
    defaults: { words_per_day: 3, characters_per_day: 2 },
    big: 'text-4xl',
    load: async () => parseVocab((await import('../data/hsk.json')).default as unknown as RawVocab),
  },
  es: {
    name: 'Spanish',
    description: 'Latin American Spanish: the most common words first, a few a day, with reviews spaced out so they stick.',
    credit: 'Word order: OpenSubtitles frequencies from FrequencyWords. Meanings from Wiktionary via kaikki.org (CC BY-SA 4.0).',
    speech: 'es-MX',
    hasCharacters: false,
    levels: [1, 2, 3, 4, 5, 6],
    levelLabel: (l) => SPANISH_BANDS[l - 1] ?? `Band ${l}`,
    levelsTitle: 'Most common words',
    jobPattern: /spanish|español/i,
    defaults: { words_per_day: 2, characters_per_day: 0 },
    big: 'text-2xl font-medium',
    load: async () => parseVocab((await import('../data/spanish.json')).default as unknown as RawVocab),
  },
}

export const LANGUAGE_IDS = Object.keys(LANGUAGES) as Language[]

/** The part of a day's study a task stands for: new words, new characters or the review. */
export type StudyPart = Kind | 'review'

/**
 * Which language and part a task is for, judged by its title and category name
 * ("Learn two Spanish words", "Mandarin review"). Null for anything else.
 */
export function studyPartOf(title: string, category = ''): { language: Language; part: StudyPart } | null {
  const language = LANGUAGE_IDS.find((l) => LANGUAGES[l].jobPattern.test(`${title} ${category}`))
  if (!language) return null
  if (/review/i.test(title)) return { language, part: 'review' }
  if (LANGUAGES[language].hasCharacters && /characters?/i.test(title)) return { language, part: 'character' }
  if (/words?/i.test(title)) return { language, part: 'word' }
  return null
}

export function isLanguage(value: string | null): value is Language {
  return !!value && value in LANGUAGES
}
