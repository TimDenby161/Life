// Static guards over the agents Edge Function. It runs with the service role,
// which bypasses RLS, so household scoping and the data it may touch are
// checked here rather than trusted.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const fnDir = join(__dirname, '../../supabase/functions/agents')
const sharedDir = join(__dirname, '../../supabase/functions/_shared/agents')
const read = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => ({ f, text: readFileSync(join(dir, f), 'utf8') }))
const fn = read(fnDir)
const shared = read(sharedDir)

describe('agents Edge Function', () => {
  it('scopes every table read to one household', () => {
    for (const { f, text } of fn) {
      // Each .from(...) chain up to the next .from( or end of statement.
      for (const [, chain] of text.matchAll(/\.from\('[a-z_]+'\)([\s\S]*?)(?=\.from\(|\n\s*\]\)|\n\n)/g)) {
        const table = /\.from\('([a-z_]+)'\)/.exec(text.slice(text.indexOf(chain) - 40))?.[1]
        if (table === 'households') continue // the dispatcher's list of households
        expect(chain, `${f}: ${table}`).toMatch(/\.eq\('household_id'|\.in\('user_id', ids\)|\.eq\('user_id', user\.user!\.id\)/)
      }
    }
  })

  it('reads only the tables the agents need, never weight, periods, money accounts, investments or the feed', () => {
    const allowed = new Set([
      'households', 'household_members', 'user_preferences', 'agent_settings', 'agent_runs', 'agent_suggestions',
      'task_lists', 'task_categories', 'task_rooms', 'tasks', 'task_occurrences', 'task_completion_events',
      'wedding_settings', 'wedding_budget_items', 'wedding_suppliers', 'wedding_guests',
      'language_study', 'language_progress', 'health_exercise_sessions', 'push_subscriptions',
      'financial_accounts', 'account_balance_history', 'financial_transactions', 'renewals', 'trips', 'career_goals',
    ])
    for (const { f, text } of [...fn, ...shared]) {
      for (const [, table] of text.matchAll(/\.from\('([a-z_]+)'\)/g)) expect(allowed, `${f}: ${table}`).toContain(table)
    }
  })

  it('reads finances only for net worth: no budgets, goals, categories, or transaction details', () => {
    for (const { f, text } of [...fn, ...shared]) expect(text, f).not.toMatch(/budgets|finance_categories|savings_goals/)
    const ctx = fn.find((x) => x.f === 'context.ts')!.text
    expect(ctx).toContain(".from('financial_transactions').select('account_id, occurred_on, amount_minor, created_at')")
    expect(ctx).toContain(".select('id, account_type, ownership, owner_id, opening_balance_minor, opening_date')")
    expect(ctx).toContain(".select('account_id, as_of, balance_minor, source, created_at')")
  })

  it('selects no contact details, free-text notes, task descriptions or comments', () => {
    for (const { f, text } of fn) {
      for (const [, cols] of text.matchAll(/\.select\('([^']*)'/g)) {
        expect(cols, f).not.toMatch(/\b(phone|email|contact_name|website|notes|comments?)\b/)
        if (/task:tasks/.test(cols)) expect(cols, f).not.toMatch(/\bdescription\b/)
      }
    }
  })

  it('never gives the LLM anything but the task briefing', () => {
    const llm = shared.find((x) => x.f === 'llm.ts')!.text
    expect(llm).not.toMatch(/fitness|wedding|languages|Session|BudgetItem|finance|netWorth/i)
  })

  it('writes only through agent_claim_run, agent_finish_run and push_subscriptions_gone', () => {
    for (const { f, text } of fn) {
      expect(text, f).not.toMatch(/\.(insert|update|upsert|delete)\(/)
      for (const [, rpc] of text.matchAll(/\.rpc\('([a-z_]+)'/g)) expect(['agent_claim_run', 'agent_finish_run', 'push_subscriptions_gone'], f).toContain(rpc)
    }
  })

  it('puts nothing but the briefing headline in a notification', () => {
    const notify = fn.find((x) => x.f === 'notify.ts')!.text
    const calls = [...notify.matchAll(/briefingMessage\(.*/g)].map((m) => m[0])
    expect(calls).toEqual(['briefingMessage(b.kind, (b.content as { headline: string }).headline)]),'])
    expect(notify).not.toMatch(/suggestions|ai_summary|reason/)
  })

  it('keeps the shared agent logic pure, so the app and Deno can both import it', () => {
    for (const { f, text } of shared) {
      for (const [, spec] of text.matchAll(/from '([^']+)'/g)) expect(spec, f).toMatch(/^\.\/[a-zA-Z]+\.ts$/)
      expect(text, f).not.toMatch(/\bDeno\./)
    }
  })
})
