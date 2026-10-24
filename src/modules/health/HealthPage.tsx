import { format, parseISO } from 'date-fns'
import { Dumbbell, Eye, EyeOff, HeartPulse, Lock, NotebookPen, Plus, Share2, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { axisProps, ChartTooltip, DataTable, gridProps } from '@/components/charts'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { EmptyState, ErrorState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Badge, Segmented, Skeleton, Switch } from '@/components/ui/misc'
import { formatDay, todayISO } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import {
  type MetricDefinition,
  useAddExercise,
  useAddMeasurement,
  useAddNote,
  useCategoryVisibility,
  useCreateMetric,
  useDeleteExercise,
  useDeleteMeasurement,
  useDeleteNote,
  useExerciseSessions,
  useHealthNotes,
  useMeasurements,
  useMetricDefinitions,
  useSetCategoryShared,
  useUpdateMeasurement,
} from './api'
import { type Aggregation, dailySeries, formatValue, HEALTH_CATEGORIES, isSharedWithPartner, latestWithChange, type Visibility } from './lib/metrics'

export default function HealthPage() {
  const { me, partner, member } = useHousehold()
  const [personId, setPersonId] = useState(me.id)
  const person = member(personId) ?? me
  const own = personId === me.id
  const defs = useMetricDefinitions()
  const measurements = useMeasurements()
  const exercise = useExerciseSessions()
  const notes = useHealthNotes()
  const visibility = useCategoryVisibility()
  const [logging, setLogging] = useState<MetricDefinition | 'pick' | null>(null)
  const [detail, setDetail] = useState<MetricDefinition | null>(null)

  const shared = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const v of visibility.data ?? []) if (v.user_id === personId) map.set(v.category, v.shared)
    return map
  }, [visibility.data, personId])

  const mine = (measurements.data ?? []).filter((m) => m.user_id === personId)
  const metricsWithData = (defs.data ?? []).filter((d) => (d.owner_id === null || d.owner_id === personId) && (own || mine.some((m) => m.metric_id === d.id)))
  const error = defs.error ?? measurements.error

  return (
    <>
      <PageHeader
        title="Health"
        description="Your own records. Nothing here is medical advice, and nothing is interpreted for you."
        actions={own ? <Button onClick={() => setLogging('pick')}><Plus /> Log</Button> : null}
      />
      {partner ? (
        <Segmented aria-label="Person" value={personId} onChange={setPersonId} className="mb-4" options={[{ value: me.id, label: 'Me' }, { value: partner.id, label: partner.display_name }]} />
      ) : null}

      {!own ? <PartnerNotice name={person.display_name} shared={shared} /> : null}

      {error ? (
        <ErrorState error={error} onRetry={() => { defs.refetch(); measurements.refetch() }} />
      ) : defs.isPending || measurements.isPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : (
        <>
          {HEALTH_CATEGORIES.filter((c) => !['exercise', 'notes'].includes(c.key)).map((cat) => {
            const metrics = metricsWithData.filter((d) => d.category === cat.key)
            if (!metrics.length) return null
            return (
              <section key={cat.key} className="mb-2">
                <SectionTitle action={own ? <SharedBadge shared={shared.get(cat.key) ?? false} /> : null}>{cat.label}</SectionTitle>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {metrics.map((d) => (
                    <MetricTile key={d.id} def={d} rows={mine.filter((m) => m.metric_id === d.id)} onOpen={() => setDetail(d)} onLog={own ? () => setLogging(d) : undefined} />
                  ))}
                </div>
              </section>
            )
          })}
          {!own && !metricsWithData.length ? null : own && !mine.length ? (
            <Card className="mt-4"><EmptyState icon={HeartPulse} title="Start tracking" description="Log a weight, resting heart rate or sleep to begin seeing trends." /></Card>
          ) : null}

          <div className="mt-2 grid gap-4 lg:grid-cols-2">
            <ExerciseSection personId={personId} own={own} sessions={(exercise.data ?? []).filter((s) => s.user_id === personId)} categoryShared={shared.get('exercise') ?? false} />
            <NotesSection own={own} notes={(notes.data ?? []).filter((n) => n.user_id === personId)} categoryShared={shared.get('notes') ?? false} />
          </div>

          {own ? <SharingPanel shared={shared} partnerName={partner?.display_name} /> : null}
          {own ? <CustomMetricForm /> : null}
        </>
      )}

      <LogDialog target={logging} defs={(defs.data ?? []).filter((d) => d.owner_id === null || d.owner_id === me.id)} shared={shared} onClose={() => setLogging(null)} />
      <MetricDetailDialog def={detail} rows={detail ? mine.filter((m) => m.metric_id === detail.id) : []} own={own} shared={shared} onClose={() => setDetail(null)} />
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

function MetricTile({ def, rows, onOpen, onLog }: { def: MetricDefinition; rows: { measured_at: string; value: number }[]; onOpen: () => void; onLog?: () => void }) {
  const series = dailySeries(rows, def.aggregation as Aggregation)
  const latest = latestWithChange(series)
  const recent = series.slice(-30)
  return (
    <Card className="group relative flex min-h-32 flex-col p-4">
      <button type="button" onClick={onOpen} className="absolute inset-0 rounded-xl" aria-label={`${def.name} details`} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{def.name}</p>
        {onLog ? (
          <button type="button" onClick={onLog} className="relative z-10 -m-1 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Log ${def.name}`}>
            <Plus className="size-4" />
          </button>
        ) : null}
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
            <div className="mt-auto h-10 pt-2" aria-hidden>
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

function VisibilityField({ value, onChange, categoryShared, partnerName }: { value: Visibility; onChange: (v: Visibility) => void; categoryShared: boolean; partnerName?: string }) {
  const visible = isSharedWithPartner(value, categoryShared)
  return (
    <Field label="Who can see this" hint={partnerName ? `${visible ? `${partnerName} can see this` : `Only you`}${value === 'inherit' ? ` (category is ${categoryShared ? 'shared' : 'private'})` : ''}` : undefined}>
      <Segmented aria-label="Visibility" size="sm" value={value} onChange={onChange} options={VISIBILITY_OPTIONS} className="w-full [&>*]:flex-1" />
    </Field>
  )
}

function nowLocalInput() {
  return format(new Date(), "yyyy-MM-dd'T'HH:mm")
}

function LogDialog({ target, defs, shared, onClose }: { target: MetricDefinition | 'pick' | null; defs: MetricDefinition[]; shared: Map<string, boolean>; onClose: () => void }) {
  const { partner } = useHousehold()
  const add = useAddMeasurement()
  const [metricId, setMetricId] = useState('')
  const [value, setValue] = useState('')
  const [when, setWhen] = useState(nowLocalInput)
  const [notes, setNotes] = useState('')
  const [vis, setVis] = useState<Visibility>('inherit')
  const [error, setError] = useState<string | null>(null)
  const activeId = target && target !== 'pick' ? target.id : metricId
  const def = defs.find((d) => d.id === activeId)

  const reset = () => { setMetricId(''); setValue(''); setNotes(''); setVis('inherit'); setError(null); setWhen(nowLocalInput()) }

  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => { if (!o) { reset(); onClose() } }}>
      <DialogContent title={def ? `Log ${def.name.toLowerCase()}` : 'Log a measurement'}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(value.replace(',', '.'))
            if (!def) return setError('Choose what to log')
            if (!value.trim() || !Number.isFinite(n)) return setError('Enter a number')
            add.mutate(
              { metric_id: def.id, value: n, measured_at: new Date(when).toISOString(), notes: notes.trim() || null, visibility: vis },
              { onSuccess: () => { reset(); onClose() } },
            )
          }}
        >
          {target === 'pick' ? (
            <Field label="What" htmlFor="log-metric">
              <NativeSelect id="log-metric" value={metricId} onChange={(e) => setMetricId(e.target.value)}>
                <option value="">Choose…</option>
                {HEALTH_CATEGORIES.map((c) => {
                  const items = defs.filter((d) => d.category === c.key)
                  return items.length ? (
                    <optgroup key={c.key} label={c.label}>
                      {items.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.unit})</option>)}
                    </optgroup>
                  ) : null
                })}
              </NativeSelect>
            </Field>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={def ? `Value (${def.unit})` : 'Value'} htmlFor="log-value" error={error}>
              <Input id="log-value" inputMode="decimal" autoFocus={target !== 'pick'} value={value} onChange={(e) => { setValue(e.target.value); setError(null) }} />
            </Field>
            <Field label="When" htmlFor="log-when">
              <Input id="log-when" type="datetime-local" value={when} max={nowLocalInput()} onChange={(e) => setWhen(e.target.value)} />
            </Field>
          </div>
          <Field label="Note" htmlFor="log-notes">
            <Input id="log-notes" value={notes} maxLength={1000} placeholder="Optional" onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {partner ? <VisibilityField value={vis} onChange={setVis} categoryShared={def ? (shared.get(def.category) ?? false) : false} partnerName={partner.display_name} /> : null}
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={add.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MetricDetailDialog({ def, rows, own, shared, onClose }: { def: MetricDefinition | null; rows: { id: string; measured_at: string; value: number; notes: string | null; visibility: string }[]; own: boolean; shared: Map<string, boolean>; onClose: () => void }) {
  const del = useDeleteMeasurement()
  const update = useUpdateMeasurement()
  const [showTable, setShowTable] = useState(false)
  if (!def) return null
  const series = dailySeries(rows, def.aggregation as Aggregation).map((p) => ({ ...p, label: format(parseISO(p.date), 'd MMM') }))
  const categoryShared = shared.get(def.category) ?? false
  const fmt = (v: number) => `${formatValue(v, def.decimals)} ${def.unit}`
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={def.name} description={`${def.aggregation === 'sum' ? 'Daily total' : def.aggregation === 'average' ? 'Daily average' : 'Latest reading per day'} · ${def.unit}`} className="sm:max-w-2xl">
        {series.length ? (
          <div className="mb-4">
            <div className="mb-1 flex justify-end">
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowTable(!showTable)}>{showTable ? 'Show chart' : 'Show as table'}</button>
            </div>
            {showTable ? (
              <DataTable columns={['Date', def.name]} rows={series.toReversed().map((p) => [p.date, fmt(p.value)])} />
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis {...axisProps} width={44} domain={['auto', 'auto']} tickFormatter={(v) => formatValue(v, def.decimals)} />
                    <Tooltip content={<ChartTooltip formatValue={fmt} />} />
                    <Line dataKey="value" name={def.name} stroke="var(--chart-1)" strokeWidth={2} dot={series.length < 40 ? { r: 4, fill: 'var(--chart-1)', stroke: 'var(--card)', strokeWidth: 2 } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        ) : null}
        <ul className="divide-y text-sm">
          {rows.toReversed().slice(0, 50).map((r) => {
            const visible = isSharedWithPartner(r.visibility as Visibility, categoryShared)
            return (
              <li key={r.id} className="flex items-center gap-2 py-2">
                <span className="flex-1">
                  <span className="font-medium tabular">{fmt(Number(r.value))}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{format(parseISO(r.measured_at), 'd MMM yyyy, HH:mm')}{r.notes ? ` · ${r.notes}` : ''}</span>
                </span>
                {own ? (
                  <>
                    <button
                      type="button"
                      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs', visible ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground')}
                      title={r.visibility === 'inherit' ? 'Follows the category setting. Tap to override.' : 'Tap to change'}
                      onClick={() => update.mutate({ id: r.id, patch: { visibility: r.visibility === 'inherit' ? (categoryShared ? 'private' : 'shared') : r.visibility === 'shared' ? 'private' : 'inherit' } })}
                    >
                      {visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                      {r.visibility === 'inherit' ? (visible ? 'Shared (default)' : 'Private (default)') : visible ? 'Shared' : 'Private'}
                    </button>
                    <button type="button" aria-label="Delete entry" className="rounded p-1 text-muted-foreground hover:text-destructive" onClick={() => del.mutate(r.id)}><Trash2 className="size-3.5" /></button>
                  </>
                ) : null}
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

function ExerciseSection({ own, sessions, categoryShared }: { personId: string; own: boolean; sessions: ReturnType<typeof useExerciseSessions>['data'] & {}; categoryShared: boolean }) {
  const { partner } = useHousehold()
  const add = useAddExercise()
  const del = useDeleteExercise()
  const [open, setOpen] = useState(false)
  const [activity, setActivity] = useState('Run')
  const [when, setWhen] = useState(nowLocalInput)
  const [duration, setDuration] = useState('')
  const [distance, setDistance] = useState('')
  const [notes, setNotes] = useState('')
  const [vis, setVis] = useState<Visibility>('inherit')
  if (!own && !sessions.length) return null
  return (
    <section>
      <SectionTitle action={own ? <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Plus /> Add</Button> : null}>Exercise</SectionTitle>
      <Card className="p-2">
        {sessions.length ? (
          <ul className="divide-y">
            {sessions.slice(0, 8).map((s) => (
              <li key={s.id} className="group flex items-center gap-3 px-2 py-2.5 text-sm">
                <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground"><Dumbbell className="size-4" /></span>
                <span className="flex-1">
                  <span className="font-medium">{s.activity_type}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[format(parseISO(s.started_at), 'EEE d MMM'), `${s.duration_minutes} min`, s.distance_m ? `${formatValue(Number(s.distance_m) / 1000, 2)} km` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {own ? <button type="button" aria-label="Delete session" className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100" onClick={() => del.mutate(s.id)}><Trash2 className="size-3.5" /></button> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No sessions logged.</p>
        )}
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Log exercise">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              const mins = Number.parseInt(duration, 10)
              if (!activity.trim() || !Number.isFinite(mins) || mins <= 0) return
              add.mutate(
                { activity_type: activity.trim(), started_at: new Date(when).toISOString(), duration_minutes: mins, distance_m: distance ? Math.round(Number(distance) * 1000) : null, energy_kcal: null, avg_heart_rate: null, notes: notes.trim() || null, visibility: vis },
                { onSuccess: () => { setOpen(false); setDuration(''); setDistance(''); setNotes('') } },
              )
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Activity" htmlFor="ex-type">
                <Input id="ex-type" list="ex-types" value={activity} maxLength={40} onChange={(e) => setActivity(e.target.value)} />
                <datalist id="ex-types">{['Run', 'Walk', 'Cycle', 'Swim', 'Gym', 'Yoga', 'Football', 'Tennis', 'Hike'].map((a) => <option key={a} value={a} />)}</datalist>
              </Field>
              <Field label="Started" htmlFor="ex-when"><Input id="ex-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
              <Field label="Minutes" htmlFor="ex-min"><Input id="ex-min" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} required /></Field>
              <Field label="Distance (km)" htmlFor="ex-km"><Input id="ex-km" inputMode="decimal" value={distance} placeholder="Optional" onChange={(e) => setDistance(e.target.value)} /></Field>
            </div>
            <Field label="Note" htmlFor="ex-notes"><Input id="ex-notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} /></Field>
            {partner ? <VisibilityField value={vis} onChange={setVis} categoryShared={categoryShared} partnerName={partner.display_name} /> : null}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={add.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function NotesSection({ own, notes, categoryShared }: { own: boolean; notes: ReturnType<typeof useHealthNotes>['data'] & {}; categoryShared: boolean }) {
  const { partner } = useHousehold()
  const add = useAddNote()
  const del = useDeleteNote()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [date, setDate] = useState(todayISO())
  const [vis, setVis] = useState<Visibility>('inherit')
  if (!own && !notes.length) return null
  return (
    <section>
      <SectionTitle action={own ? <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Plus /> Add</Button> : null}>Notes</SectionTitle>
      <Card className="p-2">
        {notes.length ? (
          <ul className="divide-y">
            {notes.slice(0, 8).map((n) => (
              <li key={n.id} className="group flex gap-3 px-2 py-2.5 text-sm">
                <NotebookPen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{n.title}</p>
                  {n.body ? <p className="whitespace-pre-wrap text-muted-foreground">{n.body}</p> : null}
                  <p className="text-xs text-muted-foreground">{formatDay(n.noted_on)}</p>
                </div>
                {own ? <button type="button" aria-label="Delete note" className="self-start rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100" onClick={() => del.mutate(n.id)}><Trash2 className="size-3.5" /></button> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No notes.</p>
        )}
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Health note">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; add.mutate({ title: title.trim(), body: body.trim() || null, noted_on: date, visibility: vis }, { onSuccess: () => { setOpen(false); setTitle(''); setBody('') } }) }}>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <Field label="Title" htmlFor="hn-title"><Input id="hn-title" autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
              <Field label="Date" htmlFor="hn-date"><Input id="hn-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            </div>
            <Field label="Details" htmlFor="hn-body"><Textarea id="hn-body" rows={4} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} /></Field>
            {partner ? <VisibilityField value={vis} onChange={setVis} categoryShared={categoryShared} partnerName={partner.display_name} /> : null}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={add.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export function SharingPanel({ shared, partnerName }: { shared: Map<string, boolean>; partnerName?: string }) {
  const set = useSetCategoryShared()
  if (!partnerName) return null
  return (
    <section id="health-sharing">
      <SectionTitle>Sharing with {partnerName}</SectionTitle>
      <Card className="divide-y">
        {HEALTH_CATEGORIES.map((c) => (
          <label key={c.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span>
              {c.label}
              <span className="block text-xs text-muted-foreground">{shared.get(c.key) ? `${partnerName} can see these` : 'Only you'}</span>
            </span>
            <Switch checked={shared.get(c.key) ?? false} onCheckedChange={(v) => set.mutate({ category: c.key, shared: v })} aria-label={`Share ${c.label} with ${partnerName}`} />
          </label>
        ))}
      </Card>
      <p className="mt-2 text-xs text-muted-foreground">Individual entries can override this. Enforced by the database, not just hidden in the app.</p>
    </section>
  )
}

function CustomMetricForm() {
  const { me } = useHousehold()
  const create = useCreateMetric()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [aggregation, setAggregation] = useState<Aggregation>('latest')
  return (
    <div className="mt-4">
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Plus /> Custom metric</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="New custom metric" description="Track anything else, e.g. water intake or blood pressure readings.">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!name.trim() || !unit.trim()) return; create.mutate({ ownerId: me.id, name: name.trim(), unit: unit.trim(), decimals: 1, aggregation }, { onSuccess: () => { setOpen(false); setName(''); setUnit('') } }) }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="cm-name"><Input id="cm-name" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Unit" htmlFor="cm-unit"><Input id="cm-unit" value={unit} maxLength={20} placeholder="e.g. ml" onChange={(e) => setUnit(e.target.value)} /></Field>
            </div>
            <Field label="Per day, show">
              <Segmented aria-label="Aggregation" size="sm" value={aggregation} onChange={setAggregation} options={[{ value: 'latest', label: 'Latest' }, { value: 'sum', label: 'Total' }, { value: 'average', label: 'Average' }]} />
            </Field>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

