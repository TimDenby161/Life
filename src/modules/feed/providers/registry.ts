import { fetchViaEdge } from './edge'
import type { FeedProvider, FeedSource } from './types'

const rss: FeedProvider = {
  id: 'rss',
  label: 'News / RSS feed',
  description: 'Headlines from an RSS or Atom feed. The server only fetches hosts on its allow-list.',
  configFields: [{ key: 'url', label: 'Feed URL', placeholder: 'https://feeds.bbci.co.uk/news/rss.xml', type: 'url' }],
  fetch: fetchViaEdge,
}

const football: FeedProvider = {
  id: 'football',
  label: 'Football scores & fixtures',
  description: 'Recent results and upcoming fixtures from API-Football. Requires an API key on the server.',
  configFields: [
    { key: 'teamId', label: 'API-Football team ID', type: 'number', hint: 'Look it up once with the API-Football /teams?search= endpoint (see docs/SETUP.md).' },
  ],
  fetch: fetchViaEdge,
}

/** Sample data for trying the layout. Always labelled as not live. */
const mock: FeedProvider = {
  id: 'mock',
  label: 'Sample data (not live)',
  description: 'Placeholder items to preview the feed layout. Clearly marked; never real information.',
  configFields: [],
  async fetch() {
    const now = Date.now()
    return {
      status: 'ok',
      isMock: true,
      attribution: 'Sample data',
      fetchedAt: new Date(now).toISOString(),
      items: [
        { id: 'm1', kind: 'fixture', title: 'Sample Town v Example United', url: null, publishedAt: new Date(now + 3 * 86_400_000).toISOString(), summary: 'Sample fixture. Not a real match.' },
        { id: 'm2', kind: 'result', title: 'Example United 2–1 Placeholder Rovers', url: null, publishedAt: new Date(now - 4 * 86_400_000).toISOString(), summary: 'Sample result. Not a real score.' },
        { id: 'm3', kind: 'article', title: 'Sample headline for layout preview', url: null, publishedAt: new Date(now - 3_600_000).toISOString(), summary: 'This is placeholder text, not news.' },
      ],
    }
  },
}

export const feedProviders: Record<FeedSource['provider'], FeedProvider> = { rss, football, mock }
