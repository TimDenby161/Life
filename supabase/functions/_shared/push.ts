// Web Push on WebCrypto alone, so the same code runs in Deno and in Vitest:
// message encryption (RFC 8291, aes128gcm) and the VAPID signature (RFC 8292).
// The payload is encrypted to the device, so the push service (Apple, Google…)
// can't read it; even so, only a briefing headline (counts) is ever sent.

export type PushTarget = { endpoint: string; p256dh: string; auth: string }
/** Base64url, as `npx web-push generate-vapid-keys` prints them: 65-byte public key, 32-byte private key. */
export type Vapid = { publicKey: string; privateKey: string; subject: string }
export type PushMessage = { title: string; body: string; url: string; tag: string }
export type PushResult = { ok: boolean; gone: boolean; status: number }

/** Push services allowed as endpoints; kept in step with the check on push_subscriptions.endpoint. */
export const PUSH_SERVICE = /^https:\/\/(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com)\//

/** How long a push service keeps trying a phone that's off: a morning briefing is stale by the afternoon. */
export const TTL_SECONDS = 6 * 3600
const RECORD_SIZE = 4096

const text = new TextEncoder()
type Bytes = Uint8Array<ArrayBuffer>

export function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(s: string): Bytes {
  const t = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}

export async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

/** HKDF expand for one block (enough for every length used here). */
async function expand(prk: Bytes, info: Bytes, length: number) {
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length)
}

/**
 * Encrypts a payload for one browser (RFC 8291). `salt` and `serverKeys` are
 * only passed in tests; normally both are fresh for every message.
 */
export async function encrypt(
  payload: Bytes,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  options: { salt?: Bytes; serverKeys?: CryptoKeyPair } = {},
): Promise<Bytes> {
  const uaPublic = fromB64url(target.p256dh)
  const authSecret = fromB64url(target.auth)
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const server = options.serverKeys ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']))
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', server.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, server.privateKey, 256))

  const prkKey = await hmac(authSecret, ecdhSecret)
  const ikm = await expand(prkKey, concat(text.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const prk = await hmac(salt, ikm)
  const cek = await expand(prk, text.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await expand(prk, text.encode('Content-Encoding: nonce\0'), 12)

  // One record: the payload, then the 0x02 "last record" delimiter, no padding.
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))))

  const header = new Uint8Array(21)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = asPublic.length
  return concat(header, asPublic, sealed)
}

/** The VAPID token proving the message comes from this app's key; valid 12 hours, for one push service. */
export async function vapidToken(endpoint: string, vapid: Vapid, now: Date): Promise<string> {
  const pub = fromB64url(vapid.publicKey)
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), d: vapid.privateKey, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const part = (o: unknown) => b64url(text.encode(JSON.stringify(o)))
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
    sub: vapid.subject,
  })}`
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text.encode(unsigned)))
  return `${unsigned}.${b64url(signature)}`
}

/** Sends one notification. `gone` means the device unsubscribed and its row should be removed. */
export async function sendPush(target: PushTarget, message: PushMessage, vapid: Vapid, now: Date, fetcher: typeof fetch = fetch): Promise<PushResult> {
  if (!PUSH_SERVICE.test(target.endpoint)) return { ok: false, gone: true, status: 0 }
  const body = await encrypt(text.encode(JSON.stringify(message)), target)
  const res = await fetcher(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${await vapidToken(target.endpoint, vapid, now)}, k=${vapid.publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(TTL_SECONDS),
      Urgency: 'normal',
      // A newer briefing replaces one the phone hasn't picked up yet.
      Topic: message.tag,
    },
    body,
  })
  await res.body?.cancel()
  return { ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status }
}

/** What the phone shows for a briefing: the headline, nothing else. */
export function briefingMessage(kind: 'daily' | 'weekly', headline: string): PushMessage {
  return { title: kind === 'weekly' ? 'This week' : 'Today', body: headline, url: 'ai', tag: 'briefing' }
}
