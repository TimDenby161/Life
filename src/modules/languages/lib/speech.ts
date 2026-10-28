// Pronunciation through the browser's own text-to-speech (no network, no key).
// Quality depends on the device's Chinese voice; iOS and Android both have one.

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function speak(text: string, lang = 'zh-CN') {
  if (!canSpeak()) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = 0.8
  // The exact voice (es-MX), else another of the same language, Spain's last.
  const voices = window.speechSynthesis.getVoices().map((v) => ({ v, tag: v.lang.replace('_', '-') }))
  const base = lang.split('-')[0]
  const voice =
    voices.find((x) => x.tag === lang) ??
    voices.find((x) => x.tag.startsWith(`${base}-`) && x.tag !== 'es-ES') ??
    voices.find((x) => x.tag.startsWith(base))
  if (voice) utterance.voice = voice.v
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}
