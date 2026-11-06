-- Whose calendar: a member can set it to someone in the household, or both.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);

select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into calendar_integrations (household_id, name, google_calendar_id, owner_id) values (%L, 'Tim', 'tim@example.com', %L)$$,
  current_setting('t.hh'), current_setting('t.tim')), 'a member adds a calendar as theirs');
select lives_ok($$update calendar_integrations set owner_id = null where name = 'Tim'$$, 'and can make it shared');
select throws_ok(format($$update calendar_integrations set owner_id = %L where name = 'Tim'$$, current_setting('t.out')),
  '23503', null, 'it cannot belong to someone outside the household');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from calendar_integrations where name = 'Tim'), 0, 'an outsider cannot see it');

select * from finish();
rollback;
