-- A trip's bookings are shared by both of you, stay on the trip's household,
-- go when the trip goes, and outsiders see none.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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
select set_config('t.outhh', (select household_id::text from household_members where user_id = current_setting('t.out')::uuid), true);

delete from trips;

select pg_temp.as_user(current_setting('t.tim')::uuid);
insert into trips (household_id, name, starts_on, ends_on) values (current_setting('t.hh')::uuid, 'Rome', '2027-12-18', '2027-12-22');
select set_config('t.trip', (select id::text from trips where name = 'Rome'), true);

select lives_ok(format($$insert into trip_bookings (household_id, trip_id, title) values (%L, %L, 'Colosseum tickets')$$,
  current_setting('t.hh'), current_setting('t.trip')), 'a member adds a booking to a trip');
select is((select done from trip_bookings), false, 'it starts not booked');
select throws_ok(format($$insert into trip_bookings (household_id, trip_id, title, created_by) values (%L, %L, 'x', %L)$$,
  current_setting('t.hh'), current_setting('t.trip'), current_setting('t.sophie')), '42501', null, 'created_by is not client-writable');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
update trip_bookings set done = true;
select is((select done from trip_bookings), true, 'the partner can tick it off');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from trip_bookings), 0, 'an outsider sees no bookings');
select throws_ok(format($$insert into trip_bookings (household_id, trip_id, title) values (%L, %L, 'Sneaky')$$,
  current_setting('t.outhh'), current_setting('t.trip')), '23503', null, 'a booking cannot hang off another household''s trip');
update trip_bookings set title = 'Changed';
select pg_temp.as_user(current_setting('t.tim')::uuid);
select is((select title from trip_bookings), 'Colosseum tickets', 'an outsider cannot change it');

delete from trips where name = 'Rome';
select is((select count(*)::int from trip_bookings), 0, 'removing the trip removes its bookings');

select * from finish();
rollback;
