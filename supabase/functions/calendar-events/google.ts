// Google service-account auth (JWT bearer grant) with Web Crypto, read-only scope.
type ServiceAccount = { client_email: string; private_key: string; token_uri?: string }

let cached: { token: string; expires: number } | null = null

function b64url(data: ArrayBuffer | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

export async function googleAccessToken(serviceAccountJson: string): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token
  const sa = JSON.parse(serviceAccountJson) as ServiceAccount
  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token'
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  )
  const key = await importKey(sa.private_key)
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`))
  const assertion = `${header}.${claims}.${b64url(signature)}`

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`)
  const data = (await res.json()) as { access_token: string; expires_in: number }
  cached = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 }
  return data.access_token
}

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
