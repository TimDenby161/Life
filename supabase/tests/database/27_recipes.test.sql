-- Recipes are written only through recipes_save (service role): both of you
-- can read one and remove it, nobody can add or edit one by hand, and outsiders
-- see none. Recipe calls are costed alongside shopping lists.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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

delete from recipes;
delete from shopping_list_runs;

-- Checked as privileges, not calls (see 16_agents: refused calls crash CI's Postgres image).
select ok(not has_function_privilege('authenticated', 'public.recipes_save(uuid, date, uuid, integer, jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.recipes_save(uuid, date, uuid, integer, jsonb, jsonb)', 'execute'),
  'members cannot call recipes_save');

-- The function, as the Edge Function calls it (service role).
select recipes_save(current_setting('t.hh')::uuid, '2026-11-09', current_setting('t.tim')::uuid, 2,
  '[{"key":"chicken curry","name":"Chicken curry","minutes":45,"ingredients":[{"item":"Chicken thighs","quantity":"600g"}],"steps":["Fry the onion.","Add the chicken."]},
    {"key":"leftovers","name":"Leftovers","minutes":null,"ingredients":[],"steps":[]}]'::jsonb,
  '{"input_tokens":300,"output_tokens":1500,"cost_micro_usd":31200}'::jsonb);

select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from recipes), 2, 'the partner sees the recipes Claude wrote');
select is((select serves || ':' || minutes || ':' || jsonb_array_length(steps) from recipes where meal_key = 'chicken curry'), '2:45:2',
  'with who it serves, how long it takes and its steps');
select is((select minutes is null and jsonb_array_length(steps) = 0 from recipes where meal_key = 'leftovers'), true,
  'a meal with nothing to cook is kept with no steps');
select throws_ok(format($$insert into recipes (household_id, meal_key, name, serves) values (%L, 'toast', 'Toast', 2)$$, current_setting('t.hh')),
  '42501', null, 'a member cannot write a recipe by hand');
select throws_ok($$update recipes set name = 'Edited' where meal_key = 'chicken curry'$$, '42501', null, 'or edit one');

-- Writing a meal again replaces its recipe rather than adding a second.
reset role;
select recipes_save(current_setting('t.hh')::uuid, '2026-11-16', current_setting('t.sophie')::uuid, 2,
  '[{"key":"chicken curry","name":"Chicken curry","minutes":30,"ingredients":[{"item":"Chicken breast","quantity":"400g"}],"steps":["Cook it."]}]'::jsonb,
  '{"cost_micro_usd":10000}'::jsonb);
-- A call that cost something but wrote nothing is still recorded.
select recipes_save(current_setting('t.hh')::uuid, '2026-11-16', current_setting('t.sophie')::uuid, 2, null, '{"cost_micro_usd":4000}'::jsonb);

select pg_temp.as_user(current_setting('t.tim')::uuid);
select is((select count(*)::int || ':' || max(minutes) from recipes where meal_key = 'chicken curry'), '1:30', 'a meal has one recipe: writing it again replaces it');
select is((select count(*)::int || ':' || sum(llm_cost_micro_usd) from shopping_list_runs where kind = 'recipes'), '3:45200',
  'every recipe call is costed, including one that wrote nothing');
select is((select count(*)::int from shopping_list_runs where kind = 'list'), 0, 'and is not mistaken for a shopping list');
delete from recipes where meal_key = 'leftovers';
select is((select count(*)::int from recipes), 1, 'a member can remove a recipe');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from recipes), 0, 'an outsider sees no recipes');
delete from recipes;
select pg_temp.as_user(current_setting('t.tim')::uuid);
select is((select count(*)::int from recipes), 1, 'and cannot remove one');

select * from finish();
rollback;
