-- =============================================================================
-- A task that can't be started until another is done. The app keeps it off Home
-- and Top jobs and stops it being ticked off while the other task is still open.
-- Deleting the other task clears the link.
-- =============================================================================

alter table public.tasks
  add column waiting_on_task_id uuid,
  add constraint tasks_waiting_on_fkey foreign key (waiting_on_task_id, household_id)
    references public.tasks (id, household_id) on delete set null (waiting_on_task_id),
  add constraint tasks_not_waiting_on_itself check (waiting_on_task_id <> id);

create index tasks_waiting_on_idx on public.tasks (waiting_on_task_id);

grant update (waiting_on_task_id) on public.tasks to authenticated;
