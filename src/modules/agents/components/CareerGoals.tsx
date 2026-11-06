import { Check, Pencil, Plus, Trophy, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { longDate } from '../../../../supabase/functions/_shared/agents/lifeAdmin.ts'
import { type GoalRow, useDeleteGoal, useGoals, useSaveGoal } from '../api'

const REVIEW = [
  { days: 7, label: 'Check in weekly' },
  { days: 14, label: 'Every 2 weeks' },
  { days: 28, label: 'Every 4 weeks' },
  { days: 90, label: 'Every 3 months' },
]

type Draft = { id?: string; title: string; target_date: string; review_days: number }

/** My career goals (editable) and my partner's (read only). Reminders only go to the owner. */
export function CareerGoals() {
  const { me, member } = useHousehold()
  const goals = useGoals()
  const save = useSaveGoal()
  const remove = useDeleteGoal()
  const [form, setForm] = useState<Draft | null>(null)
  const today = todayISO()
  const onError = (e: unknown) => toast.error(getErrorMessage(e))
  const open = (goals.data ?? []).filter((g) => !g.done_at)
  const mine = open.filter((g) => g.user_id === me.id)
  const theirs = open.filter((g) => g.user_id !== me.id)

  const row = (g: GoalRow, editable: boolean) => (
    <li key={g.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="min-w-0 flex-1 truncate">
        {g.title}
        {editable ? null : <span className="text-muted-foreground"> · {member(g.user_id)?.display_name ?? 'Someone'}</span>}
      </span>
      {g.target_date ? (
        <span className={g.target_date < today ? 'font-medium text-warning' : 'text-muted-foreground'}>{longDate(g.target_date)}</span>
      ) : null}
      {editable ? (
        <>
          <Button size="sm" variant="outline" className="h-7" disabled={save.isPending || g.last_reviewed_on === today}
            onClick={() => save.mutate({ id: g.id, last_reviewed_on: today }, { onSuccess: () => toast.success('Checked in'), onError })}>
            <Check /> Checked in
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={`${g.title} done`}
            onClick={() => save.mutate({ id: g.id, done_at: new Date().toISOString() }, { onSuccess: () => toast.success('Goal done'), onError })}>
            <Trophy />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${g.title}`}
            onClick={() => setForm({ id: g.id, title: g.title, target_date: g.target_date ?? '', review_days: g.review_days })}>
            <Pencil />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={`Remove ${g.title}`} onClick={() => remove.mutate(g.id, { onError })}>
            <X />
          </Button>
        </>
      ) : null}
    </li>
  )

  return (
    <div className="grid gap-2 rounded-xl border p-3">
      <h4 className="text-sm font-semibold">Career goals</h4>
      {mine.length ? <ul className="grid gap-1.5">{mine.map((g) => row(g, true))}</ul> : goals.isPending ? null : (
        <p className="text-sm text-muted-foreground">None yet: a qualification, a promotion, a skill, a move.</p>
      )}

      {form ? (
        <form
          className="grid gap-2 border-t pt-2"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate(
              { id: form.id, title: form.title.trim(), target_date: form.target_date || null, review_days: form.review_days },
              { onSuccess: () => setForm(null), onError },
            )
          }}
        >
          <Input aria-label="Goal" placeholder="e.g. Pass the APM qualification" className="h-8" maxLength={80} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Input type="date" aria-label="Target date (optional)" className="h-8 w-auto" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} />
            <NativeSelect aria-label="Check-ins" className="h-8 w-auto" value={form.review_days} onChange={(e) => setForm({ ...form, review_days: Number(e.target.value) })}>
              {REVIEW.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
            </NativeSelect>
            <div className="ml-auto flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={save.isPending}>{form.id ? 'Save' : 'Add'}</Button>
            </div>
          </div>
        </form>
      ) : (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setForm({ title: '', target_date: '', review_days: 14 })}>
            <Plus /> Goal
          </Button>
        </div>
      )}

      {theirs.length ? <ul className="grid gap-1.5 border-t pt-2">{theirs.map((g) => row(g, false))}</ul> : null}
      <p className="text-xs text-muted-foreground">Reminders about a goal only go to its owner. Your partner can see your goals but not change them.</p>
    </div>
  )
}
