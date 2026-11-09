import { Minus, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { nextGoal, parseProjectsConfig, type Project } from '../../../../supabase/functions/_shared/agents/projects.ts'
import { type AgentSetting, useSaveAgentConfig } from '../api'

type Draft = Project & { goalsText: string }

/** My side projects with their paid users, and a team to find sponsors for. */
export function SideProjects({ row }: { row: AgentSetting | undefined }) {
  const save = useSaveAgentConfig('side_projects', row)
  const saved = parseProjectsConfig(row?.config)
  const [projects, setProjects] = useState<Draft[]>(saved.projects.map((p) => ({ ...p, goalsText: p.goals.join(', ') })))
  const [team, setTeam] = useState(saved.sponsorTeam ?? '')
  const set = (i: number, patch: Partial<Draft>) => setProjects(projects.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  // Changing the count dates it, so the agent knows it's fresh.
  const setUsers = (i: number, users: number) => set(i, { users: Math.max(0, users), updated_on: todayISO() })

  return (
    <form
      className="grid gap-2 rounded-xl border p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        const config = {
          projects: projects
            .filter((p) => p.name.trim())
            .map((p) => ({ name: p.name.trim(), users: p.users, goals: p.goalsText.split(',').map((g) => Number(g.trim())).filter((g) => Number.isInteger(g) && g > 0), updated_on: p.updated_on })),
          sponsorTeam: team.trim() || null,
        }
        save.mutate(config, { onSuccess: () => toast.success('Saved'), onError: (err) => toast.error(getErrorMessage(err)) })
      }}
    >
      <h4 className="font-semibold">My projects</h4>
      <ul className="grid gap-2">
        {projects.map((p, i) => {
          const goal = nextGoal({ ...p, goals: p.goalsText.split(',').map(Number).filter((g) => g > 0).sort((a, b) => a - b) })
          return (
            <li key={i} className="grid gap-1.5 border-b pb-2 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label="Project" placeholder="e.g. CornerFC" className="h-8 min-w-28 flex-1" maxLength={40} value={p.name} onChange={(e) => set(i, { name: e.target.value })} />
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove project" onClick={() => setProjects(projects.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="icon-sm" variant="outline" aria-label="One fewer paid user" onClick={() => setUsers(i, p.users - 1)}><Minus /></Button>
                <span className="min-w-16 text-center tabular">{goal ? `${p.users}/${goal}` : p.users} paid</span>
                <Button type="button" size="icon-sm" variant="outline" aria-label="One more paid user" onClick={() => setUsers(i, p.users + 1)}><Plus /></Button>
                <Input aria-label="Goals" placeholder="Goals, e.g. 10, 20, 50" className="h-8 min-w-32 flex-1" value={p.goalsText} onChange={(e) => set(i, { goalsText: e.target.value })} />
              </div>
            </li>
          )
        })}
      </ul>
      <label className="flex flex-wrap items-center gap-2">
        Find sponsors for
        <Input aria-label="Team" placeholder="Team name (optional)" className="h-8 min-w-32 flex-1" maxLength={60} value={team} onChange={(e) => setTeam(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={projects.length >= 4} onClick={() => setProjects([...projects, { name: '', users: 0, goals: [], goalsText: '', updated_on: todayISO() }])}>
          <Plus /> Project
        </Button>
        <Button type="submit" size="sm" className="ml-auto" disabled={save.isPending}>Save</Button>
      </div>
      <p className="text-xs text-muted-foreground">The app can’t see your projects: update the paid users here and press Save.</p>
    </form>
  )
}
