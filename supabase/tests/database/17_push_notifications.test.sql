-- Briefing notifications: off by default, devices are owner-only, endpoints
-- must be a browser push service, and only the service role forgets devices.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated, service_role, anon;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.sophie', '22222222-2222-2222-2222-222222222222', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);
select set_config('t.key', repeat('B', 87), true);
select set_config('t.auth', repeat('a', 22), true);

delete from push_subscriptions;

-- The switch ---------------------------------------------------------------------------
select is((select briefing_push from user_preferences where user_id = current_setting('t.tim')::uuid), false,
  'notifications start switched off');

select pg_temp.as_user(current_setting('t.tim')::uuid);
update user_preferences set briefing_push = true where user_id = current_setting('t.tim')::uuid;
select is((select briefing_push from user_preferences where user_id = current_setting('t.tim')::uuid), true,
  'a person can switch them on');
update user_preferences set briefing_push = false where user_id = current_setting('t.tim')::uuid;

-- Devices --------------------------------------------------------------------------------
select lives_ok(format($$insert into push_subscriptions (household_id, endpoint, p256dh, auth)
  values (%L, 'https://web.push.apple.com/QGuQyavXut', %L, %L)$$, current_setting('t.hh'), current_setting('t.key'), current_setting('t.auth')),
  'a member can register their own device');
select is((select user_id from push_subscriptions), current_setting('t.tim')::uuid, 'the device is recorded as theirs');

select throws_ok(format($$insert into push_subscriptions (household_id, endpoint, p256dh, auth)
  values (%L, 'https://evil.example/web.push.apple.com/', %L, %L)$$, current_setting('t.hh'), current_setting('t.key'), current_setting('t.auth')),
  '23514', null, 'an endpoint that isn''t a push service is refused');
select throws_ok(format($$insert into push_subscriptions (household_id, endpoint, p256dh, auth)
  values (%L, 'https://fcm.googleapis.com/fcm/send/x', 'not a key', %L)$$, current_setting('t.hh'), current_setting('t.auth')),
  '23514', null, 'malformed keys are refused');
select throws_ok(format($$insert into push_subscriptions (household_id, user_id, endpoint, p256dh, auth)
  values (%L, %L, 'https://fcm.googleapis.com/fcm/send/y', %L, %L)$$,
  current_setting('t.hh'), current_setting('t.sophie'), current_setting('t.key'), current_setting('t.auth')),
  '42501', null, 'a member cannot register a device for their partner');
select ok(not has_table_privilege('authenticated', 'public.push_subscriptions', 'update'), 'devices cannot be edited, only removed');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from push_subscriptions), 0, 'a partner cannot see someone else''s devices');
delete from push_subscriptions;
select pg_temp.as_service();
select is((select count(*)::int from push_subscriptions), 1, 'a partner cannot remove someone else''s devices');

select pg_temp.as_user(current_setting('t.out')::uuid);
select throws_ok(format($$insert into push_subscriptions (household_id, endpoint, p256dh, auth)
  values (%L, 'https://fcm.googleapis.com/fcm/send/z', %L, %L)$$, current_setting('t.hh'), current_setting('t.key'), current_setting('t.auth')),
  '42501', null, 'an outsider cannot register a device in the household');

-- Forgetting gone devices ------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.push_subscriptions_gone(uuid, uuid[])', 'execute'),
  'members cannot call the clean-up');
select pg_temp.as_service();
select push_subscriptions_gone(gen_random_uuid(), array(select id from push_subscriptions));
select is((select count(*)::int from push_subscriptions), 1, 'the clean-up only touches the given household');
select push_subscriptions_gone(current_setting('t.hh')::uuid, array(select id from push_subscriptions));
select is((select count(*)::int from push_subscriptions), 0, 'a gone device is forgotten');

select * from finish();
rollback;
