import raw from '../data/hsk.json'
import { dueForReview, levelProgress, nextToLearn, parseHsk, remainingToday } from './vocab'

const vocab = parseHsk(raw as unknown as Parameters<typeof parseHsk>[0])
const word = (text: string, level = 1) => ({ kind: 'word' as const, text, pinyin: '', meaning: '', level, examples: [] })

describe('HSK data', () => {
  it('has words for levels 1 to 6, easiest first', () => {
    const levels = vocab.words.map((w) => w.level)
    expect(new Set(levels)).toEqual(new Set([1, 2, 3, 4, 5, 6]))
    expect(levels).toEqual(levels.toSorted((a, b) => a - b))
    expect(vocab.words.find((w) => w.text === '谢谢')).toMatchObject({ pinyin: 'xiè xie', level: 1 })
  })

  it('covers every character used in the words once, either as a word or a character', () => {
    const chars = vocab.characters.map((c) => c.text)
    const singles = new Set(vocab.words.map((w) => w.text).filter((t) => t.length === 1))
    expect(new Set(chars).size).toBe(chars.length)
    expect(chars.some((c) => singles.has(c))).toBe(false)
    for (const w of vocab.words) for (const c of w.text) if (/\p{Script=Han}/u.test(c)) expect(singles.has(c) || chars.includes(c)).toBe(true)
    expect(vocab.characters.every((c) => c.pinyin && (c.meaning || c.examples.length))).toBe(true)
  })
})

describe('daily study', () => {
  const items = [word('一'), word('二'), word('三', 2), word('四', 2)]

  it('picks the next unlearned items from the starting level', () => {
    expect(nextToLearn(items, new Set(['一']), 1, 2).map((i) => i.text)).toEqual(['二', '三'])
    expect(nextToLearn(items, new Set(), 2, 5).map((i) => i.text)).toEqual(['三', '四'])
  })

  it('counts what is left of today’s target', () => {
    const progress = [
      { kind: 'word', item: '一', learned_on: '2026-10-28', due_on: '2026-10-29' },
      { kind: 'word', item: '二', learned_on: '2026-10-27', due_on: '2026-10-28' },
      { kind: 'character', item: '三', learned_on: '2026-10-28', due_on: '2026-10-29' },
    ]
    expect(remainingToday(progress, 'word', '2026-10-28', 3)).toBe(2)
    expect(remainingToday(progress, 'character', '2026-10-28', 1)).toBe(0)
  })

  it('reviews what is due, most overdue first, but not what was learned today', () => {
    const progress = [
      { kind: 'word', item: 'a', learned_on: '2026-10-20', due_on: '2026-10-28' },
      { kind: 'word', item: 'b', learned_on: '2026-10-20', due_on: '2026-10-25' },
      { kind: 'word', item: 'c', learned_on: '2026-10-20', due_on: '2026-10-29' },
      { kind: 'word', item: 'd', learned_on: '2026-10-28', due_on: '2026-10-28' },
    ]
    expect(dueForReview(progress, '2026-10-28').map((p) => p.item)).toEqual(['b', 'a'])
  })

  it('counts progress per level', () => {
    expect(levelProgress(items, new Set(['一', '三']))).toEqual([
      { level: 1, learned: 1, total: 2 },
      { level: 2, learned: 1, total: 2 },
    ])
  })
})
