-- =============================================================================
-- Table tennis (/table-tennis): playing, coaching and coaching work.
--
--   tt_profile         a person's TT Leagues player id (the same id in every
--                      league on TT Leagues) and their monthly "Update national
--                      ranking" task.
--   tt_rankings        national ranking typed in each month (TT England has no
--                      open feed); the history shows how it has moved.
--   tt_players         players a person coaches, by TT Leagues id, so their
--                      league results follow automatically.
--   tt_player_notes    the coach's notes on a player.
--   tt_employers       who pays for coaching, each with an hourly rate.
--   tt_sessions        coaching sessions: date, start and end, the rate at the
--                      time (copied from the employer, not client-writable)
--                      and the amount from them; paid_on is null while owed.
--   tt_snapshots       a player's league record as it stood each day it was
--                      fetched (played, won, lost), to show development over
--                      the season. Written only by the table-tennis function
--                      (service role) through tt_save_snapshots.
--
-- Everything is owned by one person: both members read it, the owner writes it.
-- =============================================================================

create table public.tt_profile (
  user_id uuid primary key default auth.uid(),
  household_id uuid not null,
  tt_user_id uuid,
  tt_name text check (tt_name is null or char_length(tt_name) <= 120),
  ranking_task_id uuid,
  updated_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  foreign key (ranking_task_id, household_id) references public.tasks (id, household_id) on delete set null (ranking_task_id)
);

create trigger tt_profile_updated_at before update on public.tt_profile
  for each row execute function public.set_updated_at();

create table public.tt_rankings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  user_id uuid not null default auth.uid(),
  on_date date not null,
  ranking integer not null check (ranking between 1 and 100000),
  rating integer check (rating is null or rating between 0 and 10000),
  created_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  unique (user_id, on_date)
);

create table public.tt_players (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  user_id uuid not null default auth.uid(),
  tt_user_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  unique (user_id, tt_user_id),
  unique (id, household_id)
);

create table public.tt_player_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  user_id uuid not null default auth.uid(),
  player_id uuid not null,
  note text not null check (char_length(trim(note)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  foreign key (player_id, household_id) references public.tt_players (id, household_id) on delete cascade
);

create index tt_player_notes_player_idx on public.tt_player_notes (player_id, created_at desc);

create table public.tt_employers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  user_id uuid not null default auth.uid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  rate_minor bigint not null check (rate_minor between 0 and 100000),
  created_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  unique (id, household_id)
);

create table public.tt_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  user_id uuid not null default auth.uid(),
  employer_id uuid not null,
  day date not null,
  start_time time not null,
  end_time time not null check (end_time > start_time),
  rate_minor bigint not null default 0,
  amount_minor bigint generated always as (round(rate_minor * extract(epoch from (end_time - start_time)) / 3600)::bigint) stored,
  paid_on date,
  created_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  foreign key (employer_id, household_id) references public.tt_employers (id, household_id) on delete cascade
);

create index tt_sessions_user_day_idx on public.tt_sessions (user_id, day desc);

-- A session is paid at its employer's rate when it is logged; later rate changes leave it alone.
create or replace function public.tt_session_rate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select rate_minor into new.rate_minor from public.tt_employers where id = new.employer_id;
  return new;
end;
$$;

create trigger tt_session_rate before insert or update of employer_id on public.tt_sessions
  for each row execute function public.tt_session_rate();

create table public.tt_snapshots (
  household_id uuid not null references public.households (id) on delete cascade,
  tt_user_id uuid not null,
  league text not null check (league ~ '^[a-z_]{2,20}$'),
  day date not null,
  division text not null check (char_length(division) <= 120),
  team text not null check (char_length(team) <= 120),
  played integer not null check (played >= 0),
  won integer not null check (won >= 0),
  lost integer not null check (lost >= 0),
  primary key (household_id, tt_user_id, league, day)
);

-- RLS: household reads, owner writes ------------------------------------------------------
alter table public.tt_profile enable row level security;
alter table public.tt_rankings enable row level security;
alter table public.tt_players enable row level security;
alter table public.tt_player_notes enable row level security;
alter table public.tt_employers enable row level security;
alter table public.tt_sessions enable row level security;
alter table public.tt_snapshots enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['tt_profile', 'tt_rankings', 'tt_players', 'tt_player_notes', 'tt_employers', 'tt_sessions'] loop
    execute format('create policy "%1$s: household read" on public.%1$I for select to authenticated using (public.is_household_member(household_id))', t);
    execute format('create policy "%1$s: owner insert" on public.%1$I for insert to authenticated with check (user_id = (select auth.uid()) and public.is_household_member(household_id))', t);
    execute format('create policy "%1$s: owner update" on public.%1$I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s: owner delete" on public.%1$I for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

create policy "tt_snapshots: household read" on public.tt_snapshots
  for select to authenticated using (public.is_household_member(household_id));

grant select, delete on public.tt_profile to authenticated;
grant insert (household_id, tt_user_id, tt_name, ranking_task_id) on public.tt_profile to authenticated;
grant update (tt_user_id, tt_name, ranking_task_id) on public.tt_profile to authenticated;

grant select, delete on public.tt_rankings to authenticated;
grant insert (household_id, on_date, ranking, rating) on public.tt_rankings to authenticated;
grant update (on_date, ranking, rating) on public.tt_rankings to authenticated;

grant select, delete on public.tt_players to authenticated;
grant insert (household_id, tt_user_id, name) on public.tt_players to authenticated;
grant update (name) on public.tt_players to authenticated;

grant select, delete on public.tt_player_notes to authenticated;
grant insert (household_id, player_id, note) on public.tt_player_notes to authenticated;

grant select, delete on public.tt_employers to authenticated;
grant insert (household_id, name, rate_minor) on public.tt_employers to authenticated;
grant update (name, rate_minor) on public.tt_employers to authenticated;

-- rate_minor and amount_minor come from the employer, never the client.
grant select, delete on public.tt_sessions to authenticated;
grant insert (household_id, employer_id, day, start_time, end_time, paid_on) on public.tt_sessions to authenticated;
grant update (employer_id, day, start_time, end_time, paid_on) on public.tt_sessions to authenticated;

grant select on public.tt_snapshots to authenticated;

-- Called by the table-tennis function (service role) once it has checked the
-- caller belongs to the household: today's record for each player and league,
-- [{"tt_user_id","league","division","team","played","won","lost"}].
create or replace function public.tt_save_snapshots(p_household_id uuid, p_day date, p_rows jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.tt_snapshots (household_id, tt_user_id, league, day, division, team, played, won, lost)
  select p_household_id, (r ->> 'tt_user_id')::uuid, r ->> 'league', p_day, left(r ->> 'division', 120), left(r ->> 'team', 120),
         (r ->> 'played')::integer, (r ->> 'won')::integer, (r ->> 'lost')::integer
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
  on conflict (household_id, tt_user_id, league, day) do update
    set division = excluded.division, team = excluded.team, played = excluded.played, won = excluded.won, lost = excluded.lost;
$$;

revoke execute on function public.tt_save_snapshots(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.tt_save_snapshots(uuid, date, jsonb) to service_role;

alter publication supabase_realtime add table public.tt_profile;
alter publication supabase_realtime add table public.tt_rankings;
alter publication supabase_realtime add table public.tt_players;
alter publication supabase_realtime add table public.tt_player_notes;
alter publication supabase_realtime add table public.tt_employers;
alter publication supabase_realtime add table public.tt_sessions;
alter publication supabase_realtime add table public.tt_snapshots;
