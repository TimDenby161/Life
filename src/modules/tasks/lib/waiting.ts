type Open = { task_id: string; task: { title: string; recurrence?: unknown; waiting_on_task_id?: string | null } }

/** The task this one is held up by, while that's still open. Once it's done, this one is free. */
export function waitingOnTitle(task: { waiting_on_task_id?: string | null }, open: Open[]) {
  if (!task.waiting_on_task_id) return null
  return open.find((o) => o.task_id === task.waiting_on_task_id)?.task.title ?? null
}

/** What a task can wait on: one-off tasks, as a repeating one is never finished, and not one waiting on it. */
export function waitingChoices(taskId: string, open: Open[]) {
  return open
    .filter((o) => o.task_id !== taskId && !o.task.recurrence && o.task.waiting_on_task_id !== taskId)
    .toSorted((a, b) => a.task.title.localeCompare(b.task.title))
}
