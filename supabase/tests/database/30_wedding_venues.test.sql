-- Wedding venues are shared within the household, outsiders see none, only web
-- links are stored, who added one is not client-writable, and adding one posts
-- to the household feed.
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

delete from wedding_venues;

select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into wedding_venues (household_id, name, url) values (%L, 'Hothorpe Hall', 'https://example.com/hothorpe')$$, current_setting('t.hh')),
  'a member adds a venue with a link');
select is((select created_by::text from wedding_venues), current_setting('t.tim'), 'as themselves');
select is((select summary from feed_events where entity_type = 'wedding_venue' order by created_at desc limit 1), 'Venue idea: Hothorpe Hall', 'and it shows in the feed');
select throws_ok(format($$insert into wedding_venues (household_id, name, url) values (%L, 'Bad', 'javascript:alert(1)')$$, current_setting('t.hh')),
  '23514', null, 'only web links are kept');
select throws_ok(format($$insert into wedding_venues (household_id, name, created_by) values (%L, 'Barn', %L)$$, current_setting('t.hh'), current_setting('t.sophie')),
  '42501', null, 'nobody can say someone else added it');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
update wedding_venues set visited = true;
select is((select visited from wedding_venues), true, 'the partner sees it and can tick it visited');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from wedding_venues), 0, 'an outsider sees none of it');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
delete from wedding_venues;
select is((select count(*)::int from wedding_venues), 0, 'either of you can remove one');

select * from finish();
rollback;
