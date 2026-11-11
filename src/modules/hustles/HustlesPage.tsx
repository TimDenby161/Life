import { AlertTriangle, ExternalLink, Plus, Repeat, Settings2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, NativeSelect } from '@/components/ui/input'
import { Segmented } from '@/components/ui/misc'
import { addDaysISO, formatDay, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { formatMoney, parseMoney, toMoneyInput } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { useOpenOccurrences, useTaskCategories } from '@/modules/tasks/hooks'
import { type ProjectTotals, type Side, spreadsheetIdFrom, totalsByProject } from '../../../supabase/functions/_shared/hustles.ts'
import {
  type HustleCharge,
  type HustleSettings,
  useAddCharge,
  useAddEntry,
  useAddHustle,
  useCharges,
  useDeleteCharge,
  useHustles,
  useHustleSettings,
  useSaveSettings,
  useSetCategory,
  useSheet,
} from './api'

const onError = (e: unknown) => toast.error(getErrorMessage(e))
const money = (minor: number) => formatMoney(minor, 'GBP', { hidePence: Math.abs(minor) >= 10000 })
const signed = (minor: number) => `${minor < 0 ? '−' : minor > 0 ? '+' : ''}${money(Math.abs(minor))}`

/** Paste the sheet's link (and the tab, CashFlow by default). It has to be shared with the service account as an Editor. */
function SheetLink({ existing, onDone }: { existing?: HustleSettings; onDone?: () => void }) {
  const save = useSaveSettings()
  const [link, setLink] = useState(existing?.spreadsheet_id ?? '')
  const [tab, setTab] = useState(existing?.sheet_name ?? 'CashFlow')
  const id = spreadsheetIdFrom(link)
  return (
    <form
      className="grid gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (id) save.mutate({ spreadsheet_id: id, sheet_name: tab.trim() || 'CashFlow', exists: Boolean(existing) }, { onSuccess: onDone, onError })
      }}
    >
      <Input aria-label="Link to the sheet" placeholder="Paste the link to The Corner" className="h-9" value={link} onChange={(e) => setLink(e.target.value)} />
      <div className="flex gap-1.5">
        <Input aria-label="Tab" placeholder="Tab" className="h-9" value={tab} onChange={(e) => setTab(e.target.value)} />
        <Button type="submit" size="sm" className="h-9" disabled={!id || save.isPending}>
          Save
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Share the sheet with the app’s Google service account (the one MonthReport uses) as an Editor, so it can add rows.</p>
    </form>
  )
}

/** A regular charge that's due: confirm the amount and it goes into the sheet, ticking its task. */
function DueCharge({ charge, project, due }: { charge: HustleCharge; project: string; due: string }) {
  const add = useAddEntry()
  const [amount, setAmount] = useState(toMoneyInput(charge.usual_minor))
  const minor = parseMoney(amount)
  return (
    <li className="flex items-center gap-1.5 rounded-lg bg-warning/10 px-2 py-1.5 text-sm">
      <span className="min-w-0 flex-1 truncate">
        {charge.description} <span className="text-xs text-muted-foreground">· {formatDay(due)}</span>
      </span>
      <Input aria-label={`Amount for ${charge.description}`} inputMode="decimal" className="h-8 w-20" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Button
        size="sm"
        className="h-8"
        disabled={minor === null || add.isPending}
        onClick={() =>
          add.mutate(
            { side: charge.kind as Side, date: todayISO(), project, description: charge.description, amountMinor: minor!, chargeId: charge.id },
            { onSuccess: (r) => (r.status === 'ok' ? toast.success(`Added to the sheet (row ${r.row})`) : toast.error(r.message)), onError },
          )
        }
      >
        Add
      </Button>
    </li>
  )
}

