-- =============================================================================
-- How many times a task has been put off, so each delay can be longer than the
-- last. It lives on the occurrence, so a repeating task starts again at 0 each
-- time it comes round. Clients set it alongside due_date, under the same
-- "reschedule open" policy.
-- =============================================================================

alter table public.task_occurrences
  add column delay_count integer not null default 0 check (delay_count >= 0);

grant update (delay_count) on public.task_occurrences to authenticated;
