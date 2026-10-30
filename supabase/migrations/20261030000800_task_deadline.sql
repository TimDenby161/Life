-- =============================================================================
-- A hard deadline, separate from the due date: delaying a task moves its due
-- date, never this. The score climbs towards 200 in the last week before it.
-- =============================================================================

alter table public.tasks add column deadline date;

grant insert (deadline), update (deadline) on public.tasks to authenticated;
