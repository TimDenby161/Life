// Makes the key pair for briefing notifications and writes the three secrets
// to a file for `supabase secrets set --env-file`, so the private key is never
// printed. Usage: node scripts/vapid-keys.mjs <file> [subject]
import { createECDH } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const [file, subject = 'https://timdenby161.github.io/Life/'] = process.argv.slice(2)
if (!file) {
  console.error('Usage: node scripts/vapid-keys.mjs <file> [subject]')
  process.exit(1)
}

const ecdh = createECDH('prime256v1')
ecdh.generateKeys()
// The private key can come back shorter than 32 bytes; it's a number, so left-pad with zeros.
const priv = Buffer.alloc(32)
ecdh.getPrivateKey().copy(priv, 32 - ecdh.getPrivateKey().length)
const env = [
  `VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString('base64url')}`,
  `VAPID_PRIVATE_KEY=${priv.toString('base64url')}`,
  `VAPID_SUBJECT=${subject}`,
]
writeFileSync(file, `${env.join('\n')}\n`, { mode: 0o600 })
console.error(`Wrote ${file}`)
