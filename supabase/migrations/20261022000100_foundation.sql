-- =============================================================================
-- Foundation: profiles, households, membership, preferences, activity log.
--
-- Security model (see docs/DATABASE.md):
--   * Every row carrying household or personal data has a household_id.
--   * RLS policies call is_household_member(household_id); the helper is
--     SECURITY DEFINER so policies never recurse through household_members.
--   * Child tables use composite foreign keys (parent_id, household_id) so a
--     row can never point at a parent in a different household, even if a
--     client forges UUIDs.
--   * anon gets nothing. Writes that must be trustworthy (completion history,
--     activity events) only happen inside SECURITY DEFINER functions.
-- =============================================================================

-- Supabase grants ALL on new public tables to anon/authenticated by default.
-- We grant explicitly per table instead.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles: one row per auth user, created by trigger.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_color text not null default 'indigo'
    check (avatar_color in ('indigo', 'rose', 'emerald', 'amber', 'sky', 'violet', 'teal', 'orange')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- households + membership. Clients cannot create households or add members;
-- that is an admin operation (see bootstrap_household in a later migration).
-- -----------------------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  default_currency char(3) not null default 'GBP' check (default_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'Europe/London',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger households_updated_at before update on public.households
  for each row execute function public.set_updated_at();

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- A user belongs to at most one household. This keeps current_household_id()
-- unambiguous; relax it (and add a household switcher) if ever needed.
create unique index household_members_one_household_per_user on public.household_members (user_id);

-- -----------------------------------------------------------------------------
-- Membership helpers used by every RLS policy.
-- -----------------------------------------------------------------------------
create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = p_household_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.household_id
  from public.household_members m
  where m.user_id = (select auth.uid())
  limit 1;
$$;

-- True when p_user_id is in the caller's household (including the caller).
create or replace function public.shares_household_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members mine
    join public.household_members theirs on theirs.household_id = mine.household_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.current_household_id() to authenticated;
grant execute on function public.shares_household_with(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- user_preferences: strictly per-user.
-- -----------------------------------------------------------------------------
create table public.user_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  week_starts_on smallint not null default 1 check (week_starts_on in (0, 1)),
  default_task_list_id uuid,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now()
);

create trigger user_preferences_updated_at before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- New auth user -> profile + preferences.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      initcap(split_part(new.email, '@', 1)),
      'Member'
    )
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- feed_events: automatic household activity. Written only by trusted
-- triggers/functions via log_feed_event(); clients can only read.
-- Never put health data or monetary amounts in here.
-- -----------------------------------------------------------------------------
create table public.feed_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  event_type text not null check (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type text,
  entity_id uuid,
  summary text not null check (char_length(summary) <= 300),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index feed_events_household_created_idx on public.feed_events (household_id, created_at desc);

create or replace function public.log_feed_event(
  p_household_id uuid,
  p_actor_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_summary text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.feed_events (household_id, actor_id, event_type, entity_type, entity_id, summary, metadata)
  values (p_household_id, p_actor_id, p_event_type, p_entity_type, p_entity_id, left(p_summary, 300), coalesce(p_metadata, '{}'::jsonb));
$$;
-- Not granted to clients: only callable from other definer functions/triggers.

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.user_preferences enable row level security;
alter table public.feed_events enable row level security;

create policy "profiles: read self and household" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_household_with(id));
create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "households: members read" on public.households
  for select to authenticated using (public.is_household_member(id));
create policy "households: members update" on public.households
  for update to authenticated
  using (public.is_household_member(id)) with check (public.is_household_member(id));

create policy "household_members: members read" on public.household_members
  for select to authenticated using (public.is_household_member(household_id));

create policy "user_preferences: own" on public.user_preferences
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "feed_events: members read" on public.feed_events
  for select to authenticated using (public.is_household_member(household_id));

grant select on public.profiles to authenticated;
grant update (display_name, avatar_color) on public.profiles to authenticated;
grant select on public.households to authenticated;
grant update (name, default_currency, timezone) on public.households to authenticated;
grant select on public.household_members to authenticated;
grant select, insert, update on public.user_preferences to authenticated;
grant select on public.feed_events to authenticated;
