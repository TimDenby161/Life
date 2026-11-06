// AI priorities: asks Claude for a person's most important jobs today. Every
// failure (no key, over budget, API error, unusable answer) returns null, and
// Top jobs keeps its usual scoring. Usage is returned so the run records cost.
import Anthropic from 'npm:@anthropic-ai/sdk@1.4.0'
import { costMicroUsd, DEFAULT_MODEL, MAX_OUTPUT_TOKENS, withinBudget, worstCaseMicroUsd } from '../_shared/agents/llm.ts'
import { type Candidate, cleanPicks, type Pick, PRIORITIES_PROMPT, PRIORITIES_SCHEMA } from '../_shared/agents/priorities.ts'
import { noUsage, type Usage } from './summary.ts'

export async function pickPriorities(
  input: string,
  candidates: Candidate[],
  budget: { spent: number; limit: number },
): Promise<{ picks: Pick[] | null; usage: Usage }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey || !candidates.length) return { picks: null, usage: noUsage() }
  const model = Deno.env.get('AGENT_LLM_MODEL') || DEFAULT_MODEL
  if (!withinBudget(budget.spent, budget.limit, worstCaseMicroUsd(model, input.length + PRIORITIES_PROMPT.length))) {
    console.warn('priorities: over the monthly budget')
    return { picks: null, usage: noUsage() }
  }

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 })
  try {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: PRIORITIES_PROMPT,
      messages: [{ role: 'user', content: input }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: PRIORITIES_SCHEMA } },
    })
    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cost_micro_usd: costMicroUsd(model, response.usage.input_tokens, response.usage.output_tokens),
    }
    if (response.stop_reason !== 'end_turn') return { picks: null, usage }
    const text = response.content.find((b) => b.type === 'text')
    return { picks: text && text.type === 'text' ? cleanPicks(text.text, candidates) : null, usage }
  } catch (error) {
    // Logged without content: just which kind of failure it was.
    if (error instanceof Anthropic.RateLimitError) console.warn('priorities: rate limited')
    else if (error instanceof Anthropic.APIError) console.warn(`priorities: API error ${error.status}`)
    else console.warn('priorities: request failed')
    return { picks: null, usage: noUsage() }
  }
}
