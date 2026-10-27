import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { Settings2 } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { StatTile } from '@/components/charts'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { useBalances, usePots } from '@/modules/finances/hooks'
import { fundPot } from '@/modules/finances/lib/pots'
import { type WeddingSettings, useBudgetItems, useGuests, useSaveWeddingSettings, useWeddingChecklist, useWeddingSettings } from './api'
import { BudgetTab } from './components/BudgetTab'
import { ChecklistTab } from './components/ChecklistTab'
import { GuestsTab } from './components/GuestsTab'
import { SuppliersTab } from './components/SuppliersTab'
import { money } from './lib/money'
import { budgetTotals, guestCounts, taskCounts } from './lib/summary'

const TABS = ['budget', 'guests', 'checklist', 'suppliers'] as const
type Tab = (typeof TABS)[number]

export default function WeddingPage() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'budget'
  const settings = useWeddingSettings()
  const budget = useBudgetItems()
  const guests = useGuests()
  const tasks = useWeddingChecklist(settings.data?.task_category_id)
  const pots = usePots()
  const balances = useBalances()
  const [editing, setEditing] = useState(false)
  const today = todayISO()

  const date = settings.data?.wedding_date
  const daysToGo = date ? differenceInCalendarDays(parseISO(date), parseISO(today)) : null
  const totals = budgetTotals(budget.data ?? [])
  const people = guestCounts(guests.data ?? [])
  const checklist = taskCounts(tasks.data ?? [], today)

  // What the Wedding pot has put towards the linked item, in the pot's funding order.
  const goal = pots.data?.items.find((i) => i.id === settings.data?.pot_goal_id)
  const pot = goal ? pots.data!.pots.find((p) => p.id === goal.pot_id) : undefined
  const saved =
    goal && pot
      ? fundPot(pot.account_id ? (balances.data?.get(pot.account_id) ?? 0) : 0, pots.data!.items.filter((i) => i.pot_id === pot.id)).items.find((i) => i.id === goal.id)
      : undefined

  return (
    <>
      <PageHeader
        title="Wedding"
        description={
          date
            ? `${format(parseISO(date), 'EEEE d MMMM yyyy')}${daysToGo !== null && daysToGo >= 0 ? ` · ${daysToGo === 0 ? 'today!' : `${daysToGo} days to go`}` : ''}`
            : 'Set the date in wedding settings.'
        }
        actions={<Button variant="outline" onClick={() => setEditing(true)}><Settings2 /> Settings</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Budget" value={money(totals.budget)} sub={`${money(totals.paid)} paid · ${money(totals.remaining)} to pay`} />
        <StatTile
          label={pot ? `Saved (${pot.name} pot)` : 'Saved'}
          value={saved ? money(saved.funded) : '—'}
          sub={saved ? `of ${money(saved.target_minor)}${totals.budget ? '' : ' (placeholder until the budget has items)'}` : 'Link a pot item in settings'}
        />
        <StatTile label="Guests coming" value={String(people.coming)} sub={`${people.invited} invited · ${people.awaiting} awaiting reply`} />
        <StatTile label="Checklist" value={`${checklist.done}/${checklist.done + checklist.open}`} sub={checklist.overdue ? `${checklist.overdue} overdue` : 'done'} tone={checklist.overdue ? 'danger' : undefined} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams((p) => { p.set('tab', v); return p }, { replace: true })}>
        <TabsList className="max-w-full">
          <TabsTrigger value="budget">Budget</TabsTrigger>
          <TabsTrigger value="guests">Guests</TabsTrigger>
          <TabsTrigger value="checklist">Checklist</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
        </TabsList>
        <TabsContent value="budget"><BudgetTab /></TabsContent>
        <TabsContent value="guests"><GuestsTab /></TabsContent>
        <TabsContent value="checklist"><ChecklistTab /></TabsContent>
        <TabsContent value="suppliers"><SuppliersTab /></TabsContent>
      </Tabs>

      {editing ? <SettingsDialog settings={settings.data ?? null} onClose={() => setEditing(false)} /> : null}
    </>
  )
}

function SettingsDialog({ settings, onClose }: { settings: WeddingSettings | null; onClose: () => void }) {
  const pots = usePots()
  const save = useSaveWeddingSettings()
  const [date, setDate] = useState(settings?.wedding_date ?? '')
  const [goalId, setGoalId] = useState(settings?.pot_goal_id ?? '')
  const potName = (id: string | null) => pots.data?.pots.find((p) => p.id === id)?.name ?? ''

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title="Wedding settings">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate({ wedding_date: date || null, pot_goal_id: goalId || null }, { onSuccess: onClose, onError: (err) => toast.error(getErrorMessage(err)) })
          }}
        >
          <Field label="Wedding date" htmlFor="w-date">
            <Input id="w-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Paid for by" htmlFor="w-goal" hint="This pot item's target always equals the budget total once the budget has items.">
            <NativeSelect id="w-goal" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">Not linked</option>
              {(pots.data?.items ?? []).map((i) => <option key={i.id} value={i.id}>{potName(i.pot_id)} · {i.name}</option>)}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
