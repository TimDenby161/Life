import { CalendarDays, ExternalLink, Plus, ShoppingBag, Trash2, X } from 'lucide-react'
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
import {
  type ListItem,
  type ShoppingTask,
  type WantFields,
  type WantRow,
  useAddListItem,
  useDeleteListItem,
  useDeleteWant,
  useSaveWant,
  useSetBought,
  useShoppingTask,
  useUpdateListItem,
  useWants,
} from './api'
import { fromChecklist, splitWants, urgency } from './lib/sort'

const onError = (e: unknown) => toast.error(getErrorMessage(e))

/** One line on the page: something added here, or an item on the Shoppinglist task's checklist. */
type Row = (WantRow & { source: 'want' }) | ReturnType<typeof fromChecklist<ListItem>>

export default function ShoppingPage() {
  const wants = useWants()
  const task = useShoppingTask()
  const [editing, setEditing] = useState<Row | null>(null)
  const [showBought, setShowBought] = useState(false)
  const rows: Row[] = [
    ...(wants.data ?? []).map((w) => ({ ...w, source: 'want' as const })),
    ...(task.data?.subtasks ?? []).map(fromChecklist),
  ]
  const { dated, whenever, bought } = splitWants(rows)
  const error = wants.error ?? task.error

  return (
    <>
      <PageHeader
        title="Shopping"
        description={
          task.data
            ? `Includes your “${task.data.title}” checklist. Tap one to change it.`
            : 'Things you need or would like to buy. Tap one to change it.'
        }
      />
      <QuickAdd task={task.data ?? null} />
      {error ? (
        <ErrorState error={error} onRetry={() => { void wants.refetch(); void task.refetch() }} />
      ) : wants.isPending || task.isPending ? (
        <ListSkeleton rows={4} />
      ) : !rows.length ? (
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
      {editing?.source === 'want' ? <WantDialog want={editing} onClose={() => setEditing(null)} /> : null}
      {editing?.source === 'list' ? <ListItemDialog item={editing.item} taskTitle={task.data?.title ?? 'Shoppinglist'} onClose={() => setEditing(null)} /> : null}
    </>
  )
}

/**
 * Type a name, optionally tap the calendar for a date, and press Enter. With a
 * Shoppinglist task it goes on that checklist, so the task and this page stay one list.
 */
function QuickAdd({ task }: { task: ShoppingTask | null }) {
  const { me } = useHousehold()
  const saveWant = useSaveWant()
  const addItem = useAddListItem()
  const pending = saveWant.isPending || addItem.isPending
  const [name, setName] = useState('')
  const [needBy, setNeedBy] = useState('')
  // The date box only exists once the calendar is tapped: iPhones can put today
  // into a blank date box the moment it's touched or tabbed into.
  const [dating, setDating] = useState(false)
  const reset = () => { setName(''); setNeedBy(''); setDating(false) }

  return (
    <form
      className="mb-2 grid gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim() || pending) return
        const due = dating && needBy ? needBy : null
        const done = { onSuccess: reset, onError }
        if (task) addItem.mutate({ task, title: name.trim(), dueDate: due }, done)
        else saveWant.mutate({ name: name.trim(), need_by: due, owner_id: me.id }, done)
      }}
    >
      <div className="flex gap-2">
        <Input aria-label="Thing to buy" placeholder="Add something…" maxLength={task ? 200 : 80} enterKeyHint="done" className="min-w-0 flex-1" value={name} onChange={(e) => setName(e.target.value)} />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn('size-10 shrink-0', dating ? 'text-foreground' : 'text-muted-foreground')}
          aria-label={dating ? 'No date' : 'Need it by a date'}
          aria-pressed={dating}
          onClick={() => { setDating(!dating); setNeedBy('') }}
        >
          <CalendarDays />
        </Button>
        <Button type="submit" size="icon" className="size-10 shrink-0" aria-label="Add" disabled={pending || !name.trim()}><Plus /></Button>
      </div>
      {dating ? (
        <Field label="Need it by" htmlFor="quick-date">
          <DateBox id="quick-date" min={todayISO()} value={needBy} onChange={setNeedBy} onClear={() => { setNeedBy(''); setDating(false) }} />
        </Field>
      ) : null}
    </form>
  )
}

