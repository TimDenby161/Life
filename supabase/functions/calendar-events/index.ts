// Read-only proxy for the household's Google Calendar(s).
//
// POST { timeMin: ISO, timeMax: ISO }  (Authorization: Bearer <user JWT>)
// -> { status: 'ok', events: CalendarEvent[], fetchedAt }
//  | { status: 'not_configured', message }
//  | { status: 'error', message }
//
// Secrets (set with `supabase secrets set`, never committed):
//   GOOGLE_SERVICE_ACCOUNT_JSON  service-account key JSON (read-only use)
//   ALLOWED_ORIGINS              optional, e.g. https://tim.github.io,http://localhost:5173
import { json, TtlCache, userClient, corsHeaders } from '../_shared/http.ts'
import { type GoogleEvent, googleAccessToken, listEvents } from './google.ts'

type CalendarEvent = {
  id: string
  calendarId: string
  calendarName: string
  color: string
  title: string
  description: string | null
  location: string | null
  start: string
  end: string
  allDay: boolean
  htmlLink: string | null
}

const cache = new TtlCache<CalendarEvent[]>(2 * 60_000)
const MAX_RANGE_DAYS = 400

function normalise(e: GoogleEvent, integration: { id: string; name: string; color: string }): CalendarEvent | null {
  if (e.status === 'cancelled') return null
  const allDay = Boolean(e.start.date)
  return {
    id: `${integration.id}:${e.id}`,
    calendarId: integration.id,
    calendarName: integration.name,
    color: integration.color,
    title: e.summary?.trim() || '(No title)',
    description: e.description ?? null,
    location: e.location ?? null,
    start: (e.start.dateTime ?? e.start.date)!,
    end: (e.end.dateTime ?? e.end.date)!,
    allDay,
    htmlLink: e.htmlLink ?? null,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { status: 'error', message: 'Method not allowed' }, 405)

  const supabase = await userClient(req)
  if (!supabase) return json(req, { status: 'error', message: 'Not signed in' }, 401)

  let body: { timeMin?: string; timeMax?: string }
  try {
    body = await req.json()
  } catch {
    return json(req, { status: 'error', message: 'Invalid request' }, 400)
  }
  const min = Date.parse(body.timeMin ?? '')
  const max = Date.parse(body.timeMax ?? '')
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || max - min > MAX_RANGE_DAYS * 86_400_000) {
    return json(req, { status: 'error', message: 'Invalid time range' }, 400)
  }

  // RLS: only returns integrations for the caller's household.
  const { data: integrations, error } = await supabase
    .from('calendar_integrations')
    .select('id, name, color, google_calendar_id')
    .eq('enabled', true)
    .eq('mode', 'service_account')
  if (error) return json(req, { status: 'error', message: 'Could not load calendar settings' }, 500)
  if (!integrations?.length) {
    return json(req, { status: 'not_configured', message: 'No Google Calendar has been connected yet.' })
  }

  const serviceAccount = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!serviceAccount) {
    return json(req, { status: 'not_configured', message: 'The calendar service account secret is not set on the server.' })
  }

  const timeMin = new Date(min).toISOString()
  const timeMax = new Date(max).toISOString()
  try {
    const token = await googleAccessToken(serviceAccount)
    const results = await Promise.all(
      integrations.map(async (integration) => {
        const key = `${integration.id}|${integration.google_calendar_id}|${timeMin}|${timeMax}`
        const hit = cache.get(key)
        if (hit) return hit
        const raw = await listEvents(token, integration.google_calendar_id!, timeMin, timeMax)
        const events = raw.flatMap((e) => normalise(e, integration) ?? [])
        cache.set(key, events)
        return events
      }),
    )
    const events = results.flat().sort((a, b) => a.start.localeCompare(b.start))
    return json(req, { status: 'ok', events, fetchedAt: new Date().toISOString() })
  } catch (e) {
    const message =
      (e as Error).message === 'calendar_not_shared'
        ? 'The calendar is not shared with the service account (or the calendar ID is wrong).'
        : 'Google Calendar is unavailable right now.'
    console.error('calendar-events failed:', (e as Error).message)
    return json(req, { status: 'error', message }, 502)
  }
})
