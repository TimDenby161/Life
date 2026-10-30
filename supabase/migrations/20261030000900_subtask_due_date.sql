-- =============================================================================
-- A subtask can have its own date, so each one gets its own score. Without one
-- it goes by the parent task's date.
-- =============================================================================

alter table public.task_subtasks add column due_date date;

grant insert (due_date), update (due_date) on public.task_subtasks to authenticated;
