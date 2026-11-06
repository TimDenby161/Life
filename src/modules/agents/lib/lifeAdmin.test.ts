import { analyseLifeAdmin, longDate, type Renewal, RENEWAL_PRESETS, renewedDate, whenText } from '../../../../supabase/functions/_shared/agents/lifeAdmin.ts'
import { ALEX, BOTH, SAM, task } from './fixtures'

const TODAY = '2026-11-06' // a Friday
const renewal = (fields: Partial<Renewal> = {}): Renewal => ({
  id: 'r1',
  name: 'Car insurance',
  owner_id: null,
  expires_on: '2026-11-30',
  warn_days: 28,
  every_months: 12,
  ...fields,
})

describe('Life Admin: reminders', () => {
  it('reminds both of a joint renewal inside its window, offering a task for Saturday', () => {
    const [s] = analyseLifeAdmin(TODAY, [renewal()], [], BOTH)
    expect(s).toMatchObject({
      dedupe_key: 'admin:r1:2026-11-30',
      kind: 'renewal',
      severity: 2,
      title: 'Car insurance expires in 3 weeks',
      recipients: BOTH,
      action: { type: 'create_task', title: 'Compare car insurance quotes', list: 'joint', due_date: '2026-11-07' },
    })
    expect(s.reason).toBe(
      'It’s due on 30 Nov 2026. Compare quotes before it renews automatically. Once it’s done, press Renewed on the Life Admin card to move the date on.',
    )
  })

  it('stays quiet until the window opens', () => {
    expect(analyseLifeAdmin(TODAY, [renewal({ expires_on: '2026-12-05' })], [], BOTH)).toEqual([])
    expect(analyseLifeAdmin(TODAY, [renewal({ expires_on: '2026-12-04' })], [], BOTH)).toHaveLength(1)
  })

  it('is urgent in the last week and once expired, with the task before the date', () => {
    const soon = analyseLifeAdmin(TODAY, [renewal({ expires_on: '2026-11-07' })], [], BOTH)[0]
    expect(soon).toMatchObject({ severity: 3, title: 'Car insurance expires tomorrow' })
    expect(soon.action).toMatchObject({ due_date: TODAY })
    const gone = analyseLifeAdmin(TODAY, [renewal({ name: 'Passport', expires_on: '2026-10-01', warn_days: 180, every_months: 120 })], [], BOTH)[0]
    expect(gone).toMatchObject({ severity: 3, title: 'Passport expired 36 days ago', action: { title: 'Renew passport', due_date: TODAY } })
    expect(gone.reason).toMatch(/^It was due on 1 Oct 2026\. /)
  })

  it('reminds only the owner of a personal one, on their own list', () => {
    const [s] = analyseLifeAdmin(TODAY, [renewal({ owner_id: SAM })], [], BOTH)
    expect(s.recipients).toEqual([SAM])
    expect(s.action).toMatchObject({ list: 'personal' })
    expect(analyseLifeAdmin(TODAY, [renewal({ owner_id: SAM })], [], [ALEX])).toEqual([])
  })

  it('doesn’t remind when a task already covers it', () => {
    expect(analyseLifeAdmin(TODAY, [renewal()], [task({ title: 'Sort out car insurance' })], BOTH)).toEqual([])
    expect(analyseLifeAdmin(TODAY, [renewal({ name: 'MOT' })], [task({ title: 'Book the MOT' })], BOTH)).toEqual([])
  })

  it('names its own task for something not in the presets, and asks for a new date by hand', () => {
    const [s] = analyseLifeAdmin(TODAY, [renewal({ name: 'Gym membership', every_months: null })], [], BOTH)
    expect(s.action).toMatchObject({ title: 'Renew Gym membership' })
    expect(s.reason).toBe('It’s due on 30 Nov 2026. Once it’s done, put the new date on the Life Admin card.')
  })

  it('asks for the list once when there’s nothing on it, and says nothing when switched off', () => {
    expect(analyseLifeAdmin(TODAY, [], [], BOTH)).toMatchObject([{ dedupe_key: 'admin:start', kind: 'admin_start', action: null }])
    expect(analyseLifeAdmin(TODAY, [renewal()], [], [])).toEqual([])
  })

  it('lists the soonest first', () => {
    const out = analyseLifeAdmin(TODAY, [renewal({ id: 'late', expires_on: '2026-11-30' }), renewal({ id: 'soon', name: 'MOT', expires_on: '2026-11-10' })], [], BOTH)
    expect(out.map((s) => s.dedupe_key)).toEqual(['admin:soon:2026-11-10', 'admin:late:2026-11-30'])
  })
})

describe('Life Admin: wording and dates', () => {
  it('says when in plain words', () => {
    expect(whenText(0)).toBe('expires today')
    expect(whenText(5)).toBe('expires in 5 days')
    expect(whenText(30)).toBe('expires in 4 weeks')
    expect(whenText(150)).toBe('expires in 5 months')
    expect(whenText(-1)).toBe('expired yesterday')
    expect(longDate('2027-05-12')).toBe('12 May 2027')
  })

  it('moves a renewed date on by its period, past today', () => {
    expect(renewedDate({ expires_on: '2026-11-30', every_months: 12 }, TODAY)).toBe('2027-11-30')
    expect(renewedDate({ expires_on: '2026-10-01', every_months: 12 }, TODAY)).toBe('2027-10-01')
    expect(renewedDate({ expires_on: '2024-03-01', every_months: 12 }, TODAY)).toBe('2027-03-01')
    expect(renewedDate({ expires_on: '2027-01-31', every_months: 1 }, TODAY)).toBe('2027-02-28')
    expect(renewedDate({ expires_on: '2028-02-29', every_months: 12 }, TODAY)).toBe('2029-02-28')
    expect(renewedDate({ expires_on: '2026-11-30', every_months: null }, TODAY)).toBeNull()
  })

  it('has sensible presets', () => {
    for (const p of RENEWAL_PRESETS) {
      expect(p.warn, p.name).toBeGreaterThan(0)
      expect(p.warn, p.name).toBeLessThanOrEqual(365)
      expect(p.task, p.name).toBeTruthy()
    }
  })
})
