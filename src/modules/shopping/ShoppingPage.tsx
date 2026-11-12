import { ExternalLink, Pencil, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/misc'
import { formatDay, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { type WantFields, type WantRow, useDeleteWant, useSaveWant, useSetBought, useWants } from './api'
import { splitWants, urgency } from './lib/sort'

const onError = (e: unknown) => toast.error(getErrorMessage(e))

export default function ShoppingPage() {
  const wants = useWants()
  const [editing, setEditing] = useState<Partial<WantRow> | null>(null)
  const [showBought, setShowBought] = useState(false)
  const { dated, whenever, bought } = splitWants(wants.data ?? [])

  return (
    <>
      <PageHeader
        title="Shopping"
        description="Things you need or would like to buy, with a date if there is one."
        actions={<Button onClick={() => setEditing({})}><Plus /> Add</Button>}
      />
      <QuickAdd />
      {wants.error ? (
        <ErrorState error={wants.error} onRetry={() => wants.refetch()} />
      ) : wants.isPending ? (
        <ListSkeleton rows={4} />
      ) : !wants.data.length ? (
        <Card>
          <EmptyState icon={ShoppingBag} title="Nothing on the list" description="Add something you need or would like to buy." />
        </Card>
      ) : (
        <>
          {dated.length ? <WantList title="By a date" rows={dated} onEdit={setEditing} /> : null}
          {whenever.length ? <WantList title="Whenever" rows={whenever} onEdit={setEditing} /> : null}
          {bought.length ? (
            showBought ? (
              <WantList
                title="Bought"
                rows={bought}
                onEdit={setEditing}
                action={<Button variant="ghost" size="sm" onClick={() => setShowBought(false)}>Hide</Button>}
              />
            ) : (
              <Button variant="ghost" size="sm" className="mt-4" onClick={() => setShowBought(true)}>Bought ({bought.length})</Button>
            )
          ) : null}
        </>
      )}
      {editing ? <WantDialog want={editing} onClose={() => setEditing(null)} /> : null}
    </>
  )
}

/** Type a name (and optionally a date) and press Enter. */
function QuickAdd() {
  const { me } = useHousehold()
  const save = useSaveWant()
  const [name, setName] = useState('')
  const [needBy, setNeedBy] = useState('')

  return (
    <form
      className="mb-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        save.mutate(
          { name: name.trim(), need_by: needBy || null, owner_id: me.id },
          { onSuccess: () => { setName(''); setNeedBy('') }, onError },
        )
      }}
    >
      <Input aria-label="Thing to buy" placeholder="Add something…" maxLength={80} className="min-w-0 flex-1" value={name} onChange={(e) => setName(e.target.value)} />
      <Input aria-label="Need it by" type="date" min={todayISO()} className="w-36 shrink-0" value={needBy} onChange={(e) => setNeedBy(e.target.value)} />
      <Button type="submit" size="icon" aria-label="Add" disabled={save.isPending || !name.trim()}><Plus /></Button>
    </form>
  )
}

function WantList({ title, rows, onEdit, action }: { title: string; rows: WantRow[]; onEdit: (w: WantRow) => void; action?: React.ReactNode }) {
  const { me, partner } = useHousehold()
  const setBought = useSetBought()
  const del = useDeleteWant()
  const today = todayISO()
  const who = (id: string | null) => (id === me.id ? me.display_name : id && id === partner?.id ? partner.display_name : null)

  return (
    <section>
      <SectionTitle action={action}>{title}</SectionTitle>
      <Card className="p-2">
        <ul className="divide-y">
          {rows.map((w) => {
            const due = w.need_by && !w.bought_at ? urgency(w.need_by, today) : null
            return (
              <li key={w.id} className="flex items-center gap-3 px-2 py-2.5 text-sm">
                <Checkbox
                  aria-label={w.bought_at ? `Put ${w.name} back on the list` : `Bought ${w.name}`}
                  checked={!!w.bought_at}
                  onCheckedChange={(c) => setBought.mutate({ id: w.id, bought: c === true }, { onError })}
                />
                <span className="min-w-0 flex-1">
                  <span className={cn('flex items-center gap-1.5 font-medium', w.bought_at && 'text-muted-foreground line-through')}>
                    <span className="truncate">{w.name}</span>
                    {w.url ? (
                      <a href={w.url} target="_blank" rel="noreferrer noopener" aria-label={`Open link for ${w.name}`} className="shrink-0 text-muted-foreground hover:text-foreground">
                        <ExternalLink className="size-3.5" />
                      </a>
                    ) : null}
                  </span>
                  {w.note || who(w.owner_id) ? (
                    <span className="block truncate text-xs text-muted-foreground">{[who(w.owner_id), w.note].filter(Boolean).join(' · ')}</span>
                  ) : null}
                </span>
                {w.need_by ? (
                  <span className={cn('shrink-0 text-xs', due === 'late' ? 'font-medium text-destructive' : due === 'soon' ? 'font-medium text-warning' : 'text-muted-foreground')}>
                    {formatDay(w.need_by)}
                  </span>
                ) : null}
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${w.name}`} onClick={() => onEdit(w)}><Pencil /></Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${w.name}`} onClick={() => del.mutate(w.id, { onError })}><Trash2 /></Button>
              </li>
            )
          })}
        </ul>
      </Card>
    </section>
  )
}

function WantDialog({ want, onClose }: { want: Partial<WantRow>; onClose: () => void }) {
  const { me, partner } = useHousehold()
  const save = useSaveWant()
  const [form, setForm] = useState<WantFields>({
    owner_id: want.id ? (want.owner_id ?? null) : me.id,
    name: want.name ?? '',
    need_by: want.need_by ?? null,
    note: want.note ?? null,
    url: want.url ?? null,
  })
  const set = (patch: Partial<WantFields>) => setForm({ ...form, ...patch })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title={want.id ? `Edit ${want.name}` : 'Add something'}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const url = form.url?.trim() || null
            save.mutate(
              { id: want.id, ...form, name: form.name.trim(), note: form.note?.trim() || null, url: url && !/^https?:\/\//.test(url) ? `https://${url}` : url },
              { onSuccess: onClose, onError },
            )
          }}
        >
          <Field label="What" htmlFor="want-name">
            <Input id="want-name" autoFocus required maxLength={80} value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="For" htmlFor="want-owner">
              <NativeSelect id="want-owner" value={form.owner_id ?? ''} onChange={(e) => set({ owner_id: e.target.value || null })}>
                <option value={me.id}>{me.display_name}</option>
                {partner ? <option value={partner.id}>{partner.display_name}</option> : null}
                <option value="">Both of us</option>
              </NativeSelect>
            </Field>
            <Field label="Need it by" htmlFor="want-date" hint="Leave empty if there's no rush.">
              <Input id="want-date" type="date" value={form.need_by ?? ''} onChange={(e) => set({ need_by: e.target.value || null })} />
            </Field>
          </div>
          <Field label="Link" htmlFor="want-url">
            <Input id="want-url" inputMode="url" maxLength={500} placeholder="https://…" value={form.url ?? ''} onChange={(e) => set({ url: e.target.value })} />
          </Field>
          <Field label="Note" htmlFor="want-note">
            <Textarea id="want-note" rows={2} maxLength={300} value={form.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
          </Field>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
