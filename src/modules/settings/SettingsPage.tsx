import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { useTheme } from '@/components/ThemeProvider'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { Badge, Segmented, Switch } from '@/components/ui/misc'
import { COLOR_NAMES, colorOf } from '@/lib/colors'
import { getErrorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, unwrap } from '@/lib/utils'
import { MIN_PASSWORD_LENGTH } from '@/modules/auth/SetPasswordPage'
import { calendarKeys, useCalendarIntegrations } from '@/modules/calendar/api'
import { useDeleteSource, useFeedSources, useSaveSource } from '@/modules/feed/hooks'
import { feedProviders } from '@/modules/feed/providers/registry'
import type { FeedSource } from '@/modules/feed/providers/types'
import { HealthSettingsPanel } from '@/modules/health/HealthPage'
import { householdKeys, useHousehold } from '@/modules/household/HouseholdProvider'
import { useCreateCategory, useTaskCategories } from '@/modules/tasks/hooks'

export default function SettingsPage() {
  const { hash } = useLocation()
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hash])

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-2xl gap-2">
        <ProfileSection />
        <AppearanceSection />
        <HouseholdSection />
        <CalendarSection />
        <FeedSourcesSection />
        <HealthSettingsSection />
        <CategoriesSection />
        <AccountSection />
      </div>
    </>
  )
}

function ProfileSection() {
  const { me } = useHousehold()
  const qc = useQueryClient()
  const [name, setName] = useState(me.display_name)
  const save = useMutation({
    mutationFn: async (patch: { display_name?: string; avatar_color?: string }) => unwrap(await supabase.from('profiles').update(patch).eq('id', me.id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: householdKeys.all }); toast.success('Saved') },
  })
  return (
    <section>
      <SectionTitle>You</SectionTitle>
      <Card className="grid gap-4 p-4">
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate({ display_name: name.trim() }) }}>
          <Field label="Display name" htmlFor="s-name" className="flex-1">
            <Input id="s-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" disabled={name.trim() === me.display_name || !name.trim()}>Save</Button>
        </form>
        <Field label="Colour">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
            {COLOR_NAMES.filter((c) => c !== 'slate').map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={me.avatar_color === c}
                aria-label={c}
                onClick={() => save.mutate({ avatar_color: c })}
                className={cn('size-8 rounded-full ring-offset-2 ring-offset-card', colorOf(c).bg, me.avatar_color === c && 'ring-2 ring-foreground')}
              />
            ))}
          </div>
        </Field>
      </Card>
    </section>
  )
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const { me } = useHousehold()
  return (
    <section>
      <SectionTitle>Appearance</SectionTitle>
      <Card className="flex items-center justify-between gap-3 p-4">
        <span className="text-sm">Theme</span>
        <Segmented
          aria-label="Theme"
          size="sm"
          value={theme}
          onChange={(t) => {
            setTheme(t)
            void supabase.from('user_preferences').update({ theme: t }).eq('user_id', me.id)
          }}
          options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
        />
      </Card>
    </section>
  )
}

function HouseholdSection() {
  const { household, members } = useHousehold()
  const qc = useQueryClient()
  const [name, setName] = useState(household.name)
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.from('households').update({ name: name.trim() }).eq('id', household.id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: householdKeys.all }); toast.success('Saved') },
  })
  return (
    <section>
      <SectionTitle>Household</SectionTitle>
      <Card className="grid gap-4 p-4">
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate() }}>
          <Field label="Name" htmlFor="s-hh" className="flex-1"><Input id="s-hh" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
          <Button type="submit" variant="secondary" disabled={name.trim() === household.name || !name.trim()}>Save</Button>
        </form>
        <ul className="grid gap-2">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2.5 text-sm">
              <Avatar name={m.display_name} color={m.avatar_color} size="sm" />
              {m.display_name}
              {m.role === 'owner' ? <Badge>Owner</Badge> : null}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Life is invite-only. New members are added by an admin in Supabase (see docs/SETUP.md).</p>
      </Card>
    </section>
  )
}

