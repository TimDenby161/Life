-- Finances, health access and feed permissions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.sophie', '22222222-2222-2222-2222-222222222222', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);

-- Finances ------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
with a as (
  insert into financial_accounts (household_id, name, account_type, ownership, opening_balance_minor, opening_date)
  values (current_setting('t.hh')::uuid, 'Joint current', 'current', 'joint', 150000, current_date - 30)
  returning id
) select set_config('t.current', id::text, true) from a;
with a as (
  insert into financial_accounts (household_id, name, account_type, ownership, owner_id, opening_balance_minor, opening_date)
  values (current_setting('t.hh')::uuid, 'Sophie ISA', 'savings', 'personal', current_setting('t.sophie')::uuid, 0, current_date - 30)
  returning id
) select set_config('t.isa', id::text, true) from a;

insert into financial_transactions (household_id, account_id, occurred_on, amount_minor, kind, description)
values (current_setting('t.hh')::uuid, current_setting('t.current')::uuid, current_date - 2, -4599, 'expense', 'Groceries');

select lives_ok(
  format('select set_config(''t.transfer'', create_transfer(%L, %L, 50000, current_date - 1, ''Monthly saving'')::text, true)', current_setting('t.current'), current_setting('t.isa')),
  'Transfer between accounts can be created');
select is((select count(*)::int from financial_transactions where transfer_id = current_setting('t.transfer')::uuid), 2, 'A transfer has two legs');
select is((select sum(amount_minor)::bigint from financial_transactions where transfer_id = current_setting('t.transfer')::uuid), 0::bigint, 'Transfer legs net to zero');
select is((select balance_minor from financial_account_balances where account_id = current_setting('t.current')::uuid),
  150000::bigint - 4599 - 50000, 'Current account balance = opening + transactions');
select is((select balance_minor from financial_account_balances where account_id = current_setting('t.isa')::uuid),
  50000::bigint, 'ISA balance includes the transfer');

-- A recorded balance overrides earlier history.
insert into account_balance_history (household_id, account_id, as_of, balance_minor)
values (current_setting('t.hh')::uuid, current_setting('t.isa')::uuid, current_date - 1, 52000);
select is((select balance_minor from financial_account_balances where account_id = current_setting('t.isa')::uuid),
  52000::bigint, 'Latest recorded balance is used as the base');

select throws_ok(
  format($q$insert into financial_transactions (household_id, account_id, occurred_on, amount_minor, kind, description, transfer_id)
            values (%L, %L, current_date, -100, 'transfer', 'orphan leg', gen_random_uuid()); set constraints all immediate$q$,
         current_setting('t.hh'), current_setting('t.current')),
  '23514', null, 'A one-legged transfer is rejected');

-- Savings goal reached -> activity event
with g as (
  insert into savings_goals (household_id, name, target_minor, account_id)
  values (current_setting('t.hh')::uuid, 'Rainy day', 60000, current_setting('t.isa')::uuid)
  returning id
) select set_config('t.goal', id::text, true) from g;
select is((select reached_at from savings_goals where id = current_setting('t.goal')::uuid), null, 'Goal not yet reached');
select lives_ok(
  format('select create_transfer(%L, %L, 10000, current_date, ''Top up'')', current_setting('t.current'), current_setting('t.isa')),
  'Top up the ISA');
select isnt((select reached_at from savings_goals where id = current_setting('t.goal')::uuid), null, 'Goal is marked reached');
select is((select count(*)::int from feed_events where event_type = 'goal.reached' and entity_id = current_setting('t.goal')::uuid),
  1, 'Goal reached activity is emitted once');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from financial_accounts where id in (current_setting('t.current')::uuid, current_setting('t.isa')::uuid)), 2,
  'Sophie sees accounts Tim created, including her own personal one');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from financial_transactions), 0, 'Outsider sees no transactions');
select is((select count(*)::int from financial_account_balances), 0, 'Outsider sees no balances');
select throws_ok(
  format('select create_transfer(%L, %L, 100, current_date, ''steal'')', current_setting('t.current'), current_setting('t.isa')),
  'P0002', null, 'Outsider cannot move money between another household''s accounts');

-- Health: visible to the household, owner-only writes -----------------------------
select pg_temp.as_user(current_setting('t.sophie')::uuid);
insert into health_measurements (household_id, metric_id, value, measured_at)
values (current_setting('t.hh')::uuid, (select id from health_metric_definitions where key = 'weight' and owner_id is null), 61.2, now() - interval '1 day');
insert into health_measurements (household_id, metric_id, value)
values (current_setting('t.hh')::uuid, (select id from health_metric_definitions where key = 'weight' and owner_id is null), 60.8);
-- Rows created in this test share the transaction timestamp.
select is((select count(*)::int from health_measurements where created_at = now()), 2, 'Sophie sees her own records');
select is((select unit from health_measurements where value = 60.8 and created_at = now()), 'kg', 'Unit defaults from the metric');

