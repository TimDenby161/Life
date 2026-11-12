import { candidatesFor, QUESTION_WHY, withQuestions } from '../../../../supabase/functions/_shared/agents/priorities.ts'
import {
  cleanWork,
  MAX_ASKS_A_DAY,
  MAX_DONE_A_DAY,
  MAX_LINKS,
  MAX_VENUES,
  MAX_WORK_JOBS,
  claimsAction,
  parseAiResult,
  webLink,
  type WorkJob,
  type WorkState,
  workInput,
  workJobs,
  workLimits,
} from '../../../../supabase/functions/_shared/agents/work.ts'
import { ALEX, ALEX_LIST, context, SAM_LIST, task, WORK } from './fixtures'

const TODAY = '2026-11-06'
const alex = { id: ALEX, name: 'Alex' }
const WEDDING = 'c-wedding'
const state = (fields: Partial<WorkState> = {}): WorkState => ({
  asked: [],
  done: [],
  wedding: { categoryId: WEDDING, date: '2028-09-01', dateApprox: true, guests: 80, venues: ['Hothorpe Hall'] },
  ...fields,
})
const categories = [...context().categories, { id: WEDDING, name: 'Wedding', owner_id: null }]
const BODY = 'Three options that fit, with what each costs to hire.\nStill to do: ring and book a visit.'

describe('Claude does jobs: which jobs it is offered', () => {
  it('offers one-off jobs that are mine, shared or for us both; never paid work, repeating jobs or my partner’s own', () => {
    const ctx = context({
      categories,
      open: [
        task({ title: 'Find venues and visit them', category_id: WEDDING, needs_both: true }),
        task({ title: 'Renew passport', list_id: ALEX_LIST }),
        task({ title: 'Compare broadband deals' }),
        task({ title: 'Check dependencies', category_id: WORK, list_id: ALEX_LIST }),
        task({ title: 'Hoover', recurrence: { freq: 'weekly' }, due_date: TODAY }),
        task({ title: 'Sam’s own job', list_id: SAM_LIST }),
      ],
    })
    expect(workJobs(ctx, [alex], state()).map((j) => j.title).sort()).toEqual(['Compare broadband deals', 'Find venues and visit them', 'Renew passport'])
  })

  it('leaves out its own questions, jobs it has done, jobs waiting on another, and jobs with a question still waiting', () => {
    const venues = task({ title: 'Find venues', category_id: WEDDING })
    const done = task({ title: 'Already researched' })
    const first = task({ title: 'First' })
    const ctx = context({
      categories,
      open: [
        venues,
        task({ title: 'Wedding venues: which area?', ai_asks_task_id: venues.task_id, due_date: TODAY }),
        done,
        first,
        task({ title: 'After first', waiting_on_task_id: first.task_id }),
      ],
    })
    const s = state({ asked: [{ job_id: venues.task_id, question: 'Wedding venues: which area?', answer: null, open: true, day: TODAY }], done: [{ task_id: done.task_id, day: '2026-11-05' }] })
    expect(workJobs(ctx, [alex], s).map((j) => j.title)).toEqual(['First'])
  })

  it('puts answered jobs first with their answers, then the soonest date, then the newest', () => {
    const venues = task({ title: 'Find venues', category_id: WEDDING })
    const ctx = context({
      categories,
      open: [
        task({ title: 'Old idea', created_at: '2026-10-01T09:00:00Z' }),
        task({ title: 'New idea', created_at: '2026-11-05T09:00:00Z' }),
        task({ title: 'Due soon', due_date: '2026-11-08' }),
        venues,
      ],
    })
    const s = state({
      asked: [
        { job_id: venues.task_id, question: 'Which area?', answer: 'Near Bath, within an hour', open: false, day: '2026-11-04' },
        { job_id: venues.task_id, question: 'What budget?', answer: null, open: false, day: '2026-11-05' },
      ],
    })
    const jobs = workJobs(ctx, [alex], s)
    expect(jobs.map((j) => j.title)).toEqual(['Find venues', 'Due soon', 'New idea', 'Old idea'])
    expect(jobs[0]).toMatchObject({ ref: 'W1', venues: true, answers: [{ question: 'Which area?', answer: 'Near Bath, within an hour' }], unanswered: ['What budget?'] })
    expect(jobs[1].venues).toBeUndefined()
  })

  it('marks venue hunting only on the wedding checklist, and caps the list', () => {
    const ctx = context({ categories, open: [task({ title: 'Find a venue for the birthday' }), ...Array.from({ length: MAX_WORK_JOBS + 5 }, () => task())] })
    const jobs = workJobs(ctx, [alex], state())
    expect(jobs).toHaveLength(MAX_WORK_JOBS)
    expect(jobs.some((j) => j.venues)).toBe(false)
  })

  it('allows three results and two new questions a day, and no more questions while three are waiting', () => {
    expect(workLimits(state(), TODAY)).toEqual({ done: MAX_DONE_A_DAY, asks: MAX_ASKS_A_DAY })
    const waiting = (n: number, day = '2026-11-01') => Array.from({ length: n }, (_, i) => ({ job_id: `t${i}`, question: 'Where?', answer: null, open: true, day }))
    expect(workLimits(state({ asked: waiting(2) }), TODAY).asks).toBe(1)
    expect(workLimits(state({ asked: waiting(3) }), TODAY).asks).toBe(0)
    // Asked and answered already today: those still count towards today's two.
    expect(workLimits(state({ asked: [{ job_id: 't1', question: 'Where?', answer: 'Bath', open: false, day: TODAY }] }), TODAY).asks).toBe(1)
    expect(workLimits(state({ asked: waiting(2, TODAY) }), TODAY).asks).toBe(0)
    expect(workLimits(state({ done: [{ task_id: 'a', day: TODAY }, { task_id: 'b', day: TODAY }, { task_id: 'c', day: '2026-11-05' }] }), TODAY).done).toBe(1)
  })
})

