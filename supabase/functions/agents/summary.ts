// The optional AI sentence on a briefing. Every failure (no key, over budget,
// API error, odd output) returns null and the briefing keeps its rules-based
// headline. Usage is returned so the run records tokens and estimated cost.
import Anthropic from 'npm:@anthropic-ai/sdk@1.4.0'
import type { BriefingContent } from '../_shared/agents/chiefOfStaff.ts'
import {
  cleanSummary,
  costMicroUsd,
  DEFAULT_MODEL,
  MAX_OUTPUT_TOKENS,
  OUTPUT_SCHEMA,
  SYSTEM_PROMPT,
  summaryInput,
  withinBudget,
  worstCaseMicroUsd,
} from '../_shared/agents/llm.ts'

export type Usage = { input_tokens: number; output_tokens: number; cost_micro_usd: number }

export const noUsage = (): Usage => ({ input_tokens: 0, output_tokens: 0, cost_micro_usd: 0 })

export async function writeSummary(
  name: string,
  content: BriefingContent,
  budget: { spent: number; limit: number },
): Promise<{ summary: string | null; usage: Usage; skipped?: 'no_key' | 'over_budget' | 'error' }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return { summary: null, usage: noUsage(), skipped: 'no_key' }
  const model = Deno.env.get('AGENT_LLM_MODEL') || DEFAULT_MODEL
  const input = summaryInput(name, content)
  if (!withinBudget(budget.spent, budget.limit, worstCaseMicroUsd(model, input.length + SYSTEM_PROMPT.length))) {
    return { summary: null, usage: noUsage(), skipped: 'over_budget' }
  }

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 30_000 })
  try {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: input }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    })
    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cost_micro_usd: costMicroUsd(model, response.usage.input_tokens, response.usage.output_tokens),
    }
    if (response.stop_reason !== 'end_turn') return { summary: null, usage, skipped: 'error' }
    const text = response.content.find((b) => b.type === 'text')
    return { summary: text && text.type === 'text' ? cleanSummary(text.text) : null, usage }
  } catch (error) {
    // Logged without content: just which kind of failure it was.
    if (error instanceof Anthropic.RateLimitError) console.warn('summary: rate limited')
    else if (error instanceof Anthropic.APIError) console.warn(`summary: API error ${error.status}`)
    else console.warn('summary: request failed')
    return { summary: null, usage: noUsage(), skipped: 'error' }
  }
}
