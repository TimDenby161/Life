-- Renewals: shared within the household, invisible outside it, owners must be
-- members, and trusted columns aren't client-writable.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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
select lives_ok(format($$insert into renewals (household_id, name, owner_id, expires_on, warn_days, every_months)
  values (%L, 'Passport', %L, '2030-05-12', 180, 120), (%L, 'Car insurance', null, '2026-11-30', 28, 12)$$,
  current_setting('t.hh'), current_setting('t.tim'), current_setting('t.hh')), 'a member adds renewals');
select is((select created_by from renewals where name = 'Passport'), current_setting('t.tim')::uuid, 'created_by is the person who added it');
select throws_ok(format($$insert into renewals (household_id, name, owner_id, expires_on) values (%L, 'X', %L, '2027-01-01')$$,
  current_setting('t.hh'), current_setting('t.out')), '23503', null, 'the owner must be in the household');
select throws_ok($$update renewals set created_by = '22222222-2222-2222-2222-222222222222'$$, '42501', null, 'created_by cannot be changed');
select throws_ok(format($$insert into renewals (household_id, name, expires_on, warn_days) values (%L, 'X', '2027-01-01', 0)$$, current_setting('t.hh')),
  '23514', null, 'the warning window must be at least a day');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from renewals), 2, 'the partner sees joint and personal renewals');
update renewals set expires_on = '2027-11-30' where name = 'Car insurance';
select is((select expires_on from renewals where name = 'Car insurance'), '2027-11-30'::date, 'the partner can mark one renewed');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from renewals), 0, 'an outsider sees none');
select throws_ok(format($$insert into renewals (household_id, name, expires_on) values (%L, 'X', '2027-01-01')$$, current_setting('t.hh')),
  '42501', null, 'an outsider cannot add to the household');

select * from finish();
rollback;
