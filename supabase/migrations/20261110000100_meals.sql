-- =============================================================================
-- Meals this week and its shopping list.
--
--   meals               one row per planned meal: a day, a slot (breakfast,
--                       lunch, dinner) and who it is for. person_id null = both
--                       of you (the default); a slot split in two has one row
--                       per person instead. Both of you can read and edit them.
--   shopping_items      the week's shopping list. 'ai' rows are written by the
--                       shopping-list function from Claude's answer; 'manual'
--                       rows are ones you add. Either of you can tick or delete.
--   shopping_list_runs  append-only: one row per call to Claude, with which
--                       meals the list was built from and what the call cost.
--                       Read-only to clients; the month's rows are the spend.
-- =============================================================================

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  day date not null,
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner')),
  -- Null = both of you.
  person_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (household_id, day, slot, person_id),
  foreign key (household_id, person_id) references public.household_members (household_id, user_id) on delete cascade
);

create trigger meals_updated_at before update on public.meals
  for each row execute function public.set_updated_at();

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- The Monday of the week the list is for.
  week_start date not null check (extract(isodow from week_start) = 1),
  name text not null check (char_length(trim(name)) between 1 and 80),
  quantity text check (char_length(quantity) <= 40),
  aisle text not null default 'other'
    check (aisle in ('produce', 'meat_fish', 'dairy', 'bakery', 'cupboard', 'frozen', 'other', 'check')),
  source text not null default 'manual' check (source in ('ai', 'manual')),
  checked boolean not null default false,
  position integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index shopping_items_week_idx on public.shopping_items (household_id, week_start);

create table public.shopping_list_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  week_start date not null,
  -- False when Claude was called but no list was saved; the call still cost something.
  ok boolean not null,
  -- The meals the list was built from, so the app can say when they have changed since.
  meals_key text not null default '',
  item_count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  llm_input_tokens integer not null default 0,
  llm_output_tokens integer not null default 0,
  llm_cost_micro_usd bigint not null default 0
);

create index shopping_list_runs_household_idx on public.shopping_list_runs (household_id, created_at);

alter table public.meals enable row level security;
alter table public.shopping_items enable row level security;
alter table public.shopping_list_runs enable row level security;

create policy "meals: members all" on public.meals
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy "shopping_items: members all" on public.shopping_items
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy "shopping_list_runs: members read" on public.shopping_list_runs
  for select to authenticated using (public.is_household_member(household_id));

grant select, delete on public.meals to authenticated;
grant insert (household_id, day, slot, person_id, name) on public.meals to authenticated;
grant update (name) on public.meals to authenticated;

-- source, position and created_by are not client-writable: a client row is always 'manual'.
grant select, delete on public.shopping_items to authenticated;
grant insert (household_id, week_start, name, quantity, aisle) on public.shopping_items to authenticated;
grant update (checked) on public.shopping_items to authenticated;

grant select on public.shopping_list_runs to authenticated;

-- Called by the shopping-list function (service role) once it has checked the
-- caller belongs to the household. Records the call, and when there is a list
-- (p_items not null) swaps the week's 'ai' items for it. Items you added
-- yourself are left alone, and a tick survives on an item whose name is unchanged.
create or replace function public.shopping_save_list(
  p_household_id uuid,
  p_week_start date,
  p_user_id uuid,
  p_meals_key text,
  p_items jsonb,
  p_usage jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  -- A JSON null (no list) can arrive as SQL null or as jsonb 'null'.
  v_list boolean := p_items is not null and jsonb_typeof(p_items) = 'array';
begin
  if v_list then
    with old as (
      delete from public.shopping_items
      where household_id = p_household_id and week_start = p_week_start and source = 'ai'
      returning lower(name) as name, checked
    )
    insert into public.shopping_items (household_id, week_start, name, quantity, aisle, source, position, created_by, checked)
    select
      p_household_id,
      p_week_start,
      e.item ->> 'name',
      nullif(e.item ->> 'quantity', ''),
      e.item ->> 'aisle',
      'ai',
      e.ord::integer,
      p_user_id,
      coalesce((select bool_or(o.checked) from old o where o.name = lower(e.item ->> 'name')), false)
    from jsonb_array_elements(p_items) with ordinality as e(item, ord);
  end if;

  insert into public.shopping_list_runs
    (household_id, week_start, ok, meals_key, item_count, created_by, llm_input_tokens, llm_output_tokens, llm_cost_micro_usd)
  values (
    p_household_id,
    p_week_start,
    v_list,
    coalesce(p_meals_key, ''),
    case when v_list then jsonb_array_length(p_items) else 0 end,
    p_user_id,
    coalesce((p_usage ->> 'input_tokens')::integer, 0),
    coalesce((p_usage ->> 'output_tokens')::integer, 0),
    coalesce((p_usage ->> 'cost_micro_usd')::bigint, 0)
  );
end;
$$;

revoke execute on function public.shopping_save_list(uuid, date, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.shopping_save_list(uuid, date, uuid, text, jsonb, jsonb) to service_role;

alter publication supabase_realtime add table public.meals;
alter publication supabase_realtime add table public.shopping_items;
alter publication supabase_realtime add table public.shopping_list_runs;
