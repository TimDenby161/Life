import { Plus, Settings2, Trash2, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { StatTile } from '@/components/charts'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Badge, Segmented, Switch } from '@/components/ui/misc'
import { formatDay, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { formatMoney, parseMoney, toMoneyInput } from '@/lib/money'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import {
  type Holding,
  type InvestmentSettings,
  useDeleteHolding,
  useHoldings,
  useInvestmentSettings,
  useSaveHolding,
  useSaveInvestmentSettings,
} from './api'
import { mix, plan, type Step } from './lib/plan'

const money = (v: number) => formatMoney(v, 'GBP', { hidePence: true })
const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : '—')

export default function InvestmentsPage() {
  const { me, members } = useHousehold()
  const holdings = useHoldings()
  const settings = useInvestmentSettings()
  // Show whoever has holdings, me first; only the owner gets edit controls (RLS enforces it too).
  const owners = members.filter((m) => m.id === me.id || holdings.data?.some((h) => h.user_id === m.id))
  const withHoldings = owners.filter((m) => holdings.data?.some((h) => h.user_id === m.id))
  const [picked, setPicked] = useState<string | null>(null)
  const personId = picked ?? (withHoldings.find((m) => m.id === me.id) ?? withHoldings[0] ?? me).id
  const mine = personId === me.id
  const [editing, setEditing] = useState<Holding | 'new' | 'settings' | null>(null)

  if (holdings.isPending || settings.isPending) return <ListSkeleton rows={6} />
  if (holdings.error) return <ErrorState error={holdings.error} onRetry={() => holdings.refetch()} />
  if (settings.error) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />

  const theirs = holdings.data.filter((h) => h.user_id === personId)
  const prefs = settings.data.find((s) => s.user_id === personId) ?? null
  const totals = mix(theirs)
  const { steps, monthly } = plan(theirs, { monthly_minor: prefs?.monthly_minor ?? 0, wedding_minor: prefs?.wedding_minor ?? null })
  const pie = theirs.filter((h) => h.in_pie)
  const pieTotal = pie.reduce((s, h) => s + h.value_minor, 0)
  const others = theirs.filter((h) => !h.in_pie)

  return (
    <>
      <PageHeader
        title="Investments"
        description={prefs?.values_as_of ? `Values as of ${formatDay(prefs.values_as_of)}, entered by hand` : 'Values are entered by hand, not live prices'}
        actions={
          mine ? (
            <>
              <Button variant="outline" size="icon" aria-label="Settings" onClick={() => setEditing('settings')}><Settings2 /></Button>
              <Button variant="outline" onClick={() => setEditing('new')}><Plus /> Add</Button>
            </>
          ) : null
        }
      />

      {withHoldings.length > 1 ? (
        <Segmented className="mb-4" aria-label="Whose investments" value={personId} onChange={setPicked} options={owners.map((m) => ({ value: m.id, label: m.display_name }))} />
      ) : null}

      {!theirs.length ? (
        <Card><EmptyState icon={TrendingUp} title="No holdings yet" description={mine ? 'Add what you hold and its value to get a plan.' : undefined} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Total" value={money(totals.total)} sub={prefs?.monthly_minor ? `+${money(prefs.monthly_minor)} a month` : undefined} />
            <StatTile label="Shares" value={pct(totals.shares, totals.total)} sub={money(totals.shares)} />
            <StatTile label="Bonds" value={pct(totals.bonds, totals.total)} sub={money(totals.bonds)} />
            <StatTile label="Cash" value={pct(totals.cash, totals.total)} sub={prefs?.wedding_minor != null ? `${money(prefs.wedding_minor)} kept for the wedding` : money(totals.cash)} />
          </div>

          <div>
            <SectionTitle>What to do</SectionTitle>
            <Card className="p-0">
              <ol className="divide-y">
                {steps.map((s, i) => <StepRow key={i} step={s} onSettings={mine ? () => setEditing('settings') : undefined} />)}
                {monthly.length ? (
                  <li className="px-4 py-3 text-sm">
                    <p className="font-medium">Each month {money(prefs?.monthly_minor ?? 0)}</p>
                    <p className="text-xs text-muted-foreground tabular">{monthly.map((m) => `${m.ticker} ${money(m.amount)}`).join(' · ')}</p>
                  </li>
                ) : null}
              </ol>
            </Card>
          </div>

          {pie.length ? (
            <div>
              <SectionTitle>Pie</SectionTitle>
              <Card className="p-0">
                <ul className="divide-y">
                  {pie.map((h) => (
                    <HoldingRow key={h.id} holding={h} onEdit={mine ? () => setEditing(h) : undefined}>
                      <span className="tabular">{pct(h.value_minor, pieTotal)}{h.target_pct !== null ? ` → ${h.target_pct}%` : ''}</span>
                    </HoldingRow>
                  ))}
                </ul>
              </Card>
            </div>
          ) : null}

          {others.length ? (
            <div>
              <SectionTitle>Other holdings</SectionTitle>
              <Card className="p-0">
                <ul className="divide-y">
                  {others.map((h) => (
                    <HoldingRow key={h.id} holding={h} onEdit={mine ? () => setEditing(h) : undefined}>
                      {h.target_pct !== null ? <span className="tabular">→ {h.target_pct}%</span> : null}
                    </HoldingRow>
                  ))}
                </ul>
              </Card>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">Worked out from your own targets and choices; not regulated financial advice. Share prices go down as well as up.</p>
        </div>
      )}

      {editing === 'settings' ? <SettingsDialog userId={me.id} settings={prefs} onClose={() => setEditing(null)} /> : null}
      {editing && editing !== 'settings' ? <HoldingDialog holding={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
    </>
  )
}

function StepRow({ step, onSettings }: { step: Step; onSettings?: () => void }) {
  const row = (title: React.ReactNode, sub?: React.ReactNode, tone?: 'danger' | 'success' | 'warning', amount?: number) => (
    <li className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
      </div>
      {amount !== undefined ? <Badge tone={tone} className="tabular">{money(amount)}</Badge> : null}
    </li>
  )
  switch (step.kind) {
    case 'sell':
      return row(`Sell all of ${step.ticker}`, step.reason, 'danger', step.amount)
    case 'trim':
      return row(`Sell some ${step.ticker}`, undefined, 'danger', step.amount)
    case 'cash':
      return row('Keep as cash for the wedding', 'In the ISA, out of the Pie', 'warning', step.amount)
    case 'buy':
      return row(`Buy ${step.ticker}`, undefined, 'success', step.amount)
    case 'review':
      return row(`Decide on ${step.ticker}`, step.reason)
    case 'targets':
      return row(`Targets add up to ${step.total}%`, 'They should add up to 100%.')
    case 'wedding-unset':
      return row(
        'Set how much the wedding needs',
        <>Until then, holdings with a 0% target stay as they are. {onSettings ? <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={onSettings}>Set it</button> : null}</>,
      )
  }
}

function HoldingRow({ holding: h, onEdit, children }: { holding: Holding; onEdit?: () => void; children?: React.ReactNode }) {
  const tone = h.action === 'sell' ? 'danger' : h.action === 'review' ? 'warning' : undefined
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-medium">
          {h.ticker}
          {h.action !== 'keep' ? <Badge tone={tone}>{h.action === 'sell' ? 'Sell' : 'Review'}</Badge> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{h.name}</p>
        {h.reason ? <p className="text-xs text-muted-foreground">{h.reason}</p> : null}
      </div>
      <div className="shrink-0 text-right">
        <p className="font-medium tabular">{money(h.value_minor)}</p>
        <p className="text-xs text-muted-foreground">{children}</p>
      </div>
    </>
  )
  return (
    <li>
      {onEdit ? (
        <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50" onClick={onEdit}>{body}</button>
      ) : (
        <div className="flex items-start gap-3 px-4 py-3 text-sm">{body}</div>
      )}
    </li>
  )
}

function HoldingDialog({ holding, onClose }: { holding?: Holding; onClose: () => void }) {
  const save = useSaveHolding()
  const del = useDeleteHolding()
  const [ticker, setTicker] = useState(holding?.ticker ?? '')
  const [name, setName] = useState(holding?.name ?? '')
  const [value, setValue] = useState(holding ? toMoneyInput(holding.value_minor) : '')
  const [inPie, setInPie] = useState(holding?.in_pie ?? false)
  const [assetClass, setAssetClass] = useState(holding?.asset_class ?? 'shares')
  const [target, setTarget] = useState(holding?.target_pct?.toString() ?? '')
  const [action, setAction] = useState(holding?.action ?? 'keep')
  const [reason, setReason] = useState(holding?.reason ?? '')
  const [confirm, setConfirm] = useState(false)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title={holding ? `Edit ${holding.ticker}` : 'Add a holding'}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const minor = parseMoney(value)
            const pctValue = target.trim() === '' ? null : Number.parseInt(target, 10)
            if (minor === null || minor < 0) return toast.error('Enter the value in pounds')
            if (pctValue !== null && !(pctValue >= 0 && pctValue <= 100)) return toast.error('Target is a whole percent, 0 to 100')
            save.mutate(
              { id: holding?.id, ticker: ticker.trim().toUpperCase(), name: name.trim(), value_minor: minor, in_pie: inPie, asset_class: assetClass, target_pct: pctValue, action, reason: reason.trim() || null },
              { onSuccess: onClose, onError: (err) => toast.error(getErrorMessage(err)) },
            )
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ticker" htmlFor="i-ticker"><Input id="i-ticker" autoFocus value={ticker} maxLength={12} onChange={(e) => setTicker(e.target.value)} required /></Field>
            <Field label="Name" htmlFor="i-name"><Input id="i-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label="Value (£)" htmlFor="i-value"><Input id="i-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required /></Field>
            <Field label="Type" htmlFor="i-class">
              <NativeSelect id="i-class" value={assetClass} onChange={(e) => setAssetClass(e.target.value)}>
                <option value="shares">Shares</option>
                <option value="bonds">Bonds</option>
                <option value="cash">Cash</option>
              </NativeSelect>
            </Field>
            <Field label="Target %" htmlFor="i-target" hint="Share of the long-term mix. Blank if it isn't part of it.">
              <Input id="i-target" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} />
            </Field>
            <Field label="Verdict" htmlFor="i-action">
              <NativeSelect id="i-action" value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="keep">Keep</option>
                <option value="sell">Sell</option>
                <option value="review">Review</option>
              </NativeSelect>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={inPie} onCheckedChange={setInPie} /> In the Pie</label>
          <Field label="Why" htmlFor="i-reason"><Textarea id="i-reason" rows={2} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
          <DialogFooter className="sm:justify-between">
            {holding ? (
              <Button type="button" variant={confirm ? 'destructive' : 'ghost'} onClick={() => (confirm ? del.mutate(holding.id, { onSuccess: onClose }) : setConfirm(true))}>
                <Trash2 /> {confirm ? 'Delete holding?' : 'Delete'}
              </Button>
            ) : <span />}
            <Button type="submit" disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SettingsDialog({ userId, settings, onClose }: { userId: string; settings: InvestmentSettings | null; onClose: () => void }) {
  const save = useSaveInvestmentSettings()
  const [monthly, setMonthly] = useState(settings ? toMoneyInput(settings.monthly_minor) : '')
  const [wedding, setWedding] = useState(settings?.wedding_minor != null ? toMoneyInput(settings.wedding_minor) : '')
  const [asOf, setAsOf] = useState(settings?.values_as_of ?? todayISO())

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title="Investment settings">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const m = monthly.trim() ? parseMoney(monthly) : 0
            const w = wedding.trim() ? parseMoney(wedding) : null
            if (m === null || m < 0 || (wedding.trim() && (w === null || w < 0))) return toast.error('Enter amounts in pounds')
            save.mutate({ userId, monthly_minor: m, wedding_minor: w, values_as_of: asOf || null }, { onSuccess: onClose, onError: (err) => toast.error(getErrorMessage(err)) })
          }}
        >
          <Field label="Monthly (£)" htmlFor="is-monthly"><Input id="is-monthly" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></Field>
          <Field label="Keep safe for the wedding (£)" htmlFor="is-wedding" hint="Held as cash, not shares. Blank if not decided yet.">
            <Input id="is-wedding" inputMode="decimal" value={wedding} onChange={(e) => setWedding(e.target.value)} />
          </Field>
          <Field label="Values checked on" htmlFor="is-asof"><Input id="is-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
