import type { Renewal } from '../../../../supabase/functions/_shared/agents/lifeAdmin.ts'
import { analyseTravel, type Trip } from '../../../../supabase/functions/_shared/agents/travel.ts'
import { ALEX, BOTH, SAM, task } from './fixtures'

const TODAY = '2026-11-06' // a Friday; next Saturday 7 Nov
const trip = (fields: Partial<Trip> = {}): Trip => ({
  id: 't1',
  name: 'Rome',
  owner_id: null,
  starts_on: '2026-12-18', // 6 weeks away
  ends_on: '2026-12-22',
  abroad: true,
  transport: 'done',
  stay: 'done',
  insurance: 'done',
  time_off: 'done',
  ...fields,
})
const passport = (owner: string, expires_on: string): Renewal => ({ id: `p-${owner}`, name: 'Passport', owner_id: owner, expires_on, warn_days: 180, every_months: 120 })
const passports = [passport(ALEX, '2031-01-01'), passport(SAM, '2031-01-01')]
const run = (trips: Trip[], renewals = passports, open = [task()], enabled = BOTH) => analyseTravel(TODAY, trips, renewals, open, enabled)
const keys = (out: ReturnType<typeof analyseTravel>) => out.map((s) => s.dedupe_key)

describe('Travel: what still needs sorting', () => {
  it('puts everything still to do inside its window on one card, with a task for Saturday', () => {
    const [s] = run([trip({ stay: 'todo', insurance: 'todo' })])
    expect(s).toMatchObject({
      dedupe_key: 'trip:t1:todo:stay,insurance',
      kind: 'trip_item',
      severity: 2,
      title: 'Rome is in 6 weeks: stay and insurance to sort',
      recipients: BOTH,
      action: { type: 'create_task', title: 'Sort out Rome: stay, insurance', list: 'joint', due_date: '2026-11-07' },
    })
    expect(s.reason).toMatch(/^18 Dec 2026\. The better places go first\. Buying it once/)
  })

  it('names the task itself when only one thing is left', () => {
    expect(run([trip({ stay: 'todo' })])).toMatchObject([{ dedupe_key: 'trip:t1:todo:stay', title: 'Book somewhere to stay for Rome', action: { title: 'Book somewhere to stay for Rome' } }])
  })

  it('waits for each item’s window', () => {
    const far = trip({ starts_on: '2027-03-01', ends_on: '2027-03-05', time_off: 'todo', transport: 'todo', stay: 'todo', insurance: 'todo' })
    expect(keys(run([far]))).toEqual([]) // 115 days away
    const twelveWeeks = trip({ starts_on: '2027-01-29', ends_on: '2027-02-01', time_off: 'todo', transport: 'todo', stay: 'todo', insurance: 'todo' })
    expect(keys(run([twelveWeeks]))).toEqual(['trip:t1:todo:time_off']) // 84 days away
  })

  it('leaves done and not-needed items alone, and insurance for trips at home', () => {
    expect(run([trip({ stay: 'not_needed' })])).toEqual([])
    expect(keys(run([trip({ abroad: false, insurance: 'todo' })]))).toEqual([])
  })

  it('is urgent in the last two weeks, and lists packing three days out', () => {
    const out = run([trip({ starts_on: '2026-11-08', ends_on: '2026-11-10', transport: 'todo' })])
    expect(out.find((s) => s.dedupe_key === 'trip:t1:todo:transport')).toMatchObject({ severity: 3, action: { due_date: '2026-11-07' } })
    expect(out.find((s) => s.dedupe_key === 'trip:t1:pack')).toMatchObject({ title: 'Rome is in 2 days', action: { title: 'Pack for Rome', due_date: '2026-11-07' } })
  })

  it('skips anything an open task already covers', () => {
    expect(run([trip({ stay: 'todo' })], passports, [task({ title: 'Book somewhere to stay for Rome' })])).toEqual([])
    expect(keys(run([trip({ stay: 'todo', insurance: 'todo' })], passports, [task({ title: 'Book somewhere to stay for Rome' })]))).toEqual(['trip:t1:todo:insurance'])
    expect(run([trip({ stay: 'todo', insurance: 'todo' })], passports, [task({ title: 'Sort out Rome: stay, insurance' })])).toEqual([])
  })

  it('reminds only the traveller about a personal trip, on their own list', () => {
    const out = run([trip({ owner_id: SAM, stay: 'todo' })])
    expect(out).toMatchObject([{ recipients: [SAM], action: { list: 'personal' } }])
    expect(run([trip({ owner_id: SAM, stay: 'todo' })], passports, [], [ALEX])).toEqual([])
  })

  it('ignores trips that have started', () => {
    expect(run([trip({ starts_on: '2026-11-05', ends_on: '2026-11-09', stay: 'todo' })])).toEqual([])
  })
})

describe('Travel: passports', () => {
  it('warns the person whose passport has under six months left after the trip', () => {
    // Over 60 days away, so not yet urgent.
    const out = run([trip({ starts_on: '2027-02-01', ends_on: '2027-02-05' })], [passport(ALEX, '2027-05-01'), passport(SAM, '2031-01-01')])
    expect(out).toMatchObject([
      { dedupe_key: `trip:t1:passport:${ALEX}`, kind: 'trip_passport', severity: 2, recipients: [ALEX], title: 'Passport has under six months left after Rome' },
    ])
    expect(out[0].reason).toMatch(/^It expires on 1 May 2027\. Some countries/)
    expect(out[0].action).toMatchObject({ title: 'Renew passport', list: 'personal' })
  })

  it('is urgent when it runs out before the trip ends', () => {
    const [s] = run([trip()], [passport(ALEX, '2026-12-20'), passport(SAM, '2031-01-01')])
    expect(s).toMatchObject({ severity: 3, title: 'Passport runs out before Rome ends' })
  })

  it('asks each traveller to add a passport that isn’t on Renewals', () => {
    const out = run([trip()], [passport(ALEX, '2031-01-01')])
    expect(out).toMatchObject([{ kind: 'trip_passport_unknown', severity: 1, recipients: [SAM], title: 'Is your passport OK for Rome?', action: null }])
  })

  it('only checks trips abroad within a year', () => {
    expect(run([trip({ abroad: false })], [])).toEqual([])
    expect(run([trip({ starts_on: '2028-01-01', ends_on: '2028-01-05' })], [])).toEqual([])
  })
})
