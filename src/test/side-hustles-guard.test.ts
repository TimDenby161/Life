// Static guards over the side-hustles Edge Function: it works as the caller
// (no service role), writes to the database only by completing a task, and
// only the sheet's owner can add rows.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const fn = readFileSync(join(__dirname, '../../supabase/functions/side-hustles/index.ts'), 'utf8')

describe('side-hustles Edge Function', () => {
  it('never uses the service role', () => {
    expect(fn).not.toMatch(/SERVICE_ROLE|createClient/)
  })
  it('only changes data by completing a regular charge’s task', () => {
    expect(fn).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    expect([...fn.matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1])).toEqual(['complete_task_occurrence'])
  })
  it('lets only the sheet’s owner add rows, and never a formula', () => {
    expect(fn).toContain("if (settings.user_id !== me)")
    expect(fn).toContain('/^[=+\\-@]/.test(project)')
  })
})
