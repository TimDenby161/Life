// Static guards over the SQL migrations and frontend source. They catch
// regressions such as a new table without RLS before it reaches a database.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REALTIME_TABLES } from '@/lib/realtime'

const migrationsDir = join(__dirname, '../../supabase/migrations')
const sql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(migrationsDir, f), 'utf8'))
  .join('\n')

const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1])

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.test.ts') ? [join(dir, e.name)] : [],
  )
}

describe('database migrations', () => {
  it('defines the expected tables', () => {
    expect(tables.length).toBeGreaterThan(20)
  })

  it.each(tables)('enables row level security on %s', (table) => {
    expect(sql).toContain(`alter table public.${table} enable row level security`)
  })

  it('never grants table access to anon', () => {
    expect(sql).not.toMatch(/grant [^;]* to [^;]*\banon\b/i)
  })

  it('keeps every SECURITY DEFINER function on an empty search_path', () => {
    const fns = sql.split(/create or replace function /).slice(1)
    for (const fn of fns.filter((f) => /security definer/.test(f.split('$$')[0]))) {
      expect(fn.split('$$')[0], fn.slice(0, 60)).toMatch(/set search_path = ''/)
    }
  })

  it('keeps the realtime publication and the client refresh map in sync', () => {
    const block = /foreach v_table in array array\[([\s\S]*?)\]/.exec(sql)![1]
    const published = [...block.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()
    expect(Object.keys(REALTIME_TABLES).sort()).toEqual(published)
  })
})

describe('frontend source', () => {
  const files = walk(join(__dirname, '..'))

  it('never references a service-role key or private secrets', () => {
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      expect(text, f).not.toMatch(/service_role|SERVICE_ROLE|GOOGLE_SERVICE_ACCOUNT|API_FOOTBALL_KEY/)
    }
  })

  it('does not log data with console.log', () => {
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/console\.log\(/)
  })
})
