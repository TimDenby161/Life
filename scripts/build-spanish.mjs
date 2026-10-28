// Builds src/modules/languages/data/spanish.json: the most common Spanish words
// as Latin Americans use them, with English meanings.
//
//   node scripts/build-spanish.mjs <es_50k.txt> <kaikki-spanish.jsonl>
//
// Sources (download them first; the Wiktionary file is ~1 GB, so it isn't fetched here):
//   * Frequency: hermitdave/FrequencyWords@525f9b5, content/2018/es/es_50k.txt
//     (OpenSubtitles; MIT).
//   * Meanings: Wiktionary via kaikki.org, dictionary/Spanish/kaikki.org-dictionary-Spanish.jsonl
//     (CC BY-SA 4.0). Filtering it to the 50k words first keeps it small.
//
// Every inflected form counts towards its dictionary word (quiero → querer), the
// word takes the rank of its most common form, and only real words survive:
// no names, abbreviations or English. Meanings used only outside Latin America
// (ordenador "computer" in Spain) are dropped; obsolete, rare and vulgar ones too.
import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const [freqPath, dictPath] = process.argv.slice(2)
if (!freqPath || !dictPath) throw new Error('Usage: node scripts/build-spanish.mjs <es_50k.txt> <kaikki-spanish.jsonl>')
const out = join(dirname(fileURLToPath(import.meta.url)), '../src/modules/languages/data/spanish.json')

const LIMIT = 5000
// Bands by how common a word is, standing in for levels: [upper rank, label].
export const BANDS = [250, 500, 1000, 2000, 3500, LIMIT]

const POS = {
  noun: 'noun', verb: 'verb', adj: 'adjective', adv: 'adverb', pron: 'pronoun', prep: 'preposition',
  conj: 'conjunction', det: 'determiner', article: 'article', intj: 'interjection', num: 'number', contraction: 'contraction',
}
const LATAM = new Set([
  'Latin-America', 'Americas', 'Mexico', 'Central-America', 'Caribbean', 'Cuba', 'Puerto-Rico', 'Dominican-Republic',
  'Guatemala', 'Honduras', 'El-Salvador', 'Nicaragua', 'Costa-Rica', 'Panama', 'Venezuela', 'Colombia', 'Ecuador',
  'Peru', 'Bolivia', 'Chile', 'Argentina', 'Uruguay', 'Paraguay', 'Rioplatense', 'Andes', 'US', 'United-States',
])
const SKIP_TAGS = new Set([
  'abbreviation', 'ellipsis', 'obsolete', 'archaic', 'dated', 'rare', 'vulgar', 'derogatory',
  'offensive', 'slang', 'historical', 'misspelling', 'nonstandard', 'pejorative', 'euphemistic',
])
// Verb forms that are also rare nouns or words (era: an era, son: a Cuban dance):
// they count only for their verb.
const VERB_FORMS = new Set(['era', 'son', 'sé', 'he', 'ha', 'has', 'fue', 'fui', 've', 'va', 'vi', 'van', 'haya', 'sea', 'dije', 'había'])

// Grammar words are mostly "forms of" others (mi: apocopic form of mío, my), so
// for these the form's own gloss is the meaning.
const CLOSED = new Set(['pron', 'article', 'contraction'])
const regions = (tags) => tags.filter((t) => /^[A-Z]/.test(t))
const latinAmerican = (tags) => !regions(tags).length || regions(tags).some((t) => LATAM.has(t))
// A meaning tagged with a few countries (perro: clothes peg in Chile) is a local
// extra, not the main meaning; one tagged for Latin America as a whole isn't.
const local = (tags) => regions(tags).length > 0 && !regions(tags).some((t) => t === 'Latin-America' || t === 'Americas')
function usable(sense, pos) {
  const tags = sense.tags ?? []
  if (!sense.glosses?.length || !latinAmerican(tags)) return false
  // Wiktionary calls some everyday Latin American words dated (lindo); trust the region.
  if (tags.some((t) => SKIP_TAGS.has(t) && !(t === 'dated' && regions(tags).some((r) => LATAM.has(r))))) return false
  if ((tags.includes('form-of') || tags.includes('alt-of')) && !CLOSED.has(pos)) return false
  return !/(Latin script letter|Greek letter)/.test(sense.glosses.at(-1))
}
// Grammar words whose Wiktionary entries don't make a usable meaning.
const OVERRIDES = {
  el: ['article', 'the (masculine)'],
  la: ['article', 'the (feminine); her, it'],
  los: ['article', 'the (masculine plural); them'],
  las: ['article', 'the (feminine plural); them'],
  una: ['article', 'a, an (feminine); one'],
  al: ['contraction', 'to the (a + el)'],
  mi: ['determiner', 'my'],
  tu: ['determiner', 'your (informal)'],
  su: ['determiner', 'his, her, its, their; your (formal)'],
  sí: ['adverb', 'yes'],
  me: ['pronoun', 'me, to me, myself'],
  te: ['pronoun', 'you, to you, yourself (informal)'],
  se: ['pronoun', 'himself, herself, itself, themselves; each other'],
  lo: ['pronoun', 'it, him; the (lo bueno: the good thing)'],
  le: ['pronoun', 'to him, to her, to you (formal)'],
  esto: ['pronoun', 'this'],
  eso: ['pronoun', 'that'],
  esta: ['determiner', 'this (feminine)'],
  sus: ['determiner', 'his, her, its, their, your (formal), before a plural'],
}
// Fine in Spain, rude in much of Latin America.
const NOTES = {
  coger: 'careful: vulgar in much of Latin America; say tomar or agarrar',
  concha: 'careful: vulgar in parts of South America',
  bicho: 'careful: vulgar in Puerto Rico',
}
// Feminine nouns starting with a stressed a take el: el agua.
const STRESSED_A = new Set(['agua', 'alma', 'área', 'arma', 'hambre', 'águila', 'hacha', 'aula', 'ala', 'ancla', 'alga', 'hada', 'asma', 'arca'])
const shorten = (text, max) => {
  if (text.length <= max) return text
  const cut = Math.max(text.lastIndexOf(', ', max), text.lastIndexOf(' (', max))
  return cut > 15 ? text.slice(0, cut) : `${text.slice(0, max - 1)}…`
}

