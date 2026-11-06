import { Check, Pencil, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { daysBetween } from '../../../../supabase/functions/_shared/agents/dates.ts'
import { longDate, RENEWAL_PRESETS, renewedDate, whenText } from '../../../../supabase/functions/_shared/agents/lifeAdmin.ts'
import { type RenewalInput, type RenewalRow, useDeleteRenewal, useRenewals, useSaveRenewal } from '../api'

const REPEATS = [
  { months: 0, label: 'Set by hand' },
  { months: 12, label: 'Every year' },
  { months: 24, label: 'Every 2 years' },
  { months: 36, label: 'Every 3 years' },
  { months: 60, label: 'Every 5 years' },
  { months: 120, label: 'Every 10 years' },
]
const WARN = [
  { days: 14, label: '2 weeks before' },
  { days: 21, label: '3 weeks before' },
  { days: 28, label: '4 weeks before' },
  { days: 30, label: 'A month before' },
  { days: 49, label: '7 weeks before' },
  { days: 60, label: '2 months before' },
  { days: 90, label: '3 months before' },
  { days: 180, label: '6 months before' },
]

const blank = (): RenewalInput & { id?: string } => ({ name: '', owner_id: null, expires_on: '', warn_days: 30, every_months: 12 })

/** The household's renewals: what expires when, and who it's for. Both of you can see and edit them. */
export function Renewals() {
  const { me, partner, member } = useHousehold()
  const renewals = useRenewals()
  const save = useSaveRenewal()
  const remove = useDeleteRenewal()
  const [form, setForm] = useState<(RenewalInput & { id?: string }) | null>(null)
  const today = todayISO()

  const pickName = (name: string) => {
    const preset = RENEWAL_PRESETS.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())
    setForm((f) => f && { ...f, name, ...(preset && !f.id ? { warn_days: preset.warn, every_months: preset.every } : {}) })
  }
  const renewed = (r: RenewalRow) => {
    const next = renewedDate(r, today)
    if (next) save.mutate({ ...r, expires_on: next }, { onSuccess: () => toast.success(`${r.name}: next ${longDate(next)}`), onError: (e) => toast.error(getErrorMessage(e)) })
  }

  return (
    <div className="grid gap-2 rounded-xl border p-3">
      <h4 className="text-sm font-semibold">Renewals</h4>
      {renewals.data?.length ? (
        <ul className="grid gap-1.5">
          {renewals.data.map((r) => {
            const days = daysBetween(today, r.expires_on)
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {r.name}
                  <span className="text-muted-foreground"> · {r.owner_id ? (member(r.owner_id)?.display_name ?? 'Someone') : 'Joint'}</span>
                </span>
                <span className={days <= r.warn_days ? 'font-medium text-warning' : 'text-muted-foreground'} title={whenText(days)}>
                  {longDate(r.expires_on)}
                </span>
                {r.every_months ? (
                  <Button size="sm" variant="outline" className="h-7" disabled={save.isPending} onClick={() => renewed(r)}>
                    <Check /> Renewed
                  </Button>
                ) : null}
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setForm({ ...r })}>
                  <Pencil />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${r.name}`}
                  onClick={() => remove.mutate(r.id, { onError: (e) => toast.error(getErrorMessage(e)) })}
                >
                  <X />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : renewals.isPending ? null : (
        <p className="text-sm text-muted-foreground">Nothing yet. Add your passports, MOT, insurance and contracts.</p>
      )}

      {form ? (
        <form
          className="grid gap-2 border-t pt-2"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate(
              { ...form, name: form.name.trim(), every_months: form.every_months || null },
              { onSuccess: () => setForm(null), onError: (err) => toast.error(getErrorMessage(err)) },
            )
          }}
        >
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label="What"
              placeholder="e.g. Passport"
              className="h-8 min-w-40 flex-1"
              list="renewal-presets"
              maxLength={60}
              required
              value={form.name}
              onChange={(e) => pickName(e.target.value)}
            />
            <datalist id="renewal-presets">
              {RENEWAL_PRESETS.map((p) => <option key={p.name} value={p.name} />)}
            </datalist>
            <NativeSelect aria-label="Whose" className="h-8 w-auto" value={form.owner_id ?? ''} onChange={(e) => setForm({ ...form, owner_id: e.target.value || null })}>
              <option value="">Joint</option>
              <option value={me.id}>{me.display_name}</option>
              {partner ? <option value={partner.id}>{partner.display_name}</option> : null}
            </NativeSelect>
            <Input type="date" aria-label="Expires on" className="h-8 w-auto" required value={form.expires_on} onChange={(e) => setForm({ ...form, expires_on: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Repeats" className="h-8 w-auto" value={form.every_months ?? 0} onChange={(e) => setForm({ ...form, every_months: Number(e.target.value) || null })}>
              {REPEATS.map((o) => <option key={o.months} value={o.months}>{o.label}</option>)}
              {form.every_months && !REPEATS.some((o) => o.months === form.every_months) ? <option value={form.every_months}>Every {form.every_months} months</option> : null}
            </NativeSelect>
            <NativeSelect aria-label="Remind me" className="h-8 w-auto" value={form.warn_days} onChange={(e) => setForm({ ...form, warn_days: Number(e.target.value) })}>
              {WARN.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
              {!WARN.some((o) => o.days === form.warn_days) ? <option value={form.warn_days}>{form.warn_days} days before</option> : null}
            </NativeSelect>
            <div className="ml-auto flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={save.isPending}>{form.id ? 'Save' : 'Add'}</Button>
            </div>
          </div>
        </form>
      ) : (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setForm(blank())}>
            <Plus /> Renewal
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Shared with your partner. A personal one only reminds its owner.</p>
    </div>
  )
}
