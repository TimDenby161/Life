import { Check, Minus, Pencil, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/misc'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { ItemStatus } from '../../../../supabase/functions/_shared/agents/travel.ts'
import { type TripInput, type TripRow, useDeleteTrip, useSaveTrip, useTrips } from '../api'

export const ITEMS = [
  { key: 'time_off', label: 'Time off' },
  { key: 'transport', label: 'Travel' },
  { key: 'stay', label: 'Stay' },
  { key: 'insurance', label: 'Insurance' },
] as const
export const NEXT: Record<ItemStatus, ItemStatus> = { todo: 'done', done: 'not_needed', not_needed: 'todo' }
export const STATUS_TEXT: Record<ItemStatus, string> = { todo: 'to do', done: 'done', not_needed: 'not needed' }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "12–19 Jan 2027", "28 Feb – 3 Mar 2027". */
export function dates(from: string, to: string) {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  if (from === to) return `${fd} ${MONTHS[fm - 1]} ${fy}`
  if (fy === ty && fm === tm) return `${fd}–${td} ${MONTHS[tm - 1]} ${ty}`
  return `${fd} ${MONTHS[fm - 1]}${fy === ty ? '' : ` ${fy}`} – ${td} ${MONTHS[tm - 1]} ${ty}`
}

const blank = (): TripInput & { id?: string } => ({
  name: '',
  owner_id: null,
  starts_on: '',
  ends_on: '',
  abroad: true,
  transport: 'todo',
  stay: 'todo',
  insurance: 'todo',
  time_off: 'todo',
  cost_minor: null,
  paid_minor: 0,
  plan_url: null,
  confirmed: true,
})

/** Trips coming up and what's sorted for each. Both of you can see and edit them. */
export function Trips() {
  const { me, partner, member } = useHousehold()
  const trips = useTrips()
  const save = useSaveTrip()
  const remove = useDeleteTrip()
  const [form, setForm] = useState<(TripInput & { id?: string }) | null>(null)
  const onError = (e: unknown) => toast.error(getErrorMessage(e))

  return (
    <div className="grid gap-2 rounded-xl border p-3">
      <h4 className="text-sm font-semibold">Trips</h4>
      {trips.data?.length ? (
        <ul className="grid gap-3">
          {trips.data.map((t: TripRow) => (
            <li key={t.id} className="grid gap-1.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {t.name}
                  <span className="text-muted-foreground"> · {t.owner_id ? (member(t.owner_id)?.display_name ?? 'Someone') : 'Both'}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">{dates(t.starts_on, t.ends_on)}</span>
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setForm({ ...t })}>
                  <Pencil />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${t.name}`} onClick={() => remove.mutate(t.id, { onError })}>
                  <X />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ITEMS.map(({ key, label }) => {
                  const status = t[key] as ItemStatus
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={save.isPending}
                      aria-label={`${label}: ${STATUS_TEXT[status]}`}
                      onClick={() => save.mutate({ id: t.id, [key]: NEXT[status] }, { onError })}
                      className={cn(
                        'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs',
                        status === 'done' && 'border-transparent bg-success/15 text-success',
                        status === 'not_needed' && 'text-muted-foreground line-through',
                      )}
                    >
                      {status === 'done' ? <Check className="size-3" /> : status === 'not_needed' ? <Minus className="size-3" /> : null}
                      {label}
                    </button>
                  )
                })}
              </div>
            </li>
          ))}
        </ul>
      ) : trips.isPending ? null : (
        <p className="text-sm text-muted-foreground">No trips coming up.</p>
      )}

      {form ? (
        <form
          className="grid gap-2 border-t pt-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (form.ends_on < form.starts_on) return toast.error('The trip ends before it starts.')
            // A trip at home doesn't need travel insurance unless they've said otherwise.
            const insurance = !form.id && !form.abroad ? 'not_needed' : form.insurance
            save.mutate({ ...form, name: form.name.trim(), insurance }, { onSuccess: () => setForm(null), onError })
          }}
        >
          <div className="flex flex-wrap gap-2">
            <Input aria-label="Trip" placeholder="e.g. Rome" className="h-8 min-w-40 flex-1" maxLength={60} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <NativeSelect aria-label="Who’s going" className="h-8 w-auto" value={form.owner_id ?? ''} onChange={(e) => setForm({ ...form, owner_id: e.target.value || null })}>
              <option value="">Both</option>
              <option value={me.id}>{me.display_name}</option>
              {partner ? <option value={partner.id}>{partner.display_name}</option> : null}
            </NativeSelect>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Input
              type="date"
              aria-label="From"
              className="h-8 w-auto"
              required
              value={form.starts_on}
              onChange={(e) => setForm({ ...form, starts_on: e.target.value, ends_on: form.ends_on && form.ends_on >= e.target.value ? form.ends_on : e.target.value })}
            />
            to
            <Input type="date" aria-label="To" className="h-8 w-auto" required min={form.starts_on} value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />
            <label className="flex items-center gap-1.5">
              <Checkbox checked={form.abroad} onCheckedChange={(v) => setForm({ ...form, abroad: v === true })} aria-label="Abroad" />
              Abroad
            </label>
            <div className="ml-auto flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={save.isPending}>{form.id ? 'Save' : 'Add'}</Button>
            </div>
          </div>
        </form>
      ) : (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setForm(blank())}>
            <Plus /> Trip
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Tap Time off, Travel, Stay or Insurance to mark it done, then not needed. Shared with your partner.</p>
    </div>
  )
}
