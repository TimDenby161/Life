import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { Toaster, toast } from 'sonner'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorState } from '@/components/states'
import { ThemeProvider, useTheme } from '@/components/ThemeProvider'
import { Button } from '@/components/ui/button'
import { isConfigured } from '@/lib/env'
import { createQueryClient } from '@/lib/queryClient'
import { supabase } from '@/lib/supabase'
import { AuthLayout } from '@/modules/auth/AuthLayout'
import { AuthProvider, useAuth } from '@/modules/auth/AuthProvider'
import { LoginPage } from '@/modules/auth/LoginPage'
import { SetPasswordPage } from '@/modules/auth/SetPasswordPage'
import { HouseholdProvider, useHouseholdQuery } from '@/modules/household/HouseholdProvider'
import { modules } from '@/modules/registry'

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

export default function App() {
  const [queryClient] = useState(createQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter basename={basename}>
          {isConfigured ? (
            <AuthProvider>
              <Gate />
            </AuthProvider>
          ) : (
            <NotConfigured />
          )}
          <ThemedToaster />
          <UpdatePrompt />
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

function Gate() {
  const { session, loading, recovering } = useAuth()
  if (loading) return <Splash />
  if (!session) return <LoginPage />
  if (recovering) return <SetPasswordPage />
  return <HouseholdGate />
}

function HouseholdGate() {
  const query = useHouseholdQuery()
  if (query.isPending) return <Splash />
  if (query.error) {
    return (
      <AuthLayout title="Life">
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </AuthLayout>
    )
  }
  if (!query.data) return <NoHousehold />
  return (
    <HouseholdProvider data={query.data}>
      <AppShell>
        <Routes>
          {modules.map((m) => (
            <Route key={m.id} path={m.path === '/' ? '/' : `${m.path}/*`} element={<m.component />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </HouseholdProvider>
  )
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true" aria-label="Loading">
      <img src={`${import.meta.env.BASE_URL}pwa-192x192.png`} alt="" className="size-14 animate-pulse rounded-2xl" />
    </div>
  )
}

function NoHousehold() {
  return (
    <AuthLayout title="Almost there" subtitle="Your account isn't part of a household yet.">
      <div className="grid gap-4 rounded-2xl border bg-card p-5 text-sm text-muted-foreground shadow-sm">
        <p>
          Your admin needs to add you with <code className="rounded bg-muted px-1">bootstrap_household</code> (see
          docs/SETUP.md). Once that's done, reload this page.
        </p>
        <Button variant="outline" onClick={() => supabase.auth.signOut()}>
          Sign out
        </Button>
      </div>
    </AuthLayout>
  )
}

function NotConfigured() {
  return (
    <AuthLayout title="Life isn't configured" subtitle="Supabase connection details are missing.">
      <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground shadow-sm">
        Set <code className="rounded bg-muted px-1">VITE_SUPABASE_URL</code> and{' '}
        <code className="rounded bg-muted px-1">VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code> (or the GitHub
        repository variables) and rebuild. See docs/SETUP.md.
      </div>
    </AuthLayout>
  )
}

function ThemedToaster() {
  const { theme } = useTheme()
  return <Toaster theme={theme} position="top-center" richColors closeButton toastOptions={{ duration: 3500 }} />
}

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  useEffect(() => {
    if (!needRefresh) return
    toast('A new version of Life is available', {
      duration: Infinity,
      action: { label: 'Reload', onClick: () => updateServiceWorker(true) },
    })
  }, [needRefresh, updateServiceWorker])
  return null
}
