// Fetches external information for one configured feed source.
//
// POST { sourceId }  (Authorization: Bearer <user JWT>)
// -> { status: 'ok', items: FeedItem[], fetchedAt, attribution }
//  | { status: 'not_configured', message }
//  | { status: 'error', message }
//
// Providers:
//   rss       config { url }            URL host must be in FEED_ALLOWED_HOSTS
//   football  config { teamId, label? } API-Football (api-sports.io); needs API_FOOTBALL_KEY
//
// Secrets (optional): API_FOOTBALL_KEY, FEED_ALLOWED_HOSTS, ALLOWED_ORIGINS.
// Nothing is ever invented: if a provider can't answer, we say so.
import { XMLParser } from 'npm:fast-xml-parser@4.5.0'
import { corsHeaders, json, TtlCache, userClient } from '../_shared/http.ts'

type FeedItem = {
  id: string
  kind: 'article' | 'fixture' | 'result'
  title: string
  url: string | null
  publishedAt: string | null
  summary: string | null
  meta?: Record<string, string | number | null>
}
type Result =
  | { status: 'ok'; items: FeedItem[]; fetchedAt: string; attribution: string }
  | { status: 'not_configured' | 'error'; message: string }

const cache = new TtlCache<Result>(10 * 60_000)
const DEFAULT_HOSTS = ['feeds.bbci.co.uk', 'www.theguardian.com']

function allowedHosts(): string[] {
  const env = Deno.env.get('FEED_ALLOWED_HOSTS')
  return env ? env.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean) : DEFAULT_HOSTS
}

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const text = (v: unknown): string => (typeof v === 'string' ? v : v && typeof v === 'object' && '#text' in v ? String((v as { '#text': unknown })['#text']) : v == null ? '' : String(v))

async function fetchRss(config: Record<string, unknown>): Promise<Result> {
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

type ApiFixture = {
  fixture: { id: number; date: string; status: { short: string; long: string }; venue?: { name?: string } }
  league: { name: string }
  teams: { home: { name: string }; away: { name: string } }
  goals: { home: number | null; away: number | null }
}

async function fetchFootball(config: Record<string, unknown>): Promise<Result> {
  const key = Deno.env.get('API_FOOTBALL_KEY')
  if (!key) return { status: 'not_configured', message: 'Live scores need an API_FOOTBALL_KEY secret on the server.' }
  const teamId = Number(config.teamId)
  if (!Number.isInteger(teamId) || teamId <= 0) return { status: 'not_configured', message: 'Set the API-Football team ID for this source.' }
  const get = async (q: string) => {
    const res = await fetch(`https://v3.football.api-sports.io/fixtures?team=${teamId}&${q}`, { headers: { 'x-apisports-key': key } })
    if (!res.ok) throw new Error(`api-football ${res.status}`)
    const data = (await res.json()) as { response?: ApiFixture[]; errors?: unknown }
    if (data.errors && Object.keys(data.errors as object).length) throw new Error('api-football error response')
    return data.response ?? []
  }
  const [last, next] = await Promise.all([get('last=5'), get('next=5')])
  const map = (f: ApiFixture, kind: 'fixture' | 'result'): FeedItem => ({
    id: String(f.fixture.id),
    kind,
    title:
      kind === 'result'
        ? `${f.teams.home.name} ${f.goals.home ?? '–'}–${f.goals.away ?? '–'} ${f.teams.away.name}`
        : `${f.teams.home.name} v ${f.teams.away.name}`,
    url: null,
    publishedAt: f.fixture.date,
    summary: [f.league.name, f.fixture.venue?.name].filter(Boolean).join(' · ') || null,
    meta: { status: f.fixture.status.long, statusShort: f.fixture.status.short },
  })
  return {
    status: 'ok',
    items: [...next.map((f) => map(f, 'fixture')), ...last.reverse().map((f) => map(f, 'result'))],
    fetchedAt: new Date().toISOString(),
    attribution: 'API-Football',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { status: 'error', message: 'Method not allowed' }, 405)
  const supabase = await userClient(req)
  if (!supabase) return json(req, { status: 'error', message: 'Not signed in' }, 401)

  const { sourceId } = (await req.json().catch(() => ({}))) as { sourceId?: string }
  if (!sourceId) return json(req, { status: 'error', message: 'Missing sourceId' }, 400)

  // RLS: only the caller's household sources are visible.
  const { data: source } = await supabase.from('feed_sources').select('id, provider, config, enabled, updated_at').eq('id', sourceId).maybeSingle()
  if (!source || !source.enabled) return json(req, { status: 'error', message: 'Source not found' }, 404)

  const key = `${source.id}|${source.updated_at}`
  const hit = cache.get(key)
  if (hit) return json(req, hit)

  let result: Result
  try {
    if (source.provider === 'rss') result = await fetchRss(source.config ?? {})
    else if (source.provider === 'football') result = await fetchFootball(source.config ?? {})
    else result = { status: 'not_configured', message: 'This provider runs in the app, not on the server.' }
  } catch (e) {
    console.error('external-feed failed:', source.provider, (e as Error).message)
    result = { status: 'error', message: 'The source is unavailable right now.' }
  }
  if (result.status === 'ok') cache.set(key, result)
  return json(req, result)
})
