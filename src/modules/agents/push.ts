// What this browser can do about notifications. On iPhone, web notifications
// only work in the app opened from the Home Screen (iOS 16.4+), not in Safari.

export type PushSupport = 'ready' | 'install' | 'unsupported' | 'blocked'

export function pushSupport(): PushSupport {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (ios && !standalone) return 'install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return 'ready'
}

/** The app's service worker; there is none in `npm run dev`. */
export async function workerRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
  if (!reg) throw new Error('Notifications only work in the installed app.')
  return reg
}

/** This browser's push address, if it has one. */
export async function thisDeviceEndpoint(): Promise<string | null> {
  if (pushSupport() !== 'ready') return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription())?.endpoint ?? null
}
