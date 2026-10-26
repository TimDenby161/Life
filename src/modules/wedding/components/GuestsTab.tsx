import { Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Badge, Segmented, Switch } from '@/components/ui/misc'
import { getErrorMessage } from '@/lib/errors'
import { type Guest, useDeleteGuest, useGuests, useSaveGuest } from '../api'
import { guestCounts } from '../lib/summary'

const RSVP = [
  { value: 'pending', label: 'Awaiting' },
  { value: 'yes', label: 'Coming' },
  { value: 'no', label: 'Not coming' },
] as const
type Filter = 'all' | 'pending' | 'yes' | 'no'

export function GuestsTab() {
  const guests = useGuests()
  const save = useSaveGuest()
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<Guest | 'new' | null>(null)

  if (guests.isPending) return <ListSkeleton rows={5} />
  if (guests.error) return <ErrorState error={guests.error} onRetry={() => guests.refetch()} />
  const c = guestCounts(guests.data)
  const shown = guests.data.filter((g) => filter === 'all' || g.rsvp === filter)
  const parties = [...new Set(shown.map((g) => g.party ?? ''))]

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground tabular">
          {c.invited} invited ({c.day} day, {c.evening} evening) · {c.coming} coming · {c.notComing} not · {c.awaiting} awaiting
        </p>
        <Button variant="outline" size="sm" onClick={() => setEditing('new')}><Plus /> Add guest</Button>
      </div>
      {guests.data.length ? (
        <Segmented
          aria-label="Show"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[{ value: 'all', label: 'Everyone' }, ...RSVP.map((r) => ({ value: r.value, label: r.label }))]}
        />
      ) : null}
      {!guests.data.length ? (
        <Card><EmptyState icon={Users} title="No guests yet" description="Add guests with their invite (day or evening), plus-one, dietary needs and table." /></Card>
      ) : (
        parties.map((party) => (
          <Card key={party || 'none'} className="overflow-hidden">
            <div className="border-b bg-muted/40 px-4 py-2 text-sm font-semibold">{party || 'No group'}</div>
            <ul className="divide-y">
              {shown.filter((g) => (g.party ?? '') === party).map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{g.name}{g.plus_one ? <span className="font-normal text-muted-foreground"> +1</span> : null}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[g.invite === 'evening' ? 'Evening' : 'Day', g.dietary, g.table_name && `Table ${g.table_name}`].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <NativeSelect
                    aria-label={`RSVP for ${g.name}`}
                    value={g.rsvp}
                    onChange={(e) => save.mutate({ id: g.id, name: g.name, rsvp: e.target.value }, { onError: (err) => toast.error(getErrorMessage(err)) })}
                    className="h-8 w-32 text-[13px]"
                  >
                    {RSVP.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </NativeSelect>
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g)}><Pencil /></Button>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
      {editing ? <GuestDialog guest={editing === 'new' ? undefined : editing} parties={[...new Set(guests.data.flatMap((g) => g.party ?? []))]} onClose={() => setEditing(null)} /> : null}
    </div>
  )
}

function GuestDialog({ guest, parties, onClose }: { guest?: Guest; parties: string[]; onClose: () => void }) {
  const save = useSaveGuest()
  const del = useDeleteGuest()
  const [name, setName] = useState(guest?.name ?? '')
  const [party, setParty] = useState(guest?.party ?? '')
  const [invite, setInvite] = useState<'day' | 'evening'>((guest?.invite as 'day' | 'evening') ?? 'day')
  const [rsvp, setRsvp] = useState(guest?.rsvp ?? 'pending')
  const [plusOne, setPlusOne] = useState(guest?.plus_one ?? false)
  const [dietary, setDietary] = useState(guest?.dietary ?? '')
  const [table, setTable] = useState(guest?.table_name ?? '')
  const [notes, setNotes] = useState(guest?.notes ?? '')
  const [confirm, setConfirm] = useState(false)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title={guest ? `Edit ${guest.name}` : 'Add a guest'}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            save.mutate(
              { id: guest?.id, name: name.trim(), party: party.trim() || null, invite, rsvp, plus_one: plusOne, dietary: dietary.trim() || null, table_name: table.trim() || null, notes: notes.trim() || null },
              { onSuccess: () => { if (guest) onClose(); else { setName(''); setPlusOne(false); setDietary(''); toast.success('Guest added') } }, onError: (err) => toast.error(getErrorMessage(err)) },
            )
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="g-name"><Input id="g-name" autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label="Group" htmlFor="g-party" hint="e.g. Tim's family, Uni friends">
              <Input id="g-party" list="g-parties" value={party} maxLength={60} onChange={(e) => setParty(e.target.value)} />
              <datalist id="g-parties">{parties.map((p) => <option key={p} value={p} />)}</datalist>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Segmented aria-label="Invited to" size="sm" value={invite} onChange={setInvite} options={[{ value: 'day', label: 'Day' }, { value: 'evening', label: 'Evening' }]} />
            <label className="flex items-center gap-2 text-sm"><Switch checked={plusOne} onCheckedChange={setPlusOne} /> Plus-one</label>
            {guest ? null : <Badge>Adds and stays open for the next guest</Badge>}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="RSVP" htmlFor="g-rsvp">
              <NativeSelect id="g-rsvp" value={rsvp} onChange={(e) => setRsvp(e.target.value)}>
                {RSVP.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Dietary" htmlFor="g-diet"><Input id="g-diet" value={dietary} maxLength={200} placeholder="e.g. Vegetarian" onChange={(e) => setDietary(e.target.value)} /></Field>
            <Field label="Table" htmlFor="g-table"><Input id="g-table" value={table} maxLength={60} onChange={(e) => setTable(e.target.value)} /></Field>
          </div>
          <Field label="Notes" htmlFor="g-notes"><Textarea id="g-notes" rows={2} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} /></Field>
          <DialogFooter className="sm:justify-between">
            {guest ? (
              <Button type="button" variant={confirm ? 'destructive' : 'ghost'} onClick={() => (confirm ? del.mutate(guest.id, { onSuccess: onClose }) : setConfirm(true))}>
                <Trash2 /> {confirm ? `Remove ${guest.name}?` : 'Remove'}
              </Button>
            ) : <Button type="button" variant="ghost" onClick={onClose}>Done</Button>}
            <Button type="submit" disabled={save.isPending}>{guest ? 'Save' : 'Add guest'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
