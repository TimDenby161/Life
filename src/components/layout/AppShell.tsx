import { MoreHorizontal } from 'lucide-react'
import { Suspense, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { Avatar } from '@/components/Avatar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { OfflineBanner } from '@/components/OfflineBanner'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/misc'
import { useHouseholdRealtime } from '@/lib/realtime'
import { cn } from '@/lib/utils'
import { useUnreadPostCount } from '@/modules/feed/hooks'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { modules } from '@/modules/registry'

function isActive(pathname: string, path: string) {
  return path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`)
}

function NavBadge({ count }: { count: number }) {
  if (!count) return null
  return (
    <span className="grid min-w-4.5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-4.5 text-white">
      {count > 9 ? '9+' : count}
    </span>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { household, me } = useHousehold()
  const { pathname } = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const unread = useUnreadPostCount()
  useHouseholdRealtime(household.id)

  const primary = modules.filter((m) => m.mobilePrimary)
  const secondary = modules.filter((m) => !m.mobilePrimary)
  const moreActive = secondary.some((m) => isActive(pathname, m.path))
  const badgeFor = (id: string) => (id === 'feed' ? unread : 0)

  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-card/60 px-3 py-5 backdrop-blur lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-3">
          <img src={`${import.meta.env.BASE_URL}pwa-64x64.png`} alt="" className="size-8 rounded-lg" />
          <div className="min-w-0">
            <p className="font-semibold leading-tight">Life</p>
            <p className="truncate text-xs text-muted-foreground">{household.name}</p>
          </div>
        </div>
        <nav aria-label="Main" className="grid gap-0.5">
          {modules.map((m) => (
            <NavLink
              key={m.id}
              to={m.path}
              end={m.path === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  isActive && 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <m.icon className="size-[18px]" />
              <span className="flex-1">{m.label}</span>
              <NavBadge count={badgeFor(m.id)} />
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 rounded-lg px-3 py-2">
          <Avatar name={me.display_name} color={me.avatar_color} size="sm" />
          <span className="truncate text-sm">{me.display_name}</span>
        </div>
      </aside>

      <OfflineBanner />

      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-28 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
        </ErrorBoundary>
      </main>

      {/* Phone bottom bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/85 backdrop-blur-xl pb-safe lg:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {primary.map((m) => {
            const active = isActive(pathname, m.path)
            return (
              <NavLink
                key={m.id}
                to={m.path}
                end={m.path === '/'}
                className={cn(
                  'relative flex flex-col items-center gap-0.5 pb-2 pt-2.5 text-[11px] font-medium text-muted-foreground',
                  active && 'text-primary',
                )}
              >
                <m.icon className="size-[22px]" strokeWidth={active ? 2.3 : 1.8} />
                {m.label}
                {badgeFor(m.id) ? (
                  <span className="absolute right-[calc(50%-18px)] top-1.5">
                    <NavBadge count={badgeFor(m.id)} />
                  </span>
                ) : null}
              </NavLink>
            )
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              'flex flex-col items-center gap-0.5 pb-2 pt-2.5 text-[11px] font-medium text-muted-foreground',
              moreActive && 'text-primary',
            )}
          >
            <MoreHorizontal className="size-[22px]" />
            More
          </button>
        </div>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent title="More">
          <div className="grid grid-cols-2 gap-2 pb-2">
            {secondary.map((m) => (
              <NavLink
                key={m.id}
                to={m.path}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-xl border bg-card p-4 text-sm font-medium',
                    isActive && 'border-primary/40 bg-accent text-accent-foreground',
                  )
                }
              >
                <m.icon className="size-5" />
                {m.label}
              </NavLink>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  )
}