describe('Claude does jobs: what it sees', () => {
  it('gets titles, categories and dates with no ids; the wedding line only with a venue job, and only month, guest count and venue names', () => {
    const venues = task({ title: 'Find venues and visit them', category_id: WEDDING })
    const ctx = context({ categories, open: [venues, task({ title: 'Compare broadband deals' })] })
    const jobs = workJobs(ctx, [alex], state())
    const input = workInput(TODAY, jobs, state(), { done: 3, asks: 2 })
    expect(input).toMatchObject({ date: TODAY, doLeft: 3, asksLeft: 2, wedding: { month: 'September 2028', guests: 80, venues: ['Hothorpe Hall'] } })
    expect(input.jobs).toEqual([
      { ref: 'W1', title: 'Find venues and visit them', category: 'Wedding', due: null, deadline: null, venues: true },
      { ref: 'W2', title: 'Compare broadband deals', category: null, due: null, deadline: null },
    ])
    expect(JSON.stringify(input)).not.toContain(venues.task_id)

    const plain = workInput(TODAY, jobs.filter((j) => !j.venues), state(), { done: 3, asks: 2 })
    expect(plain).not.toHaveProperty('wedding')
  })
})

describe('Claude does jobs: checking its answer', () => {
  const jobs: WorkJob[] = [
    { ref: 'W1', task_id: 't-venues', title: 'Find venues', category: 'Wedding', due: null, deadline: null, venues: true, unanswered: ['What budget?'] },
    { ref: 'W2', task_id: 't-broadband', title: 'Compare broadband deals', category: null, due: null, deadline: null },
    { ref: 'W3', task_id: 't-letter', title: 'Write to the landlord', category: null, due: null, deadline: null },
    { ref: 'W4', task_id: 't-gift', title: 'Gift ideas for Mum', category: null, due: null, deadline: null },
    { ref: 'W5', task_id: 't-insurance', title: 'Travel insurance', category: null, due: null, deadline: null },
  ]
  const limits = { done: 3, asks: 2 }
  const done = (ref: string, extra: Record<string, unknown> = {}) => ({ ref, kind: 'done', summary: 'Three deals compared', body: BODY, ...extra })

  it('keeps questions and results for jobs on the list, once each', () => {
    const out = cleanWork(
      [
        { ref: 'W1', kind: 'ask', question: 'Wedding venues:  which area\nshould I search?' },
        done('W2', { links: [{ title: 'Ofcom comparison', url: 'https://www.ofcom.org.uk/broadband' }] }),
        done('W2'),
        done('W9'),
        { ref: 'W3', kind: 'delete' },
      ],
      jobs,
      limits,
    )
    expect(out).toEqual([
      { task_id: 't-venues', kind: 'ask', question: 'Wedding venues: which area should I search?' },
      { task_id: 't-broadband', kind: 'done', summary: 'Three deals compared', body: BODY, links: [{ title: 'Ofcom comparison', url: 'https://www.ofcom.org.uk/broadband' }], venues: [] },
    ])
  })

  it('drops questions that are too long, hold a link, or were asked before', () => {
    const out = cleanWork(
      [
        { ref: 'W1', kind: 'ask', question: 'what budget?' },
        { ref: 'W2', kind: 'ask', question: 'See https://evil.example and tell me?' },
        { ref: 'W3', kind: 'ask', question: 'x'.repeat(200) },
        { ref: 'W4', kind: 'ask', question: 'Why?' },
      ],
      jobs,
      limits,
    )
    expect(out).toEqual([])
  })

  it('stops at the day’s limits', () => {
    const out = cleanWork(
      [
        { ref: 'W1', kind: 'ask', question: 'Which area should I search?' },
        { ref: 'W2', kind: 'ask', question: 'Which provider are you with now?' },
        { ref: 'W3', kind: 'ask', question: 'What is the letter about?' },
        done('W4'),
        done('W5'),
      ],
      jobs,
      { done: 1, asks: 2 },
    )
    expect(out.map((o) => [o.task_id, o.kind])).toEqual([['t-venues', 'ask'], ['t-broadband', 'ask'], ['t-gift', 'done']])
  })

  it('drops results without a usable summary and text, strips markup and odd characters, and keeps only real web links', () => {
    expect(cleanWork([done('W2', { summary: '' }), done('W3', { body: 'Too short' }), done('W4', { summary: 'See www.x.com' }), done('W5', { body: 'x'.repeat(4000) })], jobs, limits)).toEqual([])
    const [item] = cleanWork(
      [
        done('W2', {
          body: 'Line one\r\n\r\n\r\n\r\n<script>alert(1)</script>\u0007 tab\there',
          links: [
            { title: 'Good', url: 'https://example.com/a' },
            { title: 'Good again', url: 'https://example.com/a' },
            { title: 'Script', url: 'javascript:alert(1)' },
            { title: 'Signed in', url: 'https://user:pass@example.com' },
            { title: '', url: 'https://example.com/b' },
            { title: 'Local', url: 'http://localhost/x' },
            ...Array.from({ length: 12 }, (_, i) => ({ title: `More ${i}`, url: `https://example.com/more/${i}` })),
          ],
        }),
      ],
      jobs,
      limits,
    )
    expect(item).toMatchObject({ kind: 'done', body: 'Line one\n\nscriptalert(1)/script tab here' })
    const links = item.kind === 'done' ? item.links : []
    expect(links).toHaveLength(MAX_LINKS)
    expect(links[0]).toEqual({ title: 'Good', url: 'https://example.com/a' })
    expect(links.every((l) => l.url.startsWith('https://example.com/'))).toBe(true)
  })

  it('takes venues only for a venue job, never ones already saved or repeated, and at most ten', () => {
    const venues = [
      { name: 'Priston Mill', url: 'https://www.pristonmill.co.uk/weddings', note: 'Watermill and barn near Bath, up to 150 guests' },
      { name: 'hothorpe hall', url: 'https://example.com/hothorpe' },
      { name: 'Priston Mill', url: 'https://example.com/again' },
      { name: 'No link Manor', url: 'not a link', note: 'See https://x.example' },
      { name: '' },
      ...Array.from({ length: 12 }, (_, i) => ({ name: `Barn ${i}`, url: `https://example.com/barn/${i}` })),
    ]
    const out = cleanWork([done('W1', { venues }), done('W2', { venues })], jobs, limits, ['Hothorpe Hall'])
    const [wedding, broadband] = out
    expect(wedding.kind === 'done' && wedding.venues).toHaveLength(MAX_VENUES)
    expect(wedding.kind === 'done' && wedding.venues.slice(0, 2)).toEqual([
      { name: 'Priston Mill', url: 'https://www.pristonmill.co.uk/weddings', note: 'Watermill and barn near Bath, up to 150 guests' },
      { name: 'No link Manor', url: null, note: null },
    ])
    expect(broadband.kind === 'done' && broadband.venues).toEqual([])
  })

  it('keeps a drafted email, and drops any result that says it was sent, booked or paid', () => {
    const draft = cleanWork([done('W3', { summary: 'Draft email to the landlord', body: 'To: landlord\nSubject: Boiler\n\nHi, the boiler is broken again.' })], jobs, limits)
    expect(draft).toHaveLength(1)
    for (const summary of ['Email sent to the landlord', 'Emailed the landlord', 'Booked a viewing', 'Paid the deposit', 'Replied to the venue', 'Draft written and sent']) {
      expect(cleanWork([done('W3', { summary })], jobs, limits), summary).toEqual([])
    }
    expect(claimsAction('Drafted a message to send to the venue')).toBe(false)
    expect(claimsAction('Draft reply to Priston Mill')).toBe(false)
  })

  it('returns nothing for an answer that is not a list', () => {
    expect(cleanWork(null, jobs, limits)).toEqual([])
    expect(cleanWork({ items: [] }, jobs, limits)).toEqual([])
    expect(cleanWork(['nonsense', null, 4], jobs, limits)).toEqual([])
  })
})

