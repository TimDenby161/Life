import { modules } from '@/modules/registry'
import { agentById } from '../../../../supabase/functions/_shared/agents/registry.ts'
import { PAGE_AGENTS, pageView } from '../pageAgents'

const view = (url: string, base: string) => {
  const u = new URL(url, 'http://x')
  return pageView(u.pathname, base, u.searchParams)
}

describe('agent-driven pages', () => {
  it('open on the agent view', () => {
    expect(view('/finances', '/finances')).toBe('agent')
    expect(view('/finances/', '/finances')).toBe('agent')
    expect(view('/', '/')).toBe('agent')
  })

  it('go to Details when asked, or for a link into the page', () => {
    expect(view('/finances?view=details', '/finances')).toBe('details')
    expect(view('/languages?lang=zh&part=review', '/languages')).toBe('details')
    expect(view('/tasks/abc', '/tasks')).toBe('details')
    expect(view('/languages?lang=zh&view=agent', '/languages')).toBe('agent')
  })

  it('open Goals when asked', () => {
    expect(view('/health?view=goals', '/health')).toBe('goals')
    expect(PAGE_AGENTS.health.goals).toBe('fitness')
  })

  it('cover every page with an agent, using real agents', () => {
    const ids = new Set(modules.map((m) => m.id))
    for (const [page, scope] of Object.entries(PAGE_AGENTS)) {
      expect(ids, page).toContain(page)
      for (const a of scope.agents) expect(agentById(a)?.status, `${page}: ${a}`).toBe('live')
    }
    expect(Object.keys(PAGE_AGENTS).sort()).toEqual(['calendar', 'finances', 'health', 'home', 'jobs', 'languages', 'stats', 'tasks', 'wedding'])
  })
})
