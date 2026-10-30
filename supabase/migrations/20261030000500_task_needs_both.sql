-- =============================================================================
-- A task that takes both of us, as opposed to one either of us could do alone.
-- Tasks already worded that way start marked.
-- =============================================================================

alter table public.tasks
  add column needs_both boolean not null default false;

grant insert (needs_both), update (needs_both) on public.tasks to authenticated;

update public.tasks set needs_both = true
where archived_at is null and title ~* '\mtogether\M';
