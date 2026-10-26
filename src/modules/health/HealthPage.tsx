import { format, parseISO, startOfWeek } from 'date-fns'
import { CalendarHeart, Dumbbell, Eye, EyeOff, HeartPulse, Lock, Plus, Share2, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { axisProps, ChartTooltip, DataTable, gridProps } from '@/components/charts'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { EmptyState, ErrorState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Badge, Segmented, Skeleton, Switch } from '@/components/ui/misc'
import { daysBetween, formatDay, todayISO } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import {
  type ExerciseSession,
  type MetricDefinition,
  type Period,
  useAddExercise,
  useAddMeasurement,
  useAddPeriod,
  useCategoryVisibility,
  useDeleteExercise,
  useDeleteMeasurement,
  useDeletePeriod,
  useExerciseSessions,
  useMeasurements,
  useMetricDefinitions,
  usePeriods,
  useSetCategoryShared,
  useSetTrackPeriods,
  useTrackPeriods,
  useUpdateMeasurement,
  useUpdatePeriod,
} from './api'
import { type Aggregation, cycleSummary, dailySeries, formatValue, HEALTH_CATEGORIES, isSharedWithPartner, latestWithChange, type Visibility } from './lib/metrics'

export default function HealthPage() {
  const { me, partner, member } = useHousehold()
  const [personId, setPersonId] = useState(me.id)
  const person = member(personId) ?? me
  const own = personId === me.id
  const defs = useMetricDefinitions()
  const measurements = useMeasurements()
  const exercise = useExerciseSessions()
  const periods = usePeriods()
  const trackPeriods = useTrackPeriods()
  const visibility = useCategoryVisibility()
  const [logging, setLogging] = useState(false)
  const [detail, setDetail] = useState(false)

  const shared = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const v of visibility.data ?? []) if (v.user_id === personId) map.set(v.category, v.shared)
    return map
  }, [visibility.data, personId])

  const weight = defs.data?.find((d) => d.key === 'weight' && d.owner_id === null)
  const weights = (measurements.data ?? []).filter((m) => m.user_id === personId && m.metric_id === weight?.id)
  const sessions = (exercise.data ?? []).filter((s) => s.user_id === personId)
  const personPeriods = (periods.data ?? []).filter((p) => p.user_id === personId)
  const showPeriods = own ? trackPeriods.data === true : personPeriods.length > 0
  const error = defs.error ?? measurements.error ?? exercise.error ?? periods.error

  return (
    <>
      <PageHeader title="Health" description="Your own records. Nothing here is medical advice, and nothing is interpreted for you." />
      {partner ? (
        <Segmented aria-label="Person" value={personId} onChange={setPersonId} className="mb-4" options={[{ value: me.id, label: 'Me' }, { value: partner.id, label: partner.display_name }]} />
      ) : null}

      {!own ? <PartnerNotice name={person.display_name} shared={shared} /> : null}

      {error ? (
        <ErrorState error={error} onRetry={() => { defs.refetch(); measurements.refetch(); exercise.refetch(); periods.refetch() }} />
      ) : defs.isPending || measurements.isPending || exercise.isPending || periods.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : !own && !weights.length && !sessions.length && !personPeriods.length ? (
        <Card><EmptyState icon={HeartPulse} title="Nothing shared yet" description={`${person.display_name} hasn't shared any health records with you.`} /></Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {weight && (own || weights.length) ? (
              <section>
                <SectionTitle action={own ? <SharedBadge shared={shared.get('body') ?? true} /> : null}>Weight</SectionTitle>
                <WeightTile def={weight} rows={weights} onOpen={() => setDetail(true)} onLog={own ? () => setLogging(true) : undefined} />
              </section>
            ) : null}
            {showPeriods ? <PeriodSection own={own} periods={personPeriods} categoryShared={shared.get('cycle') ?? true} /> : null}
          </div>
          <ExerciseSection own={own} sessions={sessions} categoryShared={shared.get('exercise') ?? true} />

          {own ? <HealthSettingsPanel shared={shared} partnerName={partner?.display_name} /> : null}
        </>
      )}

      {weight ? <LogWeightDialog open={logging} def={weight} categoryShared={shared.get('body') ?? true} onClose={() => setLogging(false)} /> : null}
      {weight && detail ? <WeightDetailDialog def={weight} rows={weights} own={own} categoryShared={shared.get('body') ?? true} onClose={() => setDetail(false)} /> : null}
    </>
  )
}

