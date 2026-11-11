// Static guards over the shopping-list Edge Function. It is the one place meal
// names leave the app (to Claude), and it holds the service-role key for one
// call, so what it reads and writes is checked here rather than trusted.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const fn = readFileSync(join(__dirname, '../../supabase/functions/shopping-list/index.ts'), 'utf8')
const shared = readFileSync(join(__dirname, '../../supabase/functions/_shared/meals.ts'), 'utf8')
const agents = readFileSync(join(__dirname, '../../supabase/functions/agents/index.ts'), 'utf8')

describe('shopping-list Edge Function', () => {
  it('reads only the household, its meals and plan, what it has in, its recipes and what has been spent', () => {
    const tables = new Set([...fn.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]))
    expect([...tables].sort()).toEqual([
      'household_members',
      'meal_availability',
      'meal_pantry',
      'meal_slot_notes',
      'meals',
      'recipes',
      'shopping_list_runs',
    ])
  })

  it('reads as the signed-in person, and uses the service role only to save the list, the recipes or the plan', () => {
    expect(fn).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    expect([...fn.matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual(['meals_save_plan', 'recipes_save', 'shopping_save_list'])
    // Every use of the service-role client is one of those calls.
    expect([...fn.matchAll(/serviceClient\(\)(\.rpc\('[a-z_]+')?/g)].map((m) => m[1]).sort()).toEqual([
      ".rpc('meals_save_plan'",
      ".rpc('recipes_save'",
      ".rpc('shopping_save_list'",
    ])
  })

  it('selects only what Claude needs from a meal and a recipe', () => {
    expect(fn).toContain(".select('id, day, slot, person_id, name')")
    expect(fn).toContain(".select('meal_key, serves, ingredients, created_at')")
    expect(fn).toContain(".from('meal_availability').select('day, slot, person_id, available')")
    expect(fn).toContain(".from('meal_slot_notes').select('day, slot, note')")
    expect(fn).toContain(".from('meal_pantry').select('name')")
  })

  it('never sends Claude who is eating, only how many', () => {
    const input = /export function planInput[\s\S]*?\n}\n/.exec(shared)![0]
    expect(input).toContain('people: s.eaters.length')
    expect(input).not.toMatch(/eaters(?!\.length)|person_id/)
  })

  it('has its own API key, so setting it does not switch on paid calls in the agents function', () => {
    expect(fn).toContain("Deno.env.get('MEALS_ANTHROPIC_API_KEY')")
    expect(fn).not.toContain("Deno.env.get('ANTHROPIC_API_KEY')")
    expect(fn).toMatch(/new Anthropic\(\{ apiKey,/)
    expect(agents).not.toContain('MEALS_ANTHROPIC_API_KEY')
  })

  it('never logs what was asked or answered', () => {
    for (const [, args] of fn.matchAll(/console\.\w+\(([^)]*)\)/g)) expect(args).not.toMatch(/input|raw|items|meals|rows|body/)
  })

  it('keeps the shared meal logic pure, so the app and Deno can both import it', () => {
    expect(shared).not.toMatch(/\bDeno\.|^import /m)
  })
})
