// The side hustles' money, kept in the owner's Google Sheet ("The Corner").
//
// POST { mode: 'read' }   (Authorization: Bearer <user JWT>)
//   -> { status: 'ok', owner, spreadsheetId, entries, problems }
//      The caller's sheet, or their partner's if they have none (both can see it).
// POST { mode: 'add', side: 'out' | 'in', date, project, description, amountMinor, chargeId? }
//   -> { status: 'ok', row }
//      Writes the row under the last one in that block (only the sheet's owner
//      can). With chargeId, that regular charge's task is ticked off too.
// either -> { status: 'not_configured' | 'error', message }
//
// Secrets: GOOGLE_SERVICE_ACCOUNT_JSON (the same service account as the
// calendar and MonthReport). The sheet must be shared with it as an Editor.
// Settings and charges are read as the caller, under RLS; completing a task
// goes through complete_task_occurrence as the caller. No service role here.
import { googleAccessToken } from '../_shared/google-auth.ts'
import { corsHeaders, json, userClient } from '../_shared/http.ts'
import { parseCashFlow, rowCells, rowRange, type Side } from '../_shared/hustles.ts'

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const SHEETS_API = Deno.env.get('GOOGLE_SHEETS_API_URL') ?? 'https://sheets.googleapis.com/v4'

const serviceAccountEmail = () => {
  try {
    return (JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') ?? '{}') as { client_email?: string }).client_email ?? 'the service account'
  } catch {
    return 'the service account'
  }
}

class SheetError extends Error {}

async function sheetsFetch(token: string, url: URL, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
  if (res.status === 403 || res.status === 404) throw new SheetError(`Share the sheet with ${serviceAccountEmail()} as an Editor (or check the link).`)
  if (res.status === 400) throw new SheetError('That tab wasn’t found in the sheet. Check the tab name.')
  if (!res.ok) throw new SheetError(`Google Sheets error (${res.status}).`)
  return res.json()
}

async function readValues(token: string, spreadsheetId: string, sheetName: string): Promise<unknown[][]> {
  const range = `'${sheetName.replace(/'/g, "''")}'!A1:I2000`
  const url = new URL(`${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`)
  url.search = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }).toString()
  return ((await sheetsFetch(token, url)) as { values?: unknown[][] }).values ?? []
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { status: 'error', message: 'Method not allowed' }, 405)

  const supabase = await userClient(req)
  if (!supabase) return json(req, { status: 'error', message: 'Sign in again.' }, 401)

  let body: { mode?: string; side?: string; date?: string; project?: string; description?: string; amountMinor?: number; chargeId?: string }
  try {
    body = await req.json()
  } catch {
    return json(req, { status: 'error', message: 'Invalid request' }, 400)
  }

  const { data: user } = await supabase.auth.getUser()
  const me = user.user!.id
  // RLS: only this household's settings.
  const { data: all, error } = await supabase.from('hustle_settings').select('user_id, spreadsheet_id, sheet_name')
  if (error) return json(req, { status: 'error', message: 'Could not load the sheet settings.' }, 500)
  const settings = all.find((s) => s.user_id === me) ?? all[0]
  if (!settings) return json(req, { status: 'not_configured', message: 'Add the link to your sheet first.' })

  const serviceAccount = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!serviceAccount) return json(req, { status: 'not_configured', message: 'The Google service account isn’t set up.' })

  try {
    const token = await googleAccessToken(serviceAccount, SHEETS_SCOPE)
    const sheet = parseCashFlow(await readValues(token, settings.spreadsheet_id, settings.sheet_name))

    if (body.mode === 'read') {
      return json(req, { status: 'ok', owner: settings.user_id, spreadsheetId: settings.spreadsheet_id, entries: sheet.entries, problems: sheet.problems })
    }
    if (body.mode !== 'add') return json(req, { status: 'error', message: 'Invalid request' }, 400)
    if (settings.user_id !== me) return json(req, { status: 'error', message: 'Only the sheet’s owner can add to it.' }, 403)

    const side = body.side as Side
    const project = (body.project ?? '').replace(/\s+/g, ' ').trim()
    const description = (body.description ?? '').replace(/\s+/g, ' ').trim()
    const amountMinor = body.amountMinor
    if (
      (side !== 'out' && side !== 'in') ||
      !ISO.test(body.date ?? '') ||
      !project || project.length > 60 ||
      description.length > 120 ||
      typeof amountMinor !== 'number' || !Number.isInteger(amountMinor) || amountMinor < 0 || amountMinor > 100000000 ||
      // Never let a cell start a formula.
      /^[=+\-@]/.test(project) || /^[=+\-@]/.test(description)
    ) {
      return json(req, { status: 'error', message: 'Check the entry and try again.' }, 400)
    }

    const row = sheet.nextRow[side]
    const range = rowRange(settings.sheet_name, side, row)
    const url = new URL(`${SHEETS_API}/spreadsheets/${encodeURIComponent(settings.spreadsheet_id)}/values/${encodeURIComponent(range)}`)
    url.search = new URLSearchParams({ valueInputOption: 'USER_ENTERED' }).toString()
    await sheetsFetch(token, url, { method: 'PUT', body: JSON.stringify({ range, values: [rowCells({ date: body.date!, project, description, amountMinor })] }) })

    // A regular charge: tick off its task, as the caller.
    if (body.chargeId) {
      const { data: charge } = await supabase.from('hustle_charges').select('task_id').eq('id', body.chargeId).maybeSingle()
      if (charge?.task_id) {
        const { data: open } = await supabase.from('task_occurrences').select('id').eq('task_id', charge.task_id).eq('status', 'open').maybeSingle()
        if (open) await supabase.rpc('complete_task_occurrence', { p_occurrence_id: open.id })
      }
    }
    return json(req, { status: 'ok', row })
  } catch (e) {
    if (e instanceof SheetError) return json(req, { status: 'error', message: e.message }, 502)
    console.warn('side-hustles: request failed')
    return json(req, { status: 'error', message: 'The sheet could not be reached. Try again in a minute.' }, 502)
  }
})
