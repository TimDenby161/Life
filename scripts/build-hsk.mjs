// Builds src/modules/languages/data/hsk.json from drkameleon/complete-hsk-vocabulary
// (MIT; definitions from CC-CEDICT, CC BY-SA 4.0).
//
//   node scripts/build-hsk.mjs                 downloads complete.json at the pinned commit
//   node scripts/build-hsk.mjs path/to/complete.json
//
// Words: HSK 3.0 levels 1-6 from the repo's "newest" lists, ordered by level and
// then frequency. Characters: those used in the words that aren't words
// themselves, in the order they first appear, with their own reading and
// meaning where the list has one.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const COMMIT = '7ac65bf1a6387d35f1ade478906172a19311c7f9'
const URL = `https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/${COMMIT}/complete.json`
const MAX_LEVEL = 6
const out = join(dirname(fileURLToPath(import.meta.url)), '../src/modules/languages/data/hsk.json')

const entries = process.argv[2]
  ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
  : await fetch(URL).then((r) => {
      if (!r.ok) throw new Error(`Download failed: ${r.status}`)
      return r.json()
    })

const levelOf = (entry) => {
  const levels = entry.level.filter((l) => l.startsWith('newest-')).map((l) => Number(l.slice(7)))
  return levels.length ? Math.min(...levels) : null
}

// Readings worth teaching: not surnames, variants or "used in X". The list
// order isn't by how common a reading is (说 lists shuì before shuō), so a
// grammar particle wins (了 le, 着 zhe), then the reading with most meanings.
const minor = (f) => f.meanings.every((m) => /^(surname|(unofficial |old )?variant of|used in|see )/i.test(m))
const particle = (f) => f.meanings.some((m) => /particle|marker/i.test(m))
function readings(entry) {
  const forms = entry.forms.filter((f) => !minor(f))
  if (!forms.length) return [entry.forms[0]]
  return forms.toSorted((a, b) => Number(particle(b)) - Number(particle(a)) || b.meanings.length - a.meanings.length)
}
const mainForm = (entry) => readings(entry)[0]
const lower = (f) => f.transcriptions.pinyin.toLowerCase()

function shorten(text, max) {
  if (text.length <= max) return text
  const cut = text.lastIndexOf('; ', max)
  return cut > 20 ? text.slice(0, cut) : `${text.slice(0, max - 3)}…`
}

// The main reading's first two meanings, plus a second common reading if there is one.
function meaning(entry, main = mainForm(entry)) {
  let text = shorten(main.meanings.slice(0, 2).join('; '), 90)
  const other = readings(entry).find((f) => f !== main && f.meanings.length >= 2 && lower(f) !== lower(main))
  if (other) text += ` (also ${other.transcriptions.pinyin}: ${shorten(other.meanings[0], 30)})`
  return text
}

const words = entries
  .map((e, i) => ({ e, i, level: levelOf(e) }))
  .filter((w) => w.level !== null && w.level <= MAX_LEVEL)
  .sort((a, b) => a.level - b.level || (a.e.frequency ?? 1e9) - (b.e.frequency ?? 1e9) || a.i - b.i)

const singles = new Map()
for (const e of entries) if ([...e.simplified].length === 1 && !singles.has(e.simplified)) singles.set(e.simplified, e)

// Characters that are HSK words on their own (的, 我) are learned as words, so
// the character list is the rest: ones met inside words (们, 话).
const singleWords = new Set(words.map(({ e }) => e.simplified).filter((s) => [...s].length === 1))
// How each character is read inside the words: 没 is méi in 没有, not mò.
const sounds = new Map()
for (const { e } of words) {
  const chars = [...e.simplified]
  const syllables = mainForm(e).transcriptions.pinyin.toLowerCase().split(' ')
  if (syllables.length !== chars.length) continue
  chars.forEach((c, i) => {
    const counts = sounds.get(c) ?? new Map()
    counts.set(syllables[i], (counts.get(syllables[i]) ?? 0) + 1)
    sounds.set(c, counts)
  })
}
const usualSound = (c) => [...(sounds.get(c) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''

const characters = new Map()
for (const { e, level } of words) {
  for (const c of e.simplified) {
    if (!/\p{Script=Han}/u.test(c) || singleWords.has(c)) continue
    let ch = characters.get(c)
    if (!ch) {
      const own = singles.get(c)
      const sound = usualSound(c)
      const form = own && (own.forms.find((f) => !minor(f) && lower(f) === sound) ?? mainForm(own))
      ch = {
        c,
        pinyin: form ? lower(form) : sound,
        meaning: form ? meaning(own, form) : '',
        level,
        examples: [],
      }
      characters.set(c, ch)
    }
    if (ch.examples.length < 3) ch.examples.push(e.simplified)
  }
}

const data = {
  source: `complete-hsk-vocabulary@${COMMIT.slice(0, 7)} (MIT); definitions CC-CEDICT (CC BY-SA 4.0)`,
  // [simplified, pinyin, meaning, level]
  words: words.map(({ e, level }) => {
    return [e.simplified, mainForm(e).transcriptions.pinyin, meaning(e), level]
  }),
  // [character, pinyin, meaning, level, example words]
  characters: [...characters.values()].map((c) => [c.c, c.pinyin, c.meaning, c.level, c.examples]),
}

writeFileSync(out, JSON.stringify(data))
console.info(`${data.words.length} words, ${data.characters.length} characters → ${out}`)