function WantList({ title, rows, onEdit, action }: { title: string; rows: Row[]; onEdit: (w: Row) => void; action?: React.ReactNode }) {
  const { me, partner } = useHousehold()
  const setBought = useSetBought()
  const updateItem = useUpdateListItem()
  const tick = (w: Row, bought: boolean) =>
    w.source === 'list' ? updateItem.mutate({ id: w.id, is_done: bought }, { onError }) : setBought.mutate({ id: w.id, bought }, { onError })
  const today = todayISO()
  // Your own things need no name; your partner's and shared ones do.
  const who = (id: string | null) => (id === me.id ? null : id && id === partner?.id ? partner.display_name : 'Both')

  return (
    <section>
      <SectionTitle action={action}>{title}</SectionTitle>
      <Card className="p-1.5">
        <ul className="divide-y">
          {rows.map((w) => {
            const due = w.need_by && !w.bought_at ? urgency(w.need_by, today) : null
            const sub = w.source === 'want' ? [who(w.owner_id), w.note].filter(Boolean).join(' · ') : ''
            const url = w.source === 'want' ? w.url : null
            return (
              <li key={w.id} className="flex items-center text-sm">
                {/* Big tap area round the tick. */}
                <label className="grid shrink-0 cursor-pointer place-items-center self-stretch px-3">
                  <Checkbox
                    aria-label={w.bought_at ? `Put ${w.name} back on the list` : `Bought ${w.name}`}
                    checked={!!w.bought_at}
                    onCheckedChange={(c) => tick(w, c === true)}
                  />
                </label>
                <button type="button" onClick={() => onEdit(w)} className="flex min-w-0 flex-1 items-center gap-2 py-3 pr-2 text-left" aria-label={`Change ${w.name}`}>
                  <span className="min-w-0 flex-1">
                    <span className={cn('line-clamp-2 break-words font-medium', w.bought_at && 'text-muted-foreground line-through')}>{w.name}</span>
                    {sub ? <span className="block truncate text-xs text-muted-foreground">{sub}</span> : null}
                  </span>
                  {w.need_by ? (
                    <span className={cn('shrink-0 text-xs', due === 'late' ? 'font-medium text-destructive' : due === 'soon' ? 'font-medium text-warning' : 'text-muted-foreground')}>
                      {formatDay(w.need_by).replace(/^Today \(.*\)$/, 'Today')}
                    </span>
                  ) : null}
                </button>
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`Open link for ${w.name}`}
                    className="grid size-10 shrink-0 place-items-center text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                ) : null}
              </li>
            )
          })}
        </ul>
      </Card>
    </section>
  )
}

/** A date box with a button to take the date off (iPhone date pickers can't be left blank). */
function DateBox({ id, value, onChange, min, onClear }: { id: string; value: string; onChange: (value: string) => void; min?: string; onClear?: () => void }) {
  return (
    <div className="flex gap-2">
      <Input id={id} type="date" min={min} className="min-w-0 flex-1" value={value} onChange={(e) => onChange(e.target.value)} />
      {value || onClear ? (
        <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0" aria-label="No date" onClick={onClear ?? (() => onChange(''))}><X /></Button>
      ) : null}
    </div>
  )
}

/** A Shoppinglist checklist item: its name and date, as on the task. */
function ListItemDialog({ item, taskTitle, onClose }: { item: ListItem; taskTitle: string; onClose: () => void }) {
  const update = useUpdateListItem()
  const del = useDeleteListItem()
  const [title, setTitle] = useState(item.title)
  const [dueDate, setDueDate] = useState(item.due_date ?? '')

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title={`Edit ${item.title}`} description={`On your “${taskTitle}” checklist`}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            update.mutate({ id: item.id, title: title.trim(), due_date: dueDate || null }, { onSuccess: onClose, onError })
          }}
        >
          <Field label="What" htmlFor="item-name">
            <Input id="item-name" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Need it by" htmlFor="item-date" hint="Leave empty if there's no rush.">
            <DateBox id="item-date" value={dueDate} onChange={setDueDate} />
          </Field>
          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              className="text-destructive sm:mr-auto"
              disabled={del.isPending}
              onClick={() => del.mutate(item.id, { onSuccess: onClose, onError })}
            >
              <Trash2 /> Remove
            </Button>
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={update.isPending || !title.trim()}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function WantDialog({ want, onClose }: { want: Partial<WantRow>; onClose: () => void }) {
  const { me, partner } = useHousehold()
  const save = useSaveWant()
  const del = useDeleteWant()
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
            <Input id="want-name" autoFocus={!want.id} required maxLength={80} value={form.name} onChange={(e) => set({ name: e.target.value })} />
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
              <DateBox id="want-date" value={form.need_by ?? ''} onChange={(v) => set({ need_by: v || null })} />
            </Field>
          </div>
          <Field label="Link" htmlFor="want-url">
            <Input id="want-url" inputMode="url" maxLength={500} placeholder="https://…" value={form.url ?? ''} onChange={(e) => set({ url: e.target.value })} />
          </Field>
          <Field label="Note" htmlFor="want-note">
            <Textarea id="want-note" rows={2} maxLength={300} value={form.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
          </Field>
          <DialogFooter>
            {want.id ? (
              <Button
                variant="ghost"
                type="button"
                className="text-destructive sm:mr-auto"
                disabled={del.isPending}
                onClick={() => del.mutate(want.id!, { onSuccess: onClose, onError })}
              >
                <Trash2 /> Remove
              </Button>
            ) : null}
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