function SharedBadge({ shared }: { shared: boolean }) {
  return shared ? <Badge tone="primary"><Eye className="size-3" /> Shared</Badge> : <Badge><Lock className="size-3" /> Private</Badge>
}

function PartnerNotice({ name, shared }: { name: string; shared: Map<string, boolean> }) {
  const cats = HEALTH_CATEGORIES.filter((c) => shared.get(c.key)).map((c) => c.label)
  return (
    <Card className="mb-4 flex items-start gap-3 p-4 text-sm text-muted-foreground">
      <Share2 className="mt-0.5 size-4 shrink-0" />
      <p>
        {cats.length ? <>{name} shares <span className="text-foreground">{cats.join(', ')}</span> with you, plus any individual records marked as shared.</> : <>{name} hasn't shared any health categories. You'll only see records they've shared individually.</>}
      </p>
    </Card>
  )
}

function WeightTile({ def, rows, onOpen, onLog }: { def: MetricDefinition; rows: { measured_at: string; value: number }[]; onOpen: () => void; onLog?: () => void }) {
  const series = dailySeries(rows, def.aggregation as Aggregation)
  const latest = latestWithChange(series)
  const recent = series.slice(-30)
  return (
    <Card className="relative flex min-h-40 flex-col p-4">
      <button type="button" onClick={onOpen} className="absolute inset-0 rounded-xl" aria-label="Weight history" />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">Latest</p>
        {onLog ? <Button size="sm" variant="ghost" className="relative z-10 -m-1" onClick={onLog}><Plus /> Log weight</Button> : null}
      </div>
      {latest ? (
        <>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular">
            {formatValue(latest.value, def.decimals)} <span className="text-sm font-normal text-muted-foreground">{def.unit}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDay(latest.date)}
            {latest.change !== null && latest.change !== 0 ? ` · ${latest.change > 0 ? '+' : '−'}${formatValue(Math.abs(latest.change), def.decimals)} since previous` : ''}
          </p>
          {recent.length > 1 ? (
            <div className="mt-auto h-14 pt-2" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={recent}>
                  <YAxis hide domain={['dataMin', 'dataMax']} />
                  <Line dataKey="value" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-auto text-sm text-muted-foreground">No entries yet</p>
      )}
    </Card>
  )
}

const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: 'inherit', label: 'Category default' },
  { value: 'shared', label: 'Shared' },
  { value: 'private', label: 'Private' },
]

function VisibilityField({ value, onChange, categoryShared }: { value: Visibility; onChange: (v: Visibility) => void; categoryShared: boolean }) {
  const { partner } = useHousehold()
  if (!partner) return null
  const visible = isSharedWithPartner(value, categoryShared)
  return (
    <Field label="Who can see this" hint={`${visible ? `${partner.display_name} can see this` : `Only you`}${value === 'inherit' ? ` (category is ${categoryShared ? 'shared' : 'private'})` : ''}`}>
      <Segmented aria-label="Visibility" size="sm" value={value} onChange={onChange} options={VISIBILITY_OPTIONS} className="w-full [&>*]:flex-1" />
    </Field>
  )
}

/** Cycles inherit → override → back to inherit, labelled with the effective result. */
function VisibilityToggle({ visibility, categoryShared, onChange }: { visibility: string; categoryShared: boolean; onChange: (v: Visibility) => void }) {
  const visible = isSharedWithPartner(visibility as Visibility, categoryShared)
  return (
    <button
      type="button"
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs', visible ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground')}
      title={visibility === 'inherit' ? 'Follows the category setting. Tap to override.' : 'Tap to change'}
      onClick={() => onChange(visibility === 'inherit' ? (categoryShared ? 'private' : 'shared') : visibility === 'shared' ? 'private' : 'inherit')}
    >
      {visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
      {visibility === 'inherit' ? (visible ? 'Shared (default)' : 'Private (default)') : visible ? 'Shared' : 'Private'}
    </button>
  )
}

function nowLocalInput() {
  return format(new Date(), "yyyy-MM-dd'T'HH:mm")
}

