// Loaded into the generated service worker (vite.config.ts, workbox.importScripts).
// Shows a briefing notification and opens the app on tap. The payload is
// { title, body, url, tag }, with url relative to the app (e.g. "ai").
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // An unreadable payload still gets a notification: browsers expect one per push.
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Life', {
      body: data.body || '',
      tag: data.tag || 'life',
      icon: 'pwa-192x192.png',
      badge: 'pwa-64x64.png',
      data: { url: new URL(data.url || '', self.registration.scope).href },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : self.registration.scope
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.registration.scope))
      if (open) return open.navigate(url).then((w) => (w || open).focus())
      return self.clients.openWindow(url)
    }),
  )
})