select pg_temp.as_user(current_setting('t.tim')::uuid);
select is((select count(*)::int from health_measurements where created_at = now()), 2, 'Tim sees all of Sophie''s records');
with u as (update health_measurements set value = 1 where user_id = current_setting('t.sophie')::uuid returning 1)
select is((select count(*)::int from u), 0, 'Tim cannot edit Sophie''s health records');
select throws_ok(
  format('insert into health_measurements (household_id, user_id, metric_id, value) values (%L, %L, (select id from health_metric_definitions where key = ''weight'' and owner_id is null), 80)',
         current_setting('t.hh'), current_setting('t.sophie')),
  '42501', null, 'Tim cannot record health data as Sophie');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from health_measurements), 0, 'Outsider sees no health data');

-- Periods: visible to the household, owner-only writes.
select pg_temp.as_user(current_setting('t.sophie')::uuid);
insert into health_periods (household_id, started_on, ended_on) values (current_setting('t.hh')::uuid, current_date - 30, current_date - 26);
insert into health_periods (household_id, started_on) values (current_setting('t.hh')::uuid, current_date - 2);
select throws_ok(
  format('insert into health_periods (household_id, started_on, ended_on) values (%L, current_date, current_date - 1)', current_setting('t.hh')),
  '23514', null, 'A period cannot end before it starts');

select pg_temp.as_user(current_setting('t.tim')::uuid);
select is((select count(*)::int from health_periods where created_at = now()), 2, 'Tim sees Sophie''s periods');
select throws_ok(
  format('insert into health_periods (household_id, user_id, started_on) values (%L, %L, current_date)', current_setting('t.hh'), current_setting('t.sophie')),
  '42501', null, 'Tim cannot log a period as Sophie');
with u as (update health_periods set ended_on = current_date returning 1)
select is((select count(*)::int from u), 0, 'Tim cannot edit Sophie''s periods');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from health_periods), 0, 'Outsider sees no periods');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
select throws_ok(
  format('update profiles set tracks_periods = false where id = %L', current_setting('t.sophie')),
  '42501', null, 'Who has the period tracker is not client-writable');

-- Exercise: a description and a duration.
select pg_temp.as_user(current_setting('t.tim')::uuid);
insert into health_exercise_sessions (household_id, description, started_at, duration_minutes)
values (current_setting('t.hh')::uuid, 'Swim, 40 lengths', now(), 45);
select is((select description from health_exercise_sessions where created_at = now()), 'Swim, 40 lengths', 'Exercise is logged with a free-text description');
select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from health_exercise_sessions where created_at = now()), 1, 'Sophie sees Tim''s exercise');

-- Exercise can be logged for each other; weight cannot.
select pg_temp.as_user(current_setting('t.tim')::uuid);
insert into health_exercise_sessions (household_id, user_id, description, started_at, duration_minutes)
values (current_setting('t.hh')::uuid, current_setting('t.sophie')::uuid, 'Yoga', now(), 60);
select is((select user_id::text from health_exercise_sessions where description = 'Yoga'), current_setting('t.sophie'), 'Tim can log exercise for Sophie');
select is((select logged_by::text from health_exercise_sessions where description = 'Yoga'), current_setting('t.tim'), 'the session records that Tim logged it');
select throws_ok(
  format('insert into health_exercise_sessions (household_id, user_id, description, started_at, duration_minutes) values (%L, %L, ''Run'', now(), 20)', current_setting('t.hh'), current_setting('t.out')),
  '23503', null, 'exercise can only be for a member of the household');
select throws_ok(
  format('insert into health_measurements (household_id, user_id, metric_id, value, measured_at) values (%L, %L, (select id from health_metric_definitions where key = ''weight''), 70, now())', current_setting('t.hh'), current_setting('t.sophie')),
  '42501', null, 'weight is still owner-only');

with u as (update health_exercise_sessions set duration_minutes = 61 where description = 'Yoga' returning 1)
select is((select count(*)::int from u), 0, 'only the person it belongs to can edit it, not whoever logged it');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
with d as (delete from health_exercise_sessions where description = 'Swim, 40 lengths' returning 1)
select is((select count(*)::int from d), 0, 'Sophie cannot delete a session Tim logged for himself');

select throws_ok(
  'select 1 from health_metric_definitions; insert into health_metric_definitions (key, name, unit, category) values (''x'', ''X'', ''u'', ''custom'')',
  '42501', null, 'Clients can no longer define metrics');

-- Feed ----------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
with p as (
  insert into feed_posts (household_id, body) values (current_setting('t.hh')::uuid, 'Dinner at 7?') returning id
) select set_config('t.post', id::text, true) from p;

select pg_temp.as_user(current_setting('t.sophie')::uuid);
select throws_ok(format('update feed_posts set body = ''edited'' where id = %L', current_setting('t.post')), '42501', null,
  'Only the author can edit a post');
select lives_ok(format('update feed_posts set pinned_at = now() where id = %L', current_setting('t.post')), 'Sophie can pin Tim''s post');
select is((select pinned_by from feed_posts where id = current_setting('t.post')::uuid), current_setting('t.sophie')::uuid,
  'pinned_by records who pinned');
select lives_ok(format('insert into feed_reads (household_id, post_id) values (%L, %L)', current_setting('t.hh'), current_setting('t.post')),
  'Sophie marks the post read');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from feed_posts), 0, 'Outsider cannot read the feed');

select * from finish();
rollback;
