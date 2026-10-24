-- =============================================================================
-- Health. Personal data with per-record and per-category visibility.
--
-- Effective visibility of a record owned by U, as seen by partner P (same
-- household):
--   record.visibility = 'shared'   -> visible
--   record.visibility = 'private'  -> hidden
--   record.visibility = 'inherit'  -> health_category_visibility(U, category)
--                                     .shared, defaulting to hidden.
-- The owner always sees their own records. Only the owner can write them.
-- No diagnoses or recommendations are derived from this data anywhere.
-- =============================================================================

create table public.health_metric_definitions (
  id uuid primary key default gen_random_uuid(),
  -- null owner = built-in metric available to everyone.
  owner_id uuid references public.profiles (id) on delete cascade,
  household_id uuid references public.households (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  name text not null check (char_length(trim(name)) between 1 and 60),
  unit text not null check (char_length(unit) <= 20),
  category text not null check (category in ('body', 'heart', 'fitness', 'activity', 'sleep', 'measurements', 'custom')),
  decimals smallint not null default 1 check (decimals between 0 and 3),
  aggregation text not null default 'latest' check (aggregation in ('latest', 'sum', 'average')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  check ((owner_id is null) = (household_id is null))
);

create unique index health_metric_definitions_system_key on public.health_metric_definitions (key) where owner_id is null;
create unique index health_metric_definitions_owner_key on public.health_metric_definitions (owner_id, key) where owner_id is not null;

insert into public.health_metric_definitions (key, name, unit, category, decimals, aggregation, sort_order) values
  ('weight',         'Weight',             'kg',        'body',         1, 'latest',  10),
  ('height',         'Height',             'cm',        'body',         0, 'latest',  20),
  ('body_fat',       'Body fat',           '%',         'body',         1, 'latest',  30),
  ('resting_hr',     'Resting heart rate', 'bpm',       'heart',        0, 'average', 40),
  ('hrv',            'HRV',                'ms',        'heart',        0, 'average', 50),
  ('vo2_max',        'VO₂ max',            'ml/kg/min', 'fitness',      1, 'latest',  60),
  ('steps',          'Steps',              'steps',     'activity',     0, 'sum',     70),
  ('sleep_duration', 'Sleep',              'hours',     'sleep',        1, 'average', 80),
  ('waist',          'Waist',              'cm',        'measurements', 1, 'latest',  90),
  ('chest',          'Chest',              'cm',        'measurements', 1, 'latest',  91),
  ('hips',           'Hips',               'cm',        'measurements', 1, 'latest',  92);

create table public.health_category_visibility (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  category text not null check (category in
    ('body', 'heart', 'fitness', 'activity', 'sleep', 'measurements', 'custom', 'exercise', 'notes')),
  shared boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, category),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);

create trigger health_category_visibility_updated_at before update on public.health_category_visibility
  for each row execute function public.set_updated_at();

create or replace function public.health_is_visible(p_owner uuid, p_household_id uuid, p_category text, p_visibility text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_owner = (select auth.uid())
    or (
      public.is_household_member(p_household_id)
      and public.shares_household_with(p_owner)
      and case p_visibility
            when 'shared' then true
            when 'private' then false
            else coalesce((select v.shared from public.health_category_visibility v
                           where v.user_id = p_owner and v.category = p_category), false)
          end
    );
$$;

grant execute on function public.health_is_visible(uuid, uuid, text, text) to authenticated;

create table public.health_measurements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  metric_id uuid not null references public.health_metric_definitions (id) on delete cascade,
  -- Denormalised from the metric (kept in sync by trigger) so RLS is cheap.
  category text not null default 'custom',
  measured_at timestamptz not null default now(),
  value numeric(14, 3) not null,
  unit text not null default '',
  notes text check (char_length(notes) <= 1000),
  visibility text not null default 'inherit' check (visibility in ('inherit', 'private', 'shared')),
  source text not null default 'manual' check (source in ('manual', 'apple_health', 'health_connect', 'wearable', 'import')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  unique (user_id, source, external_id)
);

create index health_measurements_user_metric_time_idx on public.health_measurements (user_id, metric_id, measured_at desc);
create index health_measurements_household_time_idx on public.health_measurements (household_id, measured_at desc);

create trigger health_measurements_updated_at before update on public.health_measurements
  for each row execute function public.set_updated_at();

create or replace function public.health_measurements_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def public.health_metric_definitions;
begin
  select * into v_def from public.health_metric_definitions where id = new.metric_id;
  if not found or (v_def.owner_id is not null and v_def.owner_id <> new.user_id) then
    raise exception 'Unknown metric' using errcode = '23503';
  end if;
  new.category := v_def.category;
  if coalesce(new.unit, '') = '' then
    new.unit := v_def.unit;
  end if;
  return new;
end;
$$;

create trigger health_measurements_prepare before insert or update of metric_id, unit on public.health_measurements
  for each row execute function public.health_measurements_prepare();

-- Keep the denormalised category in step if a custom metric is recategorised.
create or replace function public.health_metric_definitions_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.health_measurements set category = new.category where metric_id = new.id and category <> new.category;
  return null;
end;
$$;

create trigger health_metric_definitions_sync after update of category on public.health_metric_definitions
  for each row execute function public.health_metric_definitions_sync();

create table public.health_exercise_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  activity_type text not null check (char_length(trim(activity_type)) between 1 and 40),
  started_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 1 and 1440),
  distance_m numeric(10, 1) check (distance_m >= 0),
  energy_kcal integer check (energy_kcal >= 0),
  avg_heart_rate integer check (avg_heart_rate between 20 and 250),
  notes text check (char_length(notes) <= 1000),
  visibility text not null default 'inherit' check (visibility in ('inherit', 'private', 'shared')),
  source text not null default 'manual' check (source in ('manual', 'apple_health', 'health_connect', 'wearable', 'import')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  unique (user_id, source, external_id)
);

create index health_exercise_sessions_user_time_idx on public.health_exercise_sessions (user_id, started_at desc);

create trigger health_exercise_sessions_updated_at before update on public.health_exercise_sessions
  for each row execute function public.set_updated_at();

create table public.health_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  noted_on date not null default current_date,
  title text not null check (char_length(trim(title)) between 1 and 120),
  body text check (char_length(body) <= 5000),
  visibility text not null default 'inherit' check (visibility in ('inherit', 'private', 'shared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);

create index health_notes_user_date_idx on public.health_notes (user_id, noted_on desc);

create trigger health_notes_updated_at before update on public.health_notes
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS + grants
-- -----------------------------------------------------------------------------
alter table public.health_metric_definitions enable row level security;
alter table public.health_category_visibility enable row level security;
alter table public.health_measurements enable row level security;
alter table public.health_exercise_sessions enable row level security;
alter table public.health_notes enable row level security;

-- Built-in metrics are readable by everyone signed in. A custom metric's name
-- is visible to the partner only when its category is shared or at least one
-- of its measurements is explicitly shared.
create policy "health_metric_definitions: read" on public.health_metric_definitions
  for select to authenticated
  using (
    owner_id is null
    or owner_id = (select auth.uid())
    or (
      public.is_household_member(household_id)
      and (
        public.health_is_visible(owner_id, household_id, category, 'inherit')
        or exists (select 1 from public.health_measurements m
                   where m.metric_id = health_metric_definitions.id and m.visibility = 'shared')
      )
    )
  );
create policy "health_metric_definitions: owner writes" on public.health_metric_definitions
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.is_household_member(household_id));
create policy "health_metric_definitions: owner updates" on public.health_metric_definitions
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "health_metric_definitions: owner deletes" on public.health_metric_definitions
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "health_category_visibility: household read" on public.health_category_visibility
  for select to authenticated using (public.is_household_member(household_id));
create policy "health_category_visibility: own insert" on public.health_category_visibility
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));
create policy "health_category_visibility: own update" on public.health_category_visibility
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "health_measurements: visible read" on public.health_measurements
  for select to authenticated
  using (public.health_is_visible(user_id, household_id, category, visibility));
