import { ArrowDown, ArrowUp, Check, PiggyBank, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { Badge, Progress } from '@/components/ui/misc'
import { formatDay } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { formatMoney, parseMoney, toMoneyInput } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { type Account, LIABILITY_TYPES, type SavingsGoal, type SavingsPot, VALUED_TYPES } from '../api'
import { MoneyInput } from '../components/forms'
import { useAccounts, useBalances, useDeletePot, useDeletePotItem, usePots, useReorderPotItems, useSavePot, useSavePotItem } from '../hooks'
import { type FundedItem, fundPot, move } from '../lib/pots'

const money = (v: number) => formatMoney(v, 'GBP', { hidePence: true })

/** Savings pots: each backed by an account whose balance funds its items in order. */
export function GoalsTab() {
  const pots = usePots()
  const balances = useBalances()
  const accounts = useAccounts()
  const [editingPot, setEditingPot] = useState<SavingsPot | 'new' | null>(null)

  if (pots.isPending || balances.isPending || accounts.isPending) return <ListSkeleton rows={3} />
  if (pots.error) return <ErrorState error={pots.error} onRetry={() => pots.refetch()} />

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Each pot's account funds its items in order, one at a time.</p>
        <Button variant="outline" size="sm" onClick={() => setEditingPot('new')}><Plus /> New pot</Button>
      </div>
      {!pots.data.pots.length ? (
        <Card>
          <EmptyState icon={PiggyBank} title="No pots yet" description="Make a pot for each savings account, e.g. Holidays, then add what it's saving for in order." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
          {pots.data.pots.map((p) => (
            <PotCard
              key={p.id}
              pot={p}
              account={accounts.data?.find((a) => a.id === p.account_id)}
              balance={p.account_id ? (balances.data?.get(p.account_id) ?? 0) : 0}
              items={pots.data.items.filter((i) => i.pot_id === p.id)}
              onEdit={() => setEditingPot(p)}
            />
          ))}
        </div>
      )}
      <PotDialog key={editingPot === 'new' ? 'new' : editingPot?.id} pot={editingPot} accounts={accounts.data ?? []} onClose={() => setEditingPot(null)} />
    </div>
  )
}

function PotCard({ pot, account, balance, items, onEdit }: { pot: SavingsPot; account?: Account; balance: number; items: SavingsGoal[]; onEdit: () => void }) {
  const reorder = useReorderPotItems()
  const remove = useDeletePotItem()
  const [editing, setEditing] = useState<SavingsGoal | 'new' | null>(null)
  const funded = fundPot(balance, items)
  const pct = funded.needed ? Math.min(100, Math.round((Math.max(0, balance) / funded.needed) * 100)) : 0

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{pot.name}</p>
          <p className="truncate text-xs text-muted-foreground">{account ? `${account.name} account` : 'No account linked'}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${pot.name}`} onClick={onEdit}><Pencil /></Button>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular">
        {money(balance)}
        {funded.needed ? <span className="text-sm font-normal text-muted-foreground"> of {money(funded.needed)}</span> : null}
      </p>
      {funded.needed ? (
        <>
          <Progress value={pct} className="mt-2 h-2" indicatorClassName={funded.shortfall === 0 ? 'bg-success' : undefined} />
          <p className="mt-1.5 text-xs text-muted-foreground tabular">
            {funded.shortfall ? `${money(funded.shortfall)} still to save` : 'Everything is funded'}
            {funded.spare ? ` · ${money(funded.spare)} spare` : ''}
          </p>
        </>
      ) : null}

      <ol className="mt-3 grid grid-cols-1 gap-2 border-t pt-3">
        {funded.items.map((item, i) => (
          <PotItemRow
            key={item.id}
            item={item}
            first={i === 0}
            last={i === funded.items.length - 1}
            onMove={(by) => reorder.mutate(move(funded.items, i, by))}
            onEdit={() => setEditing(item)}
            onDelete={() => remove.mutate(item.id, { onError: (e) => toast.error(getErrorMessage(e)) })}
          />
        ))}
        {!items.length ? <li className="text-xs text-muted-foreground">Nothing in this pot yet.</li> : null}
      </ol>
      <Button variant="ghost" size="sm" className="mt-2 max-w-full" onClick={() => setEditing('new')}><Plus /> <span className="truncate">Add to {pot.name}</span></Button>

      <PotItemDialog key={editing === 'new' ? 'new' : editing?.id} pot={pot} item={editing} nextOrder={items.length} onClose={() => setEditing(null)} />
    </Card>
  )
}

function PotItemRow({
  item,
  first,
  last,
  onMove,
  onEdit,
  onDelete,
}: {
  item: FundedItem<SavingsGoal>
  first: boolean
  last: boolean
  onMove: (by: -1 | 1) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const pct = Math.round((item.funded / item.target_minor) * 100)
  return (
    <li className={cn('grid grid-cols-1 gap-1 rounded-lg p-2', item.status === 'funding' && 'bg-muted/50')}>
      <div className="flex items-start justify-between gap-2 text-sm">
        <div className="min-w-0">
          <p className="truncate font-medium">{item.name}</p>
          <p className="text-xs text-muted-foreground">
            {item.status === 'funded' ? (
              <span className="inline-flex items-center gap-0.5 text-success"><Check className="size-3" /> Funded</span>
            ) : item.status === 'funding' ? (
              'Saving for this now'
            ) : (
              'Waiting'
            )}
            {item.target_date ? ` · by ${formatDay(item.target_date)}` : ''}
          </p>
        </div>
        <p className="shrink-0 text-right text-xs tabular">
          <span className="text-sm font-medium">{money(item.funded)}</span>
          <span className="text-muted-foreground"> / {money(item.target_minor)}</span>
        </p>
      </div>
      <Progress value={pct} className="h-1.5" indicatorClassName={item.status === 'funded' ? 'bg-success' : undefined} />
      <div className="flex items-center justify-between">
        <div className="flex">
          <Button variant="ghost" size="icon-sm" aria-label={`Move ${item.name} up`} disabled={first} onClick={() => onMove(-1)}><ArrowUp /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Move ${item.name} down`} disabled={last} onClick={() => onMove(1)}><ArrowDown /></Button>
        </div>
        <div className="flex">
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${item.name}`} onClick={onEdit}><Pencil /></Button>
          {confirm ? (
            <Button variant="destructive" size="sm" onClick={onDelete}>Delete?</Button>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${item.name}`} onClick={() => setConfirm(true)}><Trash2 /></Button>
          )}
        </div>
      </div>
      {item.status === 'funding' ? <Badge tone="primary" className="justify-self-start">Next up</Badge> : null}
    </li>
  )
}