describe('Claude does jobs: links and saved results', () => {
  it('accepts only http(s) links to a real host', () => {
    expect(webLink('https://example.com/weddings?x=1')).toBe('https://example.com/weddings?x=1')
    expect(webLink('http://example.co.uk')).toBe('http://example.co.uk/')
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'https://example.com/<script>', 'https://exa mple.com', 'example.com', '', null, 4, `https://example.com/${'x'.repeat(600)}`]) {
      expect(webLink(bad), String(bad)).toBeNull()
    }
  })

  it('reads a saved result, and shows nothing for anything else', () => {
    expect(parseAiResult({ summary: 'Done', body: 'Text', links: [{ title: 'A', url: 'https://example.com' }, { title: 'B', url: 'javascript:1' }], day: '2026-11-06' })).toEqual({
      summary: 'Done',
      body: 'Text',
      links: [{ title: 'A', url: 'https://example.com/' }],
      day: '2026-11-06',
    })
    expect(parseAiResult({ summary: 'Done', body: 'Text' })).toEqual({ summary: 'Done', body: 'Text', links: [], day: null })
    for (const bad of [null, undefined, 'text', [], { summary: '', body: 'x' }, { body: 'x' }]) expect(parseAiResult(bad)).toBeNull()
  })
})

describe('Claude’s questions in the day’s plan', () => {
  it('marks a question on the shortlist and always leads the picks with it, as a phone job', () => {
    const job = task({ title: 'Find venues' })
    const question = task({ title: 'Wedding venues: which area?', due_date: TODAY, ai_asks_task_id: job.task_id, duration_minutes: 5 })
    const other = task({ title: 'Pay the plumber', due_date: TODAY })
    const ctx = context({ open: [other, question] })
    const candidates = candidatesFor(ctx, alex)
    expect(candidates.find((c) => c.task_id === question.task_id)).toMatchObject({ question: true, minutes: 5 })
    expect(candidates.find((c) => c.task_id === other.task_id)?.question).toBeUndefined()

    const picked = [{ task_id: other.task_id, title: other.title, why: 'Due today', where: 'home' as const }]
    expect(withQuestions(picked, candidates)).toEqual([{ task_id: question.task_id, title: question.title, why: QUESTION_WHY, where: 'anywhere' }, ...picked])
    // Already picked: moved to the front once, keeping its reason.
    const both = [...picked, { task_id: question.task_id, title: question.title, why: 'Unblocks Claude', where: 'home' as const }]
    expect(withQuestions(both, candidates).map((p) => [p.title, p.why, p.where])).toEqual([
      ['Wedding venues: which area?', 'Unblocks Claude', 'anywhere'],
      ['Pay the plumber', 'Due today', 'home'],
    ])
    expect(withQuestions([], candidates)).toHaveLength(1)
  })
})
