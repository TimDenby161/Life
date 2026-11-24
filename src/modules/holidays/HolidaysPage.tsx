import { differenceInCalendarDays, parseISO } from 'date-fns'
import { Check, CircleCheck, ExternalLink, Minus, Pencil, Plane, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { Progress, Segmented, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { formatMoney, parseMoney, toMoneyInput } from '@/lib/money'
import { cn } from '@/lib/utils'
import { usePots } from '@/modules/finances/hooks'
import { inBrowser } from '@/modules/agents/components/AgentView'
import { dates, ITEMS, NEXT, STATUS_TEXT } from '@/modules/agents/components/Trips'
import { type TripBookingRow, type TripRow, useDeleteTrip, useDeleteTripBooking, useSaveTrip, useSaveTripBooking, useTripBookings, useTrips } from '@/modules/agents/api'
import type { ItemStatus } from '../../../supabase/functions/_shared/agents/travel.ts'
import { byDate, todoItems, type Urgency, URGENCY_LABELS, urgency } from './lib/todo'

const onError = (e: unknown) => toast.error(getErrorMessage(e))
const money = (minor: number) => formatMoney(minor, 'GBP', { hidePence: true })

type Form = { id?: string; name: string; starts_on: string; ends_on: string; cost: string; paid: string; plan_url: string; confirmed: boolean; pot_goal_id: string }

const toForm = (t?: TripRow): Form => ({
  id: t?.id,
  name: t?.name ?? '',
  starts_on: t?.starts_on ?? '',
  ends_on: t?.ends_on ?? '',
  cost: t?.cost_minor != null ? toMoneyInput(t.cost_minor) : '',
  paid: t?.paid_minor ? toMoneyInput(t.paid_minor) : '',
  plan_url: t?.plan_url ?? '',
  confirmed: t?.confirmed ?? true,
  pot_goal_id: t?.pot_goal_id ?? '',
})

/**
 * Add or change a holiday: name, dates, cost and paid (for both of you), the plan's link, whether you're going or it's
 * an idea, and the savings pot item it's saved in (whose amount and date then follow the holiday's; see the trip_pot_goals migration).
 */
function HolidayDialog({ initial, trips, onClose }: { initial: Form; trips: TripRow[]; onClose: () => void }) {
  const save = useSaveTrip()
  const pots = usePots()
  const potName = (id: string | null) => pots.data?.pots.find((p) => p.id === id)?.name ?? ''
  // Each pot item pays for one holiday.
  const taken = new Set(trips.filter((t) => t.id !== initial.id && t.pot_goal_id).map((t) => t.pot_goal_id))
  const [f, setF] = useState(initial)
  const cost = f.cost.trim() ? parseMoney(f.cost) : null
  const paid = f.paid.trim() ? parseMoney(f.paid) : 0
  const link = f.plan_url.trim()
  const ready =
    Boolean(f.name.trim() && f.starts_on && f.ends_on && f.ends_on >= f.starts_on) &&
    (!f.cost.trim() || cost !== null) &&
    paid !== null &&
    (!link || /^https:\/\//.test(link))

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title={initial.id ? 'Holiday' : 'New holiday'}>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!ready) return
            save.mutate(
              {
                id: f.id,
                name: f.name.trim(),
                starts_on: f.starts_on,
                ends_on: f.ends_on,
                cost_minor: cost,
                paid_minor: paid ?? 0,
                plan_url: link || null,
                confirmed: f.confirmed,
                pot_goal_id: f.pot_goal_id || null,
                ...(f.id ? {} : { owner_id: null, abroad: true, transport: 'todo', stay: 'todo', insurance: 'todo', time_off: 'todo' }),
              },
              { onSuccess: onClose, onError },
            )
          }}
        >
          <Segmented
            aria-label="Going or an idea"
            size="sm"
            className="w-fit"
            value={f.confirmed ? 'going' : 'idea'}
            onChange={(v) => setF({ ...f, confirmed: v === 'going' })}
            options={[{ value: 'going', label: 'Going' }, { value: 'idea', label: 'Idea' }]}
          />
          <Field label="Where" htmlFor="h-name">
            <Input id="h-name" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From" htmlFor="h-from">
              <Input id="h-from" type="date" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value, ends_on: f.ends_on || e.target.value })} />
            </Field>
            <Field label="To" htmlFor="h-to">
              <Input id="h-to" type="date" value={f.ends_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} />
            </Field>
            <Field label="Cost for 2" htmlFor="h-cost">
              <Input id="h-cost" inputMode="decimal" placeholder="£" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
            </Field>
            <Field label="Paid so far" htmlFor="h-paid">
              <Input id="h-paid" inputMode="decimal" placeholder="£" value={f.paid} onChange={(e) => setF({ ...f, paid: e.target.value })} />
            </Field>
          </div>
          <Field label="Link to the plan" htmlFor="h-url">
            <Input id="h-url" inputMode="url" autoCapitalize="off" placeholder="https://claude.ai/artifact/…" maxLength={300} value={f.plan_url} onChange={(e) => setF({ ...f, plan_url: e.target.value })} />
          </Field>
          <Field label="Saved in" htmlFor="h-goal" hint="Its amount follows the cost less what's paid, due the day before you go.">
            <NativeSelect id="h-goal" value={f.pot_goal_id} onChange={(e) => setF({ ...f, pot_goal_id: e.target.value })}>
              <option value="">Not linked</option>
              {(pots.data?.items ?? []).filter((i) => !taken.has(i.id)).map((i) => <option key={i.id} value={i.id}>{potName(i.pot_id)} · {i.name}</option>)}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!ready || save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function HolidayCard({ trip: t, onEdit }: { trip: TripRow; onEdit: () => void }) {
  const save = useSaveTrip()
  const del = useDeleteTrip()
  const days = differenceInCalendarDays(parseISO(t.starts_on), parseISO(todayISO()))
  const pct = t.cost_minor ? Math.min(100, Math.round((t.paid_minor / t.cost_minor) * 100)) : 0
  return (
    <Card className={cn('p-3', !t.confirmed && 'border-dashed bg-card/60')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span className="truncate">{t.name}</span>
            {!t.confirmed ? <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">Idea</span> : null}
          </h2>
          <p className="text-xs text-muted-foreground">
            {dates(t.starts_on, t.ends_on)}
            {days > 0 ? ` · ${days < 60 ? `${days} days` : `${Math.round(days / 30)} months`} to go` : days <= 0 ? ' · now' : ''}
          </p>
        </div>
        <span className="text-right">
          <span className="block font-semibold tabular">{t.cost_minor != null ? money(t.cost_minor) : '—'}</span>
          <span className="block text-[11px] text-muted-foreground tabular">{t.paid_minor ? `${money(t.paid_minor)} paid` : 'for 2'}</span>
        </span>
      </div>
      {t.cost_minor ? <Progress value={pct} className="mt-2 h-1" indicatorClassName={pct >= 100 ? 'bg-success' : undefined} /> : null}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {t.confirmed
          ? ITEMS.map(({ key, label }) => {
              const status = t[key] as ItemStatus
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={`${label}: ${STATUS_TEXT[status]}`}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
                    status === 'done' ? 'border-success/40 bg-success/10 text-success' : status === 'not_needed' ? 'text-muted-foreground line-through' : 'text-foreground',
                  )}
                  onClick={() => save.mutate({ id: t.id, [key]: NEXT[status] }, { onError })}
                >
                  {status === 'done' ? <Check className="size-3" /> : status === 'not_needed' ? <Minus className="size-3" /> : null}
                  {label}
                </button>
              )
            })
          : null}
        <span className="ml-auto flex items-center">
          {t.plan_url ? (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" asChild>
              <a href={inBrowser(t.plan_url)} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="size-3.5" /> Plan
              </a>
            </Button>
          ) : null}
          <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label={`Change ${t.name}`} onClick={onEdit}>
            <Pencil />
          </Button>
          <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label={`Remove ${t.name}`} onClick={() => del.mutate(t.id, { onError })}>
            <Trash2 />
          </Button>
        </span>
      </div>
    </Card>
  )
}