/** Settings for one side hustle: whose tasks are its upcoming jobs, and its regular charges. */
function HustleSettingsPanel({ name, categoryId, charges }: { name: string; categoryId: string | null; charges: HustleCharge[] }) {
  const categories = useTaskCategories().data ?? []
  const setCategory = useSetCategory()
  const addCharge = useAddCharge()
  const del = useDeleteCharge()
  const [kind, setKind] = useState<Side>('out')
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [day, setDay] = useState('24')
  const minor = parseMoney(amount)
  const dayNum = Number(day)
  const ready = Boolean(desc.trim()) && minor !== null && Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= 31

  return (
    <div className="grid gap-2 border-t px-3 pb-3 pt-2 text-sm">
      <label className="flex items-center gap-2">
        <span className="shrink-0 text-xs text-muted-foreground">Tasks from</span>
        <NativeSelect
          aria-label={`Task category for ${name}`}
          className="h-8 text-sm"
          value={categoryId ?? ''}
          onChange={(e) => setCategory.mutate({ name, categoryId: e.target.value || null }, { onError })}
        >
          <option value="">No category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
      </label>
      {charges.length ? (
        <ul className="grid gap-1">
          {charges.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <Repeat className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{c.description}</span>
              <span className="tabular text-muted-foreground">{c.kind === 'in' ? '+' : ''}{money(c.usual_minor)}/mo</span>
              <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label={`Stop ${c.description}`} onClick={() => del.mutate(c, { onError })}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="grid grid-cols-[auto_minmax(0,1fr)_4.5rem_3rem_auto] gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready)
            addCharge.mutate(
              { hustleName: name, kind, description: desc.trim(), usualMinor: minor!, monthDay: dayNum },
              { onSuccess: () => { setDesc(''); setAmount('') }, onError },
            )
        }}
      >
        <NativeSelect aria-label="Charge or income" className="h-8 w-14 px-1 text-xs" value={kind} onChange={(e) => setKind(e.target.value as Side)}>
          <option value="out">Out</option>
          <option value="in">In</option>
        </NativeSelect>
        <Input aria-label="Regular charge" placeholder="Monthly charge" maxLength={80} className="h-8 text-sm" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <Input aria-label="Usual amount" placeholder="£" inputMode="decimal" className="h-8 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input aria-label="Day of the month" title="Day of the month" inputMode="numeric" className="h-8 text-sm" value={day} onChange={(e) => setDay(e.target.value)} />
        <Button type="submit" size="icon-sm" variant="outline" className="size-8" aria-label="Add regular charge" disabled={!ready || addCharge.isPending}>
          <Plus />
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">Each regular charge gets a monthly task. Adding it here writes it to the sheet and ticks the task off.</p>
    </div>
  )
}

/** One side hustle: money this month and all time, regular charges that are due, and its next tasks. */
function HustleCard({ name, totals, mine }: { name: string; totals: ProjectTotals | undefined; mine: boolean }) {
  const hustles = useHustles().data ?? []
  const charges = useCharges().data ?? []
  const open = useOpenOccurrences().data ?? []
  const [settings, setSettings] = useState(false)
  const hustle = hustles.find((h) => h.name.toLowerCase() === name.toLowerCase())
  const theirCharges = hustle ? charges.filter((c) => c.hustle_id === hustle.id) : []
  const soon = addDaysISO(todayISO(), 3)
  const due = theirCharges.flatMap((c) => {
    const occ = open.find((o) => o.task_id === c.task_id)
    return occ?.due_date && occ.due_date <= soon ? [{ charge: c, due: occ.due_date }] : []
  })
  const chargeTasks = new Set(charges.map((c) => c.task_id))
  const tasks = hustle?.category_id
    ? open
        .filter((o) => o.task.category_id === hustle.category_id && !chargeTasks.has(o.task_id))
        .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
        .slice(0, 3)
    : []
  const net = totals ? totals.inAll - totals.outAll : 0

  return (
    <Card>
      <div className="flex items-start gap-2 p-3 pb-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{name}</h2>
          <p className="text-xs text-muted-foreground tabular">
            {totals ? (
              <>This month <span className="text-foreground">{signed(totals.inMonth - totals.outMonth)}</span> · out {money(totals.outMonth)} · in {money(totals.inMonth)}</>
            ) : (
              'Nothing in the sheet yet'
            )}
          </p>
        </div>
        <span className="text-right">
          <span className={cn('block font-semibold tabular', net < 0 ? 'text-destructive' : net > 0 ? 'text-success' : '')}>{signed(net)}</span>
          <span className="block text-[11px] text-muted-foreground">all time</span>
        </span>
        {mine ? (
          <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label={`Settings for ${name}`} aria-expanded={settings} onClick={() => setSettings(!settings)}>
            <Settings2 />
          </Button>
        ) : null}
      </div>
      {due.length && mine ? (
        <ul className="grid gap-1 px-3 pb-2">
          {due.map(({ charge, due: d }) => <DueCharge key={charge.id} charge={charge} project={name} due={d} />)}
        </ul>
      ) : null}
      {tasks.length ? (
        <ul className="grid gap-0.5 px-3 pb-3 text-sm">
          {tasks.map((o) => (
            <li key={o.id} className="flex gap-2">
              <span className="min-w-0 flex-1 truncate">{o.task.title}</span>
              {o.due_date ? <span className={cn('shrink-0 text-xs', o.due_date < todayISO() ? 'text-destructive' : 'text-muted-foreground')}>{formatDay(o.due_date)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {settings ? <HustleSettingsPanel name={name} categoryId={hustle?.category_id ?? null} charges={theirCharges} /> : null}
    </Card>
  )
}

/** A one-off entry straight into the sheet. */
function AddEntry({ projects }: { projects: string[] }) {
  const add = useAddEntry()
  const [side, setSide] = useState<Side>('out')
  const [project, setProject] = useState('')
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const minor = parseMoney(amount)
  const ready = Boolean(project.trim()) && minor !== null && Boolean(date)
  return (
    <Card className="p-3">
      <form
        className="grid grid-cols-2 gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!ready) return
          add.mutate(
            { side, date, project: project.trim(), description: desc.trim(), amountMinor: minor! },
            {
              onSuccess: (r) => {
                if (r.status !== 'ok') return void toast.error(r.message)
                toast.success(`Added to the sheet (row ${r.row})`)
                setDesc('')
                setAmount('')
              },
              onError,
            },
          )
        }}
      >
        <Segmented
          aria-label="Money out or in"
          size="sm"
          className="col-span-2 w-full [&>*]:flex-1"
          value={side}
          onChange={(v) => setSide(v as Side)}
          options={[{ value: 'out', label: 'Out' }, { value: 'in', label: 'In' }]}
        />
        <Input aria-label="Project" placeholder="Project" list="hustle-names" maxLength={60} className="h-9" value={project} onChange={(e) => setProject(e.target.value)} />
        <Input aria-label="Date" type="date" className="h-9" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input aria-label="Description" placeholder="What for" maxLength={120} className="h-9" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <Input aria-label="Amount" placeholder="£" inputMode="decimal" className="h-9" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button type="submit" size="sm" className="col-span-2" disabled={!ready || add.isPending}>
          <Plus /> Add to the sheet
        </Button>
        <datalist id="hustle-names">
          {projects.map((p) => <option key={p} value={p} />)}
        </datalist>
      </form>
    </Card>
  )
}

/**
 * Side hustles: each project's money from The Corner sheet (this month and all
 * time), regular charges due (adding one writes it to the sheet and ticks its
 * task), and its next tasks; then a one-off entry, and rows the sheet has that
 * can't be read.
 */
export default function HustlesPage() {
  const { me } = useHousehold()
  const settingsQ = useHustleSettings()
  const hustles = useHustles()
  const addHustle = useAddHustle()
  const mineSettings = settingsQ.data?.find((s) => s.user_id === me.id)
  const anySettings = mineSettings ?? settingsQ.data?.[0]
  const sheet = useSheet(Boolean(anySettings))
  const [linking, setLinking] = useState(false)
  const [newName, setNewName] = useState('')
  const month = todayISO().slice(0, 7)

  if (settingsQ.error) return <ErrorState error={settingsQ.error} onRetry={() => void settingsQ.refetch()} />
  if (settingsQ.isPending || hustles.isPending) return <ListSkeleton rows={4} />

  if (!anySettings || linking) {
    return (
      <>
        <PageHeader title="Side hustles" />
        <Card className="p-3 md:max-w-2xl">
          <h2 className="mb-2 text-sm font-semibold">Link The Corner sheet</h2>
          <SheetLink existing={mineSettings} onDone={() => setLinking(false)} />
        </Card>
      </>
    )
  }

  const data = sheet.data?.status === 'ok' ? sheet.data : null
  const totals = data ? totalsByProject(data.entries, month) : []
  const names = [...new Map([...totals.map((t) => t.project), ...(hustles.data ?? []).map((h) => h.name)].map((n) => [n.toLowerCase(), n])).values()]
  const mine = anySettings.user_id === me.id
  const all = totals.reduce((t, p) => ({ out: t.out + p.outMonth, in: t.in + p.inMonth }), { out: 0, in: 0 })

  return (
    <>
      <PageHeader
        title="Side hustles"
        description={data ? `This month ${signed(all.in - all.out)} · out ${money(all.out)} · in ${money(all.in)}` : undefined}
        actions={
          <>
            <Button variant="ghost" size="icon-sm" aria-label="Open the sheet" asChild>
              <a href={`https://docs.google.com/spreadsheets/d/${anySettings.spreadsheet_id}/edit`} target="_blank" rel="noreferrer noopener">
                <ExternalLink />
              </a>
            </Button>
            {mine ? (
              <Button variant="ghost" size="icon-sm" aria-label="Sheet settings" onClick={() => setLinking(true)}>
                <Settings2 />
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-2 md:max-w-2xl">
        {sheet.isPending ? (
          <ListSkeleton rows={3} />
        ) : sheet.error ? (
          <ErrorState error={sheet.error} onRetry={() => void sheet.refetch()} />
        ) : sheet.data.status !== 'ok' ? (
          <Card role="status" className="border-warning/40 bg-warning/10 p-3 text-sm">{sheet.data.message}</Card>
        ) : null}

        {names.map((n) => <HustleCard key={n} name={n} totals={totals.find((t) => t.project.toLowerCase() === n.toLowerCase())} mine={mine} />)}

        {mine ? (
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (newName.trim()) addHustle.mutate(newName, { onSuccess: () => setNewName(''), onError })
            }}
          >
            <Input aria-label="A new side hustle" placeholder="Add a side hustle (e.g. Travel, Life app)" maxLength={60} className="h-9" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Button type="submit" size="icon" variant="outline" aria-label="Add side hustle" disabled={!newName.trim() || addHustle.isPending}>
              <Plus />
            </Button>
          </form>
        ) : null}

        {mine && data ? <AddEntry projects={names} /> : null}

        {data?.problems.length ? (
          <Card className="p-3 text-sm">
            <h2 className="mb-1 flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="size-4 text-warning" /> Rows the app can’t read
            </h2>
            <ul className="grid gap-0.5 text-xs text-muted-foreground">
              {data.problems.map((p) => (
                <li key={`${p.side}${p.row}`}>
                  {p.side === 'out' ? 'Outgoings' : 'Income'} row {p.row}: {p.text}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">Fix the date or amount in the sheet and they’ll count.</p>
          </Card>
        ) : null}
      </div>
    </>
  )
}