function LogWeightDialog({ open, def, categoryShared, onClose }: { open: boolean; def: MetricDefinition; categoryShared: boolean; onClose: () => void }) {
  const add = useAddMeasurement()
  const [value, setValue] = useState('')
  const [when, setWhen] = useState(nowLocalInput)
  const [notes, setNotes] = useState('')
  const [vis, setVis] = useState<Visibility>('inherit')
  const [error, setError] = useState<string | null>(null)

  const reset = () => { setValue(''); setNotes(''); setVis('inherit'); setError(null); setWhen(nowLocalInput()) }
  const close = () => { reset(); onClose() }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent title="Log weight">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(value.replace(',', '.'))
            if (!value.trim() || !Number.isFinite(n) || n <= 0) return setError('Enter a weight')
            add.mutate({ metric_id: def.id, value: n, measured_at: new Date(when).toISOString(), notes: notes.trim() || null, visibility: vis }, { onSuccess: close })
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Weight (${def.unit})`} htmlFor="log-value" error={error}>
              <Input id="log-value" inputMode="decimal" autoFocus value={value} onChange={(e) => { setValue(e.target.value); setError(null) }} />
            </Field>
            <Field label="When" htmlFor="log-when">
              <Input id="log-when" type="datetime-local" value={when} max={nowLocalInput()} onChange={(e) => setWhen(e.target.value)} />
            </Field>
          </div>
          <Field label="Note" htmlFor="log-notes">
            <Input id="log-notes" value={notes} maxLength={1000} placeholder="Optional" onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <VisibilityField value={vis} onChange={setVis} categoryShared={categoryShared} />
          <DialogFooter>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={add.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function WeightDetailDialog({ def, rows, own, categoryShared, onClose }: { def: MetricDefinition; rows: { id: string; measured_at: string; value: number; notes: string | null; visibility: string }[]; own: boolean; categoryShared: boolean; onClose: () => void }) {
  const del = useDeleteMeasurement()
  const update = useUpdateMeasurement()
  const [showTable, setShowTable] = useState(false)
  const series = dailySeries(rows, def.aggregation as Aggregation).map((p) => ({ ...p, label: format(parseISO(p.date), 'd MMM') }))
  const fmt = (v: number) => `${formatValue(v, def.decimals)} ${def.unit}`
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Weight" description={`Latest reading per day · ${def.unit}`} className="sm:max-w-2xl">
        {series.length ? (
          <div className="mb-4">
            <div className="mb-1 flex justify-end">
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowTable(!showTable)}>{showTable ? 'Show chart' : 'Show as table'}</button>
            </div>
            {showTable ? (
              <DataTable columns={['Date', 'Weight']} rows={series.toReversed().map((p) => [p.date, fmt(p.value)])} />
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis {...axisProps} width={44} domain={['auto', 'auto']} tickFormatter={(v) => formatValue(v, def.decimals)} />
                    <Tooltip content={<ChartTooltip formatValue={fmt} />} />
                    <Line dataKey="value" name="Weight" stroke="var(--chart-1)" strokeWidth={2} dot={series.length < 40 ? { r: 4, fill: 'var(--chart-1)', stroke: 'var(--card)', strokeWidth: 2 } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        ) : null}
        <ul className="divide-y text-sm">
          {rows.toReversed().slice(0, 50).map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-2">
              <span className="flex-1">
                <span className="font-medium tabular">{fmt(Number(r.value))}</span>
                <span className="ml-2 text-xs text-muted-foreground">{format(parseISO(r.measured_at), 'd MMM yyyy, HH:mm')}{r.notes ? ` · ${r.notes}` : ''}</span>
              </span>
              {own ? (
                <>
                  <VisibilityToggle visibility={r.visibility} categoryShared={categoryShared} onChange={(v) => update.mutate({ id: r.id, patch: { visibility: v } })} />
                  <button type="button" aria-label="Delete entry" className="rounded p-1 text-muted-foreground hover:text-destructive" onClick={() => del.mutate(r.id)}><Trash2 className="size-3.5" /></button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

function formatMinutes(mins: number) {
  const h = Math.floor(mins / 60)
  return h ? `${h} h${mins % 60 ? ` ${mins % 60} min` : ''}` : `${mins} min`
}

function ExerciseSection({ own, sessions, categoryShared }: { own: boolean; sessions: ExerciseSession[]; categoryShared: boolean }) {
  const add = useAddExercise()
  const del = useDeleteExercise()
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [description, setDescription] = useState('')
  const [when, setWhen] = useState(nowLocalInput)
  const [duration, setDuration] = useState('')
  const [vis, setVis] = useState<Visibility>('inherit')
  const [error, setError] = useState<string | null>(null)
  if (!own && !sessions.length) return null
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const thisWeek = sessions.filter((s) => parseISO(s.started_at) >= weekStart)
  const close = () => { setOpen(false); setDescription(''); setDuration(''); setVis('inherit'); setError(null) }
  return (
    <section className="mt-2">
      <SectionTitle action={own ? <Button variant="ghost" size="sm" onClick={() => { setWhen(nowLocalInput()); setOpen(true) }}><Plus /> Add</Button> : null}>Exercise</SectionTitle>
      <Card className="p-2">
        {sessions.length ? (
          <>
            <p className="px-2 pt-1 pb-2 text-xs text-muted-foreground">
              This week: {thisWeek.length ? `${thisWeek.length} ${thisWeek.length === 1 ? 'session' : 'sessions'} · ${formatMinutes(thisWeek.reduce((a, s) => a + s.duration_minutes, 0))}` : 'nothing yet'}
            </p>
            <ul className="divide-y">
              {(showAll ? sessions : sessions.slice(0, 8)).map((s) => (
                <li key={s.id} className="group flex items-center gap-3 px-2 py-2.5 text-sm">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><Dumbbell className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block whitespace-pre-wrap font-medium">{s.description}</span>
                    <span className="block text-xs text-muted-foreground">{format(parseISO(s.started_at), 'EEE d MMM, HH:mm')} · {formatMinutes(s.duration_minutes)}</span>
                  </span>
                  {own ? <button type="button" aria-label="Delete session" className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100" onClick={() => del.mutate(s.id)}><Trash2 className="size-3.5" /></button> : null}
                </li>
              ))}
            </ul>
            {sessions.length > 8 ? (
              <button type="button" className="w-full px-2 py-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${sessions.length}`}</button>
            ) : null}
          </>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No exercise logged yet.</p>
        )}
      </Card>
      <Dialog open={open} onOpenChange={(o) => { if (!o) close() }}>
        <DialogContent title="Log exercise">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              const mins = Number.parseInt(duration, 10)
              if (!description.trim()) return setError('Say what you did')
              if (!Number.isFinite(mins) || mins <= 0 || mins > 1440) return setError('Enter how many minutes')
              add.mutate({ description: description.trim(), started_at: new Date(when).toISOString(), duration_minutes: mins, visibility: vis }, { onSuccess: close })
            }}
          >
            <Field label="What did you do?" htmlFor="ex-desc" error={error}>
              <Textarea id="ex-desc" autoFocus rows={2} value={description} maxLength={500} placeholder="e.g. 5k run around the park, or legs day at the gym" onChange={(e) => { setDescription(e.target.value); setError(null) }} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Minutes" htmlFor="ex-min"><Input id="ex-min" inputMode="numeric" value={duration} onChange={(e) => { setDuration(e.target.value); setError(null) }} /></Field>
              <Field label="When" htmlFor="ex-when"><Input id="ex-when" type="datetime-local" value={when} max={nowLocalInput()} onChange={(e) => setWhen(e.target.value)} /></Field>
            </div>
            <VisibilityField value={vis} onChange={setVis} categoryShared={categoryShared} />
            <DialogFooter>
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button type="submit" disabled={add.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function PeriodSection({ own, periods, categoryShared }: { own: boolean; periods: Period[]; categoryShared: boolean }) {
  const add = useAddPeriod()
  const update = useUpdatePeriod()
  const del = useDeletePeriod()
  const [open, setOpen] = useState(false)
  const today = todayISO()
  const current = periods.find((p) => !p.ended_on && p.started_on <= today)
  const summary = cycleSummary(periods)
  return (
    <section>
      <SectionTitle action={own ? <SharedBadge shared={categoryShared} /> : null}>Periods</SectionTitle>
      <Card className="p-4">
        {current ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tracking-tight">Day {daysBetween(current.started_on, today) + 1}</p>
              <p className="text-xs text-muted-foreground">Started {formatDay(current.started_on)}</p>
            </div>
            {own ? <Button size="sm" onClick={() => update.mutate({ id: current.id, patch: { ended_on: today } })} disabled={update.isPending}>Ended today</Button> : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {summary.estimatedNext ? (
                <>
                  <p className="text-xs font-medium text-muted-foreground">Next period <Badge>Estimate</Badge></p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">{format(parseISO(summary.estimatedNext), 'EEE d MMM')}</p>
                  <p className="text-xs text-muted-foreground">Last start plus your average cycle</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{periods.length ? 'Log one more period to see an estimate.' : 'No periods logged yet.'}</p>
              )}
            </div>
            {own ? (
              <Button size="sm" onClick={() => add.mutate({ started_on: today, ended_on: null, notes: null, visibility: 'inherit' })} disabled={add.isPending || periods.some((p) => p.started_on === today)}>
                <CalendarHeart /> Started today
              </Button>
            ) : null}
          </div>
        )}

        {summary.averageCycle || summary.averageLength ? (
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Average cycle</dt><dd className="font-medium tabular">{summary.averageCycle ? `${summary.averageCycle} days` : '—'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Average length</dt><dd className="font-medium tabular">{summary.averageLength ? `${summary.averageLength} days` : '—'}</dd></div>
          </dl>
        ) : null}

        {periods.length ? (
          <ul className="mt-3 divide-y border-t text-sm">
            {periods.slice(0, 6).map((p) => (
              <li key={p.id} className="group flex items-center gap-2 py-2">
                <span className="flex-1">
                  <span className="font-medium">{format(parseISO(p.started_on), 'd MMM yyyy')}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {p.ended_on ? `${daysBetween(p.started_on, p.ended_on) + 1} days` : 'ongoing'}{p.notes ? ` · ${p.notes}` : ''}
                  </span>
                </span>
                {own ? (
                  <>
                    <VisibilityToggle visibility={p.visibility} categoryShared={categoryShared} onChange={(v) => update.mutate({ id: p.id, patch: { visibility: v } })} />
                    <button type="button" aria-label="Delete period" className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100" onClick={() => del.mutate(p.id)}><Trash2 className="size-3.5" /></button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {own ? <button type="button" className="mt-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(true)}>Log a past period</button> : null}
      </Card>
      {own ? <PastPeriodDialog open={open} categoryShared={categoryShared} onClose={() => setOpen(false)} /> : null}
    </section>
  )
}

function PastPeriodDialog({ open, categoryShared, onClose }: { open: boolean; categoryShared: boolean; onClose: () => void }) {
  const add = useAddPeriod()
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [notes, setNotes] = useState('')
  const [vis, setVis] = useState<Visibility>('inherit')
  const [error, setError] = useState<string | null>(null)
  const close = () => { setStart(''); setEnd(''); setNotes(''); setVis('inherit'); setError(null); onClose() }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent title="Log a period">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!start) return setError('Choose the start date')
            if (end && end < start) return setError('The end must be on or after the start')
            add.mutate({ started_on: start, ended_on: end || null, notes: notes.trim() || null, visibility: vis }, { onSuccess: close, onError: () => setError('Couldn’t save. Is there already a period starting that day?') })
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Started" htmlFor="pd-start" error={error}><Input id="pd-start" type="date" value={start} max={todayISO()} onChange={(e) => { setStart(e.target.value); setError(null) }} /></Field>
            <Field label="Ended" htmlFor="pd-end" hint="Leave blank if it's ongoing"><Input id="pd-end" type="date" value={end} min={start || undefined} max={todayISO()} onChange={(e) => { setEnd(e.target.value); setError(null) }} /></Field>
          </div>
          <Field label="Note" htmlFor="pd-notes"><Input id="pd-notes" value={notes} maxLength={1000} placeholder="Optional" onChange={(e) => setNotes(e.target.value)} /></Field>
          <VisibilityField value={vis} onChange={setVis} categoryShared={categoryShared} />
          <DialogFooter>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={add.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function HealthSettingsPanel({ shared, partnerName }: { shared: Map<string, boolean>; partnerName?: string }) {
  const trackPeriods = useTrackPeriods().data === true
  const set = useSetCategoryShared()
  const setTrack = useSetTrackPeriods()
  return (
    <section id="health-sharing">
      <SectionTitle>Settings</SectionTitle>
      <Card className="divide-y">
        <label className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <span>
            Period tracker
            <span className="block text-xs text-muted-foreground">Show the period tracker on your Health page</span>
          </span>
          <Switch checked={trackPeriods} onCheckedChange={(v) => setTrack.mutate(v)} aria-label="Show the period tracker" />
        </label>
        {partnerName
          ? HEALTH_CATEGORIES.map((c) => (
              <label key={c.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  Share {c.label.toLowerCase()} with {partnerName}
                  <span className="block text-xs text-muted-foreground">{shared.get(c.key) ? `${partnerName} can see these` : 'Only you'}</span>
                </span>
                <Switch checked={shared.get(c.key) ?? true} onCheckedChange={(v) => set.mutate({ category: c.key, shared: v })} aria-label={`Share ${c.label} with ${partnerName}`} />
              </label>
            ))
          : null}
      </Card>
      {partnerName ? <p className="mt-2 text-xs text-muted-foreground">Individual entries can override sharing. Enforced by the database, not just hidden in the app.</p> : null}
    </section>
  )
}
