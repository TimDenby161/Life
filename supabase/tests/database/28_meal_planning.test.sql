-- Meal wishes, who is in for each meal, and per-meal notes are shared within the
-- household; outsiders see none of them. A person's change to availability is
-- always 'manual', and the overnight calendar run (agent_save_meal_availability,
-- service role only) never overwrites it.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.sophie', '22222222-2222-2222-2222-222222222222', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);

delete from meal_wishes;
delete from meal_availability;
delete from meal_slot_notes;

-- Wishes ---------------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into meal_wishes (household_id, name) values (%L, 'Fish pie')$$, current_setting('t.hh')), 'a member adds a meal they want');
select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from meal_wishes), 1, 'the partner sees it');
delete from meal_wishes where name = 'Fish pie';
select is((select count(*)::int from meal_wishes), 0, 'and can remove it');

-- Availability -----------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into meal_availability (household_id, day, slot, person_id, available) values (%L, '2026-11-12', 'dinner', %L, false)$$,
  current_setting('t.hh'), current_setting('t.sophie')), 'a member marks the other out for a meal');
select is((select source from meal_availability where slot = 'dinner'), 'manual', 'which counts as set by hand');
select throws_ok(format($$insert into meal_availability (household_id, day, slot, person_id, available, source) values (%L, '2026-11-12', 'lunch', %L, false, 'calendar')$$,
  current_setting('t.hh'), current_setting('t.tim')), '42501', null, 'a client cannot claim a row came from the calendar');
select throws_ok(format($$insert into meal_availability (household_id, day, slot, person_id) values (%L, '2026-11-12', 'breakfast', %L)$$,
  current_setting('t.hh'), current_setting('t.tim')), '23514', null, 'breakfast is left out');
select throws_ok(format($$insert into meal_availability (household_id, day, slot, person_id) values (%L, '2026-11-12', 'lunch', %L)$$,
  current_setting('t.hh'), current_setting('t.out')), '23503', null, 'only for someone in the household');
select ok(not has_function_privilege('authenticated', 'public.agent_save_meal_availability(uuid, date, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.agent_save_meal_availability(uuid, date, jsonb)', 'execute'),
  'a client cannot call agent_save_meal_availability');

-- The overnight run, as the agents function calls it (service role).
reset role;
select agent_save_meal_availability(current_setting('t.hh')::uuid, '2026-11-11', jsonb_build_array(
  jsonb_build_object('day', '2026-11-12', 'slot', 'dinner', 'person_id', current_setting('t.sophie'), 'available', true),
  jsonb_build_object('day', '2026-11-12', 'slot', 'lunch', 'person_id', current_setting('t.tim'), 'available', false),
  jsonb_build_object('day', '2026-11-12', 'slot', 'lunch', 'person_id', current_setting('t.out'), 'available', false),
  jsonb_build_object('day', '2026-11-01', 'slot', 'lunch', 'person_id', current_setting('t.tim'), 'available', false)
));
select is((select available from meal_availability where slot = 'dinner' and person_id = current_setting('t.sophie')::uuid), false,
  'the calendar never overwrites a row set by hand');
select is((select source || ':' || available from meal_availability where slot = 'lunch' and person_id = current_setting('t.tim')::uuid), 'calendar:false',
  'it fills in what the calendar says');
select is((select count(*)::int from meal_availability), 2, 'and ignores outsiders and days already gone');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
update meal_availability set available = true where slot = 'lunch' and person_id = current_setting('t.tim')::uuid;
select is((select source || ':' || available from meal_availability where slot = 'lunch'), 'manual:true', 'changing a calendar row makes it yours');

-- Notes ----------------------------------------------------------------------------------
select lives_ok(format($$insert into meal_slot_notes (household_id, day, slot, note) values (%L, '2026-11-12', 'dinner', 'Something quick')$$,
  current_setting('t.hh')), 'a member writes what they want for a meal');
select throws_ok(format($$insert into meal_slot_notes (household_id, day, slot, note) values (%L, '2026-11-12', 'dinner', 'Again')$$,
  current_setting('t.hh')), '23505', null, 'one note per meal');

-- Claude's plan, as the shopping-list function saves it (service role) ------------------
select ok(not has_function_privilege('authenticated', 'public.meals_save_plan(uuid, date, uuid, jsonb, jsonb)', 'execute'),
  'a client cannot call meals_save_plan');
reset role;
delete from meals;
insert into meal_wishes (household_id, name, created_by) values
  (current_setting('t.hh')::uuid, 'Fish pie', current_setting('t.tim')::uuid),
  (current_setting('t.hh')::uuid, 'Ramen', current_setting('t.tim')::uuid);
insert into meals (household_id, day, slot, name, created_by) values (current_setting('t.hh')::uuid, '2026-11-12', 'lunch', 'Soup', current_setting('t.tim')::uuid);
select is(
  meals_save_plan(current_setting('t.hh')::uuid, '2026-11-09', current_setting('t.tim')::uuid, jsonb_build_array(
    jsonb_build_object('day', '2026-11-12', 'slot', 'lunch', 'person_id', null, 'name', 'Not over soup'),
    jsonb_build_object('day', '2026-11-12', 'slot', 'dinner', 'person_id', current_setting('t.tim'), 'name', 'fish pie'),
    jsonb_build_object('day', '2026-11-13', 'slot', 'dinner', 'person_id', null, 'name', 'Chilli'),
    jsonb_build_object('day', '2026-11-13', 'slot', 'breakfast', 'person_id', null, 'name', 'Toast')
  ), '{"cost_micro_usd": 9000}'::jsonb),
  2, 'it fills empty lunches and dinners only');
select is((select string_agg(day || ' ' || slot || ' ' || name || ' ' || coalesce(person_id::text, 'both'), ', ' order by day, slot) from meals),
  '2026-11-12 dinner fish pie ' || current_setting('t.tim') || ', 2026-11-12 lunch Soup both, 2026-11-13 dinner Chilli both',
  'never over a meal already there, and a meal for one when only one is in');
select is((select string_agg(name, ',') from meal_wishes), 'Ramen', 'a wanted meal it used comes off the list');
select is((select kind || ':' || ok || ':' || item_count || ':' || llm_cost_micro_usd from shopping_list_runs where kind = 'plan'), 'plan:true:2:9000',
  'and the call is costed with the lists and recipes');
select is((select created_by::text from meals where name = 'Chilli'), current_setting('t.tim'), 'planned meals are by the person who asked');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select (select count(*) from meal_wishes) + (select count(*) from meal_availability) + (select count(*) from meal_slot_notes))::int, 0,
  'an outsider sees none of it');

select * from finish();
rollback;
