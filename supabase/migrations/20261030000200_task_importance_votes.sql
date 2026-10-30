-- =============================================================================
-- Up and down arrows on a task: net votes that move it up or down Top jobs. It
-- lives on the task, not the occurrence, so a repeating task keeps its score.
-- =============================================================================

alter table public.tasks
  add column importance_votes integer not null default 0;

grant update (importance_votes) on public.tasks to authenticated;
