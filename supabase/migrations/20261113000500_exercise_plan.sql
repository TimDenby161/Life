-- =============================================================================
-- Exercise week plan (Coach page): which exercise each of you, or both of you
-- together, is doing on each day.
--
--   exercise_plan  one cell of the Mon–Sun table. owner_id null = Together.
--                  activity null = a rest day (kept so the coach never refills
--                  a day you cleared). by_coach marks the coach's draft; any
--                  edit by hand clears it.
--
-- The coach's draft is worked out in the app from each person's weekly fitness
-- goals (exercise_goals below) and only fills a person's week when it has no
-- rows yet, so edits are never overwritten. Exercise is the one health area
-- either of you can log for the other, so both of you can edit every cell.
-- =============================================================================

create table public.exercise_plan (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  day date not null,
  -- Null = Together.
  owner_id uuid,
  activity text check (activity is null or char_length(trim(activity)) between 1 and 60),
  by_coach boolean not null default false,
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id) on delete cascade
);

-- One cell per person (or Together) per day.
create unique index exercise_plan_cell_idx on public.exercise_plan
  (household_id, day, coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid));

create function public.exercise_plan_touch() returns trigger language plpgsql as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  -- A change by hand is no longer the coach's.
  if tg_op = 'UPDATE' then new.by_coach := false; end if;
  return new;
end $$;

create trigger exercise_plan_touch before insert or update on public.exercise_plan
  for each row execute function public.exercise_plan_touch();

alter table public.exercise_plan enable row level security;

create policy "exercise_plan: members all" on public.exercise_plan
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select, delete on public.exercise_plan to authenticated;
grant insert (household_id, day, owner_id, activity, by_coach) on public.exercise_plan to authenticated;
grant update (activity) on public.exercise_plan to authenticated;

alter publication supabase_realtime add table public.exercise_plan;

-- Each member's weekly activity goals (name, times, optional, at most), from
-- their Fitness Coach settings, so the coach can draft both columns. Only the
-- activities: never events or anything else in the settings.
create function public.exercise_goals()
returns table (user_id uuid, activities jsonb)
language sql stable security definer set search_path = public as $$
  select s.user_id, coalesce(s.config -> 'activities', '[]'::jsonb)
  from public.agent_settings s
  where s.agent_id = 'health_coach'
    and s.household_id in (select m.household_id from public.household_members m where m.user_id = auth.uid())
    and jsonb_typeof(s.config -> 'activities') = 'array'
$$;

revoke all on function public.exercise_goals() from public, anon;
grant execute on function public.exercise_goals() to authenticated;
