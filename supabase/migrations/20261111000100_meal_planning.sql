-- =============================================================================
-- Planning meals: the Plan view on /meals.
--
--   meal_wishes         meals either of you wants to have soon: one you have
--                       had before or a new one. Shared; either of you can add
--                       or remove them.
--   meal_availability   whether each person is in for lunch and dinner on a
--                       day. No row = in. 'calendar' rows are written overnight
--                       by the agents function from the calendars; a person
--                       changing one makes it 'manual', and the calendar never
--                       overwrites a manual row.
--   meal_slot_notes     anything you specifically want for a lunch or dinner
--                       ("something quick", "Sophie's choice"). Shared.
-- Breakfast is left out on purpose.
-- =============================================================================

create table public.meal_wishes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create index meal_wishes_household_idx on public.meal_wishes (household_id, created_at);

create table public.meal_availability (
  -- Tied to the household through the member key below only: a second foreign
  -- key to households would make PostgREST read this as a link table between
  -- households and household_members and break their embeds.
  household_id uuid not null,
  day date not null,
  slot text not null check (slot in ('lunch', 'dinner')),
  person_id uuid not null,
  available boolean not null default true,
  source text not null default 'manual' check (source in ('calendar', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (household_id, day, slot, person_id),
  foreign key (household_id, person_id) references public.household_members (household_id, user_id) on delete cascade
);

create table public.meal_slot_notes (
  household_id uuid not null references public.households (id) on delete cascade,
  day date not null,
  slot text not null check (slot in ('lunch', 'dinner')),
  note text not null check (char_length(trim(note)) between 1 and 120),
  updated_at timestamptz not null default now(),
  primary key (household_id, day, slot)
);

-- A person's change always counts as theirs, so the overnight calendar run leaves it alone.
create or replace function public.meal_availability_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  -- A signed-in person (not the service role the agents function runs as).
  if current_user = 'authenticated' then
    new.source := 'manual';
  end if;
  return new;
end;
$$;

create trigger meal_availability_touch before insert or update on public.meal_availability
  for each row execute function public.meal_availability_touch();

create trigger meal_slot_notes_updated_at before update on public.meal_slot_notes
  for each row execute function public.set_updated_at();

alter table public.meal_wishes enable row level security;
alter table public.meal_availability enable row level security;
alter table public.meal_slot_notes enable row level security;

create policy "meal_wishes: members all" on public.meal_wishes
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy "meal_availability: members all" on public.meal_availability
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy "meal_slot_notes: members all" on public.meal_slot_notes
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select, delete on public.meal_wishes to authenticated;
grant insert (household_id, name) on public.meal_wishes to authenticated;

-- source is not client-writable (the trigger sets it).
grant select, delete on public.meal_availability to authenticated;
grant insert (household_id, day, slot, person_id, available) on public.meal_availability to authenticated;
grant update (available) on public.meal_availability to authenticated;

grant select, delete on public.meal_slot_notes to authenticated;
grant insert (household_id, day, slot, note) on public.meal_slot_notes to authenticated;
grant update (note) on public.meal_slot_notes to authenticated;

-- Called overnight by the agents function (service role) with what the
-- calendars say: [{"day":"2026-11-11","slot":"dinner","person_id":"…","available":false}].
-- Fills or refreshes calendar rows, never touches a row someone set by hand,
-- and clears rows for days that have gone.
create or replace function public.agent_save_meal_availability(p_household_id uuid, p_today date, p_rows jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.meal_availability (household_id, day, slot, person_id, available, source)
  select p_household_id, (r ->> 'day')::date, r ->> 'slot', (r ->> 'person_id')::uuid, (r ->> 'available')::boolean, 'calendar'
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
  where (r ->> 'day')::date >= p_today
    and exists (
      select 1 from public.household_members m
      where m.household_id = p_household_id and m.user_id = (r ->> 'person_id')::uuid
    )
  on conflict (household_id, day, slot, person_id) do update
    set available = excluded.available, source = 'calendar', updated_at = now()
    where public.meal_availability.source = 'calendar';

  delete from public.meal_availability where household_id = p_household_id and day < p_today - 7;
  delete from public.meal_slot_notes where household_id = p_household_id and day < p_today - 7;
$$;

revoke execute on function public.agent_save_meal_availability(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.agent_save_meal_availability(uuid, date, jsonb) to service_role;

alter publication supabase_realtime add table public.meal_wishes;
alter publication supabase_realtime add table public.meal_availability;
alter publication supabase_realtime add table public.meal_slot_notes;

-- Planning with Claude is costed with the lists and recipes.
alter table public.shopping_list_runs drop constraint shopping_list_runs_kind_check;
alter table public.shopping_list_runs add constraint shopping_list_runs_kind_check check (kind in ('list', 'recipes', 'plan'));

-- Called by the shopping-list function (service role) once it has checked the
-- caller belongs to the household. Puts Claude's plan into empty slots
-- ([{"day","slot","person_id","name"}], person_id null = for both), never over
-- a meal already there; crosses the wanted meals it used off the list; and
-- records what the call cost.
create or replace function public.meals_save_plan(
  p_household_id uuid,
  p_week_start date,
  p_user_id uuid,
  p_meals jsonb,
  p_usage jsonb
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_plan boolean := p_meals is not null and jsonb_typeof(p_meals) = 'array';
  v_count integer := 0;
begin
  if v_plan then
    with incoming as (
      select (m ->> 'day')::date as day, m ->> 'slot' as slot, nullif(m ->> 'person_id', '')::uuid as person_id, trim(m ->> 'name') as name
      from jsonb_array_elements(p_meals) as m
    ),
    added as (
      insert into public.meals (household_id, day, slot, person_id, name, created_by)
      select p_household_id, i.day, i.slot, i.person_id, i.name, p_user_id
      from incoming i
      where i.slot in ('lunch', 'dinner')
        and not exists (select 1 from public.meals x where x.household_id = p_household_id and x.day = i.day and x.slot = i.slot)
      on conflict do nothing
      returning name
    ),
    used as (
      delete from public.meal_wishes w
      where w.household_id = p_household_id and lower(w.name) in (select lower(a.name) from added a)
    )
    select count(*) into v_count from added;
  end if;

  insert into public.shopping_list_runs
    (household_id, week_start, kind, ok, item_count, created_by, llm_input_tokens, llm_output_tokens, llm_cost_micro_usd)
  values (
    p_household_id,
    p_week_start,
    'plan',
    v_plan,
    v_count,
    p_user_id,
    coalesce((p_usage ->> 'input_tokens')::integer, 0),
    coalesce((p_usage ->> 'output_tokens')::integer, 0),
    coalesce((p_usage ->> 'cost_micro_usd')::bigint, 0)
  );
  return v_count;
end;
$$;

revoke execute on function public.meals_save_plan(uuid, date, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.meals_save_plan(uuid, date, uuid, jsonb, jsonb) to service_role;
