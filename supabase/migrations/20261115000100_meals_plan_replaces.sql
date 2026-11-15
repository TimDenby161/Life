-- Plan meals redoes the whole of Meals each time (Tim, 15 Nov 2026): every
-- lunch and dinner Claude planned replaces what was in that slot (shared or one
-- each), and the slots nobody is in for (p_clear: [{"day","slot"}]) are emptied.
-- Breakfasts are never touched. Nothing changes when Claude came back with
-- nothing (p_meals null), so a failed call never wipes a plan.
drop function if exists public.meals_save_plan(uuid, date, uuid, jsonb, jsonb);

create function public.meals_save_plan(
  p_household_id uuid,
  p_week_start date,
  p_user_id uuid,
  p_meals jsonb,
  p_usage jsonb,
  p_clear jsonb default null
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
    delete from public.meals x
    where x.household_id = p_household_id
      and x.slot in ('lunch', 'dinner')
      and exists (
        select 1
        from jsonb_array_elements(p_meals || coalesce(case when jsonb_typeof(p_clear) = 'array' then p_clear end, '[]'::jsonb)) as m
        where (m ->> 'day')::date = x.day and m ->> 'slot' = x.slot
      );

    with incoming as (
      select (m ->> 'day')::date as day, m ->> 'slot' as slot, nullif(m ->> 'person_id', '')::uuid as person_id, trim(m ->> 'name') as name
      from jsonb_array_elements(p_meals) as m
    ),
    added as (
      insert into public.meals (household_id, day, slot, person_id, name, created_by)
      select p_household_id, i.day, i.slot, i.person_id, i.name, p_user_id
      from incoming i
      where i.slot in ('lunch', 'dinner')
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

revoke execute on function public.meals_save_plan(uuid, date, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.meals_save_plan(uuid, date, uuid, jsonb, jsonb, jsonb) to service_role;
