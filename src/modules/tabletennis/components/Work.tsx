import { format } from 'date-fns'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, NativeSelect } from '@/components/ui/input'
import { Segmented } from '@/components/ui/misc'
import { parseISODate, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { formatMoney, parseMoney, toMoneyInput } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { type TtEmployer, useAddSession, useDeleteEmployer, useDeleteSession, useEmployers, useSaveEmployer, useSessions, useSetPaid } from '../api'
import { owedByEmployer } from '../lib/progress'

const onError = (e: unknown) => toast.error(getErrorMessage(e))
const money = (minor: number) => formatMoney(minor, 'GBP')
/** "2h", "1.5h". */
const hoursLabel = (h: number) => `${Number(h)}h`
const HOURS = [1, 2, 3, 4, 5]

/** Add or change who pays you and their hourly rate. A new rate applies to sessions logged from now on. */
function EmployerForm({ employer, onDone }: { employer?: TtEmployer; onDone: () => void }) {
  const save = useSaveEmployer()
  const [name, setName] = useState(employer?.name ?? '')
  const [rate, setRate] = useState(employer ? toMoneyInput(employer.rate_minor) : '')
  const minor = parseMoney(rate)
  const ready = Boolean(name.trim()) && minor !== null && minor >= 0
  return (
    <form
      className="grid grid-cols-[minmax(0,1fr)_6rem_auto] gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) save.mutate({ id: employer?.id, name: name.trim(), rate_minor: minor! }, { onSuccess: onDone, onError })
      }}
    >
      <Input aria-label="Who pays you" placeholder="Graham Spicer’s" maxLength={80} className="h-9" value={name} onChange={(e) => setName(e.target.value)} />
      <Input aria-label="Hourly rate" placeholder="£ an hour" inputMode="decimal" className="h-9" value={rate} onChange={(e) => setRate(e.target.value)} />
      <Button type="submit" size="sm" className="h-9" disabled={!ready || save.isPending}>
        Save
      </Button>
    </form>
  )
}

/**
 * Coaching work: what each employer owes (sessions not yet paid), a quick way to
 * log a session, and every session by month, tapped to mark paid or owed.
 */
