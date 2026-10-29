import { toast } from 'sonner'

// Pronunciation through the browser's own text-to-speech (no network, no key).
// Quality depends on the device's Chinese voice; iOS and Android both have one.

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

// Chrome loads voices lazily; asking once up front means they're ready by the first tap.
if (canSpeak()) window.speechSynthesis.getVoices()

// Held until it finishes: Safari can garbage-collect an utterance mid-speech and cut it off.
let current: SpeechSynthesisUtterance | null = null

const isIOS = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1))

/** Half a second of silence as a WAV (8 kHz, 8-bit mono, where 128 is silence). */
function silentWav(): string {
  const samples = 4000
  const bytes = new Uint8Array(44 + samples)
  const view = new DataView(bytes.buffer)
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true)
  ascii(36, 'data'); view.setUint32(40, samples, true)
  bytes.fill(128, 44)
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
}

// iPhone mutes speech on silent, but not media: a looping silent clip while speaking makes the
// page a media player, so the word is heard even with the silent switch on.
let silence: HTMLAudioElement | null = null
function holdMedia() {
  if (!isIOS()) return
  if (!silence) {
    silence = new Audio(silentWav())
    silence.loop = true
    silence.setAttribute('x-webkit-airplay', 'deny')
  }
  silence.play().catch(() => {})
}
const releaseMedia = () => silence?.pause()

export function speak(text: string, lang = 'zh-CN') {
  if (!canSpeak()) return
  const synth = window.speechSynthesis
  // iPhone (Safari 17+): play as media, so the silent switch doesn't mute speech. Ignored elsewhere.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (session) session.type = 'playback'
  // Started inside the tap, which iOS requires before media can play.
  holdMedia()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = 0.8
  // The exact voice (es-MX), else another of the same language, Spain's last.
  const voices = synth.getVoices().map((v) => ({ v, tag: v.lang.replace('_', '-') }))
  const base = lang.split('-')[0]
  const voice =
    voices.find((x) => x.tag === lang) ??
    voices.find((x) => x.tag.startsWith(`${base}-`) && x.tag !== 'es-ES') ??
    voices.find((x) => x.tag.startsWith(base))
  if (voice) utterance.voice = voice.v
  utterance.onend = () => {
    if (current !== utterance) return
    current = null
    releaseMedia()
  }
  utterance.onerror = (e) => {
    if (current === utterance) {
      current = null
      releaseMedia()
    }
    // Interrupted/canceled just means another word was tapped.
    if (e.error === 'interrupted' || e.error === 'canceled') return
    toast.error(`Couldn't play the sound (${e.error}). Check the phone isn't on silent and has a ${base === 'zh' ? 'Chinese' : 'Spanish'} voice installed.`)
  }

  // Cancelling only when something is playing: Safari can drop a speak() that straight follows cancel().
  if (synth.speaking || synth.pending) synth.cancel()
  // Android Chrome can be left paused after the app was in the background.
  synth.resume()
  current = utterance
  synth.speak(utterance)
}
