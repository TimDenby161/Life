-- =============================================================================
-- Tasks with subtasks start minimised: the count on the row opens them, and
-- that choice is still saved per task.
-- =============================================================================

alter table public.tasks alter column subtasks_collapsed set default true;

update public.tasks set subtasks_collapsed = true where not subtasks_collapsed;
