import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Segmented, Switch } from '@/components/ui/misc'
import { monthStart, todayISO } from '@/lib/dates'
import { formatMoney, parseMoney, toMoneyInput } from '@/lib/money'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { type Account, ACCOUNT_TYPES, type Budget, LIABILITY_TYPES, type SavingsGoal, type Transaction, VALUED_TYPES } from '../api'
import {
  useAccounts,
  useCreateAccount,
  useCreateTransaction,
  useCreateTransfer,
  useDeleteBudget,
  useFinanceCategories,
  useRecordBalance,
  useSaveBudget,
  useSaveGoal,
  useUpdateAccount,
  useUpdateTransaction,
} from '../hooks'

export function MoneyInput({
  value,
  onChange,
  currency = 'GBP',
  id,
  allowNegative,
  ...rest
}: {
  value: string
  onChange: (v: string) => void
  currency?: string
  id?: string
  allowNegative?: boolean
  'aria-label'?: string
  autoFocus?: boolean
}) {
  const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{symbol}</span>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        className="tabular"
        style={{ paddingLeft: `${0.75 + symbol.length * 0.6}rem` }}
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(allowNegative ? e.target.value : e.target.value.replace('-', ''))}
        {...rest}
      />
    </div>
  )
}

function accountLabel(a: Account, owner?: string) {
  return `${a.name}${a.ownership === 'joint' ? ' · Joint' : owner ? ` · ${owner}` : ''}`
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------
type TxKind = 'expense' | 'income' | 'transfer'

export function TransactionDialog({
  open,
  onOpenChange,
  initial,
  defaultAccountId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initial?: Transaction
  defaultAccountId?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={initial ? 'Edit transaction' : 'Add transaction'}>
        {open ? <TransactionForm initial={initial} defaultAccountId={defaultAccountId} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function TransactionForm({ initial, defaultAccountId, onDone }: { initial?: Transaction; defaultAccountId?: string; onDone: () => void }) {
  const { member } = useHousehold()
  const accounts = (useAccounts().data ?? []).filter((a) => !a.archived_at || a.id === initial?.account_id)
  const categories = useFinanceCategories().data ?? []
  const create = useCreateTransaction()
  const update = useUpdateTransaction()
  const transfer = useCreateTransfer()

  const [kind, setKind] = useState<TxKind>(initial ? (initial.kind === 'income' ? 'income' : 'expense') : 'expense')
  const [amount, setAmount] = useState(initial ? toMoneyInput(Math.abs(initial.amount_minor)) : '')
  const [toAmount, setToAmount] = useState('')
  const [accountId, setAccountId] = useState(initial?.account_id ?? defaultAccountId ?? accounts[0]?.id ?? '')
  const [toAccountId, setToAccountId] = useState('')
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '')
  const [date, setDate] = useState(initial?.occurred_on ?? todayISO())
  const [description, setDescription] = useState(initial?.description ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  const account = accounts.find((a) => a.id === accountId)
  const toAccount = accounts.find((a) => a.id === toAccountId)
  const crossCurrency = kind === 'transfer' && account && toAccount && account.currency !== toAccount.currency
  const busy = create.isPending || update.isPending || transfer.isPending

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const minor = parseMoney(amount, account?.currency)
    if (!account) return setError('Choose an account')
    if (!minor || minor <= 0) return setError('Enter an amount greater than zero')
    if (kind === 'transfer') {
      if (!toAccount || toAccount.id === account.id) return setError('Choose a different account to transfer to')
      const toMinor = crossCurrency ? parseMoney(toAmount, toAccount.currency) : undefined
      if (crossCurrency && (!toMinor || toMinor <= 0)) return setError('Enter the amount received')
      transfer.mutate(
        { fromAccountId: account.id, toAccountId: toAccount.id, amountMinor: minor, toAmountMinor: toMinor ?? undefined, occurredOn: date, description: description.trim() || `Transfer to ${toAccount.name}`, notes: notes || undefined },
        { onSuccess: onDone },
      )
      return
    }
    if (!description.trim()) return setError('Add a short description')
    const payload = {
      account_id: account.id,
      occurred_on: date,
      amount_minor: kind === 'expense' ? -minor : minor,
      kind,
      category_id: categoryId || null,
      description: description.trim(),
      notes: notes.trim() || null,
    }
    if (initial) {
      const { account_id: _ignored, ...patch } = payload
      update.mutate({ id: initial.id, patch }, { onSuccess: onDone })
    } else {
      create.mutate(payload, { onSuccess: onDone })
    }
  }

  const accountOptions = accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {accountLabel(a, member(a.owner_id)?.display_name)}
    </option>
  ))

  if (!accounts.length) {
    return <p className="py-4 text-sm text-muted-foreground">Add an account first, then you can record transactions against it.</p>
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {!initial ? (
        <Segmented
          aria-label="Type"
          value={kind}
          onChange={(k) => { setKind(k); setCategoryId('') }}
          options={[
            { value: 'expense', label: 'Expense' },
            { value: 'income', label: 'Income' },
            { value: 'transfer', label: 'Transfer' },
          ]}
          className="w-full [&>*]:flex-1"
        />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={crossCurrency ? `Amount sent (${account?.currency})` : 'Amount'} htmlFor="tx-amount" error={error}>
          <MoneyInput id="tx-amount" autoFocus value={amount} onChange={(v) => { setAmount(v); setError(null) }} currency={account?.currency} />
        </Field>
        <Field label="Date" htmlFor="tx-date">
          <Input id="tx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      </div>
      <Field label={kind === 'transfer' ? 'From account' : 'Account'} htmlFor="tx-account">
        <NativeSelect id="tx-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={Boolean(initial)}>
          {accountOptions}
        </NativeSelect>
      </Field>
      {kind === 'transfer' ? (
        <>
          <Field label="To account" htmlFor="tx-to" hint="Transfers move money between your accounts and are never counted as income or spending.">
            <NativeSelect id="tx-to" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              <option value="">Choose…</option>
              {accountOptions}
            </NativeSelect>
          </Field>
          {crossCurrency ? (
            <Field label={`Amount received (${toAccount?.currency})`} htmlFor="tx-to-amount">
              <MoneyInput id="tx-to-amount" value={toAmount} onChange={setToAmount} currency={toAccount?.currency} />
            </Field>
          ) : null}
        </>
      ) : (
        <Field label="Category" htmlFor="tx-category">
          <NativeSelect id="tx-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Uncategorised</option>
            {categories
              .filter((c) => c.kind === kind && !c.archived_at)
              .map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </NativeSelect>
        </Field>
      )}
      <Field label="Description" htmlFor="tx-desc">
        <Input id="tx-desc" value={description} maxLength={200} placeholder={kind === 'transfer' ? 'Optional' : 'e.g. Weekly shop'} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Notes" htmlFor="tx-notes">
        <Textarea id="tx-notes" rows={2} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save' : 'Add'}</Button>
      </DialogFooter>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------
export function AccountDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: Account }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={initial ? 'Edit account' : 'Add account'}>
        {open ? <AccountForm initial={initial} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function AccountForm({ initial, onDone }: { initial?: Account; onDone: () => void }) {
  const { members, household } = useHousehold()
  const create = useCreateAccount()
  const update = useUpdateAccount()
  const [name, setName] = useState(initial?.name ?? '')
  const [institution, setInstitution] = useState(initial?.institution ?? '')
  const [type, setType] = useState(initial?.account_type ?? 'current')
  const [owner, setOwner] = useState(initial ? (initial.ownership === 'joint' ? 'joint' : initial.owner_id!) : 'joint')
  const [currency, setCurrency] = useState(initial?.currency ?? household.default_currency)
  const liability = LIABILITY_TYPES.has(type)
  // Liabilities are stored negative; the form asks for the positive amount owed.
  const [opening, setOpening] = useState(initial ? toMoneyInput(Math.abs(initial.opening_balance_minor)) : '')
  const [openingDate, setOpeningDate] = useState(initial?.opening_date ?? todayISO())
  const [includeNW, setIncludeNW] = useState(initial?.include_in_net_worth ?? true)
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Name the account')
    const minor = opening.trim() ? parseMoney(opening, currency) : 0
    if (minor === null) return setError('Opening balance is not a valid amount')
    const payload = {
      name: name.trim(),
      institution: institution.trim() || null,
      account_type: type,
      ownership: owner === 'joint' ? 'joint' : 'personal',
      owner_id: owner === 'joint' ? null : owner,
      opening_balance_minor: liability ? -Math.abs(minor) : minor,
      opening_date: openingDate,
      include_in_net_worth: includeNW,
    }
    if (initial) update.mutate({ id: initial.id, patch: payload }, { onSuccess: onDone })
    else create.mutate({ ...payload, currency }, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Name" htmlFor="acc-name" error={error}>
        <Input id="acc-name" autoFocus value={name} maxLength={80} placeholder="e.g. Joint current account" onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="acc-type">
          <NativeSelect id="acc-type" value={type} onChange={(e) => setType(e.target.value)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Provider" htmlFor="acc-inst">
          <Input id="acc-inst" value={institution} maxLength={80} placeholder="Optional" onChange={(e) => setInstitution(e.target.value)} />
        </Field>
      </div>
      <Field label="Belongs to">
        <Segmented
          aria-label="Belongs to"
          value={owner}
          onChange={setOwner}
          options={[{ value: 'joint', label: 'Joint' }, ...members.map((m) => ({ value: m.id, label: m.display_name }))]}
          className="w-full [&>*]:flex-1"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_6rem]">
        <Field label={liability ? 'Amount owed at start' : 'Opening balance'} htmlFor="acc-open">
          <MoneyInput id="acc-open" value={opening} onChange={setOpening} currency={currency} allowNegative={!liability} />
        </Field>
        <Field label="As of" htmlFor="acc-open-date">
          <Input id="acc-open-date" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
        </Field>
        <Field label="Currency" htmlFor="acc-cur">
          <Input id="acc-cur" value={currency} maxLength={3} disabled={Boolean(initial)} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </Field>
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        Include in net worth
        <Switch checked={includeNW} onCheckedChange={setIncludeNW} />
      </label>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={create.isPending || update.isPending}>{initial ? 'Save' : 'Add account'}</Button>
      </DialogFooter>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Record balance
// ---------------------------------------------------------------------------
export function RecordBalanceDialog({ account, onOpenChange, currentBalance }: { account: Account | null; onOpenChange: (o: boolean) => void; currentBalance?: number }) {
  const record = useRecordBalance()
  const liability = account ? LIABILITY_TYPES.has(account.account_type) : false
  const [value, setValue] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const valued = account ? VALUED_TYPES.has(account.account_type) : false
  const [estimate, setEstimate] = useState(valued)
  useEffect(() => setEstimate(valued), [valued, account?.id])

  return (
    <Dialog open={Boolean(account)} onOpenChange={(o) => { if (!o) { setValue(''); setError(null) } onOpenChange(o) }}>
      <DialogContent
        title={valued ? 'Record value' : 'Record balance'}
        description={
          valued
            ? 'What it would sell for today. Estimates are always labelled as estimates.'
            : 'Enter the actual balance from a statement or app. It becomes a real data point; later transactions are added on top.'
        }
      >
        {account ? (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              const minor = parseMoney(value, account.currency)
              if (minor === null) return setError('Enter a valid amount')
              record.mutate(
                { accountId: account.id, asOf: date, balanceMinor: liability ? -Math.abs(minor) : minor, note, estimate },
                { onSuccess: () => { setValue(''); onOpenChange(false) } },
              )
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={liability ? 'Amount owed' : valued ? 'Value' : 'Balance'}
                htmlFor="bal-v"
                error={error}
                hint={currentBalance !== undefined ? `${valued ? 'Currently' : 'Calculated now'}: ${formatMoney(currentBalance, account.currency)}` : undefined}
              >
                <MoneyInput id="bal-v" autoFocus value={value} onChange={setValue} currency={account.currency} allowNegative={!liability} />
              </Field>
              <Field label="On" htmlFor="bal-d">
                <Input id="bal-d" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            <Field label="Note" htmlFor="bal-n">
              <Input id="bal-n" value={note} maxLength={500} placeholder={valued ? 'Optional, e.g. based on the London flat price index' : 'Optional, e.g. October statement'} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={estimate} onChange={(e) => setEstimate(e.target.checked)} className="mt-0.5 accent-[var(--primary)]" />
              <span>
                This is an estimate
                <span className="block text-xs text-muted-foreground">A valuation or best guess rather than a statement. Shown as “estimated” everywhere.</span>
              </span>
            </label>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={record.isPending}>{valued ? 'Save value' : 'Save balance'}</Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------
export function BudgetDialog({ open, onOpenChange, initial, month }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: Budget; month: string }) {
  const categories = (useFinanceCategories().data ?? []).filter((c) => c.kind === 'expense' && !c.archived_at)
  const save = useSaveBudget()
  const del = useDeleteBudget()
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '')
  const [amount, setAmount] = useState(initial ? toMoneyInput(initial.amount_minor) : '')
  const [from, setFrom] = useState((initial?.starts_month ?? month).slice(0, 7))
  const [error, setError] = useState<string | null>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={initial ? 'Edit budget' : 'Add monthly budget'}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const minor = parseMoney(amount)
            if (!categoryId) return setError('Choose a category')
            if (!minor || minor <= 0) return setError('Enter a monthly amount')
            save.mutate({ id: initial?.id, category_id: categoryId, amount_minor: minor, starts_month: monthStart(`${from}-01`) }, { onSuccess: () => onOpenChange(false) })
          }}
        >
          <Field label="Category" htmlFor="b-cat" error={error}>
            <NativeSelect id="b-cat" value={categoryId} disabled={Boolean(initial)} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Per month" htmlFor="b-amt">
              <MoneyInput id="b-amt" value={amount} onChange={setAmount} />
            </Field>
            <Field label="Starting" htmlFor="b-from" hint="Applies from this month onwards">
              <Input id="b-from" type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            {initial ? (
              <Button variant="ghost" className="text-destructive sm:mr-auto" onClick={() => del.mutate(initial.id, { onSuccess: () => onOpenChange(false) })}>
                Remove budget
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>Save budget</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Savings goal
// ---------------------------------------------------------------------------
export function GoalDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: SavingsGoal }) {
  const { members, member } = useHousehold()
  const accounts = (useAccounts().data ?? []).filter((a) => !a.archived_at && !LIABILITY_TYPES.has(a.account_type))
  const save = useSaveGoal()
  const [name, setName] = useState(initial?.name ?? '')
  const [target, setTarget] = useState(initial ? toMoneyInput(initial.target_minor) : '')
  const [date, setDate] = useState(initial?.target_date ?? '')
  const [accountId, setAccountId] = useState(initial?.account_id ?? '')
  const [manual, setManual] = useState(initial ? toMoneyInput(initial.manual_saved_minor) : '')
  const [owner, setOwner] = useState(initial?.owner_id ?? 'joint')
  const [error, setError] = useState<string | null>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={initial ? 'Edit goal' : 'New savings goal'}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const t = parseMoney(target)
            const m = manual.trim() ? parseMoney(manual) : 0
            if (!name.trim()) return setError('Name the goal')
            if (!t || t <= 0) return setError('Enter a target amount')
            if (m === null || m < 0) return setError('Saved so far is not a valid amount')
            save.mutate(
              {
                id: initial?.id,
                name: name.trim(),
                target_minor: t,
                target_date: date || null,
                account_id: accountId || null,
                manual_saved_minor: m,
                ownership: owner === 'joint' ? 'joint' : 'personal',
                owner_id: owner === 'joint' ? null : owner,
              },
              { onSuccess: () => onOpenChange(false) },
            )
          }}
        >
          <Field label="Goal" htmlFor="g-name" error={error}>
            <Input id="g-name" autoFocus value={name} maxLength={80} placeholder="e.g. Holiday in Italy" onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Target" htmlFor="g-target">
              <MoneyInput id="g-target" value={target} onChange={setTarget} />
            </Field>
            <Field label="By (optional)" htmlFor="g-date">
              <Input id="g-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="For">
            <Segmented aria-label="For" value={owner} onChange={setOwner} options={[{ value: 'joint', label: 'Both of us' }, ...members.map((m) => ({ value: m.id, label: m.display_name }))]} className="w-full [&>*]:flex-1" />
          </Field>
          <Field label="Track progress from" htmlFor="g-acc" hint="Link a savings account to follow its balance automatically, or enter the amount yourself.">
            <NativeSelect id="g-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Manual amount</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{accountLabel(a, member(a.owner_id)?.display_name)}</option>
              ))}
            </NativeSelect>
          </Field>
          {!accountId ? (
            <Field label="Saved so far" htmlFor="g-manual">
              <MoneyInput id="g-manual" value={manual} onChange={setManual} />
            </Field>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>Save goal</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
