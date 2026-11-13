import { Plus, Target, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, NativeSelect, Textarea } from '@/components/ui/input'
import { getErrorMessage } from '@/lib/errors'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { AREAS } from '../../../supabase/functions/_shared/agents/ideas.ts'
import { type GoalFields, type GoalRow, useDeleteGoal, useGoals, useSaveGoal } from './api'

const onError = (e: unknown) => toast.error(getErrorMessage(e))

/**
 * What each of you, and the two of you together, is aiming for in each area of
 * life. Each morning Claude decides that day's tasks for each area from these.
 */
export default function GoalsPage() {
  const goals = useGoals()
  const { me, partner } = useHousehold()
  const [editing, setEditing] = useState<(Partial<GoalRow> & Pick<GoalRow, 'area'>) | null>(null)
  const name = (owner: string | null) => (owner === null ? 'Together' : owner === me.id ? me.display_name : owner === partner?.id ? partner.display_name : '')
  // Mine first, then my partner's, then Together's.
  const rank = (owner: string | null) => (owner === me.id ? 0 : owner === null ? 2 : 1)

  return (
    <>
      <PageHeader title="Goals" description="Each morning Claude works out the day’s tasks in each area from these. Tap one to change it." />
      {goals.error ? (
        <ErrorState error={goals.error} onRetry={() => goals.refetch()} />
      ) : goals.isPending ? (
        <ListSkeleton rows={6} />
      ) : (
        AREAS.map((area) => {
          const rows = goals.data.filter((g) => g.area === area.key).sort((a, b) => rank(a.owner_id) - rank(b.owner_id) || a.sort_order - b.sort_order)
          return (
            <section key={area.key}>
              <SectionTitle
                action={
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ area: area.key, owner_id: me.id })} aria-label={`Add a ${area.label} goal`}>
                    <Plus /> Add
                  </Button>
                }
              >
                {area.label}
              </SectionTitle>
              <Card className="p-1.5">
                {rows.length ? (
                  <ul className="divide-y">
                    {rows.map((g) => (
                      <li key={g.id}>
                        <button type="button" onClick={() => setEditing(g)} className="flex w-full items-start gap-3 px-2.5 py-3 text-left text-sm">
                          <span className="w-16 shrink-0 pt-px text-xs font-medium text-muted-foreground">{name(g.owner_id)}</span>
                          <span className="min-w-0 flex-1 break-words">{g.goal}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="flex items-center gap-2 px-2.5 py-3 text-sm text-muted-foreground">
                    <Target className="size-4" /> No goals yet
                  </p>
                )}
              </Card>
            </section>
          )
        })
      )}
      {editing ? <GoalDialog goal={editing} count={(goals.data ?? []).filter((g) => g.area === editing.area).length} onClose={() => setEditing(null)} /> : null}
    </>
  )
}

function GoalDialog({ goal, count, onClose }: { goal: Partial<GoalRow> & Pick<GoalRow, 'area'>; count: number; onClose: () => void }) {
  const { me, partner } = useHousehold()
  const save = useSaveGoal()
  const del = useDeleteGoal()
  const [form, setForm] = useState<GoalFields>({ owner_id: goal.owner_id ?? null, area: goal.area, goal: goal.goal ?? '' })
  const label = AREAS.find((a) => a.key === goal.area)?.label ?? ''

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title={goal.id ? `${label} goal` : `New ${label.toLowerCase()} goal`}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate({ id: goal.id, ...form, goal: form.goal.trim(), sort_order: goal.id ? undefined : count + 1 }, { onSuccess: onClose, onError })
          }}
        >
          <Field label="Goal" htmlFor="goal-text">
            <Textarea id="goal-text" autoFocus={!goal.id} required rows={2} maxLength={200} value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Whose" htmlFor="goal-owner">
              <NativeSelect id="goal-owner" value={form.owner_id ?? ''} onChange={(e) => setForm({ ...form, owner_id: e.target.value || null })}>
                <option value={me.id}>{me.display_name}</option>
                {partner ? <option value={partner.id}>{partner.display_name}</option> : null}
                <option value="">Together</option>
              </NativeSelect>
            </Field>
            <Field label="Area" htmlFor="goal-area">
              <NativeSelect id="goal-area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>
                {AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <DialogFooter>
            {goal.id ? (
              <Button variant="ghost" type="button" className="text-destructive sm:mr-auto" disabled={del.isPending} onClick={() => del.mutate(goal.id!, { onSuccess: onClose, onError })}>
                <Trash2 /> Remove
              </Button>
            ) : null}
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending || !form.goal.trim()}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