/** Add a booking to a trip, with the date to book it by. */
function AddBooking({ trips }: { trips: TripRow[] }) {
  const save = useSaveTripBooking()
  const [f, setF] = useState({ trip_id: trips[0]?.id ?? '', title: '', book_by: '' })
  const ready = Boolean(f.trip_id && f.title.trim())
  return (
    <form
      className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[8rem_1fr_9rem_auto]"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        save.mutate(
          { trip_id: f.trip_id, title: f.title.trim(), book_by: f.book_by || null, sort: Date.now() % 1_000_000_000 },
          { onSuccess: () => setF({ ...f, title: '', book_by: '' }), onError },
        )
      }}
    >
      <NativeSelect aria-label="Holiday" className="col-span-2 h-8 text-sm sm:col-span-1" value={f.trip_id} onChange={(e) => setF({ ...f, trip_id: e.target.value })}>
        {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </NativeSelect>
      <Input aria-label="Booking" placeholder="Add a booking" maxLength={200} className="h-8 text-sm" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <Input aria-label="Book by" type="date" className="h-8 text-sm" value={f.book_by} onChange={(e) => setF({ ...f, book_by: e.target.value })} />
      <Button type="submit" size="sm" variant="outline" className="h-8" disabled={!ready || save.isPending}>Add</Button>
    </form>
  )
}

const URGENCY_TONE: Record<Urgency, string> = {
  overdue: 'text-destructive',
  month: 'text-warning',
  quarter: 'text-foreground',
  later: 'text-muted-foreground',
}

/**
 * Everything still to book on the trips you're going on, as one list in the
 * order it needs booking: each plan's "Book now" bookings (by their book-by
 * date), then time off, travel, stay and insurance where still to do (dated
 * from the trip; see lib/todo.ts). Tap one when it's booked.
 */
