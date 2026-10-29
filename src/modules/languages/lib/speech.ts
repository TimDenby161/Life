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

export function speak(text: string, lang = 'zh-CN') {
  if (!canSpeak()) return
  const synth = window.speechSynthesis
  // iPhone (Safari 17+): play as media, so the silent switch doesn't mute speech. Ignored elsewhere.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (session) session.type = 'playback'

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
  utterance.onend = () => { if (current === utterance) current = null }
  utterance.onerror = (e) => {
    if (current === utterance) current = null
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