function CalendarSection() {
  const { household } = useHousehold()
  const qc = useQueryClient()
  const integrations = useCalendarIntegrations()
  const [mode, setMode] = useState<'service_account' | 'embed'>('service_account')
  const [name, setName] = useState('Shared calendar')
  const [calendarId, setCalendarId] = useState('')
  const [embedUrl, setEmbedUrl] = useState('')
  const [color, setColor] = useState('sky')
  const invalidate = () => qc.invalidateQueries({ queryKey: calendarKeys.all })
  const add = useMutation({
    mutationFn: async () =>
      unwrap(
        await supabase.from('calendar_integrations').insert({
          household_id: household.id,
          mode,
          name: name.trim(),
          google_calendar_id: mode === 'service_account' ? calendarId.trim() : null,
          embed_url: mode === 'embed' ? embedUrl.trim() : null,
          color,
        }),
      ),
    onSuccess: () => { invalidate(); setCalendarId(''); setEmbedUrl(''); toast.success('Calendar added') },
  })
  const update = useMutation({
    mutationFn: async (a: { id: string; patch: { enabled?: boolean; hidden_event_titles?: string[] } }) =>
      unwrap(await supabase.from('calendar_integrations').update(a.patch).eq('id', a.id)),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('calendar_integrations').delete().eq('id', id)),
    onSuccess: invalidate,
  })

  return (
    <section id="calendar" className="scroll-mt-6">
      <SectionTitle>Google Calendar</SectionTitle>
      <Card className="grid gap-4 p-4">
        {integrations.data?.length ? (
          <ul className="grid gap-2">
            {integrations.data.map((i) => (
              <li key={i.id} className="grid gap-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className={cn('size-2.5 rounded-full', colorOf(i.color).dot)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{i.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{i.mode === 'embed' ? 'Google embed (browser sign-in)' : i.google_calendar_id}</span>
                  </span>
                  <Switch checked={i.enabled} onCheckedChange={(v) => update.mutate({ id: i.id, patch: { enabled: v } })} aria-label={`Show ${i.name}`} />
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${i.name}`} onClick={() => remove.mutate(i.id)}><Trash2 /></Button>
                </div>
                {i.mode === 'service_account' ? (
                  <HiddenTitles titles={i.hidden_event_titles ?? []} onChange={(titles) => update.mutate({ id: i.id, patch: { hidden_event_titles: titles } })} />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <form className="grid gap-3 border-t pt-4 first:border-0 first:pt-0" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
          <Segmented
            aria-label="Connection type"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[{ value: 'service_account', label: 'Secure (recommended)' }, { value: 'embed', label: 'Google embed' }]}
          />
          <p className="text-xs text-muted-foreground">
            {mode === 'service_account'
              ? 'Share the calendar with the service account email (read-only "See all event details"), then paste the calendar ID from Google Calendar settings. Credentials stay on the server.'
              : "Paste the embed URL from Google Calendar → Settings → Integrate calendar. It only shows if the viewer's browser is signed in to Google with access, and may be blocked in iOS home-screen apps."}
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <Field label="Name" htmlFor="c-name"><Input id="c-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label="Colour" htmlFor="c-color">
              <NativeSelect id="c-color" value={color} onChange={(e) => setColor(e.target.value)}>
                {COLOR_NAMES.map((c) => <option key={c} value={c}>{c}</option>)}
              </NativeSelect>
            </Field>
          </div>
          {mode === 'service_account' ? (
            <Field label="Calendar ID" htmlFor="c-id"><Input id="c-id" value={calendarId} placeholder="abc123@group.calendar.google.com" onChange={(e) => setCalendarId(e.target.value)} required /></Field>
          ) : (
            <Field label="Embed URL" htmlFor="c-embed"><Input id="c-embed" type="url" value={embedUrl} placeholder="https://calendar.google.com/calendar/embed?src=…" onChange={(e) => setEmbedUrl(e.target.value)} required /></Field>
          )}
          <Button type="submit" variant="secondary" className="justify-self-start" disabled={add.isPending}><Plus /> Add calendar</Button>
        </form>
      </Card>
    </section>
  )
}

/** Exact event titles (ignoring case/spacing) that the calendar won't show. */
function HiddenTitles({ titles, onChange }: { titles: string[]; onChange: (titles: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const t = draft.trim().replace(/\s+/g, ' ')
    if (!t) return
    if (!titles.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...titles, t])
    setDraft('')
  }
  return (
    <div className="ml-5 grid gap-1.5 rounded-lg bg-muted/50 p-2.5">
      <p className="text-xs text-muted-foreground">Hide events titled exactly:</p>
      <div className="flex flex-wrap gap-1.5">
        {titles.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pl-2.5 pr-1 text-xs">
            {t}
            <button type="button" aria-label={`Stop hiding ${t}`} className="rounded-full p-0.5 text-muted-foreground hover:text-destructive" onClick={() => onChange(titles.filter((x) => x !== t))}>
              <Trash2 className="size-3" />
            </button>
          </span>
        ))}
        {!titles.length ? <span className="text-xs text-muted-foreground">Nothing hidden</span> : null}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add() }}>
        <Input aria-label="Event title to hide" placeholder="e.g. Work AM" value={draft} maxLength={200} onChange={(e) => setDraft(e.target.value)} className="h-8" />
        <Button type="submit" variant="secondary" size="sm" disabled={!draft.trim()}>Hide</Button>
      </form>
    </div>
  )
}

function FeedSourcesSection() {
  const sources = useFeedSources()
  const save = useSaveSource()
  const remove = useDeleteSource()
  const [provider, setProvider] = useState<FeedSource['provider']>('rss')
  const [name, setName] = useState('')
  const [config, setConfig] = useState<Record<string, string>>({})
  const def = feedProviders[provider]

  return (
    <section id="feed-sources" className="scroll-mt-6">
      <SectionTitle>Feed sources</SectionTitle>
      <Card className="grid gap-4 p-4">
        {sources.data?.length ? (
          <ul className="grid gap-2">
            {sources.data.map((s) => (
              <li key={s.id} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{feedProviders[s.provider].label}</span>
                </span>
                <Switch checked={s.enabled} onCheckedChange={(v) => save.mutate({ id: s.id, provider: s.provider, name: s.name, config: (s.config ?? {}) as Record<string, unknown>, enabled: v })} aria-label={`Show ${s.name}`} />
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${s.name}`} onClick={() => remove.mutate(s.id)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          className="grid gap-3 border-t pt-4 first:border-0 first:pt-0"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            const cfg: Record<string, unknown> = {}
            for (const f of def.configFields) {
              if (!config[f.key]) continue
              const value = config[f.key].trim()
              cfg[f.key] = f.type === 'number' ? Number(value) : f.type === 'url' ? value.replace(/^http:\/\//i, 'https://') : value
            }
            save.mutate({ provider, name: name.trim(), config: cfg, enabled: true }, { onSuccess: () => { setName(''); setConfig({}) } })
          }}
        >
          <Field label="Type" htmlFor="fs-provider" hint={def.description}>
            <NativeSelect id="fs-provider" value={provider} onChange={(e) => { setProvider(e.target.value as FeedSource['provider']); setConfig({}) }}>
              {Object.values(feedProviders).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Name" htmlFor="fs-name"><Input id="fs-name" value={name} maxLength={80} placeholder={provider === 'football' ? 'e.g. Chesterfield FC' : 'e.g. BBC News'} onChange={(e) => setName(e.target.value)} required /></Field>
          {def.configFields.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`fs-${f.key}`} hint={f.hint}>
              <Input id={`fs-${f.key}`} type={f.type === 'number' ? 'text' : (f.type ?? 'text')} inputMode={f.type === 'number' ? 'numeric' : undefined} placeholder={f.placeholder} value={config[f.key] ?? ''} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} required />
            </Field>
          ))}
          <Button type="submit" variant="secondary" className="justify-self-start" disabled={save.isPending}><Plus /> Add source</Button>
        </form>
      </Card>
    </section>
  )
}

