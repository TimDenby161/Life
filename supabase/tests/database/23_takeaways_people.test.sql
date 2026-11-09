-- Takeaways are readable by both of you but only the logger adds or deletes
-- their own; people are shared within the household; outsiders see neither.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

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

delete from takeaways;
delete from people;

-- Takeaways -----------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into takeaways (household_id, shared) values (%L, true)$$, current_setting('t.hh')), 'a member logs a takeaway');
select is((select user_id from takeaways), current_setting('t.tim')::uuid, 'it is logged as theirs');
select throws_ok(format($$insert into takeaways (household_id, user_id) values (%L, %L)$$, current_setting('t.hh'), current_setting('t.sophie')),
  '42501', null, 'nobody logs one as someone else');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from takeaways), 1, 'the partner can read it');
delete from takeaways;
select is((select count(*)::int from takeaways), 1, 'the partner cannot delete it');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from takeaways), 0, 'an outsider sees no takeaways');

-- People --------------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into people (household_id, owner_id, name, birthday_month, birthday_day) values (%L, %L, 'Jess', 2, 29)$$,
  current_setting('t.hh'), current_setting('t.tim')), 'a member adds a friend with a birthday');
select throws_ok(format($$insert into people (household_id, name, birthday_month, birthday_day) values (%L, 'Nobody', 4, 31)$$,
  current_setting('t.hh')), '23514', null, 'the birthday has to be a real day');
select throws_ok(format($$insert into people (household_id, name, birthday_month) values (%L, 'Half', 4)$$,
  current_setting('t.hh')), '23514', null, 'a birthday needs both month and day');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
update people set last_seen_on = '2026-11-09' where name = 'Jess';
select is((select last_seen_on from people where name = 'Jess'), '2026-11-09'::date, 'the partner can mark them seen');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from people), 0, 'an outsider sees no people');

select * from finish();
rollback;
