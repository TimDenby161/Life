-- Ingredients you already have are shared within the household; outsiders see
-- none, and who added one is not client-writable.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

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

delete from meal_pantry;

select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into meal_pantry (household_id, name) values (%L, 'Chicken thighs')$$, current_setting('t.hh')), 'a member adds an ingredient they have');
select is((select created_by::text from meal_pantry), current_setting('t.tim'), 'as themselves');
select throws_ok(format($$insert into meal_pantry (household_id, name, created_by) values (%L, 'Rice', %L)$$, current_setting('t.hh'), current_setting('t.sophie')),
  '42501', null, 'and cannot say someone else added it');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from meal_pantry), 0, 'an outsider sees none of it');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from meal_pantry), 1, 'the partner sees it');
delete from meal_pantry;
select is((select count(*)::int from meal_pantry), 0, 'and can remove it');

select * from finish();
rollback;
