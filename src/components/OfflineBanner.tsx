import { CloudOff } from 'lucide-react'
import { useSyncExternalStore } from 'react'

function subscribe(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
}

export function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-warning px-4 py-2 text-center text-sm font-medium text-black pt-[max(0.5rem,env(safe-area-inset-top))]"
    >
      <CloudOff className="size-4" />
      You're offline. You can browse what's already loaded, but changes can't be saved.
    </div>
  )
}
