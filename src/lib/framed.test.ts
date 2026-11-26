import { framedByAnotherSite } from './framed'

const fake = (top: unknown, origin = 'https://timdenby161.github.io') => {
  const self = { location: { origin } } as unknown as Window
  return Object.assign(self, { self, top: top === 'self' ? self : top }) as Window
}

describe('framedByAnotherSite', () => {
  it('is false when the app is the whole page', () => {
    expect(framedByAnotherSite(fake('self'))).toBe(false)
  })
  it("is true inside another site, whose address can't be read", () => {
    const other = { get location(): Location { throw new DOMException('Blocked', 'SecurityError') } }
    expect(framedByAnotherSite(fake(other))).toBe(true)
  })
  it('is false inside a frame of its own site', () => {
    expect(framedByAnotherSite(fake({ location: { origin: 'https://timdenby161.github.io' } }))).toBe(false)
  })
})
