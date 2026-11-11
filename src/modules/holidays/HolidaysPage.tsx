import { differenceInCalendarDays, parseISO } from 'date-fns'
import { Check, ExternalLink, Minus, Pencil, Plane, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { Progress, Segmented } from '@/components/ui/misc'
import { todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { formatMoney, parseMoney, toMoneyInput } from '@/lib/money'
import { cn } from '@/lib/utils'
import { inBrowser } from '@/modules/agents/components/AgentView'
import { dates, ITEMS, NEXT, STATUS_TEXT } from '@/modules/agents/components/Trips'
import { type TripRow, useDeleteTrip, useSaveTrip, useTrips } from '@/modules/agents/api'
import type { ItemStatus } from '../../../supabase/functions/_shared/agents/travel.ts'

const onError = (e: unknown) => toast.error(getErrorMessage(e))
const money = (minor: number) => formatMoney(minor, 'GBP', { hidePence: true })

type Form = { id?: string; name: string; starts_on: string; ends_on: string; cost: string; paid: string; plan_url: string; confirmed: boolean }

const toForm = (t?: TripRow): Form => ({
  id: t?.id,
  name: t?.name ?? '',
  starts_on: t?.starts_on ?? '',
  ends_on: t?.ends_on ?? '',
  cost: t?.cost_minor != null ? toMoneyInput(t.cost_minor) : '',
  paid: t?.paid_minor ? toMoneyInput(t.paid_minor) : '',
  plan_url: t?.plan_url ?? '',
  confirmed: t?.confirmed ?? true,
})

/** Add or change a holiday: name, dates, cost and paid (for both of you), the plan's link, and whether you're going or it's an idea. */
function HolidayDialog({ initial, onClose }: { initial: Form; onClose: () => void }) {
  const save = useSaveTrip()
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

/**
 * Holidays: every trip to come, soonest first, with what it costs (for both of
 * you), what's paid, what's sorted, and a link to its plan. Ideas (alternatives
 * not yet decided) are marked and left out of the total, and the Travel agent
 * doesn't chase them.
 */
export default function HolidaysPage() {
  const trips = useTrips()
  const [editing, setEditing] = useState<Form | null>(null)

  const going = (trips.data ?? []).filter((t) => t.confirmed)
  const total = going.reduce((s, t) => s + (t.cost_minor ?? 0), 0)
  const paid = going.reduce((s, t) => s + t.paid_minor, 0)

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
      <div className="grid gap-2 md:max-w-2xl">
        {trips.error ? (
          <ErrorState error={trips.error} onRetry={() => void trips.refetch()} />
        ) : trips.isPending ? (
          <ListSkeleton rows={4} />
        ) : !trips.data.length ? (
          <Card>
            <EmptyState icon={Plane} title="No holidays yet" description="Add one with its dates, cost and the link to its plan." className="py-6" />
          </Card>
        ) : (
          trips.data.map((t) => <HolidayCard key={t.id} trip={t} onEdit={() => setEditing(toForm(t))} />)
        )}
      </div>
      {editing ? <HolidayDialog initial={editing} onClose={() => setEditing(null)} /> : null}
    </>
  )
}
