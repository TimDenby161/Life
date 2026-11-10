-- =============================================================================
-- Recipes for the meals on the Meals page.
--
--   recipes  one per meal name per household, written by Claude through the
--            shopping-list function and kept, so a meal you plan again already
--            has its recipe. meal_key is the name tidied and lower-cased. A meal
--            with nothing to cook ("out", "leftovers") is kept with no steps, so
--            it isn't asked about again. Both of you can read a recipe and remove
--            it (it is then written afresh next time); nobody edits one by hand.
--
-- Recipe calls are costed in shopping_list_runs alongside shopping lists
-- (kind = 'recipes'), so one monthly budget covers both.
-- =============================================================================

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  meal_key text not null check (char_length(meal_key) between 1 and 80),
  name text not null check (char_length(trim(name)) between 1 and 80),
  serves smallint not null check (serves between 1 and 12),
  -- Start to finish; null when there is nothing to cook.
  minutes smallint check (minutes between 1 and 600),
  -- [{ "item": "Chicken thighs", "quantity": "600g" }]
  ingredients jsonb not null default '[]' check (jsonb_typeof(ingredients) = 'array'),
  -- ["Fry the onion…", "Add the spices…"]
  steps jsonb not null default '[]' check (jsonb_typeof(steps) = 'array'),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (household_id, meal_key)
);

alter table public.recipes enable row level security;

create policy "recipes: members read" on public.recipes
  for select to authenticated using (public.is_household_member(household_id));
create policy "recipes: members delete" on public.recipes
  for delete to authenticated using (public.is_household_member(household_id));

-- No insert or update: recipes only arrive through recipes_save.
grant select, delete on public.recipes to authenticated;

alter table public.shopping_list_runs
  add column kind text not null default 'list' check (kind in ('list', 'recipes'));

-- Called by the shopping-list function (service role) once it has checked the
-- caller belongs to the household. Saves the recipes Claude wrote (p_recipes
-- not null) and records what the call cost.
create or replace function public.recipes_save(
  p_household_id uuid,
  p_week_start date,
  p_user_id uuid,
  p_serves integer,
  p_recipes jsonb,
  p_usage jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  -- A JSON null (nothing written) can arrive as SQL null or as jsonb 'null'.
  v_list boolean := p_recipes is not null and jsonb_typeof(p_recipes) = 'array';
begin
  if v_list then
    insert into public.recipes (household_id, meal_key, name, serves, minutes, ingredients, steps, created_by)
    select
      p_household_id,
      r ->> 'key',
      r ->> 'name',
      p_serves,
      (r ->> 'minutes')::smallint,
      coalesce(r -> 'ingredients', '[]'::jsonb),
      coalesce(r -> 'steps', '[]'::jsonb),
      p_user_id
    from jsonb_array_elements(p_recipes) as r
    on conflict (household_id, meal_key) do update
      set name = excluded.name, serves = excluded.serves, minutes = excluded.minutes,
          ingredients = excluded.ingredients, steps = excluded.steps,
          created_by = excluded.created_by, created_at = now();
  end if;

  insert into public.shopping_list_runs
    (household_id, week_start, kind, ok, item_count, created_by, llm_input_tokens, llm_output_tokens, llm_cost_micro_usd)
  values (
    p_household_id,
    p_week_start,
    'recipes',
    v_list,
    case when v_list then jsonb_array_length(p_recipes) else 0 end,
    p_user_id,
    coalesce((p_usage ->> 'input_tokens')::integer, 0),
    coalesce((p_usage ->> 'output_tokens')::integer, 0),
    coalesce((p_usage ->> 'cost_micro_usd')::bigint, 0)
  );
end;
$$;

revoke execute on function public.recipes_save(uuid, date, uuid, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.recipes_save(uuid, date, uuid, integer, jsonb, jsonb) to service_role;

alter publication supabase_realtime add table public.recipes;
