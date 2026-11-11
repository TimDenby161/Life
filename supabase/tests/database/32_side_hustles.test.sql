-- Side hustles: the owner's own settings, hustles and regular charges; the
-- household reads them, only the owner writes, outsiders see nothing.
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

select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into hustle_settings (household_id, spreadsheet_id) values (%L, '1pBeL0orom1TQ3fbaZrP7h_DXKba-qurLMvq5T0dYIL4')$$, current_setting('t.hh')), 'Tim links his sheet');
select throws_ok(format($$insert into hustles (household_id, name) values (%L, 'Life app'); insert into hustles (household_id, name) values (%L, 'Life app')$$, current_setting('t.hh'), current_setting('t.hh')),
  '23505', null, 'one hustle per name');
insert into hustles (household_id, name) values (current_setting('t.hh')::uuid, 'Life app');
select lives_ok(format($$insert into hustle_charges (household_id, hustle_id, description, usual_minor) select %L, id, 'Supabase', 2000 from hustles$$, current_setting('t.hh')), 'and a regular charge');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from hustle_charges), 1, 'Sophie can see it');
update hustle_charges set usual_minor = 1;
select is((select usual_minor from hustle_charges), 2000::bigint, 'but not change it');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from hustles) + (select count(*)::int from hustle_settings), 0, 'an outsider sees none of it');

select * from finish();
rollback;
