import { CheckCircle2, ExternalLink, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/misc'
import { formatDay, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import {
  type Venue,
  useAddChecklistTasks,
  useAddVenue,
  useDeleteVenue,
  useToggleChecklistTask,
  useUpdateVenue,
  useVenues,
  useWeddingChecklist,
  useWeddingSettings,
} from '../api'

const onError = (e: unknown) => toast.error(getErrorMessage(e))

/** "www.example.com/x" or "https://…" as a web link we can store; null when it isn't one. */
export function asLink(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  const withScheme = /^https?:\/\//i.test(t) ? t : /^[\w-]+(\.[\w-]+)+(\/|$)/.test(t) ? `https://${t}` : null
  if (!withScheme) return null
  try {
    const url = new URL(withScheme)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** A name from a link when none was typed: "hothorpehall.co.uk" from https://www.hothorpehall.co.uk/weddings. */
export function nameFromLink(link: string): string {
  return new URL(link).hostname.replace(/^www\./, '')
}

/**
 * The jobs still to do for the wedding, soonest due first. They are the
 * wedding checklist (ordinary joint tasks), so they are on the Tasks page too.
 */
function Jobs() {
  const settings = useWeddingSettings()
  const tasks = useWeddingChecklist(settings.data?.task_category_id)
  const add = useAddChecklistTasks()
  const toggle = useToggleChecklistTask()
  const [title, setTitle] = useState('')
  const today = todayISO()

  if (settings.error ?? tasks.error) return <ErrorState error={settings.error ?? tasks.error} onRetry={() => void tasks.refetch()} />
  const open = (tasks.data ?? []).filter((t) => !t.done)
  const done = (tasks.data ?? []).length - open.length

  return (
    <Card>
      <CardHeader className="p-3 pb-1 sm:p-3 sm:pb-1">
        <CardTitle>Jobs</CardTitle>
        {done ? <span className="text-xs text-muted-foreground">{done} done</span> : null}
      </CardHeader>
      <CardContent className="grid gap-1 px-3 pb-3 pt-1 sm:px-3">
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (!title.trim()) return
            add.mutate([{ title: title.trim(), due_date: null }], { onSuccess: () => setTitle(''), onError })
          }}
        >
          <Input aria-label="A wedding job" placeholder="Add a job…" maxLength={200} enterKeyHint="done" className="h-9" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Button type="submit" size="icon" variant="outline" aria-label="Add job" disabled={!title.trim() || add.isPending}>
            <Plus />
          </Button>
        </form>
        {settings.isPending || tasks.isPending ? (
          <ListSkeleton rows={3} />
        ) : open.length ? (
          <ul className="divide-y">
            {open.map((t) => {
              const overdue = t.due_date && t.due_date < today
              return (
                <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                  <Checkbox checked={false} aria-label={`Done: ${t.title}`} disabled={toggle.isPending} onCheckedChange={() => toggle.mutate(t, { onError })} />
                  <span className="min-w-0 flex-1 break-words">{t.title}</span>
                  {t.due_date ? <span className={cn('shrink-0 text-xs', overdue ? 'text-destructive' : 'text-muted-foreground')}>{formatDay(t.due_date)}</span> : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" /> Nothing to do right now.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** Venues either of you is looking at: a name and a link, who found it, and whether you've been. Adding one shows in the feed. */
function Venues() {
  const { me, member } = useHousehold()
  const venues = useVenues()
  const add = useAddVenue()
  const update = useUpdateVenue()
  const del = useDeleteVenue()
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const url = asLink(link)
  const badLink = Boolean(link.trim()) && !url
  const ready = (Boolean(name.trim()) || Boolean(url)) && !badLink

  if (venues.error) return <ErrorState error={venues.error} onRetry={() => void venues.refetch()} />

  return (
    <Card>
      <CardHeader className="p-3 pb-1 sm:p-3 sm:pb-1">
        <CardTitle>Venues</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 px-3 pb-3 pt-1 sm:px-3">
        <form
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (!ready) return
            add.mutate(
              { name: name.trim() || nameFromLink(url!), url },
              {
                onSuccess: () => {
                  setName('')
                  setLink('')
                },
                onError,
              },
            )
          }}
        >
          <Input aria-label="Venue name" placeholder="Venue" maxLength={120} className="h-9" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            aria-label="Link to the venue"
            aria-invalid={badLink || undefined}
            placeholder="Link"
            inputMode="url"
            autoCapitalize="off"
            maxLength={500}
            className={cn('h-9', badLink && 'border-destructive')}
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <Button type="submit" size="icon" variant="outline" aria-label="Add venue" disabled={!ready || add.isPending}>
            <Plus />
          </Button>
        </form>
        {venues.isPending ? (
          <ListSkeleton rows={2} />
        ) : venues.data.length ? (
          <ul className="divide-y">
            {venues.data.map((v) => (
              <VenueRow
                key={v.id}
                venue={v}
                by={v.created_by === me.id ? null : (member(v.created_by)?.display_name ?? null)}
                onVisited={() => update.mutate({ id: v.id, patch: { visited: !v.visited } }, { onError })}
                onDelete={() => del.mutate(v.id, { onError })}
              />
            ))}
          </ul>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">Add venues you like, with a link. The other person sees them straight away.</p>
        )}
      </CardContent>
    </Card>
  )
}

function VenueRow({ venue: v, by, onVisited, onDelete }: { venue: Venue; by: string | null; onVisited: () => void; onDelete: () => void }) {
  return (
    <li className="flex items-center gap-2 py-1.5 text-sm">
      <span className="min-w-0 flex-1 truncate">
        {v.url ? (
          <a href={v.url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 font-medium hover:underline">
            <span className="truncate">{v.name}</span>
            <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          </a>
        ) : (
          <span className="font-medium">{v.name}</span>
        )}
        {by ? <span className="text-xs text-muted-foreground"> · {by}</span> : null}
      </span>
      <Button
        size="sm"
        variant={v.visited ? 'secondary' : 'ghost'}
        className={cn('h-7 shrink-0 rounded-full px-2.5 text-xs', v.visited ? 'text-success' : 'text-muted-foreground')}
        aria-pressed={v.visited}
        onClick={onVisited}
      >
        {v.visited ? <CheckCircle2 className="size-3.5" /> : null} Visited
      </Button>
      <Button size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground" aria-label={`Remove ${v.name}`} onClick={onDelete}>
        <X />
      </Button>
    </li>
  )
}

/** The Wedding page's first view: the jobs to do, then the venues you're looking at. Budget, guests and the rest are under Details. */
export function WeddingPlan() {
  return (
    <div className="grid grid-cols-1 gap-3 md:max-w-2xl">
      <Jobs />
      <Venues />
    </div>
  )
}
