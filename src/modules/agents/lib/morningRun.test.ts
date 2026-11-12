import { claudeResults, morningRun } from './morningRun'

const TODAY = '2026-11-13'
const job = (task_id: string, title: string, extra: Partial<{ created_at: string; ai_asks_task_id: string | null; ai_result: unknown }> = {}) => ({
  task_id,
  task: { title, created_at: '2026-11-01T09:00:00Z', ai_asks_task_id: null, ai_result: null, ...extra },
})
const result = (day: string) => ({ summary: '8 venues near Bath added', body: 'The shortlist.', links: [], day })

describe('the morning run summary', () => {
  it('lists today’s results and every open question, today’s first, with the job each is for', () => {
    const run = morningRun(
      [
        job('venues', 'Find venues and visit them', { ai_result: result(TODAY) }),
        job('old', 'Compare broadband', { ai_result: result('2026-11-12') }),
        job('insurance', 'Travel insurance'),
        job('q-old', 'Broadband: which provider now?', { ai_asks_task_id: 'old', created_at: '2026-11-12T06:20:00Z' }),
        job('q-new', 'Travel insurance: which trip?', { ai_asks_task_id: 'insurance', created_at: '2026-11-13T06:20:00Z' }),
      ],
      TODAY,
    )
    expect(run.did.map((d) => [d.taskId, d.result.summary])).toEqual([['venues', '8 venues near Bath added']])
    expect(run.asks.map((a) => [a.question, a.forTitle, a.today])).toEqual([
      ['Travel insurance: which trip?', 'Travel insurance', true],
      ['Broadband: which provider now?', 'Compare broadband', false],
    ])
    expect(run.news).toBe(true)
  })

  it('counts a question asked after midnight London time as today’s, in BST or not', () => {
    expect(morningRun([job('q', 'Which area?', { ai_asks_task_id: 'x', created_at: '2026-11-13T00:30:00Z' })], TODAY).asks[0].today).toBe(true)
    expect(morningRun([job('q', 'Which area?', { ai_asks_task_id: 'x', created_at: '2026-06-12T23:30:00Z' })], '2026-06-13').asks[0].today).toBe(true)
  })

  it('has no news on a day the run did and asked nothing new, even with old questions waiting', () => {
    const run = morningRun([job('q', 'Which area?', { ai_asks_task_id: 'gone', created_at: '2026-11-10T06:20:00Z' }), job('a', 'A job')], TODAY)
    expect(run).toEqual({ did: [], asks: [{ taskId: 'q', question: 'Which area?', forTitle: null, today: false }], news: false })
    expect(morningRun([], TODAY).news).toBe(false)
  })
})

describe('everything Claude has done', () => {
  it('lists every open job with a result, newest first, undated last', () => {
    const all = claudeResults([
      job('old', 'Compare broadband', { ai_result: result('2026-11-10') }),
      job('none', 'No result'),
      job('undated', 'Undated', { ai_result: { ...result(TODAY), day: null } }),
      job('new', 'Find venues', { ai_result: result(TODAY) }),
    ])
    expect(all.map((d) => d.taskId)).toEqual(['new', 'old', 'undated'])
  })
})
