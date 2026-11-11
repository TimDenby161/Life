import { asLink, nameFromLink } from '../components/WeddingPlan'

describe('venue links', () => {
  it('keeps web links, adding https to a bare address', () => {
    expect(asLink('https://www.hothorpehall.co.uk/weddings')).toBe('https://www.hothorpehall.co.uk/weddings')
    expect(asLink(' www.example.com ')).toBe('https://www.example.com/')
    expect(asLink('example.co.uk/barn')).toBe('https://example.co.uk/barn')
  })

  it('refuses anything that is not a web link', () => {
    expect(asLink('javascript:alert(1)')).toBeNull()
    expect(asLink('Hothorpe Hall')).toBeNull()
    expect(asLink('')).toBeNull()
  })

  it('names a venue from its link when no name was typed', () => {
    expect(nameFromLink('https://www.hothorpehall.co.uk/weddings')).toBe('hothorpehall.co.uk')
  })
})
