// Static guards over the table-tennis Edge Function: it reads public league data,
// follows ids read as the caller, and writes only league snapshots.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('table-tennis Edge Function', () => {
  const fn = readFileSync(join(__dirname, '../../supabase/functions/table-tennis/index.ts'), 'utf8')
  it('reads as the caller and writes only league snapshots, through tt_save_snapshots', () => {
    expect(fn).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    expect([...fn.matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1])).toEqual(['tt_save_snapshots'])
    expect([...fn.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]).sort()).toEqual(['household_members', 'tt_players', 'tt_profile'])
  })
  it('keeps the shared logic pure', () => {
    expect(readFileSync(join(__dirname, '../../supabase/functions/_shared/tableTennis.ts'), 'utf8')).not.toMatch(/\bDeno\.|^import /m)
  })
})
