-- =============================================================================
-- Health has no privacy settings: everything is visible to both members of
-- the household. Only the owner can write their own records (unchanged).
--
-- Drops the per-record `visibility` columns, the per-category sharing table
-- and public.health_is_visible; read policies become plain household checks.
-- =============================================================================

drop policy "health_metric_definitions: read" on public.health_metric_definitions;
drop policy "health_measurements: visible read" on public.health_measurements;
drop policy "health_exercise_sessions: visible read" on public.health_exercise_sessions;
drop policy "health_periods: visible read" on public.health_periods;

alter table public.health_measurements drop column visibility;
alter table public.health_exercise_sessions drop column visibility;
alter table public.health_periods drop column visibility;

alter publication supabase_realtime drop table public.health_category_visibility;
drop table public.health_category_visibility;
drop function public.health_is_visible(uuid, uuid, text, text);

create policy "health_metric_definitions: read" on public.health_metric_definitions
  for select to authenticated
  using (owner_id is null or public.is_household_member(household_id));
create policy "health_measurements: household read" on public.health_measurements
  for select to authenticated using (public.is_household_member(household_id));
create policy "health_exercise_sessions: household read" on public.health_exercise_sessions
  for select to authenticated using (public.is_household_member(household_id));
create policy "health_periods: household read" on public.health_periods
  for select to authenticated using (public.is_household_member(household_id));
