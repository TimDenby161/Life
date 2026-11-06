import type { BriefingContent } from '../../../../supabase/functions/_shared/agents/chiefOfStaff.ts'
import {
  cleanSummary,
  costMicroUsd,
  monthlyBudgetMicroUsd,
  summaryInput,
  withinBudget,
  worstCaseMicroUsd,
} from '../../../../supabase/functions/_shared/agents/llm.ts'

describe('cost', () => {
  it('prices tokens in millionths of a dollar', () => {
    expect(costMicroUsd('claude-opus-5-5', 1_000_000, 0)).toBe(4_000_000)
    expect(costMicroUsd('claude-opus-5-5', 600, 80)).toBe(600 * 4 + 80 * 20)
    expect(costMicroUsd('claude-haiku-5-5', 1000, 100)).toBe(150)
  })

  it('prices an unknown model as the dearest', () => {
    expect(costMicroUsd('some-new-model', 1000, 0)).toBeGreaterThan(costMicroUsd('claude-opus-5-5', 1000, 0))
  })

  it('reads the monthly budget, defaulting to $1', () => {
    expect(monthlyBudgetMicroUsd(undefined)).toBe(1_000_000)
    expect(monthlyBudgetMicroUsd('')).toBe(1_000_000)
    expect(monthlyBudgetMicroUsd('0.5')).toBe(500_000)
    expect(monthlyBudgetMicroUsd('0')).toBe(0)
    expect(monthlyBudgetMicroUsd('lots')).toBe(1_000_000)
  })

  it('refuses a call whose worst case would go over the budget', () => {
    const worst = worstCaseMicroUsd('claude-opus-5-5', 1500)
    expect(withinBudget(0, 1_000_000, worst)).toBe(true)
    expect(withinBudget(1_000_000 - worst + 1, 1_000_000, worst)).toBe(false)
    expect(withinBudget(0, 0, worst)).toBe(false)
  })

  it('costs about a third of a cent a day per person on the default model', () => {
    // A briefing prompt is ~600 tokens in and ~60 out.
    expect(costMicroUsd('claude-opus-5-5', 600, 60)).toBeLessThan(5_000)
  })
})

describe('what the model sees', () => {
  const content: BriefingContent = {
    date: '2026-11-06',
    headline: '1 due today.',
    dueToday: 1,
    overdue: 0,
    together: 0,
    deadlines: [{ task_id: 'secret-id', title: 'Passport', deadline: '2026-11-09' }],
    busy: [],
    clashes: [],
    partnerDone: { name: 'Sam', count: 2, titles: ['Hoover', 'Bins'] },
    added: [],
    suggestions: [{ key: 'task:secret-id', title: 'Do the thing', severity: 2 }],
  }

  it('gets titles, counts and dates only, no ids', () => {
    const input = summaryInput('Alex', content)
    expect(input).toContain('Passport')
    expect(input).not.toContain('secret-id')
    expect(JSON.parse(input).partnerFinished).toEqual({ name: 'Sam', count: 2 })
  })
})

describe('checking the output', () => {
  it('keeps one plain sentence', () => {
    expect(cleanSummary('{"summary":"  A quiet day:\\n one thing due. "}')).toBe('A quiet day: one thing due.')
  })

  it('discards anything else', () => {
    expect(cleanSummary('not json')).toBeNull()
    expect(cleanSummary('{"summary": 3}')).toBeNull()
    expect(cleanSummary('{"summary": ""}')).toBeNull()
    expect(cleanSummary(JSON.stringify({ summary: 'x'.repeat(301) }))).toBeNull()
    expect(cleanSummary('{"summary":"Visit https://example.com now"}')).toBeNull()
    expect(cleanSummary('{"summary":"<script>"}')).toBeNull()
  })
})
