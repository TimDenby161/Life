// RSS and Atom headlines from an allow-listed https host. Shared by
// external-feed (the Feed page) and the agents function (the morning routine's
// short headlines). Nothing is ever invented: if a feed can't answer, we say so.
import { XMLParser } from 'npm:fast-xml-parser@4.5.0'

export type FeedItem = {
  id: string
  kind: 'article' | 'fixture' | 'result'
  title: string
  url: string | null
  publishedAt: string | null
  summary: string | null
  meta?: Record<string, string | number | null>
}
export type Result =
  | { status: 'ok'; items: FeedItem[]; fetchedAt: string; attribution: string }
  | { status: 'not_configured' | 'error'; message: string }

const DEFAULT_HOSTS = ['feeds.bbci.co.uk', 'www.theguardian.com']

function allowedHosts(): string[] {
  const env = Deno.env.get('FEED_ALLOWED_HOSTS')
  return env ? env.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean) : DEFAULT_HOSTS
}

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const text = (v: unknown): string => (typeof v === 'string' ? v : v && typeof v === 'object' && '#text' in v ? String((v as { '#text': unknown })['#text']) : v == null ? '' : String(v))

export async function fetchRss(config: Record<string, unknown>): Promise<Result> {
  let url: URL
  try {
    url = new URL(String(config.url ?? ''))
  } catch {
    return { status: 'not_configured', message: 'This source has no valid feed URL.' }
  }
  // Many publishers still advertise http:// feed links; fetch them over https.
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:') return { status: 'not_configured', message: 'Feed URLs must use https.' }
  if (!allowedHosts().includes(url.hostname.toLowerCase())) {
    return { status: 'not_configured', message: `${url.hostname} is not in the server's FEED_ALLOWED_HOSTS list.` }
  }
  const res = await fetch(url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml' }, redirect: 'follow' })
  if (!res.ok) return { status: 'error', message: `The feed responded with ${res.status}.` }
  const xml = (await res.text()).slice(0, 2_000_000)
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml)
  const rssItems = doc?.rss?.channel?.item
  const atomItems = doc?.feed?.entry
  const raw: unknown[] = Array.isArray(rssItems) ? rssItems : rssItems ? [rssItems] : Array.isArray(atomItems) ? atomItems : atomItems ? [atomItems] : []
  const items = raw.slice(0, 20).map((r, i): FeedItem => {
    const it = r as Record<string, unknown>
    const link = typeof it.link === 'string' ? it.link : (it.link as Record<string, string> | undefined)?.['@_href'] ?? null
    const date = text(it.pubDate ?? it.published ?? it.updated)
    const summary = stripHtml(text(it.description ?? it.summary ?? ''))
    return {
      id: text(it.guid ?? it.id) || `${i}-${link}`,
      kind: 'article',
      title: stripHtml(text(it.title)) || '(untitled)',
      url: link && /^https?:\/\//.test(link) ? link : null,
      publishedAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
      summary: summary ? summary.slice(0, 280) : null,
    }
  })
  const title = stripHtml(text(doc?.rss?.channel?.title ?? doc?.feed?.title)) || url.hostname
  return { status: 'ok', items, fetchedAt: new Date().toISOString(), attribution: title }
}
