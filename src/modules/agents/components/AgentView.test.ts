import { inBrowser } from './AgentView'

describe('opening pinned links in the browser', () => {
  const url = 'https://claude.ai/artifact/7Tm8wQd2ZezWCcVMVMs3Ra'
  it('sends iPhone links to Safari rather than the Claude app', () => {
    expect(inBrowser(url, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(`x-safari-${url}`)
  })
  it('leaves other devices alone', () => {
    expect(inBrowser(url, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(url)
  })
})
