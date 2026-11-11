-- =============================================================================
-- Coaching sessions are logged by hours (1-5 buttons), not start and end
-- times. Sessions already logged get their hours from their times (kept), and
-- the amount is now the rate times the hours.
-- =============================================================================

alter table public.tt_sessions add column hours numeric(4, 2);
update public.tt_sessions set hours = round((extract(epoch from (end_time - start_time)) / 3600)::numeric, 2);
alter table public.tt_sessions
  alter column hours set not null,
  add constraint tt_sessions_hours_check check (hours > 0 and hours <= 12),
  alter column start_time drop not null,
  alter column end_time drop not null,
  drop constraint tt_sessions_check,
  add constraint tt_sessions_times_check check (start_time is null or end_time is null or end_time > start_time);

alter table public.tt_sessions drop column amount_minor;
alter table public.tt_sessions add column amount_minor bigint generated always as (round(rate_minor * hours)::bigint) stored;

grant insert (hours), update (hours) on public.tt_sessions to authenticated;
