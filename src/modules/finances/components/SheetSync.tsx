import { formatDistanceToNow } from 'date-fns'
import { CircleAlert, CircleCheck, FileSpreadsheet, Link2, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { type SheetRowChoice, type SheetSource, type SheetSyncResult, spreadsheetIdFrom, type SyncRow } from '../api'
import { useAccounts, useApplySheetLinks, useDeleteSheetSource, useSaveSheetSource, useSheetSource, useSyncSheet } from '../hooks'
import { skipByDefault, suggestAccount } from '../lib/sheetLink'

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

  const result = sync.data?.status === 'ok' ? sync.data : null
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
          <FileSpreadsheet className="size-5 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">Keep balances in a Google Sheet? Connect it and each new month's column comes in automatically.</p>
          <Button variant="outline" size="sm" onClick={() => setConnecting(true)}><Link2 /> Connect sheet</Button>
        </Card>
        <ConnectSheetDialog open={connecting} onOpenChange={setConnecting} />
      </>
    )
  }

  const error = sync.data && sync.data.status !== 'ok' ? sync.data.message : s.last_sync_error
  return (
    <>
      <Card className="mb-4 grid gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <FileSpreadsheet className="size-5 text-success" />
          <div className="min-w-0 flex-1">
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
      {result ? <LinkRowsDialog open={linking} onOpenChange={setLinking} source={s} result={result} /> : null}
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
            save.mutate({ spreadsheet_id: id, sheet_name: tab.trim() }, { onSuccess: () => { toast.success('Sheet saved'); onOpenChange(false) }, onError: (err) => toast.error(getErrorMessage(err)) })
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

type Choice = 'skip' | 'create' | string // otherwise an account id

function LinkRowsDialog({ open, onOpenChange, source, result }: { open: boolean; onOpenChange: (o: boolean) => void; source: SheetSource; result: OkResult }) {
  const { members } = useHousehold()
  const accounts = useAccounts()
  const apply = useApplySheetLinks()
  const initial = useMemo(() => {
    const out: Record<string, Choice> = {}
    for (const r of result.rows) {
      const decidedSkip = source.skipped_row_keys.includes(r.key)
      out[r.key] = r.accountId ?? (decidedSkip || skipByDefault(r, result.suggestedSkip) ? 'skip' : 'create')
    }
    return out
  }, [result, source.skipped_row_keys])
  const [choices, setChoices] = useState(initial)
  useEffect(() => { if (open) setChoices(initial) }, [open, initial])

  const sections = [
    { label: 'Summary', matches: null as boolean | null },
    ...result.sections.map((s) => ({ label: s.label, matches: s.matchesSheetTotal })),
  ]
  const taken = new Set(Object.values(choices))
  const unlinkedAccounts = (accounts.data ?? []).filter((a) => !a.archived_at)
  const creating = Object.values(choices).filter((c) => c === 'create').length

  const save = () => {
    const list: SheetRowChoice[] = result.rows.map((row) => {
      const c = choices[row.key]
      if (c === 'skip') return { row, kind: 'skip' }
      if (c === 'create') return { row, kind: 'create', account: suggestAccount(row, members) }
      return { row, kind: 'link', accountId: c }
    })
    apply.mutate(
      { sourceId: source.id, choices: list, openingDate: result.dates[0] },
      { onSuccess: () => { toast.success('Linked. Balances imported from the sheet.'); onOpenChange(false) }, onError: (e) => toast.error(getErrorMessage(e)) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Link sheet rows to accounts" description="Each linked row's balances are recorded on that account for every date column." className="sm:max-w-2xl">
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
                      onChange={(v) => setChoices((c) => ({ ...c, [r.key]: v }))}
                      accounts={unlinkedAccounts.filter((a) => a.id === choices[r.key] || !taken.has(a.id))}
                      hint={suggestAccount(r, members)}
                      ownerName={(id) => members.find((m) => m.id === id)?.display_name ?? 'Joint'}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={apply.isPending}>
            {apply.isPending ? 'Saving…' : creating ? `Create ${creating} account${creating === 1 ? '' : 's'} and sync` : 'Save and sync'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RowChoice({
  row,
  value,
  onChange,
  accounts,
  hint,
  ownerName,
}: {
  row: SyncRow
  value: Choice
  onChange: (v: Choice) => void
  accounts: { id: string; name: string }[]
  hint: ReturnType<typeof suggestAccount>
  ownerName: (id: string | null) => string
}) {
  const label = [row.institution, row.name].filter(Boolean).join(' · ')
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{label}</p>
        <p className="text-xs text-muted-foreground tabular">
          {row.latest ? `${formatMoney(row.latest.balanceMinor)} on ${formatDay(row.latest.date)}` : 'No figures'}
          {value === 'create' ? ` · new ${hint.account_type.replace('_', ' ')}, ${ownerName(hint.owner_id)}` : ''}
        </p>
      </div>
      <NativeSelect aria-label={`What to do with ${label}`} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full text-[13px] sm:w-56">
        <option value="skip">Don’t import</option>
        <option value="create">New account</option>
        {accounts.length ? (
          <optgroup label="Link to existing account">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </optgroup>
        ) : null}
      </NativeSelect>
    </li>
  )
}
