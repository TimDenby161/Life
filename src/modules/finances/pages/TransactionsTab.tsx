import { ArrowLeftRight, Receipt, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Card } from '@/components/ui/card'
import { Input, NativeSelect } from '@/components/ui/input'
import { formatDay } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { cn, groupBy } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { Transaction } from '../api'
import { TransactionDialog } from '../components/forms'
import { useAccounts, useDeleteTransaction, useFinanceCategories, useTransactions } from '../hooks'

const PAGE = 100

export function TransactionsTab() {
  const { member } = useHousehold()
  const transactions = useTransactions()
  const accounts = useAccounts().data ?? []
  const categories = useFinanceCategories().data ?? []
  const del = useDeleteTransaction()
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [kind, setKind] = useState('')
  const [month, setMonth] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [editing, setEditing] = useState<Transaction | undefined>()
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (transactions.data ?? []).filter(
      (t) =>
        (!accountId || t.account_id === accountId) &&
        (!categoryId || t.category_id === categoryId) &&
        (!kind || t.kind === kind) &&
        (!month || t.occurred_on.startsWith(month)) &&
        (!q || t.description.toLowerCase().includes(q) || (t.notes ?? '').toLowerCase().includes(q)),
    )
  }, [transactions.data, accountId, categoryId, kind, month, search])

  // Show each transfer once (the outgoing leg) unless filtering by account.
  const rows = accountId ? filtered : filtered.filter((t) => t.kind !== 'transfer' || t.amount_minor < 0)
  const visible = rows.slice(0, limit)
  const byDay = groupBy(visible, (t) => t.occurred_on)
  const legsByTransfer = groupBy((transactions.data ?? []).filter((t) => t.transfer_id), (t) => t.transfer_id!)

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Input aria-label="Search transactions" placeholder="Search" className="h-9 w-full sm:w-48" value={search} onChange={(e) => setSearch(e.target.value)} />
        <NativeSelect aria-label="Account" className="h-9 w-auto" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Type" className="h-9 w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All types</option>
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
          <option value="transfer">Transfers</option>
          <option value="adjustment">Adjustments</option>
        </NativeSelect>
        <NativeSelect aria-label="Category" className="h-9 w-auto" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <Input type="month" aria-label="Month" className="h-9 w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>

      <Card className="p-2 sm:p-3">
        {transactions.isPending ? (
          <ListSkeleton rows={6} className="p-3" />
        ) : transactions.error ? (
          <ErrorState error={transactions.error} onRetry={() => transactions.refetch()} />
        ) : !rows.length ? (
          <EmptyState icon={Receipt} title="No transactions" description="Add income, spending or transfers with the Transaction button." />
        ) : (
          <>
            {Object.entries(byDay).map(([day, txs]) => (
              <section key={day} className="mb-1">
                <h3 className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{formatDay(day)}</h3>
                <ul>
                  {txs.map((t) => {
                    const account = accountById.get(t.account_id)
                    const isTransfer = t.kind === 'transfer'
                    const other = isTransfer ? legsByTransfer[t.transfer_id!]?.find((l) => l.id !== t.id) : undefined
                    const otherAccount = other ? accountById.get(other.account_id) : undefined
                    const cat = t.category_id ? categoryById.get(t.category_id) : undefined
                    const amountShown = isTransfer && !accountId ? Math.abs(t.amount_minor) : t.amount_minor
                    return (
                      <li key={t.id} className="group flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-muted/60">
                        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => !isTransfer && setEditing(t)} disabled={isTransfer}>
                          <span className={cn('grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground', isTransfer && 'bg-accent text-accent-foreground')}>
                            {isTransfer ? <ArrowLeftRight className="size-4" /> : <Receipt className="size-4" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[15px]">{t.description}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {isTransfer
                                ? `${t.amount_minor < 0 ? account?.name : otherAccount?.name} → ${t.amount_minor < 0 ? otherAccount?.name : account?.name}`
                                : [account?.name, cat?.name ?? 'Uncategorised', t.created_by ? `added by ${member(t.created_by)?.display_name ?? '—'}` : null].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                        </button>
                        <span className={cn('shrink-0 text-sm font-medium tabular', !isTransfer && t.amount_minor > 0 && 'text-success')}>
                          {formatMoney(amountShown, account?.currency, { signed: !isTransfer || Boolean(accountId) })}
                        </span>
                        <button
                          type="button"
                          aria-label={confirmId === t.id ? 'Confirm delete' : `Delete ${t.description}`}
                          className={cn(
                            'rounded-full p-1.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100',
                            confirmId === t.id && 'bg-destructive text-destructive-foreground opacity-100 hover:text-destructive-foreground',
                          )}
                          onClick={() => {
                            if (confirmId !== t.id) return setConfirmId(t.id)
                            del.mutate(t, { onSuccess: () => setConfirmId(null) })
                          }}
                          onBlur={() => setConfirmId(null)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
            {rows.length > limit ? (
              <button type="button" className="w-full py-3 text-sm font-medium text-primary" onClick={() => setLimit(limit + PAGE)}>
                Show more ({rows.length - limit} remaining)
              </button>
            ) : null}
          </>
        )}
      </Card>
      <TransactionDialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(undefined)} initial={editing} />
    </div>
  )
}