function TodoList({ trips, bookings }: { trips: TripRow[]; bookings: TripBookingRow[] }) {
  const save = useSaveTrip()
  const saveBooking = useSaveTripBooking()
  const delBooking = useDeleteTripBooking()
  const today = todayISO()
  const going = trips.filter((t) => t.confirmed)
  const items = todoItems(going, bookings)
  const groups = (['overdue', 'month', 'quarter', 'later'] as const)
    .map((u) => ({ u, items: items.filter((i) => urgency(i.bookBy, today) === u) }))
    .filter((g) => g.items.length)

  return (
    <div className="grid gap-3">
      {!items.length ? (
        <Card>
          <EmptyState icon={CircleCheck} title="All booked" description="Nothing left to book for the holidays you're going on." className="py-6" />
        </Card>
      ) : (
        groups.map(({ u, items: rows }) => (
          <section key={u} aria-label={URGENCY_LABELS[u]}>
            <h2 className={cn('mb-1 px-1 text-xs font-semibold uppercase tracking-wide', URGENCY_TONE[u])}>
              {URGENCY_LABELS[u]} · {rows.length}
            </h2>
            <Card className="divide-y p-0">
              {rows.map((i) => (
                <div key={i.id} className="flex items-center gap-1 px-2">
                  <button
                    type="button"
                    disabled={save.isPending || saveBooking.isPending}
                    aria-label={`${i.label} for ${i.trip.name}: mark booked`}
                    className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
                    onClick={() =>
                      i.kind === 'booking'
                        ? saveBooking.mutate({ id: i.id, done: true }, { onError })
                        : save.mutate({ id: i.trip.id, [i.key]: 'done' }, { onError })
                    }
                  >
                    <span className="size-4 shrink-0 rounded-full border" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-snug">{i.label}</span>
                      <span className="block text-xs text-muted-foreground">{i.trip.name}</span>
                    </span>
                    <span className={cn('shrink-0 text-xs tabular', URGENCY_TONE[u])}>{i.bookBy ? byDate(i.bookBy, today) : '—'}</span>
                  </button>
                  {i.kind === 'booking' ? (
                    <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label={`Remove ${i.label}`} onClick={() => delBooking.mutate(i.id, { onError })}>
                      <Trash2 />
                    </Button>
                  ) : (
                    <span className="size-7 shrink-0" />
                  )}
                </div>
              ))}
            </Card>
          </section>
        ))
      )}
      {going.length ? <AddBooking trips={going} /> : null}
    </div>
  )
}

const TABS = ['planned', 'todo'] as const
type Tab = (typeof TABS)[number]

/**
 * Holidays: two tabs. Planned is every trip to come, soonest first, with what it
 * costs (for both of you), what's paid, what's sorted, and a link to its plan.
 * Ideas (alternatives not yet decided) are marked and left out of the total, and
 * the Travel agent doesn't chase them. Todo is what's still to book.
 */
export default function HolidaysPage() {
  const trips = useTrips()
  const bookings = useTripBookings()
  const [editing, setEditing] = useState<Form | null>(null)
  const [params, setParams] = useSearchParams()
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'planned'

  const going = (trips.data ?? []).filter((t) => t.confirmed)
  const total = going.reduce((s, t) => s + (t.cost_minor ?? 0), 0)
  const paid = going.reduce((s, t) => s + t.paid_minor, 0)
  const toBook = todoItems(going, bookings.data ?? []).length

  return (
    <>
      <PageHeader
        title="Holidays"
        description={going.length ? `${money(total)} for the ${going.length} you’re going on · ${money(paid)} paid` : undefined}
        actions={
          <Button size="sm" onClick={() => setEditing(toForm())}>
            <Plus /> Add
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams((p) => { p.set('tab', v); return p }, { replace: true })} className="md:max-w-2xl">
        <TabsList>
          <TabsTrigger value="planned">Planned</TabsTrigger>
          <TabsTrigger value="todo">Todo{toBook ? ` · ${toBook}` : ''}</TabsTrigger>
        </TabsList>
        {trips.error ? (
          <div className="mt-4"><ErrorState error={trips.error} onRetry={() => void trips.refetch()} /></div>
        ) : trips.isPending ? (
          <div className="mt-4"><ListSkeleton rows={4} /></div>
        ) : (
          <>
            <TabsContent value="planned">
              <div className="grid gap-2">
                {!trips.data.length ? (
                  <Card>
                    <EmptyState icon={Plane} title="No holidays yet" description="Add one with its dates, cost and the link to its plan." className="py-6" />
                  </Card>
                ) : (
                  trips.data.map((t) => <HolidayCard key={t.id} trip={t} onEdit={() => setEditing(toForm(t))} />)
                )}
              </div>
            </TabsContent>
            <TabsContent value="todo">
              <TodoList trips={trips.data} bookings={bookings.data ?? []} />
            </TabsContent>
          </>
        )}
      </Tabs>
      {editing ? <HolidayDialog initial={editing} trips={trips.data ?? []} onClose={() => setEditing(null)} /> : null}
    </>
  )
}
