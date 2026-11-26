import { agentHealth } from './agentHealth'

const run = (agent_id: string, status: string, created_at: string, trigger = 'scheduled') => ({ agent_id, trigger, status, created_at })
const at = (iso: string) => new Date(iso)

describe('agentHealth', () => {
  const ok = [run('finance', 'succeeded', '2026-11-26T06:05:00Z'), run('travel', 'succeeded', '2026-11-26T06:06:00Z')]

  it('says nothing before the morning runs have had two ticks', () => {
    expect(agentHealth([], at('2026-11-26T07:59:00Z'))).toBeNull()
  })

  it('says nothing when the morning runs succeeded', () => {
    expect(agentHealth(ok, at('2026-11-26T09:00:00Z'))).toBeNull()
  })

  it('notices when nothing has run this morning', () => {
    // yesterday's runs don't count, nor do manual or event ones
    const old = [run('finance', 'succeeded', '2026-11-25T06:05:00Z'), run('finance', 'succeeded', '2026-11-26T07:00:00Z', 'manual')]
    expect(agentHealth(old, at('2026-11-26T08:30:00Z'))).toEqual({ missing: true, failed: [] })
  })

  it('names the agents whose last run today failed', () => {
    const runs = [...ok, run('wedding', 'failed', '2026-11-26T06:07:00Z'), run('sleep', 'failed', '2026-11-26T06:08:00Z')]
    expect(agentHealth(runs, at('2026-11-26T09:00:00Z'))).toEqual({ missing: false, failed: ['sleep', 'wedding'] })
  })

  it('forgets a failure that a later run put right', () => {
    const runs = [...ok, run('wedding', 'failed', '2026-11-26T06:07:00Z'), run('wedding', 'succeeded', '2026-11-26T07:07:00Z')]
    expect(agentHealth(runs, at('2026-11-26T09:00:00Z'))).toBeNull()
  })
})