function HealthSettingsSection() {
  return <div className="mt-4"><HealthSettingsPanel /></div>
}

function CategoriesSection() {
  const categories = useTaskCategories()
  const create = useCreateCategory()
  const [name, setName] = useState('')
  return (
    <section>
      <SectionTitle>Task categories</SectionTitle>
      <Card className="grid gap-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          {(categories.data ?? []).map((c) => (
            <Badge key={c.id} tone="neutral"><span className={cn('size-1.5 rounded-full', colorOf(c.color).dot)} />{c.name}</Badge>
          ))}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate({ name: name.trim(), color: 'slate' }, { onSuccess: () => setName('') }) }}>
          <Input aria-label="New category" placeholder="New category" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="h-9" />
          <Button type="submit" variant="secondary" size="sm" disabled={!name.trim()}>Add</Button>
        </form>
      </Card>
    </section>
  )
}

function AccountSection() {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <section>
      <SectionTitle>Sign-in</SectionTitle>
      <Card className="grid gap-4 p-4">
        <form
          className="flex items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (password.length < MIN_PASSWORD_LENGTH) return toast.error(`Use at least ${MIN_PASSWORD_LENGTH} characters`)
            setBusy(true)
            const { error } = await supabase.auth.updateUser({ password })
            setBusy(false)
            if (error) return toast.error(getErrorMessage(error))
            setPassword('')
            toast.success('Password changed')
          }}
        >
          <Field label="New password" htmlFor="s-pw" className="flex-1">
            <Input id="s-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" disabled={busy || !password}>Change</Button>
        </form>
        <Button variant="outline" className="justify-self-start" onClick={() => supabase.auth.signOut()}><LogOut /> Sign out</Button>
        <p className="text-xs text-muted-foreground">
          Life works online. When you're offline you can still see what's already loaded, but changes won't be saved until you reconnect.
        </p>
      </Card>
    </section>
  )
}
