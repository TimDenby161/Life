import { addDays, daysBetween, isoWeekday, isoWeekKey, localNow, nextWeekday } from '../../../../supabase/functions/_shared/agents/dates.ts'
import { AGENTS, LIVE_AGENTS } from '../../../../supabase/functions/_shared/agents/registry.ts'
import { agentDue, chiefOfStaffDue, manualKey } from '../../../../supabase/functions/_shared/agents/schedule.ts'

describe('dates', () => {
  it('does day arithmetic across the clocks changing', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26')
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('knows weekdays and ISO weeks', () => {
    expect(isoWeekday('2026-11-06')).toBe(5)
    expect(nextWeekday('2026-11-06', 6)).toBe('2026-11-07')
    expect(nextWeekday('2026-11-07', 6)).toBe('2026-11-14')
    expect(isoWeekKey('2026-11-09')).toBe('2026-W46')
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53')
  })

  it('reads the local date and hour in London, summer and winter', () => {
    expect(localNow(new Date('2026-07-01T05:30:00Z'), 'Europe/London')).toEqual({ date: '2026-07-01', hour: 6, minute: 30 })
    expect(localNow(new Date('2026-12-01T23:30:00Z'), 'Europe/London')).toEqual({ date: '2026-12-01', hour: 23, minute: 30 })
    expect(localNow(new Date('2026-07-01T23:30:00Z'), 'Europe/London').date).toBe('2026-07-02')
  })
})

describe('schedule', () => {
  it('runs daily agents once a day from 6am', () => {
    expect(agentDue('daily', '2026-11-06', 5)).toBeNull()
    expect(agentDue('daily', '2026-11-06', 6)).toEqual({ runKey: 'daily:2026-11-06', kind: 'daily' })
    // Later ticks ask for the same key, which the database refuses once it has run.
    expect(agentDue('daily', '2026-11-06', 15)?.runKey).toBe('daily:2026-11-06')
  })

  it('runs weekly agents once per ISO week, catching up if Monday was missed', () => {
    expect(agentDue('weekly', '2026-11-09', 6)?.runKey).toBe('weekly:2026-W46')
    expect(agentDue('weekly', '2026-11-12', 9)?.runKey).toBe('weekly:2026-W46')
    expect(agentDue(null, '2026-11-09', 9)).toBeNull()
  })

  it('briefs daily people every morning and everyone on Mondays', () => {
    expect(chiefOfStaffDue('2026-11-06', 7, ['daily', 'weekly'])).toEqual({ runKey: 'daily:2026-11-06', kind: 'daily' })
    expect(chiefOfStaffDue('2026-11-06', 7, ['weekly'])).toBeNull()
    expect(chiefOfStaffDue('2026-11-09', 7, ['weekly'])).toEqual({ runKey: 'weekly:2026-W46', kind: 'weekly' })
    expect(chiefOfStaffDue('2026-11-09', 7, [])).toBeNull()
  })

  it('shares one on-demand key per ten minutes', () => {
    expect(manualKey(new Date('2026-11-06T14:23:45Z'))).toBe('manual:2026-11-06T14:20')
    expect(manualKey(new Date('2026-11-06T14:29:59Z'))).toBe(manualKey(new Date('2026-11-06T14:20:00Z')))
    expect(manualKey(new Date('2026-11-06T14:30:00Z'))).toBe('manual:2026-11-06T14:30')
  })
})

describe('registry', () => {
  it('has the thirteen agents, with only the built ones live and the Task Manager first to run', () => {
    expect(AGENTS).toHaveLength(13)
    expect(LIVE_AGENTS.map((a) => a.id)).toEqual(['chief_of_staff', 'task_manager', 'wedding', 'language_coach', 'health_coach', 'household', 'finance', 'life_admin', 'travel', 'career', 'nutrition', 'side_projects', 'friends'])
    expect(LIVE_AGENTS.filter((a) => a.cadence).map((a) => a.id)[0]).toBe('task_manager')
  })

  it('gives every live specialist a cadence, and planned agents none', () => {
    for (const a of AGENTS) expect(Boolean(a.cadence), a.id).toBe(a.status === 'live' && a.id !== 'chief_of_staff')
  })

  it('says what every planned agent is waiting on', () => {
    for (const a of AGENTS.filter((a) => a.status === 'planned')) expect(a.blockedBy, a.id).toBeTruthy()
  })

  it('uses ids the database accepts', () => {
    for (const a of AGENTS) expect(a.id).toMatch(/^[a-z_]{2,40}$/)
  })
})
