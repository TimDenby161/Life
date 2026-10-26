-- Google Sheet balance sync: household isolation, linked accounts only,
-- idempotent re-syncs and removal of deleted date columns.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);

select pg_temp.as_user(current_setting('t.tim')::uuid);
with s as (
  insert into finance_sheet_sources (household_id, spreadsheet_id) values (current_setting('t.hh')::uuid, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')
  returning id
) select set_config('t.src', id::text, true) from s;
with a as (
  insert into financial_accounts (household_id, name, account_type, ownership)
  values (current_setting('t.hh')::uuid, 'Joint Current', 'current', 'joint')
  returning id
) select set_config('t.linked', id::text, true) from a;
-- Two sheet rows feed one account.
select replace_sheet_links(current_setting('t.hh')::uuid, jsonb_build_array(
  jsonb_build_object('row_key', 'joint positive|revolut|joint', 'account_id', current_setting('t.linked')),
  jsonb_build_object('row_key', 'joint positive|santander|edge explorer', 'account_id', current_setting('t.linked'))));
with a as (
  insert into financial_accounts (household_id, name, account_type, ownership)
  values (current_setting('t.hh')::uuid, 'Cash jar', 'cash', 'joint')
  returning id
) select set_config('t.plain', id::text, true) from a;

-- A manual balance on a date the sheet doesn't have must survive syncs.
insert into account_balance_history (household_id, account_id, as_of, balance_minor)
values (current_setting('t.hh')::uuid, current_setting('t.linked')::uuid, '2026-06-01', 999);

select pg_temp.as_user(current_setting('t.out')::uuid);
select throws_ok(
  format($q$select apply_sheet_balances(%L, '[]'::jsonb)$q$, current_setting('t.src')),
  'P0002', null, 'An outsider cannot sync another household''s sheet');
select is((select count(*)::int from finance_sheet_sources), 0, 'An outsider cannot see the sheet settings');
select is((select count(*)::int from finance_sheet_links), 0, 'An outsider cannot see the sheet links');
select throws_ok(
  format($q$insert into finance_sheet_links (household_id, account_id, row_key) values (%L, %L, 'x')$q$, current_setting('t.hh'), current_setting('t.linked')),
  '42501', null, 'An outsider cannot link rows in another household');

select pg_temp.as_user(current_setting('t.tim')::uuid);
select throws_ok(
  format($q$update finance_sheet_sources set last_synced_at = now() where id = %L$q$, current_setting('t.src')),
  '42501', null, 'Sync status is not client-writable');
select throws_ok(
  format($q$select apply_sheet_balances(%L, jsonb_build_array(jsonb_build_object('account_id', %L, 'as_of', '2026-07-14', 'balance_minor', 1)))$q$,
         current_setting('t.src'), current_setting('t.plain')),
  '22023', null, 'Only sheet-linked accounts can be written');

select is(
  (select apply_sheet_balances(current_setting('t.src')::uuid, jsonb_build_array(
    jsonb_build_object('account_id', current_setting('t.linked'), 'as_of', '2026-07-14', 'balance_minor', 1411),
    jsonb_build_object('account_id', current_setting('t.linked'), 'as_of', '2026-08-16', 'balance_minor', 2411)))),
  '{"written": 2, "removed": 0}'::jsonb, 'First sync writes every date');
select is((select source from account_balance_history where account_id = current_setting('t.linked')::uuid and as_of = '2026-07-14'),
  'sheet', 'Imported balances are marked as from the sheet');
select is(
  (select apply_sheet_balances(current_setting('t.src')::uuid, jsonb_build_array(
    jsonb_build_object('account_id', current_setting('t.linked'), 'as_of', '2026-07-14', 'balance_minor', 1411,
      'breakdown', '[{"label": "Revolut · Joint", "balance_minor": 1000}, {"label": "Santander · Edge Explorer", "balance_minor": 411}]'::jsonb),
    jsonb_build_object('account_id', current_setting('t.linked'), 'as_of', '2026-08-16', 'balance_minor', 2411)))),
  '{"written": 1, "removed": 0}'::jsonb, 'Adding a breakdown rewrites only that date');
select is((select jsonb_array_length(breakdown) from account_balance_history where account_id = current_setting('t.linked')::uuid and as_of = '2026-07-14'),
  2, 'The rows behind a combined balance are kept');
select is((select balance_minor from financial_account_balances where account_id = current_setting('t.linked')::uuid),
  2411::bigint, 'The latest sheet balance becomes the current balance');
select isnt((select last_synced_at from finance_sheet_sources where id = current_setting('t.src')::uuid), null, 'Sync time is recorded');

select is(
  (select apply_sheet_balances(current_setting('t.src')::uuid, jsonb_build_array(
    jsonb_build_object('account_id', current_setting('t.linked'), 'as_of', '2026-07-14', 'balance_minor', 1411,
      'breakdown', '[{"label": "Revolut · Joint", "balance_minor": 1000}, {"label": "Santander · Edge Explorer", "balance_minor": 411}]'::jsonb),
    jsonb_build_object('account_id', current_setting('t.linked'), 'as_of', '2026-08-16', 'balance_minor', 2411)))),
  '{"written": 0, "removed": 0}'::jsonb, 'Re-syncing unchanged figures writes nothing');

select is(
  (select apply_sheet_balances(current_setting('t.src')::uuid, jsonb_build_array(
    jsonb_build_object('account_id', current_setting('t.linked'), 'as_of', '2026-08-16', 'balance_minor', 2500),
    jsonb_build_object('account_id', current_setting('t.linked'), 'as_of', '2026-09-18', 'balance_minor', 2411)))),
  '{"written": 2, "removed": 1}'::jsonb, 'An edited cell updates, a new column adds, a deleted column removes');
select is((select balance_minor from account_balance_history where account_id = current_setting('t.linked')::uuid and as_of = '2026-08-16'),
  2500::bigint, 'The edited figure is stored');
select is((select balance_minor from account_balance_history where account_id = current_setting('t.linked')::uuid and as_of = '2026-06-01'),
  999::bigint, 'Manual balances on other dates are kept');

select lives_ok(
  format($q$select apply_sheet_balances(%L, '[]'::jsonb, 'The sheet is not shared')$q$, current_setting('t.src')),
  'A failed sync is recorded');
select is((select last_sync_error from finance_sheet_sources where id = current_setting('t.src')::uuid),
  'The sheet is not shared', 'The error is shown to the household');
select is((select count(*)::int from account_balance_history where account_id = current_setting('t.linked')::uuid),
  3, 'A failed sync leaves balances alone');

select lives_ok(
  format($q$select replace_sheet_links(%L, '[{"row_key": "joint positive|revolut|joint", "account_id": null}]')$q$, current_setting('t.hh')),
  'One row can be unlinked on its own');
select is((select count(*)::int from finance_sheet_links where account_id = current_setting('t.linked')::uuid), 1,
  'The account keeps its other row');
select throws_ok(
  format($q$insert into finance_sheet_links (household_id, account_id, row_key) values (%L, %L, 'joint positive|santander|edge explorer')$q$,
         current_setting('t.hh'), current_setting('t.plain')),
  '23505', null, 'A row links to only one account');

-- Unlinking keeps history: later syncs no longer touch that account.
delete from finance_sheet_links where account_id = current_setting('t.linked')::uuid;
select apply_sheet_balances(current_setting('t.src')::uuid, '[]'::jsonb);
select is((select count(*)::int from account_balance_history where account_id = current_setting('t.linked')::uuid and source = 'sheet'),
  2, 'Unlinking an account keeps its imported history');

select * from finish();
rollback;
