-- Shopping list: shared within the household, outsiders see nothing, and
-- created_by can't be forged.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

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

delete from wants;

select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into wants (household_id, owner_id, name, need_by) values (%L, %L, 'Running shoes', '2026-12-01')$$,
  current_setting('t.hh'), current_setting('t.tim')), 'a member adds something with a deadline');
select lives_ok(format($$insert into wants (household_id, name) values (%L, 'Sofa')$$, current_setting('t.hh')), 'and something with no deadline, for both');
select throws_ok(format($$insert into wants (household_id, name, created_by) values (%L, 'Forged', %L)$$,
  current_setting('t.hh'), current_setting('t.sophie')), '42501', null, 'created_by is not client-writable');
select throws_ok(format($$insert into wants (household_id, name, url) values (%L, 'Bad link', 'javascript:alert(1)')$$,
  current_setting('t.hh')), '23514', null, 'links have to be web links');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
update wants set bought_at = now() where name = 'Sofa';
select isnt((select bought_at from wants where name = 'Sofa'), null, 'the partner can tick it off');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from wants), 0, 'an outsider sees nothing');
select throws_ok(format($$insert into wants (household_id, name) values (%L, 'Sneaky')$$, current_setting('t.hh')),
  '42501', null, 'an outsider cannot add to it');

select * from finish();
rollback;