const rank = new Map()
readFileSync(freqPath, 'utf8')
  .split('\n')
  .forEach((line, i) => {
    const word = line.split(' ')[0]
    if (word && !rank.has(word)) rank.set(word, i)
  })

// The dictionary file holds the 50k words plus the dictionary words their
// forms point to (platicar is rare in subtitles; platicamos isn't).
const entries = new Map() // word → dictionary entries with a part of speech we teach
const formOf = new Map() // inflected form → dictionary words
for await (const line of createInterface({ input: createReadStream(dictPath) })) {
  const e = JSON.parse(line)
  for (const s of e.senses ?? []) for (const f of s.form_of ?? []) {
    if (!formOf.has(e.word)) formOf.set(e.word, new Set())
    formOf.get(e.word).add(f.word)
  }
  if (!POS[e.pos]) continue
  if (!entries.has(e.word)) entries.set(e.word, [])
  entries.get(e.word).push(e)
}

// Wiktionary's order (main meanings first), with local meanings and usage
// notes ("Used as...") moved behind the plain ones.
function senses(word) {
  return (entries.get(word) ?? [])
    .flatMap((e) => (e.senses ?? []).filter((s) => usable(s, e.pos)).map((s) => ({ e, s })))
    .map((x, i) => ({ ...x, i, score: (local(x.s.tags ?? []) ? 2 : 0) + (/^[A-Z]/.test(x.s.glosses.at(-1)) ? 1 : 0) }))
    .sort((a, b) => a.score - b.score || a.i - b.i)
}

function describe(word) {
  if (OVERRIDES[word]) return { reading: OVERRIDES[word][0], meaning: OVERRIDES[word][1] }
  const list = senses(word)
  if (!list.length) return null
  const { e: main, s: first } = list[0]
  let reading = POS[main.pos]
  if (main.pos === 'noun') {
    const tags = list.filter((x) => x.e === main).flatMap((x) => x.s.tags ?? [])
    const head = main.head_templates?.[0]?.args ?? {}
    const plural = /p/.test(`${head['1'] ?? ''}${head.g ?? ''}`) && !/^[mf]+$/.test(head['1'] ?? 'x')
    const masc = (first.tags ?? []).includes('masculine') || (!first.tags?.includes('feminine') && tags.includes('masculine'))
    const fem = (first.tags ?? []).includes('feminine') || (!first.tags?.includes('masculine') && tags.includes('feminine'))
    const article = masc && fem ? (plural ? 'los/las' : 'el/la') : fem ? (plural ? 'las' : STRESSED_A.has(word) ? 'el' : 'la') : masc ? (plural ? 'los' : 'el') : ''
    if (article) reading = `${article} ${word}`
  }
  const glosses = []
  for (const { s } of list) {
    const g = shorten(s.glosses.at(-1).replace(/\s+/g, ' ').trim().replace(/\.$/, ''), 60)
    if (!glosses.includes(g)) glosses.push(g)
    if (glosses.length === 2) break
  }
  let meaning = glosses.join('; ')
  if (NOTES[word]) meaning += ` (${NOTES[word]})`
  return { reading, meaning }
}

// Each dictionary word takes the rank of its most common form. A word with
// meanings of its own counts only for itself (para, casa: not parar, casar).
// Other forms count for their dictionary word, but only when there's one:
// creo is creer or crear, so it counts for neither (creer has cree, crees...).
// An interjection on a verb form doesn't make it a word (sabes "you know?").
const best = new Map()
const credit = (word, r) => {
  if (!best.has(word) || best.get(word) > r) best.set(word, r)
}
const isVerb = (word) => (entries.get(word) ?? []).some((e) => e.pos === 'verb' && senses(word).some((x) => x.e === e))
for (const [word, r] of rank) {
  const lemmas = [...(formOf.get(word) ?? [])].filter((l) => l !== word)
  const own = senses(word).filter((x) => x.e.pos !== 'intj' || !lemmas.some(isVerb))
  if (OVERRIDES[word] || (own.length && !VERB_FORMS.has(word))) credit(word, r)
  else if (lemmas.length === 1) credit(lemmas[0], r)
}

const words = []
for (const [word] of [...best].sort((a, b) => a[1] - b[1])) {
  if (words.length >= LIMIT) break
  if (word.length < 1 || /[^a-záéíóúüñ-]/i.test(word)) continue
  const d = describe(word)
  if (!d) continue
  const level = BANDS.findIndex((upper) => words.length < upper) + 1
  words.push([word, d.reading, d.meaning, level])
}

const data = {
  source: 'FrequencyWords@525f9b5 (MIT); meanings Wiktionary via kaikki.org (CC BY-SA 4.0)',
  // [word, reading (article or part of speech), meaning, band]
  words,
  characters: [],
}
writeFileSync(out, JSON.stringify(data))
console.info(`${words.length} words → ${out}`)
