-- =============================================================================
-- Takeaways (Weight & Food agent) and people (Friends agent).
--
--   takeaways  one row per takeaway: on your own (shared = false, counts against
--              the logger's own limit) or together (shared = true, counts against
--              the joint limit). Logged by whoever ate it; only the logger can
--              delete it. Both of you can read them, like the rest of health.
--   people     friends and family with an optional birthday (month and day, no
--              year) and how often you'd like to see them. owner_id null =
--              joint friends; both of you can read and edit every row.
-- =============================================================================

create table public.takeaways (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  eaten_on date not null default current_date,
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);

create index takeaways_household_idx on public.takeaways (household_id, eaten_on);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Null = joint friends.
  owner_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 60),
  birthday_month smallint check (birthday_month between 1 and 12),
  birthday_day smallint check (birthday_day between 1 and 31),
  see_every_weeks smallint check (see_every_weeks between 1 and 52),
  last_seen_on date,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id) on delete cascade,
  check ((birthday_month is null) = (birthday_day is null)),
  check (birthday_day <= (array[31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])[birthday_month])
);

create index people_household_idx on public.people (household_id);

create trigger people_updated_at before update on public.people
  for each row execute function public.set_updated_at();

alter table public.takeaways enable row level security;
alter table public.people enable row level security;

create policy "takeaways: household read" on public.takeaways
  for select to authenticated using (public.is_household_member(household_id));
create policy "takeaways: logger insert" on public.takeaways
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));
create policy "takeaways: logger delete" on public.takeaways
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "people: members all" on public.people
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select, delete on public.takeaways to authenticated;
grant insert (household_id, eaten_on, shared) on public.takeaways to authenticated;

grant select, delete on public.people to authenticated;
grant insert (household_id, owner_id, name, birthday_month, birthday_day, see_every_weeks, last_seen_on) on public.people to authenticated;
grant update (owner_id, name, birthday_month, birthday_day, see_every_weeks, last_seen_on) on public.people to authenticated;

alter publication supabase_realtime add table public.takeaways;
alter publication supabase_realtime add table public.people;
