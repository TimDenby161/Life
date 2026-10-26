// Google Calendar API (read-only).
export { googleAccessToken } from '../_shared/google-auth.ts'

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

export type GoogleEvent = {
  id: string
  status?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  start: { date?: string; dateTime?: string }
  end: { date?: string; dateTime?: string }
}

export async function listEvents(token: string, calendarId: string, timeMin: string, timeMax: string): Promise<GoogleEvent[]> {
  const out: GoogleEvent[] = []
  let pageToken: string | undefined
  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`)
    url.search = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
      ...(pageToken ? { pageToken } : {}),
    }).toString()
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 404 || res.status === 403) throw new Error('calendar_not_shared')
    if (!res.ok) throw new Error(`Google Calendar error (${res.status})`)
    const data = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string }
    out.push(...(data.items ?? []))
    pageToken = data.nextPageToken
  } while (pageToken && out.length < 5000)
  return out
}
