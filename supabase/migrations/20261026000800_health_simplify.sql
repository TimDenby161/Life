-- =============================================================================
-- Health, cut down to what's used: weight, exercise and a period tracker.
--
-- * Weight is the only metric. Other built-in metrics, custom metrics and
--   their readings are deleted; clients can no longer define metrics.
-- * Health notes are dropped.
-- * An exercise session is a free-text description, when, and how long.
-- * health_periods: one row per period (start, optional end). Category
--   'cycle', private unless shared, owner-only writes like everything else.
--   Whether the tracker shows is a per-user setting
--   (user_preferences.settings.track_periods), not a schema fact.
-- =============================================================================

delete from public.health_metric_definitions where owner_id is not null or key <> 'weight';

drop policy "health_metric_definitions: owner writes" on public.health_metric_definitions;
drop policy "health_metric_definitions: owner updates" on public.health_metric_definitions;
drop policy "health_metric_definitions: owner deletes" on public.health_metric_definitions;
revoke insert, update, delete on public.health_metric_definitions from authenticated;

alter publication supabase_realtime drop table public.health_notes;
drop table public.health_notes;

alter table public.health_exercise_sessions rename column activity_type to description;
alter table public.health_exercise_sessions
  drop constraint health_exercise_sessions_activity_type_check,
  add constraint health_exercise_sessions_description_check check (char_length(trim(description)) between 1 and 500),
  drop column distance_m,
  drop column energy_kcal,
  drop column avg_heart_rate,
  drop column notes;

revoke insert, update on public.health_exercise_sessions from authenticated;
grant insert (id, household_id, description, started_at, duration_minutes, visibility, source, external_id)
  on public.health_exercise_sessions to authenticated;
grant update (description, started_at, duration_minutes, visibility) on public.health_exercise_sessions to authenticated;

delete from public.health_category_visibility where category not in ('body', 'exercise');
alter table public.health_category_visibility
  drop constraint health_category_visibility_category_check,
  add constraint health_category_visibility_category_check check (category in ('body', 'exercise', 'cycle'));

create table public.health_periods (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  started_on date not null,
  ended_on date check (ended_on >= started_on),
  notes text check (char_length(notes) <= 1000),
  visibility text not null default 'inherit' check (visibility in ('inherit', 'private', 'shared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  unique (user_id, started_on)
);

create trigger health_periods_updated_at before update on public.health_periods
  for each row execute function public.set_updated_at();

alter table public.health_periods enable row level security;

create policy "health_periods: visible read" on public.health_periods
  for select to authenticated
  using (public.health_is_visible(user_id, household_id, 'cycle', visibility));
create policy "health_periods: owner insert" on public.health_periods
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));
create policy "health_periods: owner update" on public.health_periods
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "health_periods: owner delete" on public.health_periods
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, delete on public.health_periods to authenticated;
grant insert (id, household_id, started_on, ended_on, notes, visibility) on public.health_periods to authenticated;
grant update (started_on, ended_on, notes, visibility) on public.health_periods to authenticated;

alter publication supabase_realtime add table public.health_periods;
