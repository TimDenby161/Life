import { Cake, Check, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { daysBetween, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { nextBirthday } from '../../../supabase/functions/_shared/agents/people.ts'
import { type PersonFields, type PersonRow, useDeletePerson, usePeople, useSavePerson } from './api'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const EVERY = [1, 2, 4, 6, 8, 12, 26]

const birthday = (p: PersonRow) => (p.birthday_month && p.birthday_day ? `${p.birthday_day} ${MONTHS[p.birthday_month - 1].slice(0, 3)}` : null)

/** "6 weeks ago", "today". */
function ago(date: string) {
  const days = daysBetween(date, todayISO())
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  return `${Math.round(days / 7)} weeks ago`
}

export default function PeoplePage() {
  const { me, partner } = useHousehold()
  const people = usePeople()
  const save = useSavePerson()
  const del = useDeletePerson()
  const [editing, setEditing] = useState<Partial<PersonRow> | null>(null)
  const today = todayISO()
  const onError = (e: unknown) => toast.error(getErrorMessage(e))

  const groups = [
    { title: me.display_name, owner: me.id },
    ...(partner ? [{ title: partner.display_name, owner: partner.id }] : []),
    { title: 'Joint', owner: null },
  ]
  // Soonest birthday first, then by name.
  const sorted = [...(people.data ?? [])].sort((a, b) => {
    const next = (p: PersonRow) => (p.birthday_month && p.birthday_day ? nextBirthday(today, p.birthday_month, p.birthday_day) : '9999')
    return next(a).localeCompare(next(b)) || a.name.localeCompare(b.name)
  })

  return (
    <>
      <PageHeader
        title="People"
        description="Friends and family, their birthdays and how often you’d like to see them. The Friends agent reminds you a week before a birthday and when it’s been a while."
        actions={<Button onClick={() => setEditing({ owner_id: me.id })}><Plus /> Person</Button>}
      />
      {people.error ? (
        <ErrorState error={people.error} onRetry={() => people.refetch()} />
      ) : people.isPending ? (
        <ListSkeleton rows={4} />
      ) : !sorted.length ? (
        <Card>
          <EmptyState icon={Users} title="No one yet" description="Add the people you want to keep in touch with." action={<Button size="sm" onClick={() => setEditing({ owner_id: me.id })}>Add someone</Button>} />
        </Card>
      ) : (
        groups.map((g) => {
          const rows = sorted.filter((p) => p.owner_id === g.owner)
          if (!rows.length) return null
          return (
            <section key={g.title}>
              <SectionTitle action={<Button variant="ghost" size="sm" onClick={() => setEditing({ owner_id: g.owner })}><Plus /> Add</Button>}>{g.title}</SectionTitle>
              <Card className="p-2">
                <ul className="divide-y">
                  {rows.map((p) => {
                    const overdue = p.see_every_weeks && (!p.last_seen_on || daysBetween(p.last_seen_on, today) > p.see_every_weeks * 7)
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2.5 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {[
                              p.see_every_weeks ? `Every ${p.see_every_weeks === 1 ? 'week' : `${p.see_every_weeks} weeks`}` : null,
                              p.last_seen_on ? `seen ${ago(p.last_seen_on)}` : p.see_every_weeks ? 'not seen yet' : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        {birthday(p) ? (
                          <span className="flex items-center gap-1 text-muted-foreground"><Cake className="size-3.5" />{birthday(p)}</span>
                        ) : null}
                        <Button
                          size="sm"
                          variant={overdue ? 'default' : 'outline'}
                          className="h-7"
                          disabled={save.isPending || p.last_seen_on === today}
                          onClick={() => save.mutate({ id: p.id, last_seen_on: today }, { onSuccess: () => toast.success(`Saw ${p.name}`), onError })}
                        >
                          <Check /> Saw them
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}><Pencil /></Button>
                        <Button size="icon-sm" variant="ghost" aria-label={`Remove ${p.name}`} onClick={() => del.mutate(p.id, { onError })}><Trash2 /></Button>
                      </li>
                    )
                  })}
                </ul>
              </Card>
            </section>
          )
        })
      )}
      {editing ? <PersonDialog person={editing} onClose={() => setEditing(null)} /> : null}
    </>
  )
}

function PersonDialog({ person, onClose }: { person: Partial<PersonRow>; onClose: () => void }) {
  const { me, partner } = useHousehold()
  const save = useSavePerson()
  const [form, setForm] = useState<PersonFields>({
    owner_id: person.owner_id ?? null,
    name: person.name ?? '',
    birthday_month: person.birthday_month ?? null,
    birthday_day: person.birthday_day ?? null,
    see_every_weeks: person.see_every_weeks ?? null,
    last_seen_on: person.last_seen_on ?? null,
  })
  const set = (patch: Partial<PersonFields>) => setForm({ ...form, ...patch })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title={person.id ? `Edit ${person.name}` : 'Add someone'}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const fields = { ...form, name: form.name.trim(), ...(form.birthday_month && form.birthday_day ? {} : { birthday_month: null, birthday_day: null }) }
            save.mutate({ id: person.id, ...fields }, { onSuccess: onClose, onError: (err) => toast.error(getErrorMessage(err)) })
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="person-name">
              <Input id="person-name" autoFocus required maxLength={60} value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Whose friend" htmlFor="person-owner">
              <NativeSelect id="person-owner" value={form.owner_id ?? ''} onChange={(e) => set({ owner_id: e.target.value || null })}>
                <option value={me.id}>{me.display_name}</option>
                {partner ? <option value={partner.id}>{partner.display_name}</option> : null}
                <option value="">Joint</option>
              </NativeSelect>
            </Field>
          </div>
          <Field label="Birthday" htmlFor="person-day" hint="Optional. No year needed.">
            <div className="flex gap-2">
              <NativeSelect id="person-day" aria-label="Day" className="w-auto" value={form.birthday_day ?? ''} onChange={(e) => set({ birthday_day: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Day</option>
                {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </NativeSelect>
              <NativeSelect aria-label="Month" className="w-auto" value={form.birthday_month ?? ''} onChange={(e) => set({ birthday_month: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Month</option>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </NativeSelect>
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="See them every" htmlFor="person-every">
              <NativeSelect id="person-every" value={form.see_every_weeks ?? ''} onChange={(e) => set({ see_every_weeks: e.target.value ? Number(e.target.value) : null })}>
                <option value="">No reminder</option>
                {EVERY.map((w) => <option key={w} value={w}>{w === 1 ? 'Week' : `${w} weeks`}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Last seen" htmlFor="person-seen">
              <Input id="person-seen" type="date" max={todayISO()} value={form.last_seen_on ?? ''} onChange={(e) => set({ last_seen_on: e.target.value || null })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
