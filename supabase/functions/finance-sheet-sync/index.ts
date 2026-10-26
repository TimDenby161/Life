// Syncs recorded balances from the household's Google Sheet (MonthReport).
//
// POST {}  (Authorization: Bearer <user JWT>)
// -> { status: 'ok', syncedAt, dates, rows: SyncRow[], sections, suggestedSkip, written, removed }
//  | { status: 'not_configured', message }
//  | { status: 'error', message }
//
// Every call reads the whole sheet, so it is idempotent: new date columns are
// added, edited cells update, deleted columns are removed. Only rows linked to
// an account (finance_sheet_links) are written, an account's rows summed per
// date; the rest come back so the app can offer to link them.
//
// Secrets (set with `supabase secrets set`, never committed):
//   GOOGLE_SERVICE_ACCOUNT_JSON  the same read-only service account as calendar-events
//   GOOGLE_SHEETS_API_URL        optional, local testing only (defaults to Google)
//   ALLOWED_ORIGINS              optional
import { googleAccessToken } from '../_shared/google-auth.ts'
import { corsHeaders, json, userClient } from '../_shared/http.ts'
import { accountBalances, parseMonthReport, reconcile } from '../_shared/month-report.ts'
import type { SyncRow } from './types.ts'

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const SHEETS_API = Deno.env.get('GOOGLE_SHEETS_API_URL') ?? 'https://sheets.googleapis.com/v4'

async function readSheet(token: string, spreadsheetId: string, sheetName: string): Promise<unknown[][]> {
  const range = `'${sheetName.replace(/'/g, "''")}'!A1:ZZ1000`
  const url = new URL(`${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`)
  url.search = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }).toString()
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 403) {
    // Google uses 403 both for "API not enabled in the project" and "not shared".
    const body = (await res.json().catch(() => null)) as { error?: { details?: { reason?: string }[] } } | null
    const reasons = (body?.error?.details ?? []).map((d) => d.reason)
    throw new Error(reasons.includes('SERVICE_DISABLED') || reasons.includes('ACCESS_NOT_CONFIGURED') ? 'sheets_api_disabled' : 'sheet_not_shared')
  }
  if (res.status === 404) throw new Error('sheet_not_shared')
  if (res.status === 400) throw new Error('sheet_tab_missing')
  if (!res.ok) throw new Error(`Google Sheets error (${res.status})`)
  return ((await res.json()) as { values?: unknown[][] }).values ?? []
}

const serviceAccountEmail = () => {
  try {
    return (JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') ?? '{}') as { client_email?: string }).client_email ?? 'the service account'
  } catch {
    return 'the service account'
  }
}

const MESSAGES: Record<string, () => string> = {
  sheet_not_shared: () => `The sheet is not shared with ${serviceAccountEmail()} (or the spreadsheet link is wrong).`,
  sheets_api_disabled: () => {
    const project = /@([^.]+)\.iam\.gserviceaccount\.com$/.exec(serviceAccountEmail())?.[1]
    return `The Google Sheets API is not enabled in the Google Cloud project${project ? ` "${project}"` : ''}. Enable it, wait a few minutes, then sync again.`
  },
  sheet_tab_missing: () => 'That tab was not found in the spreadsheet. Check the tab name in the sheet settings.',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { status: 'error', message: 'Method not allowed' }, 405)

  const supabase = await userClient(req)
  if (!supabase) return json(req, { status: 'error', message: 'Not signed in' }, 401)

  // RLS: only the caller's household's source.
  const { data: source, error } = await supabase.from('finance_sheet_sources').select('*').eq('enabled', true).maybeSingle()
  if (error) return json(req, { status: 'error', message: 'Could not load sheet settings' }, 500)
  if (!source) return json(req, { status: 'not_configured', message: 'No Google Sheet has been connected yet.' })

  const serviceAccount = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!serviceAccount) {
    return json(req, { status: 'not_configured', message: 'The Google service account secret is not set on the server.' })
  }

  const fail = async (message: string, status: number) => {
    await supabase.rpc('apply_sheet_balances', { p_source_id: source.id, p_balances: [], p_error: message })
    return json(req, { status: 'error', message }, status)
  }

  let report
  try {
    const token = await googleAccessToken(serviceAccount, SHEETS_SCOPE)
    report = parseMonthReport(await readSheet(token, source.spreadsheet_id, source.sheet_name))
  } catch (e) {
    const code = (e as Error).message
    // Never log sheet contents; the error codes and parser messages contain none.
    console.error('finance-sheet-sync failed:', code)
    if (MESSAGES[code]) return fail(MESSAGES[code](), 502)
    if (/^No (dates|"Date" row)/.test(code)) return fail(`The sheet layout wasn't recognised: ${code}.`, 422)
    return fail('Google Sheets is unavailable right now.', 502)
  }

  const { data: links, error: linksError } = await supabase.from('finance_sheet_links').select('row_key, account_id')
  if (linksError) return json(req, { status: 'error', message: 'Could not load linked accounts' }, 500)
  const linked = new Map(links.map((l) => [l.row_key as string, l.account_id as string]))

  const balances = accountBalances(report, linked)
  const { data: applied, error: applyError } = await supabase.rpc('apply_sheet_balances', { p_source_id: source.id, p_balances: balances })
  if (applyError) {
    console.error('finance-sheet-sync apply failed:', applyError.code)
    return json(req, { status: 'error', message: 'Could not save the balances' }, 500)
  }

  const { skip, matches } = reconcile(report)
  const rows: SyncRow[] = report.rows.map(({ values, ...r }) => {
    const i = values.findLastIndex((v) => v !== null)
    return { ...r, accountId: linked.get(r.key) ?? null, latest: i < 0 ? null : { date: report.dates[i], balanceMinor: values[i]! } }
  })
  return json(req, {
    status: 'ok',
    syncedAt: new Date().toISOString(),
    dates: report.dates,
    rows,
    sections: report.sections.map((s) => ({ label: s.label, matchesSheetTotal: matches.get(s.label) ?? false })),
    suggestedSkip: [...skip],
    ...(applied as { written: number; removed: number }),
  })
})
