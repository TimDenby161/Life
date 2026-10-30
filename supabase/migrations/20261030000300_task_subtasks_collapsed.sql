-- =============================================================================
-- Whether a task's subtasks start minimised on its row. Saved on the task so
-- it holds across reloads and for both of us.
-- =============================================================================

alter table public.tasks
  add column subtasks_collapsed boolean not null default false;

grant update (subtasks_collapsed) on public.tasks to authenticated;
