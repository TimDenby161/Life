import { format, parseISO } from 'date-fns'
import { Archive, ClipboardCheck, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { axisProps, ChartTooltip, gridProps, Legend } from '@/components/charts'
import { SectionTitle } from '@/components/PageHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/misc'
import { formatDay, todayISO } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { type Account, ACCOUNT_TYPES } from '../api'
import { AccountDialog, RecordBalanceDialog } from '../components/forms'
import { SheetSyncCard } from '../components/SheetSync'
import { useAccounts, useBalances, useDeleteAccount, useDeleteSnapshot, useSnapshots, useTransactions, useUpdateAccount } from '../hooks'
import { balanceSeries } from '../lib/calc'

const typeLabel = (t: string) => ACCOUNT_TYPES.find((x) => x.value === t)?.label ?? t

export function AccountsTab() {
  const { members } = useHousehold()
  const accounts = useAccounts()
  const balances = useBalances()
  const snapshots = useSnapshots()
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  if (accounts.isPending || balances.isPending) return <ListSkeleton rows={5} />
  if (accounts.error) return <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />

  const list = accounts.data.filter((a) => showArchived || !a.archived_at)
  const groups = [
    { key: 'joint', label: 'Joint', items: list.filter((a) => a.ownership === 'joint') },
    ...members.map((m) => ({ key: m.id, label: m.display_name, items: list.filter((a) => a.owner_id === m.id) })),
  ]
  const lastRecorded = new Map<string, string>()
  for (const s of snapshots.data ?? []) lastRecorded.set(s.account_id, s.as_of)
  const open = accounts.data.find((a) => a.id === openId) ?? null

  return (
    <div>
      <SheetSyncCard />
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-[var(--primary)]" />
          Show archived
        </label>
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus /> Add account
        </Button>
      </div>
      {!accounts.data.length ? (
        <Card><EmptyState icon={Wallet} title="No accounts yet" description="Add current accounts, savings, cards, loans and investments." /></Card>
      ) : (
        groups.map((g) =>
          g.items.length ? (
            <section key={g.key}>
              <SectionTitle>{g.label}</SectionTitle>
              <Card className="divide-y overflow-hidden">
                {g.items.map((a) => {
                  const bal = balances.data?.get(a.id) ?? 0
                  return (
                    <button key={a.id} type="button" onClick={() => setOpenId(a.id)} className={cn('flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50', a.archived_at && 'opacity-60')}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{a.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[typeLabel(a.account_type), a.institution, lastRecorded.get(a.id) ? `recorded ${formatDay(lastRecorded.get(a.id)!)}` : 'calculated', a.external_provider === 'google_sheet' && 'from sheet'].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={cn('font-semibold tabular', bal < 0 && 'text-destructive')}>{formatMoney(bal, a.currency)}</p>
                        {a.archived_at ? <Badge>Archived</Badge> : !a.include_in_net_worth ? <p className="text-xs text-muted-foreground">excluded from net worth</p> : null}
                      </div>
                    </button>
                  )
                })}
              </Card>
            </section>
          ) : null,
        )
      )}
      <AccountDialog open={adding} onOpenChange={setAdding} />
      <AccountDetailDialog account={open} onClose={() => setOpenId(null)} balance={open ? (balances.data?.get(open.id) ?? 0) : 0} />
    </div>
  )
}

function AccountDetailDialog({ account, onClose, balance }: { account: Account | null; onClose: () => void; balance: number }) {
  const snapshots = useSnapshots()
  const transactions = useTransactions()
  const update = useUpdateAccount()
  const del = useDeleteAccount()
  const delSnap = useDeleteSnapshot()
  const [editing, setEditing] = useState(false)
  const [recording, setRecording] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const own = useMemo(() => (snapshots.data ?? []).filter((s) => s.account_id === account?.id), [snapshots.data, account])
  const series = useMemo(
    () => (account ? balanceSeries(account, own, transactions.data ?? [], 12, todayISO()) : []),
    [account, own, transactions.data],
  )
  const data = series.map((p) => ({
    label: format(parseISO(p.date), 'd MMM yy'),
    calculated: p.balance,
    recorded: p.recorded ? p.balance : null,
  }))
  const money = (v: number) => formatMoney(v, account?.currency, { hidePence: true })
  const txCount = (transactions.data ?? []).filter((t) => t.account_id === account?.id).length

  return (
    <>
      <Dialog open={Boolean(account) && !editing && !recording} onOpenChange={(o) => { if (!o) { setConfirm(false); onClose() } }}>
        <DialogContent title={account?.name ?? 'Account'} description={account ? `${typeLabel(account.account_type)}${account.institution ? ` · ${account.institution}` : ''}` : undefined} className="sm:max-w-2xl">
          {account ? (
            <div className="grid gap-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Current balance</p>
                  <p className={cn('text-3xl font-semibold tabular', balance < 0 && 'text-destructive')}>{formatMoney(balance, account.currency)}</p>
                </div>
                <Button onClick={() => setRecording(true)}>
                  <ClipboardCheck /> Record balance
                </Button>
              </div>

              <div>
                <Legend
                  className="mb-2"
                  items={[
                    { key: 'recorded', label: 'Recorded balance', color: 'var(--chart-1)' },
                    { key: 'calc', label: 'Calculated from transactions', color: 'var(--chart-estimate)', dashed: true },
                  ]}
                />
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
                      <YAxis {...axisProps} width={56} tickFormatter={(v) => formatMoney(v, account.currency, { compact: true })} domain={['auto', 'auto']} />
                      <Tooltip content={<ChartTooltip formatValue={money} />} />
                      <Line dataKey="calculated" name="Calculated" stroke="var(--chart-estimate)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                      <Line dataKey="recorded" name="Recorded" stroke="none" dot={{ r: 4.5, fill: 'var(--chart-1)', stroke: 'var(--card)', strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {own.length ? (
                <section>
                  <h3 className="mb-1 text-sm font-semibold">Recorded balances</h3>
                  <ul className="divide-y text-sm">
                    {own.toReversed().slice(0, 10).map((s) => (
                      <li key={s.id} className="group flex items-center justify-between gap-2 py-1.5">
                        <span className="text-muted-foreground">{formatDay(s.as_of)}{s.source === 'sheet' ? ' · from sheet' : ''}{s.note ? ` · ${s.note}` : ''}</span>
                        <span className="flex items-center gap-2 tabular">
                          {formatMoney(s.balance_minor, account.currency)}
                          <button type="button" aria-label="Delete recorded balance" className="text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100" onClick={() => delSnap.mutate(s.id)}>
                            <Trash2 className="size-3.5" />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <div className="flex flex-wrap justify-end gap-1 border-t pt-4">
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}><Pencil /> Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: account.id, patch: { archived_at: account.archived_at ? null : new Date().toISOString() } }, { onSuccess: onClose })}>
                  <Archive /> {account.archived_at ? 'Restore' : 'Archive'}
                </Button>
                <Button
                  variant={confirm ? 'destructive' : 'ghost'}
                  size="sm"
                  onClick={() => (confirm ? del.mutate(account.id, { onSuccess: onClose }) : setConfirm(true))}
                >
                  <Trash2 /> {confirm ? `Delete with ${txCount} transactions?` : 'Delete'}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <AccountDialog open={editing} onOpenChange={setEditing} initial={account ?? undefined} />
      <RecordBalanceDialog account={recording ? account : null} onOpenChange={setRecording} currentBalance={balance} />
    </>
  )
}
