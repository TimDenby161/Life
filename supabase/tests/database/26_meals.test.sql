-- Meals and the shopping list are shared within the household; outsiders see
-- neither. Clients can't mark an item as written by Claude, record a run, or
-- call shopping_save_list, which swaps the week's 'ai' items and logs the cost.
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

delete from meals;
delete from shopping_items;
delete from shopping_list_runs;

-- Meals ---------------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into meals (household_id, day, slot, name) values (%L, '2026-11-09', 'dinner', 'Chilli')$$, current_setting('t.hh')),
  'a member plans a meal for both');
select throws_ok(format($$insert into meals (household_id, day, slot, name) values (%L, '2026-11-09', 'dinner', 'Stew')$$, current_setting('t.hh')),
  '23505', null, 'a slot holds one shared meal');
select lives_ok(format($$insert into meals (household_id, day, slot, person_id, name) values (%L, '2026-11-10', 'lunch', %L, 'Salad')$$,
  current_setting('t.hh'), current_setting('t.sophie')), 'a member plans a meal for the other person');
select throws_ok(format($$insert into meals (household_id, day, slot, person_id, name) values (%L, '2026-11-10', 'lunch', %L, 'Soup')$$,
  current_setting('t.hh'), current_setting('t.sophie')), '23505', null, 'and each person has one meal per slot');
select throws_ok(format($$insert into meals (household_id, day, slot, name) values (%L, '2026-11-09', 'supper', 'Toast')$$, current_setting('t.hh')),
  '23514', null, 'the slot has to be breakfast, lunch or dinner');
select throws_ok(format($$insert into meals (household_id, day, slot, person_id, name) values (%L, '2026-11-11', 'lunch', %L, 'Soup')$$,
  current_setting('t.hh'), current_setting('t.out')), '23503', null, 'a meal can only be for someone in the household');
select throws_ok($$update meals set day = '2026-11-12' where name = 'Chilli'$$, '42501', null, 'a meal cannot be moved by editing its day');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
update meals set name = 'Veggie chilli' where name = 'Chilli';
select is((select count(*)::int from meals where name = 'Veggie chilli'), 1, 'the partner can change a meal');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from meals), 0, 'an outsider sees no meals');
select throws_ok(format($$insert into meals (household_id, day, slot, name) values (%L, '2026-11-12', 'dinner', 'Mine now')$$, current_setting('t.hh')),
  '42501', null, 'and cannot add one');

-- Shopping list --------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into shopping_items (household_id, week_start, name) values (%L, '2026-11-09', 'Bin bags')$$, current_setting('t.hh')),
  'a member adds their own item');
select is((select source from shopping_items where name = 'Bin bags'), 'manual', 'it is marked as theirs, not Claude''s');
select throws_ok(format($$insert into shopping_items (household_id, week_start, name, source) values (%L, '2026-11-09', 'Fake', 'ai')$$, current_setting('t.hh')),
  '42501', null, 'a client cannot mark an item as written by Claude');
select throws_ok(format($$insert into shopping_items (household_id, week_start, name) values (%L, '2026-11-10', 'Midweek')$$, current_setting('t.hh')),
  '23514', null, 'a list belongs to a week starting on a Monday');
select throws_ok(format($$insert into shopping_list_runs (household_id, week_start, ok) values (%L, '2026-11-09', true)$$, current_setting('t.hh')),
  '42501', null, 'a client cannot record a run');
-- Checked as a privilege, not a call (see 16_agents: refused calls crash CI's Postgres image).
select ok(not has_function_privilege('authenticated', 'public.shopping_save_list(uuid, date, uuid, text, jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.shopping_save_list(uuid, date, uuid, text, jsonb, jsonb)', 'execute'),
  'or call shopping_save_list');

-- The function, as the Edge Function calls it (service role).
reset role;
select shopping_save_list(current_setting('t.hh')::uuid, '2026-11-09', current_setting('t.tim')::uuid, 'key-1',
  '[{"name":"Mince","quantity":"500g","aisle":"meat_fish"},{"name":"Kidney beans","quantity":"1 tin","aisle":"cupboard"}]'::jsonb,
  '{"input_tokens":400,"output_tokens":900,"cost_micro_usd":19600}'::jsonb);

select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from shopping_items where source = 'ai'), 2, 'the partner sees the list Claude wrote');
update shopping_items set checked = true where name in ('Mince', 'Bin bags');
select is((select count(*)::int from shopping_items where checked), 2, 'and can tick items off');

-- A rebuild swaps Claude's items, keeps the tick on an unchanged one, and leaves added items alone.
reset role;
select shopping_save_list(current_setting('t.hh')::uuid, '2026-11-09', current_setting('t.sophie')::uuid, 'key-2',
  '[{"name":"mince","quantity":"750g","aisle":"meat_fish"},{"name":"Rice","quantity":"","aisle":"cupboard"}]'::jsonb, '{"cost_micro_usd":20000}'::jsonb);
-- A call that cost something but produced no list changes nothing and is still recorded.
select shopping_save_list(current_setting('t.hh')::uuid, '2026-11-09', current_setting('t.sophie')::uuid, 'key-3', null, '{"cost_micro_usd":5000}'::jsonb);

select pg_temp.as_user(current_setting('t.tim')::uuid);
select is(
  (select string_agg(name || ':' || coalesce(quantity, '-') || ':' || checked, ', ' order by source, position) from shopping_items),
  'mince:750g:true, Rice:-:false, Bin bags:-:true',
  'a rebuild replaces Claude''s items, keeps ticks, and leaves your own items');
select is(
  (select string_agg(meals_key, ',' order by meals_key) from shopping_list_runs where ok), 'key-1,key-2',
  'each list remembers which meals it was built from; a call that made no list does not count');
select is((select sum(llm_cost_micro_usd)::int from shopping_list_runs), 44600, 'every call is costed, including one that made no list');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select (select count(*) from shopping_items) + (select count(*) from shopping_list_runs))::int, 0, 'an outsider sees no list and no runs');

select * from finish();
rollback;