export function Work() {
  const { me } = useHousehold()
  const employers = useEmployers()
  const sessions = useSessions()
  const add = useAddSession()
  const setPaid = useSetPaid()
  const del = useDeleteSession()
  const removeEmployer = useDeleteEmployer()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [employerId, setEmployerId] = useState('')
  const [day, setDay] = useState(todayISO())
  const [hours, setHours] = useState(1)
  const [paidNow, setPaidNow] = useState(false)

  if (employers.error ?? sessions.error) return <ErrorState error={employers.error ?? sessions.error} onRetry={() => { void employers.refetch(); void sessions.refetch() }} />
  if (employers.isPending || sessions.isPending) return <ListSkeleton rows={4} />

  const mine = employers.data.filter((e) => e.user_id === me.id)
  const theirs = sessions.data.filter((s) => s.user_id === me.id)
  const owed = owedByEmployer(theirs)
  const nameOf = (id: string) => employers.data.find((e) => e.id === id)?.name ?? ''
  const chosen = employerId || mine[0]?.id || ''
  const ready = Boolean(chosen && day && hours)
  const months = new Map<string, typeof theirs>()
  for (const s of theirs) months.set(s.day.slice(0, 7), [...(months.get(s.day.slice(0, 7)) ?? []), s])

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <Card className="p-3">
        <h2 className="mb-1.5 text-sm font-semibold">Owed</h2>
        <ul className="grid gap-1.5">
          {mine.map((e) => {
            const o = owed.get(e.id)
            return (
              <li key={e.id} className="grid gap-1.5">
                {editing === e.id ? (
                  <div className="grid gap-1">
                    <EmployerForm employer={e} onDone={() => setEditing(null)} />
                    {theirs.some((s) => s.employer_id === e.id) ? (
                      <p className="text-xs text-muted-foreground">Has sessions logged, so it can’t be removed.</p>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-2 w-fit text-muted-foreground"
                        onClick={() => removeEmployer.mutate(e.id, { onSuccess: () => setEditing(null), onError })}
                      >
                        <Trash2 /> Remove {e.name}
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{e.name}</span>
                      <span className="text-xs text-muted-foreground"> · {money(e.rate_minor)}/h</span>
                    </span>
                    <span className={cn('tabular', o ? 'font-semibold' : 'text-muted-foreground')}>{o ? money(o.amount) : '£0'}</span>
                    {o ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={setPaid.isPending}
                        onClick={() =>
                          setPaid.mutate(
                            { ids: theirs.filter((s) => s.employer_id === e.id && !s.paid_on).map((s) => s.id), paid: true },
                            { onSuccess: () => toast.success(`${e.name}: ${o.count} session${o.count === 1 ? '' : 's'} paid`), onError },
                          )
                        }
                      >
                        All paid
                      </Button>
                    ) : null}
                    <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label={`Change ${e.name}`} onClick={() => setEditing(e.id)}>
                      <Pencil />
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {editing === 'new' ? (
          <div className="mt-2">
            <EmployerForm onDone={() => setEditing(null)} />
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="mt-1 -ml-2 text-muted-foreground" onClick={() => setEditing('new')}>
            <Plus /> {mine.length ? 'Another employer' : 'Add who pays you, with their hourly rate'}
          </Button>
        )}
      </Card>

      {mine.length ? (
        <Card className="p-3">
          <h2 className="mb-1.5 text-sm font-semibold">Log a session</h2>
          <form
            className="grid grid-cols-2 gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (ready) add.mutate({ employer_id: chosen, day, hours, paid: paidNow }, { onSuccess: () => { setHours(1); setPaidNow(false); toast.success('Session logged') }, onError })
            }}
          >
            <NativeSelect aria-label="Employer" className="h-9" value={chosen} onChange={(e) => setEmployerId(e.target.value)}>
              {mine.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </NativeSelect>
            <Input aria-label="Date" type="date" className="h-9" value={day} onChange={(e) => setDay(e.target.value)} />
            <Segmented
              aria-label="Hours"
              size="sm"
              className="col-span-2 w-full [&>*]:flex-1"
              value={String(hours)}
              onChange={(v) => setHours(Number(v))}
              options={HOURS.map((h) => ({ value: String(h), label: `${h}h` }))}
            />
            <Segmented
              aria-label="Paid for this session yet?"
              size="sm"
              className="col-span-2 w-full [&>*]:flex-1"
              value={paidNow ? 'paid' : 'owed'}
              onChange={(v) => setPaidNow(v === 'paid')}
              options={[{ value: 'owed', label: 'Not paid yet' }, { value: 'paid', label: 'Paid' }]}
            />
            <Button type="submit" size="sm" className="col-span-2" disabled={!ready || add.isPending}>
              <Plus /> Add session
            </Button>
          </form>
        </Card>
      ) : null}

      {[...months.entries()].map(([month, rows]) => (
        <Card key={month} className="p-3">
          <h2 className="mb-1 flex items-baseline justify-between text-sm font-semibold">
            {format(parseISODate(`${month}-01`), 'MMMM yyyy')}
            <span className="text-xs font-normal text-muted-foreground tabular">{money(rows.reduce((t, s) => t + (s.amount_minor ?? 0), 0))}</span>
          </h2>
          <ul className="divide-y">
            {rows.map((s) => (
              <li key={s.id} className="group flex items-center gap-2 py-1.5 text-sm">
                <span className="w-16 shrink-0 text-xs text-muted-foreground">{format(parseISODate(s.day), 'EEE d')}</span>
                <span className="min-w-0 flex-1 truncate">
                  {hoursLabel(s.hours)} <span className="text-xs text-muted-foreground">· {nameOf(s.employer_id)}</span>
                </span>
                <span className="tabular">{money(s.amount_minor ?? 0)}</span>
                <Button
                  size="sm"
                  variant={s.paid_on ? 'secondary' : 'outline'}
                  className={cn('h-7 w-16 px-2 text-xs', s.paid_on ? 'text-success' : 'text-warning')}
                  aria-pressed={Boolean(s.paid_on)}
                  onClick={() => setPaid.mutate({ ids: [s.id], paid: !s.paid_on }, { onError })}
                >
                  {s.paid_on ? <><Check className="size-3.5" /> Paid</> : 'Owed'}
                </Button>
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label="Delete session" onClick={() => del.mutate(s.id, { onError })}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}
