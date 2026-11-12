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

  it('reads only the tables the agents need, never periods, investments, budgets or the feed', () => {
    const allowed = new Set([
      'households', 'household_members', 'user_preferences', 'agent_settings', 'agent_runs', 'agent_suggestions',
      'task_lists', 'task_categories', 'task_rooms', 'tasks', 'task_occurrences', 'task_completion_events',
      'wedding_settings', 'wedding_budget_items', 'wedding_suppliers', 'wedding_guests',
      'language_study', 'language_progress', 'health_exercise_sessions', 'push_subscriptions',
      'financial_accounts', 'account_balance_history', 'financial_transactions', 'renewals', 'trips', 'career_goals', 'calendar_integrations', 'feed_sources',
      'savings_goals', 'savings_pots', 'health_measurements', 'takeaways', 'people', 'wedding_venues',
    ])
    for (const { f, text } of [...fn, ...shared]) {
      for (const [, table] of text.matchAll(/\.from\('([a-z_]+)'\)/g)) expect(allowed, `${f}: ${table}`).toContain(table)
    }
  })

  it('reads finances only for net worth and savings goals: no budgets, categories, or transaction details', () => {
    for (const { f, text } of [...fn, ...shared]) expect(text, f).not.toMatch(/budgets|finance_categories/)
    const ctx = fn.find((x) => x.f === 'context.ts')!.text
    expect(ctx).toContain(".from('financial_transactions').select('account_id, occurred_on, amount_minor, created_at')")
    expect(ctx).toContain(".select('id, account_type, ownership, owner_id, opening_balance_minor, opening_date')")
    expect(ctx).toContain(".select('account_id, as_of, balance_minor, source, created_at')")
  })

  it('reads health readings only as values and dates, only in loadReadings, and only weight and sleep', () => {
    const ctx = fn.find((x) => x.f === 'context.ts')!.text
    const chains = [...ctx.matchAll(/\.from\('health_measurements'\)[\s\S]*?\.limit\(\d+\)/g)].map((m) => m[0])
    expect(chains).toHaveLength(1)
    expect(chains[0]).toContain(".select('user_id, measured_at, value, metric:health_metric_definitions!inner(key)')")
    expect(chains[0]).toContain(".in('metric.key', ['weight', 'sleep_duration', 'sleep_score'])")
    for (const { f, text } of fn) if (f !== 'context.ts') expect(text, f).not.toMatch(/health_measurements|health_periods/)
  })

  it('keeps weight out of everything but its owner’s own suggestions and briefing lines', () => {
    const food = shared.find((x) => x.f === 'nutrition.ts')!.text
    for (const [, recipients] of food.matchAll(/recipients: ([^,\n}]+)/g)) {
      expect(['[m.id]', 'sharedLimit.map((p) => p.m.id)', 'planners']).toContain(recipients.trim())
    }
    const index = fn.find((x) => x.f === 'index.ts')!.text
    expect(index).toContain('weights: weights.filter((w) => w.user_id === userId)')
  })

  it('selects no contact details, free-text notes, task descriptions or comments', () => {
    for (const { f, text } of fn) {
      for (const [, cols] of text.matchAll(/\.select\('([^']*)'/g)) {
        expect(cols, f).not.toMatch(/\b(phone|email|contact_name|website|notes|comments?)\b/)
        if (/task:tasks/.test(cols)) expect(cols, f).not.toMatch(/\bdescription\b/)
      }
    }
  })

  it('keeps calendar descriptions and locations out of the agents', () => {
    const ctx = fn.find((x) => x.f === 'context.ts')!.text
    expect(ctx).not.toMatch(/e\.description|e\.location/)
    const llm = shared.find((x) => x.f === 'llm.ts')!.text
    expect(llm).not.toMatch(/c\.calendar|c\.packed/)
  })

  it('gives the AI priorities only jobs and busy times, never event titles, health or money', () => {
    const pr = shared.find((x) => x.f === 'priorities.ts')!.text
    expect(pr).not.toMatch(/dayLoad|\.title\b.*calendar|fitness|wedding|finance|Session|BudgetItem/i)
    expect(shared.find((x) => x.f === 'calendar.ts')!.text).toMatch(/export function busyBlocks[\s\S]*?out\.push\(\{ from: lo, to: hi \}\)/)
  })

  it('never gives the LLM anything but the task briefing', () => {
    const llm = shared.find((x) => x.f === 'llm.ts')!.text
    expect(llm).not.toMatch(/fitness|wedding|languages|Session|BudgetItem|finance|netWorth|goals|weight|takeaway|people/i)
  })

  it('writes only through agent_claim_run, agent_finish_run, push_subscriptions_gone, agent_save_picks, agent_save_meal_availability and agent_save_work', () => {
    for (const { f, text } of fn) {
      expect(text, f).not.toMatch(/\.(insert|update|upsert|delete)\(/)
      for (const [, rpc] of text.matchAll(/\.rpc\('([a-z_]+)'/g)) {
        expect(['agent_claim_run', 'agent_finish_run', 'push_subscriptions_gone', 'agent_save_picks', 'agent_save_headlines', 'agent_save_meal_availability', 'agent_save_work'], f).toContain(rpc)
      }
    }
  })

  it('lets Claude do jobs only through the routine, after checking its answer against the jobs it offered', () => {
    const routine = fn.find((x) => x.f === 'routine.ts')!.text
    // The one caller of agent_save_work, and it saves only what cleanWork kept.
    for (const { f, text } of fn) if (f !== 'routine.ts') expect(text, f).not.toMatch(/rpc\('agent_save_work'/)
    expect(routine).toMatch(/const items = cleanWork\(body\.items, jobs, workLimits\(state, ctx\.today\), state\.wedding\.venues\)[\s\S]*?rpc\('agent_save_work', \{ p_household_id: householdId, p_day: date, p_items: items \}\)/)
    // Never paid work, repeating jobs, or the jobs of someone who hasn't switched AI picks on.
    const work = shared.find((x) => x.f === 'work.ts')!.text
    expect(work).toMatch(/if \(t\.recurrence \|\| t\.ai_asks_task_id \|\| done\.has\(t\.task_id\)\) return false/)
    expect(work).toMatch(/if \(WORK_JOB\.test\(category\(t\.category_id\) \?\? ''\)\) return false/)
    expect(work).toMatch(/if \(!t\.needs_both && owner !== null && !ids\.has\(owner\)\) return false/)
    // It drafts emails and messages, never sends them, and a result claiming otherwise is dropped.
    expect(work).toMatch(/Emails and messages: you may draft one, never send it\./)
    expect(work).toMatch(/HAS_LINK\.test\(summary\) \|\| claimsAction\(summary\)/)
    // The routine's prompt says the same, and the routine runs with no email or messaging tools.
    const routineDoc = readFileSync(join(__dirname, '../../docs/ai-agents/morning-routine.md'), 'utf8')
    expect(routineDoc).toMatch(/Tools: `Bash`, `Read`, `WebSearch`/)
    expect(routineDoc).toMatch(/Never send an email or message/)
    expect(/^- Tools: (.*)$/m.exec(routineDoc)?.[1]).not.toMatch(/gmail|mail|message|resend|slack|mcp/i)
    expect(routineDoc).toMatch(/clear_mcp_connections: true/)
    // Of the wedding it reads the month, a guest count and venue names: no guest names, budget or suppliers.
    const ctx = fn.find((x) => x.f === 'context.ts')!.text
    const loadWork = ctx.slice(ctx.indexOf('export async function loadWork'), ctx.indexOf('export async function loadLanguages'))
    expect(loadWork).toContain(".from('wedding_guests').select('id', { count: 'exact', head: true })")
    expect(loadWork).toContain(".from('wedding_venues').select('name')")
    expect(loadWork).not.toMatch(/wedding_budget_items|wedding_suppliers|description/)
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
