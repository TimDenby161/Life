import { cleanHeadlines, headlinesInput, MAX_SHORT_CHARS, NEWS_COUNT } from '../../../../supabase/functions/_shared/agents/headlines.ts'

const items = [
  { url: 'https://www.bbc.co.uk/news/a', title: 'Government announces sweeping changes to the way council tax is calculated in England', summary: 'More detail.' },
  { url: 'https://www.bbc.co.uk/news/b', title: 'Storm warning', summary: null },
]

describe('one-line headlines', () => {
  it('gives the routine each headline with its address as the ref', () => {
    expect(headlinesInput(items)).toEqual([
      { ref: 'https://www.bbc.co.uk/news/a', title: items[0].title, summary: 'More detail.' },
      { ref: 'https://www.bbc.co.uk/news/b', title: 'Storm warning', summary: null },
    ])
    expect(headlinesInput(Array.from({ length: 10 }, (_, i) => ({ ...items[1], url: `u${i}` })))).toHaveLength(NEWS_COUNT)
  })

  it('keeps short versions of headlines it was given', () => {
    expect(cleanHeadlines([{ ref: items[0].url, short: 'Council tax overhaul for England.' }], items)).toEqual([
      { url: items[0].url, title: items[0].title, short: 'Council tax overhaul for England' },
    ])
  })

  it('drops made-up stories, long or odd ones, and repeats', () => {
    expect(cleanHeadlines([{ ref: 'https://evil.example', short: 'Hi' }], items)).toEqual([])
    expect(cleanHeadlines([{ ref: items[1].url, short: 'x'.repeat(MAX_SHORT_CHARS + 1) }], items)).toEqual([])
    expect(cleanHeadlines([{ ref: items[1].url, short: 'See https://x.y' }], items)).toEqual([])
    expect(cleanHeadlines([{ ref: items[1].url, short: 'Storm' }, { ref: items[1].url, short: 'Storm again' }], items)).toHaveLength(1)
    expect(cleanHeadlines('nope', items)).toEqual([])
  })
})
