import { formatDistanceToNow } from 'date-fns'
import { CircleAlert, CircleCheck, FileSpreadsheet, Link2, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { rowLabel } from '../../../../supabase/functions/_shared/month-report.ts'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { Badge } from '@/components/ui/misc'
import { formatDay } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { type SheetSource, type SheetSyncResult, spreadsheetIdFrom, type SyncRow } from '../api'
import { useAccounts, useApplySheetLinks, useDeleteSheetSource, useSaveSheetSource, useSheetSource, useSyncSheet } from '../hooks'
import { planLinks, type RowChoice as RowChoiceValue, skipByDefault, suggestAccount } from '../lib/sheetLink'

type OkResult = Extract<SheetSyncResult, { status: 'ok' }>

/** Opening the Accounts tab re-syncs if the last sync is older than this. */
const AUTO_SYNC_AFTER_MS = 60 * 60_000

/** Connection status, sync and row linking for the household's MonthReport sheet. */
export function SheetSyncCard() {
  const source = useSheetSource()
  const sync = useSyncSheet()
  const [connecting, setConnecting] = useState(false)
  const [linking, setLinking] = useState(false)
  const autoSynced = useRef(false)
  const s = source.data

  // The newest result, from a sync or from saving links (which re-syncs).
  const [last, setLast] = useState<SheetSyncResult | undefined>()
  useEffect(() => { if (sync.data) setLast(sync.data) }, [sync.data])
  const result = last?.status === 'ok' ? last : null
  const newRows = result?.rows.filter((r) => !r.accountId && !s?.skipped_row_keys.includes(r.key)) ?? []

  useEffect(() => {
    if (!s?.enabled || autoSynced.current) return
    autoSynced.current = true
    if (!s.last_synced_at || Date.now() - Date.parse(s.last_synced_at) > AUTO_SYNC_AFTER_MS) sync.mutate(undefined)
  }, [s, sync])

  const run = () =>
    sync.mutate(undefined, {
      onSuccess: (r) => (r.status === 'ok' ? toast.success(r.written || r.removed ? `Updated ${r.written + r.removed} balances from the sheet` : 'Already up to date') : toast.error(r.message)),
      onError: (e) => toast.error(getErrorMessage(e)),
    })

  if (source.isPending) return null
  if (!s) {
    return (
      <>
        <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
          <FileSpreadsheet className="size-5 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 basis-48 text-sm text-muted-foreground">Keep balances in a Google Sheet? Connect it and each new month's column comes in automatically.</p>
          <Button variant="outline" size="sm" onClick={() => setConnecting(true)}><Link2 /> Connect sheet</Button>
        </Card>
        <ConnectSheetDialog open={connecting} onOpenChange={setConnecting} />
      </>
    )
  }

  const error = last && last.status !== 'ok' ? last.message : s.last_sync_error
  return (
    <>
      <Card className="mb-4 grid gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <FileSpreadsheet className="size-5 shrink-0 text-success" />
          {/* The basis makes the buttons wrap below on phones rather than squeezing the text. */}
          <div className="min-w-0 flex-1 basis-48">
            <p className="truncate text-sm font-medium">{s.name} <span className="font-normal text-muted-foreground">· Google Sheet, tab “{s.sheet_name}”</span></p>
            <p className="text-xs text-muted-foreground">
              {sync.isPending
                ? 'Syncing…'
                : s.last_synced_at
                  ? `Synced ${formatDistanceToNow(new Date(s.last_synced_at), { addSuffix: true })}${result ? ` · ${result.dates.length} snapshots, latest ${formatDay(result.dates.at(-1)!)}` : ''}`
                  : 'Not synced yet'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant={newRows.length ? 'default' : 'ghost'}
              size="sm"
              disabled={sync.isPending}
              onClick={() => (result ? setLinking(true) : sync.mutate(undefined, { onSuccess: (r) => (r.status === 'ok' ? setLinking(true) : toast.error(r.message)) }))}
            >
              <Link2 /> {newRows.length ? `Link ${newRows.length} new row${newRows.length === 1 ? '' : 's'}` : 'Link rows'}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Sync now" onClick={run} disabled={sync.isPending}>
              <RefreshCw className={sync.isPending ? 'animate-spin' : undefined} />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Sheet settings" onClick={() => setConnecting(true)}><Settings2 /></Button>
          </div>
        </div>
        {error && !sync.isPending ? (
          <p className="flex items-start gap-2 text-xs text-destructive" role="alert"><CircleAlert className="mt-px size-3.5 shrink-0" />{error}</p>
        ) : null}
      </Card>
      <ConnectSheetDialog open={connecting} onOpenChange={setConnecting} source={s} />
      {result ? <LinkRowsDialog open={linking} onOpenChange={setLinking} source={s} result={result} onSaved={setLast} /> : null}
    </>
  )
}

function ConnectSheetDialog({ open, onOpenChange, source }: { open: boolean; onOpenChange: (o: boolean) => void; source?: SheetSource }) {
  const save = useSaveSheetSource()
  const remove = useDeleteSheetSource()
  const [link, setLink] = useState(source?.spreadsheet_id ?? '')
  const [tab, setTab] = useState(source?.sheet_name ?? 'Sheet1')
  const [confirm, setConfirm] = useState(false)
  const id = spreadsheetIdFrom(link)

  return (
    <Dialog open={open} onOpenChange={(o) => { setConfirm(false); onOpenChange(o) }}>
      <DialogContent title={source ? 'Google Sheet' : 'Connect a Google Sheet'} description="Read-only. The app reads balances from the sheet; it never changes it.">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!id) return
            save.mutate({ id: source?.id, spreadsheet_id: id, sheet_name: tab.trim() }, { onSuccess: () => { toast.success('Sheet saved'); onOpenChange(false) }, onError: (err) => toast.error(getErrorMessage(err)) })
          }}
        >
          <ol className="grid list-decimal gap-1 pl-5 text-sm text-muted-foreground">
            <li>In Google Sheets, click Share and add the service account email as a <strong>Viewer</strong> (the same one used for Google Calendar).</li>
            <li>Paste the sheet's link below.</li>
          </ol>
          <Field label="Sheet link" htmlFor="sheet-link" error={link && !id ? 'That doesn’t look like a Google Sheets link' : null}>
            <Input id="sheet-link" value={link} placeholder="https://docs.google.com/spreadsheets/d/…" onChange={(e) => setLink(e.target.value)} required />
          </Field>
          <Field label="Tab" htmlFor="sheet-tab" hint="The tab name at the bottom of the sheet.">
            <Input id="sheet-tab" value={tab} maxLength={100} onChange={(e) => setTab(e.target.value)} required />
          </Field>
          <DialogFooter className="sm:justify-between">
            {source ? (
              <Button
                type="button"
                variant={confirm ? 'destructive' : 'ghost'}
                onClick={() => (confirm ? remove.mutate(source.id, { onSuccess: () => onOpenChange(false) }) : setConfirm(true))}
              >
                <Trash2 /> {confirm ? 'Disconnect? Balances already imported stay' : 'Disconnect'}
              </Button>
            ) : <span />}
            <Button type="submit" disabled={!id || save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LinkRowsDialog({
  open,
  onOpenChange,
  source,
  result,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  source: SheetSource
  result: OkResult
  onSaved: (r: SheetSyncResult) => void
}) {
  const { members } = useHousehold()
  const accounts = useAccounts()
  const apply = useApplySheetLinks()
  const suggestions = useMemo(() => new Map(result.rows.map((r) => [r.key, suggestAccount(r, members)])), [result, members])
  const initial = useMemo(() => {
    const out: Record<string, RowChoiceValue> = {}
    for (const r of result.rows) {
      const decidedSkip = source.skipped_row_keys.includes(r.key)
      out[r.key] = r.accountId ?? (decidedSkip || skipByDefault(r, result.suggestedSkip) ? 'skip' : 'create')
    }
    return out
  }, [result, source.skipped_row_keys])
  const [choices, setChoices] = useState(initial)
  const [names, setNames] = useState<Record<string, string>>({})
  /** Accounts losing all their rows that should stay active (e.g. a house valued by hand from now on). */
  const [keep, setKeep] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!open) return
    setChoices(initial)
    setNames({})
    setKeep(new Set())
  }, [open, initial])

  const ownerName = (id: string | null) => members.find((m) => m.id === id)?.display_name ?? 'Joint'
  const nameOf = (key: string) => names[key] ?? suggestions.get(key)!.name
  const plan = planLinks(result.rows, choices)
  const sections = [
    { label: 'Summary', matches: null as boolean | null },
    ...result.sections.map((s) => ({ label: s.label, matches: s.matchesSheetTotal })),
  ]
  const liveAccounts = (accounts.data ?? []).filter((a) => !a.archived_at)
  const newAccounts = plan.creates.map((key) => ({ key, name: nameOf(key), owner_id: suggestions.get(key)!.owner_id }))
  const orphans = plan.orphaned.flatMap((id) => accounts.data?.find((a) => a.id === id) ?? [])

  const change = (key: string, value: RowChoiceValue) =>
    setChoices((c) => {
      const next = { ...c, [key]: value }
      // Rows that were joining this row's new account now make their own.
      if (c[key] === 'create' && value !== 'create') for (const k in next) if (next[k] === `new:${key}`) next[k] = 'create'
      return next
    })

  const save = () => {
    const accountsToCreate = Object.fromEntries(
      plan.creates.map((key) => {
        const s = suggestions.get(key)!
        const fed = [...plan.targets].flatMap(([rowKey, t]) => (t && 'newFrom' in t && t.newFrom === key ? [suggestions.get(rowKey)!.institution] : []))
        // A combined account spanning banks has no single institution.
        return [key, { ...s, name: nameOf(key).trim() || s.name, institution: new Set(fed).size > 1 ? null : s.institution }]
      }),
    )
    apply.mutate(
      {
        sourceId: source.id,
        rowKeys: result.rows.map((r) => r.key),
        plan: { ...plan, orphaned: plan.orphaned.filter((id) => !keep.has(id)) },
        newAccounts: accountsToCreate,
        openingDate: result.dates[0],
      },
      {
        onSuccess: ({ archived, result: r }) => {
          toast.success(archived ? `Saved. Archived ${archived} account${archived === 1 ? '' : 's'} no longer fed by the sheet.` : 'Saved. Balances imported from the sheet.')
          onSaved(r)
          onOpenChange(false)
        },
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Link sheet rows to accounts"
        description="Link several rows to one account to combine them: its balance is their total on each date, with the breakdown kept."
        className="sm:max-w-2xl"
      >
        <div className="grid gap-5">
          {sections.map((section) => {
            const rows = result.rows.filter((r) => r.section === section.label)
            if (!rows.length) return null
            return (
              <section key={section.label}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{section.label === 'Summary' ? 'Summary rows' : section.label}</h3>
                  {section.matches === true ? (
                    <Badge tone="success"><CircleCheck className="size-3" /> Adds up to the sheet’s subtotal</Badge>
                  ) : section.matches === false ? (
                    <Badge tone="warning"><CircleAlert className="size-3" /> Doesn’t match the sheet’s subtotal</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Totals the app works out itself</span>
                  )}
                </div>
                <ul className="divide-y rounded-xl border">
                  {rows.map((r) => (
                    <RowChoice
                      key={r.key}
                      row={r}
                      value={choices[r.key]}
                      onChange={(v) => change(r.key, v)}
                      accounts={liveAccounts}
                      newAccounts={newAccounts.filter((n) => n.key !== r.key)}
                      ownName={nameOf(r.key)}
                      onRename={(name) => setNames((n) => ({ ...n, [r.key]: name }))}
                      joiners={result.rows.filter((x) => choices[x.key] === `new:${r.key}`).length}
                      hint={suggestions.get(r.key)!}
                      ownerName={ownerName}
                      rowsFeeding={(accountId) => result.rows.filter((x) => choices[x.key] === accountId).length}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
        {orphans.length ? (
          <div className="mt-4 grid gap-2 rounded-lg bg-warning/10 p-3 text-xs">
            <p className="text-warning">
              No longer fed by the sheet. Archive, so the last balance doesn’t count twice, unless you’ll keep the account up to date by hand (e.g. a house you value yourself):
            </p>
            {orphans.map((a) => (
              <label key={a.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!keep.has(a.id)}
                  onChange={(e) => setKeep((k) => { const n = new Set(k); if (e.target.checked) n.delete(a.id); else n.add(a.id); return n })}
                  className="accent-[var(--primary)]"
                />
                Archive {a.name}
              </label>
            ))}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={apply.isPending}>
            {apply.isPending ? 'Saving…' : plan.creates.length ? `Create ${plan.creates.length} account${plan.creates.length === 1 ? '' : 's'} and sync` : 'Save and sync'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type AccountOption = { id: string; name: string; owner_id: string | null }

function RowChoice({
  row,
  value,
  onChange,
  accounts,
  newAccounts,
  ownName,
  onRename,
  joiners,
  hint,
  ownerName,
  rowsFeeding,
}: {
  row: SyncRow
  value: RowChoiceValue
  onChange: (v: RowChoiceValue) => void
  accounts: AccountOption[]
  /** New accounts other rows in the dialog are making, which this row can join. */
  newAccounts: { key: string; name: string; owner_id: string | null }[]
  ownName: string
  onRename: (name: string) => void
  joiners: number
  hint: ReturnType<typeof suggestAccount>
  ownerName: (id: string | null) => string
  rowsFeeding: (accountId: string) => number
}) {
  const label = rowLabel(row)
  const whose = (owner: string | null) => (ownerName(owner) === 'Joint' ? 'joint' : `${ownerName(owner)}’s`)
  const linked = accounts.find((a) => a.id === value)
  const joining = value.startsWith('new:') ? newAccounts.find((n) => `new:${n.key}` === value) : undefined
  // Same-named accounts (e.g. "Santander Current Account") differ only by owner:
  // group by owner, the row's own person (or joint) first.
  const owners = [...new Set([hint.owner_id, ...newAccounts.map((n) => n.owner_id), ...accounts.map((a) => a.owner_id)])]
  const byOwner = <T extends { owner_id: string | null }>(items: T[]) =>
    owners.map((owner) => ({ label: ownerName(owner), items: items.filter((a) => a.owner_id === owner) })).filter((g) => g.items.length)
  const [renaming, setRenaming] = useState(false)
  const combined = (n: number) => (n > 1 ? `, combined with ${n - 1} other row${n === 2 ? '' : 's'}` : '')

  return (
    <li className="grid gap-2 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{label}</p>
          <p className="text-xs text-muted-foreground tabular">
            {row.latest ? `${formatMoney(row.latest.balanceMinor)} on ${formatDay(row.latest.date)}` : 'No figures'}
            {value === 'create' ? ` · new ${hint.account_type.replace('_', ' ')}, ${ownerName(hint.owner_id)}${combined(joiners + 1)}` : ''}
            {value === 'create' && !joiners && !renaming ? (
              <> · <button type="button" className="text-primary hover:underline" onClick={() => setRenaming(true)}>Rename</button></>
            ) : null}
            {linked ? ` · into ${whose(linked.owner_id)} ${linked.name}${combined(rowsFeeding(linked.id))}` : ''}
            {joining ? ` · into new ${whose(joining.owner_id)} ${joining.name}` : ''}
          </p>
        </div>
        <NativeSelect aria-label={`What to do with ${label}`} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full text-[13px] sm:w-60">
          <option value="skip">Don’t import</option>
          <option value="create">New account</option>
          {byOwner(accounts).map((g) => (
            <optgroup key={g.label} label={`Add to ${g.label === 'Joint' ? 'a joint' : `${g.label}’s`} account`}>
              {g.items.map((a) => <option key={a.id} value={a.id}>{g.label} · {a.name}</option>)}
            </optgroup>
          ))}
          {byOwner(newAccounts).map((g) => (
            <optgroup key={`new-${g.label}`} label={`Add to a new ${g.label === 'Joint' ? 'joint' : `${g.label}’s`} account (made in this list)`}>
              {g.items.map((n) => <option key={n.key} value={`new:${n.key}`}>{g.label} · {n.name} (new)</option>)}
            </optgroup>
          ))}
        </NativeSelect>
      </div>
      {value === 'create' && (joiners || renaming) ? (
        <Input aria-label={`Name for the new account from ${label}`} value={ownName} maxLength={80} onChange={(e) => onRename(e.target.value)} className="h-8 text-[13px]" />
      ) : null}
    </li>
  )
}
