// @vitest-environment node
// WebCrypto (crypto.subtle) is Node's; jsdom's crypto has no subtle.
import {
  b64url,
  briefingMessage,
  concat,
  encrypt,
  fromB64url,
  hmac,
  PUSH_SERVICE,
  sendPush,
  TTL_SECONDS,
  type Vapid,
  vapidToken,
} from '../../../../supabase/functions/_shared/push.ts'

const text = new TextEncoder()
const now = new Date('2026-11-06T06:05:00Z')

/** A browser's side of a subscription: its key pair and auth secret. */
async function browser() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const p256dh = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)))
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)))
  return { keys, p256dh, auth, endpoint: 'https://fcm.googleapis.com/fcm/send/abc123' }
}

/** What the browser does on receipt (RFC 8291 from the user agent's side). */
async function decrypt(body: Uint8Array, b: Awaited<ReturnType<typeof browser>>) {
  const salt = body.slice(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const sealed = body.slice(21 + idlen)
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, b.keys.privateKey, 256))
  const one = new Uint8Array([1])
  const prkKey = await hmac(fromB64url(b.auth), secret)
  const ikm = await hmac(prkKey, concat(text.encode('WebPush: info\0'), fromB64url(b.p256dh), asPublic, one))
  const prk = await hmac(salt, ikm)
  const cek = (await hmac(prk, concat(text.encode('Content-Encoding: aes128gcm\0'), one))).slice(0, 16)
  const nonce = (await hmac(prk, concat(text.encode('Content-Encoding: nonce\0'), one))).slice(0, 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed))
  return { rs, idlen, delimiter: plain[plain.length - 1], payload: new TextDecoder().decode(plain.slice(0, -1)) }
}

async function vapidKeys(): Promise<Vapid & { verifyKey: CryptoKey }> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', keys.privateKey)
  const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)))
  return { publicKey, privateKey: jwk.d!, subject: 'https://example.github.io/life/', verifyKey: keys.publicKey }
}

describe('base64url', () => {
  it('round-trips bytes, with or without padding', () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i * 37) % 256)
    expect(fromB64url(b64url(bytes))).toEqual(bytes)
    expect(b64url(bytes)).not.toMatch(/[+/=]/)
    expect(fromB64url('AQID')).toEqual(new Uint8Array([1, 2, 3]))
    expect(fromB64url('AQ==')).toEqual(new Uint8Array([1]))
  })
})

describe('message encryption', () => {
  it('produces what the browser can decrypt', async () => {
    const b = await browser()
    const body = await encrypt(text.encode('{"body":"3 due today."}'), b)
    const out = await decrypt(body, b)
    expect(out).toEqual({ rs: 4096, idlen: 65, delimiter: 2, payload: '{"body":"3 due today."}' })
  })

  it('uses a fresh key and salt every time', async () => {
    const b = await browser()
    const [one, two] = await Promise.all([encrypt(text.encode('x'), b), encrypt(text.encode('x'), b)])
    expect(b64url(one)).not.toBe(b64url(two))
  })

  it('cannot be read with another browser’s secret', async () => {
    const b = await browser()
    const other = await browser()
    const body = await encrypt(text.encode('x'), b)
    await expect(decrypt(body, { ...b, auth: other.auth })).rejects.toThrow()
  })
})

describe('VAPID', () => {
  it('signs a token for the push service’s origin that the public key verifies', async () => {
    const v = await vapidKeys()
    const token = await vapidToken('https://web.push.apple.com/QGuQyavXut/abc', v, now)
    const [h, c, s] = token.split('.')
    expect(JSON.parse(new TextDecoder().decode(fromB64url(h)))).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(new TextDecoder().decode(fromB64url(c)))).toEqual({
      aud: 'https://web.push.apple.com',
      exp: now.getTime() / 1000 + 12 * 3600,
      sub: v.subject,
    })
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, v.verifyKey, fromB64url(s), text.encode(`${h}.${c}`))
    expect(ok).toBe(true)
  })
})

describe('sending', () => {
  it('posts the encrypted briefing with the push headers', async () => {
    const b = await browser()
    const v = await vapidKeys()
    const calls: { url: string; init: RequestInit }[] = []
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(null, { status: 201 })
    }) as unknown as typeof fetch
    const result = await sendPush(b, briefingMessage('daily', '3 due today, 1 overdue.'), v, now, fetcher)
    expect(result).toEqual({ ok: true, gone: false, status: 201 })
    const { url, init } = calls[0]
    const headers = init.headers as Record<string, string>
    expect(url).toBe(b.endpoint)
    expect(headers.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${v.publicKey}$`))
    expect(headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: String(TTL_SECONDS), Topic: 'briefing' })
    const sent = JSON.parse((await decrypt(init.body as Uint8Array, b)).payload)
    expect(sent).toEqual({ title: 'Today', body: '3 due today, 1 overdue.', url: 'ai', tag: 'briefing' })
  })

  it('reports a device that has gone away', async () => {
    const b = await browser()
    const v = await vapidKeys()
    const status = (s: number) => (async () => new Response(null, { status: s })) as unknown as typeof fetch
    expect(await sendPush(b, briefingMessage('weekly', 'x'), v, now, status(410))).toEqual({ ok: false, gone: true, status: 410 })
    expect(await sendPush(b, briefingMessage('weekly', 'x'), v, now, status(404))).toMatchObject({ gone: true })
    expect(await sendPush(b, briefingMessage('weekly', 'x'), v, now, status(429))).toEqual({ ok: false, gone: false, status: 429 })
  })

  it('never calls anything but a browser push service', async () => {
    const b = await browser()
    const v = await vapidKeys()
    let called = false
    const fetcher = (async () => {
      called = true
      return new Response(null, { status: 201 })
    }) as unknown as typeof fetch
    expect(await sendPush({ ...b, endpoint: 'https://evil.example/fcm.googleapis.com/' }, briefingMessage('daily', 'x'), v, now, fetcher)).toMatchObject({ ok: false })
    expect(called).toBe(false)
    expect(PUSH_SERVICE.test('https://web.push.apple.com/abc')).toBe(true)
    expect(PUSH_SERVICE.test('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true)
    expect(PUSH_SERVICE.test('https://wns2-db5p.notify.windows.com/w/?token=abc')).toBe(true)
    expect(PUSH_SERVICE.test('https://fcm.googleapis.com.evil.example/x')).toBe(false)
    expect(PUSH_SERVICE.test('http://fcm.googleapis.com/x')).toBe(false)
  })

  it('names a weekly briefing as such', () => {
    expect(briefingMessage('weekly', '12 due this week.').title).toBe('This week')
  })
})