function PotDialog({ pot, accounts, onClose }: { pot: SavingsPot | 'new' | null; accounts: Account[]; onClose: () => void }) {
  const { member } = useHousehold()
  const save = useSavePot()
  const del = useDeletePot()
  const existing = pot && pot !== 'new' ? pot : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [accountId, setAccountId] = useState(existing?.account_id ?? '')
  const [confirm, setConfirm] = useState(false)
  const options = accounts.filter((a) => !a.archived_at && !LIABILITY_TYPES.has(a.account_type) && !VALUED_TYPES.has(a.account_type))
  const owner = (a: Account) => (a.ownership === 'joint' ? 'Joint' : member(a.owner_id)?.display_name)

  return (
    <Dialog open={Boolean(pot)} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title={existing ? `Edit ${existing.name}` : 'New pot'} description="The pot's money is this account's balance.">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            save.mutate({ id: existing?.id, name: name.trim(), account_id: accountId || null }, { onSuccess: onClose, onError: (err) => toast.error(getErrorMessage(err)) })
          }}
        >
          <Field label="Name" htmlFor="pot-name">
            <Input id="pot-name" autoFocus value={name} maxLength={80} placeholder="e.g. Holidays" onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Funded by" htmlFor="pot-account">
            <NativeSelect id="pot-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Choose an account…</option>
              {options.map((a) => <option key={a.id} value={a.id}>{owner(a)} · {a.name}</option>)}
            </NativeSelect>
          </Field>
          <DialogFooter className="sm:justify-between">
            {existing ? (
              <Button type="button" variant={confirm ? 'destructive' : 'ghost'} onClick={() => (confirm ? del.mutate(existing.id, { onSuccess: onClose }) : setConfirm(true))}>
                <Trash2 /> {confirm ? 'Delete the pot and everything in it?' : 'Delete pot'}
              </Button>
            ) : <span />}
            <Button type="submit" disabled={save.isPending || !name.trim()}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PotItemDialog({ pot, item, nextOrder, onClose }: { pot: SavingsPot; item: SavingsGoal | 'new' | null; nextOrder: number; onClose: () => void }) {
  const save = useSavePotItem()
  const existing = item && item !== 'new' ? item : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [amount, setAmount] = useState(existing ? toMoneyInput(existing.target_minor) : '')
  const [date, setDate] = useState(existing?.target_date ?? '')
  const [error, setError] = useState<string | null>(null)

  return (
    <Dialog open={Boolean(item)} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title={existing ? `Edit ${existing.name}` : `Add to ${pot.name}`} description={existing ? undefined : 'New items go to the end of the list; move them up to fund them sooner.'}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const target = parseMoney(amount)
            if (!name.trim()) return setError('Give it a name')
            if (!target || target <= 0) return setError('Enter an amount')
            save.mutate(
              { id: existing?.id, pot_id: pot.id, name: name.trim(), target_minor: target, target_date: date || null, sort_order: existing?.sort_order ?? nextOrder },
              { onSuccess: onClose, onError: (err) => toast.error(getErrorMessage(err)) },
            )
          }}
        >
          <Field label="What for" htmlFor="item-name" error={error}>
            <Input id="item-name" autoFocus value={name} maxLength={80} placeholder={pot.name.toLowerCase().includes('service') ? 'e.g. Service charge (Jan)' : 'e.g. Italy, June'} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" htmlFor="item-amount">
              <MoneyInput id="item-amount" value={amount} onChange={setAmount} />
            </Field>
            <Field label="Due (optional)" htmlFor="item-date">
              <Input id="item-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
