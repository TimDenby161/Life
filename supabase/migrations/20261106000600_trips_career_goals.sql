-- =============================================================================
-- Trips (Travel agent) and career goals (Career agent).
--
--   trips         household-shared like renewals; a personal trip names its
--                 owner, and only they get its reminders. What's sorted is one
--                 status per item: todo / done / not_needed. No bookings,
--                 references or prices are stored.
--   career_goals  one person's goals with check-ins. Both of you can read them
--                 (the household shares by design); only the owner writes.
-- =============================================================================

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  -- Null = both of you.
  owner_id uuid,
  starts_on date not null,
  ends_on date not null,
  abroad boolean not null default true,
  transport text not null default 'todo' check (transport in ('todo', 'done', 'not_needed')),
  stay text not null default 'todo' check (stay in ('todo', 'done', 'not_needed')),
  insurance text not null default 'todo' check (insurance in ('todo', 'done', 'not_needed')),
  time_off text not null default 'todo' check (time_off in ('todo', 'done', 'not_needed')),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id) on delete cascade,
  check (ends_on >= starts_on)
);

create index trips_household_idx on public.trips (household_id, starts_on);

create trigger trips_updated_at before update on public.trips
  for each row execute function public.set_updated_at();

create table public.career_goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  title text not null check (char_length(trim(title)) between 1 and 80),
  target_date date,
  review_days smallint not null default 14 check (review_days between 7 and 90),
  last_reviewed_on date,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);

create index career_goals_household_idx on public.career_goals (household_id);

create trigger career_goals_updated_at before update on public.career_goals
  for each row execute function public.set_updated_at();

alter table public.trips enable row level security;
alter table public.career_goals enable row level security;

create policy "trips: members all" on public.trips
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy "career_goals: household read" on public.career_goals
  for select to authenticated using (public.is_household_member(household_id));
create policy "career_goals: owner insert" on public.career_goals
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));
create policy "career_goals: owner update" on public.career_goals
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "career_goals: owner delete" on public.career_goals
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, delete on public.trips to authenticated;
grant insert (household_id, name, owner_id, starts_on, ends_on, abroad, transport, stay, insurance, time_off) on public.trips to authenticated;
grant update (name, owner_id, starts_on, ends_on, abroad, transport, stay, insurance, time_off) on public.trips to authenticated;

grant select, delete on public.career_goals to authenticated;
grant insert (household_id, title, target_date, review_days, last_reviewed_on) on public.career_goals to authenticated;
grant update (title, target_date, review_days, last_reviewed_on, done_at) on public.career_goals to authenticated;

alter publication supabase_realtime add table public.trips;
alter publication supabase_realtime add table public.career_goals;
