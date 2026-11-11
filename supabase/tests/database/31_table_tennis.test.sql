-- Table tennis: a person's own rows, read by the household, written only by
-- them. A session's rate comes from its employer at the time (not the client)
-- and its amount from the hours. Snapshots are written only by the service role.
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

select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into tt_employers (household_id, name, rate_minor) values (%L, 'Graham Spicer', 2000)$$, current_setting('t.hh')), 'Tim adds who pays him, with a rate');
select lives_ok(format($$insert into tt_sessions (household_id, employer_id, day, hours) select %L, id, '2026-11-10', 1.5 from tt_employers$$, current_setting('t.hh')),
  'and logs a session by its hours');
select is((select rate_minor || ':' || amount_minor from tt_sessions), '2000:3000', 'paid at the employer''s rate for the hours (1.5h at £20 = £30)');
select throws_ok($$update tt_sessions set rate_minor = 9999$$, '42501', null, 'the rate is not client-writable');
update tt_employers set rate_minor = 2500;
select is((select amount_minor from tt_sessions), 3000::bigint, 'a later rate change leaves logged sessions alone');
update tt_sessions set paid_on = '2026-11-11';
select is((select paid_on from tt_sessions), '2026-11-11'::date, 'a session can be marked paid');
select throws_ok(format($$insert into tt_sessions (household_id, employer_id, day, hours) select %L, id, '2026-11-10', 0 from tt_employers$$, current_setting('t.hh')),
  '23514', null, 'it lasts some time');
select lives_ok(format($$insert into tt_players (household_id, tt_user_id, name) values (%L, gen_random_uuid(), 'A Junior')$$, current_setting('t.hh')), 'Tim adds a player he coaches');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from tt_sessions) + (select count(*)::int from tt_players), 2, 'Sophie can see them');
update tt_sessions set paid_on = null;
select is((select count(*)::int from tt_sessions where paid_on is null), 0, 'but cannot change Tim''s');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from tt_sessions) + (select count(*)::int from tt_employers), 0, 'an outsider sees none of it');

select ok(not has_function_privilege('authenticated', 'public.tt_save_snapshots(uuid, date, jsonb)', 'execute'), 'a client cannot write league snapshots');

select * from finish();
rollback;