create policy "health_measurements: owner insert" on public.health_measurements
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));
create policy "health_measurements: owner update" on public.health_measurements
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "health_measurements: owner delete" on public.health_measurements
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "health_exercise_sessions: visible read" on public.health_exercise_sessions
  for select to authenticated
  using (public.health_is_visible(user_id, household_id, 'exercise', visibility));
create policy "health_exercise_sessions: owner insert" on public.health_exercise_sessions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));
create policy "health_exercise_sessions: owner update" on public.health_exercise_sessions
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "health_exercise_sessions: owner delete" on public.health_exercise_sessions
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "health_notes: visible read" on public.health_notes
  for select to authenticated
  using (public.health_is_visible(user_id, household_id, 'notes', visibility));
create policy "health_notes: owner insert" on public.health_notes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));
create policy "health_notes: owner update" on public.health_notes
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "health_notes: owner delete" on public.health_notes
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, delete on public.health_metric_definitions to authenticated;
grant insert (id, owner_id, household_id, key, name, unit, category, decimals, aggregation, sort_order)
  on public.health_metric_definitions to authenticated;
grant update (name, unit, category, decimals, aggregation, sort_order) on public.health_metric_definitions to authenticated;
grant select on public.health_category_visibility to authenticated;
grant insert (household_id, category, shared) on public.health_category_visibility to authenticated;
grant update (shared) on public.health_category_visibility to authenticated;
grant select, delete on public.health_measurements to authenticated;
grant insert (id, household_id, metric_id, measured_at, value, unit, notes, visibility, source, external_id)
  on public.health_measurements to authenticated;
grant update (metric_id, measured_at, value, unit, notes, visibility) on public.health_measurements to authenticated;
grant select, delete on public.health_exercise_sessions to authenticated;
grant insert (id, household_id, activity_type, started_at, duration_minutes, distance_m, energy_kcal, avg_heart_rate,
              notes, visibility, source, external_id)
  on public.health_exercise_sessions to authenticated;
grant update (activity_type, started_at, duration_minutes, distance_m, energy_kcal, avg_heart_rate, notes, visibility)
  on public.health_exercise_sessions to authenticated;
grant select, delete on public.health_notes to authenticated;
grant insert (id, household_id, noted_on, title, body, visibility) on public.health_notes to authenticated;
grant update (noted_on, title, body, visibility) on public.health_notes to authenticated;
