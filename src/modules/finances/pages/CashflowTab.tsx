import { ArrowDownLeft, ArrowUpRight, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/misc'
import { todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { formatMoney, parseMoney, toMoneyInput } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { CashflowItem } from '../api'
import { MoneyInput } from '../components/forms'
import { useBalances, useCashflow, useDeleteCashflowItem, useGoals, usePots, useSaveCashflowItem } from '../hooks'
import { cashflowTotals, perMonth } from '../lib/cashflow'
import { goalPlans } from '../lib/insights'

const money = (v: number) => formatMoney(v, 'GBP', { hidePence: true })
const onError = (e: unknown) => toast.error(getErrorMessage(e))

type Direction = 'in' | 'out'
type Editing = { item?: CashflowItem; direction: Direction }

/**
 * Cashflow: the regular money coming in (salaries…) and going out (mortgage,
 * bills…), typed in, as monthly amounts; what's left, and what's left once the
 * goals' monthly saving (from Goals) is put away.
 */
export function CashflowTab() {
  const items = useCashflow()
  const goals = useGoals()
  const pots = usePots()
  const balances = useBalances()
  const [editing, setEditing] = useState<Editing | null>(null)
  const today = todayISO()

  const saving = useMemo(() => {
    if (!goals.data || !pots.data || !balances.data) return null
    return goalPlans([...goals.data, ...pots.data.items], pots.data.pots, balances.data, today).reduce((t, p) => t + (p.perMonth ?? 0), 0)
  }, [goals.data, pots.data, balances.data, today])

  if (items.error) return <ErrorState error={items.error} onRetry={() => items.refetch()} />
  if (items.isPending) return <ListSkeleton rows={4} />

  const totals = cashflowTotals(items.data)
  const ins = items.data.filter((i) => i.direction === 'in')
  const outs = items.data.filter((i) => i.direction === 'out')
  const afterSaving = saving ? totals.left - saving : null

  return (
    <div className="grid grid-cols-1 gap-3 md:max-w-2xl">
      <Card>
        <CardHeader className="p-3 pb-1 sm:p-3 sm:pb-1">
          <CardTitle>Each month</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 px-3 pb-3 pt-0 sm:px-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Total label="In" value={money(totals.in)} />
            <Total label="Out" value={money(totals.out)} />
            <Total label="Left" value={`${totals.left < 0 ? '−' : ''}${money(Math.abs(totals.left))}`} className={totals.left < 0 ? 'text-destructive' : 'text-success'} />
          </div>
          {afterSaving !== null && items.data.length ? (
            <p className="border-t pt-2 text-center text-xs text-muted-foreground tabular">
              <span className={cn('font-medium', afterSaving < 0 ? 'text-destructive' : 'text-foreground')}>
                {afterSaving < 0 ? '−' : ''}{money(Math.abs(afterSaving))}
              </span>{' '}
              after {money(saving!)} to goals
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Section title="In" icon={ArrowDownLeft} items={ins} total={totals.in} empty="Add your take-home pay." onAdd={() => setEditing({ direction: 'in' })} onEdit={(item) => setEditing({ item, direction: 'in' })} />
      <Section title="Out" icon={ArrowUpRight} items={outs} total={totals.out} empty="Add the big ones: mortgage, council tax, bills." onAdd={() => setEditing({ direction: 'out' })} onEdit={(item) => setEditing({ item, direction: 'out' })} />

      {editing ? <CashflowDialog key={editing.item?.id ?? editing.direction} editing={editing} nextOrder={items.data.length} onClose={() => setEditing(null)} /> : null}
    </div>
  )
}

function Total({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('text-lg font-semibold tabular', className)}>{value}</p>
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  items,
  total,
  empty,
  onAdd,
  onEdit,
}: {
  title: string
  icon: typeof ArrowDownLeft
  items: CashflowItem[]
  total: number
  empty: string
  onAdd: () => void
  onEdit: (item: CashflowItem) => void
}) {
  const { member } = useHousehold()
  return (
    <Card>
      <CardHeader className="p-3 pb-1 sm:p-3 sm:pb-1">
        <CardTitle className="flex items-center gap-1.5"><Icon className="size-4 text-muted-foreground" aria-hidden /> {title}</CardTitle>
        <span className="flex items-center gap-1">
          {items.length ? <span className="text-sm font-semibold tabular">{money(total)}</span> : null}
          <Button variant="ghost" size="icon-sm" aria-label={`Add to ${title}`} onClick={onAdd}><Plus /></Button>
        </span>
      </CardHeader>
      <CardContent className="px-3 pb-2 pt-0 sm:px-3">
        {items.length ? (
          <ul className="divide-y">
            {items.map((i) => {
              const owner = i.owner_id ? member(i.owner_id)?.display_name : undefined
              return (
                <li key={i.id}>
                  <button type="button" className="flex w-full items-baseline gap-2 py-1.5 text-left text-sm" onClick={() => onEdit(i)}>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{i.name}</span>
                      {owner ? <span className="text-xs text-muted-foreground"> · {owner}</span> : null}
                    </span>
                    {i.every === 'year' ? <span className="shrink-0 text-xs text-muted-foreground tabular">{money(i.amount_minor)}/yr</span> : null}
                    <span className="min-w-16 shrink-0 text-right font-semibold tabular">{money(perMonth(i))}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  )
}

function CashflowDialog({ editing, nextOrder, onClose }: { editing: Editing; nextOrder: number; onClose: () => void }) {
  const { members } = useHousehold()
  const save = useSaveCashflowItem()
  const del = useDeleteCashflowItem()
  const existing = editing.item
  const [direction, setDirection] = useState<Direction>(editing.direction)
  const [name, setName] = useState(existing?.name ?? '')
  const [amount, setAmount] = useState(existing ? toMoneyInput(existing.amount_minor) : '')
  const [every, setEvery] = useState<'month' | 'year'>(existing?.every === 'year' ? 'year' : 'month')
  const [owner, setOwner] = useState(existing?.owner_id ?? '')
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title={existing ? existing.name : direction === 'in' ? 'Money in' : 'Money out'}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const minor = parseMoney(amount)
            if (!name.trim()) return setError('Give it a name')
            if (!minor || minor <= 0) return setError('Enter an amount')
            save.mutate(
              { id: existing?.id, direction, name: name.trim(), amount_minor: minor, every, owner_id: owner || null, ...(existing ? {} : { sort_order: nextOrder }) },
              { onSuccess: onClose, onError },
            )
          }}
        >
          <Segmented
            aria-label="In or out"
            size="sm"
            className="w-fit"
            value={direction}
            onChange={(v) => setDirection(v as Direction)}
            options={[{ value: 'in', label: 'In' }, { value: 'out', label: 'Out' }]}
          />
          <Field label="What" htmlFor="cf-name" error={error}>
            <Input id="cf-name" autoFocus={!existing} maxLength={60} placeholder={direction === 'in' ? 'e.g. Salary' : 'e.g. Mortgage'} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <Field label="Amount" htmlFor="cf-amount">
              <MoneyInput id="cf-amount" value={amount} onChange={setAmount} />
            </Field>
            <Segmented
              aria-label="How often"
              size="sm"
              className="mb-1"
              value={every}
              onChange={(v) => setEvery(v as 'month' | 'year')}
              options={[{ value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]}
            />
          </div>
          <Segmented
            aria-label="Whose"
            size="sm"
            className="w-fit"
            value={owner || 'joint'}
            onChange={(v) => setOwner(v === 'joint' ? '' : v)}
            options={[{ value: 'joint', label: 'Joint' }, ...members.map((m) => ({ value: m.id, label: m.display_name }))]}
          />
          <DialogFooter className="sm:justify-between">
            {existing ? (
              <Button type="button" variant={confirm ? 'destructive' : 'ghost'} onClick={() => (confirm ? del.mutate(existing.id, { onSuccess: onClose, onError }) : setConfirm(true))}>
                <Trash2 /> {confirm ? 'Delete?' : 'Delete'}
              </Button>
            ) : <span />}
            <Button type="submit" disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
