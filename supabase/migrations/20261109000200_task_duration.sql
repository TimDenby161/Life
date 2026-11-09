-- =============================================================================
-- How long a task takes, in minutes, set by hand. When it's null the app and
-- the agents estimate it from the title (estimateMinutes in
-- functions/_shared/agents/taskManager.ts). Home's plan for the day and the AI
-- picks add these up to fit the free time.
-- =============================================================================

alter table public.tasks
  add column duration_minutes smallint check (duration_minutes between 1 and 720);

grant insert (duration_minutes), update (duration_minutes) on public.tasks to authenticated;
