-- =============================================================================
-- Google Sheet balance sync.
--
-- The household keeps a monthly snapshot of every account in a Google Sheet
-- (one column per snapshot date). The finance-sheet-sync Edge Function reads
-- it with the read-only service account and records each linked account's
-- balances through apply_sheet_balances.
--
-- * finance_sheet_sources: which spreadsheet/tab to read (one per household).
--   The service-account key is an Edge Function secret, never stored here.
-- * An account is linked to a sheet row with external_provider =
--   'google_sheet' and external_account_id = the row key (section + labels).
-- * account_balance_history.source marks balances the sheet wrote, so they can
--   be labelled, corrected by the next sync, or removed together.
-- =============================================================================

create table public.finance_sheet_sources (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null unique references public.households (id) on delete cascade,
  name text not null default 'Month report' check (char_length(trim(name)) between 1 and 80),
  spreadsheet_id text not null check (spreadsheet_id ~ '^[A-Za-z0-9_-]{20,100}$'),
  sheet_name text not null default 'Sheet1' check (char_length(trim(sheet_name)) between 1 and 100),
  enabled boolean not null default true,
  -- Row keys the household chose not to import (so only new rows get flagged).
  skipped_row_keys text[] not null default '{}' check (cardinality(skipped_row_keys) <= 500),
  -- Written only by apply_sheet_balances.
  last_synced_at timestamptz,
  last_sync_error text check (char_length(last_sync_error) <= 300),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger finance_sheet_sources_updated_at before update on public.finance_sheet_sources
  for each row execute function public.set_updated_at();

alter table public.account_balance_history
  add column source text not null default 'manual' check (source in ('manual', 'sheet'));

alter table public.financial_accounts
  add constraint financial_accounts_external_provider_check
  check (external_provider is null or external_provider in ('google_sheet'));

-- -----------------------------------------------------------------------------
-- Applies one sync: upserts the sheet's balances for linked accounts, removes
-- sheet balances whose date column no longer exists, and records the outcome.
-- p_balances: [{ "account_id": uuid, "as_of": date, "balance_minor": bigint }]
-- Definer so the sync status columns stay non-client-writable; membership and
-- account ownership are checked explicitly.
-- -----------------------------------------------------------------------------
create or replace function public.apply_sheet_balances(p_source_id uuid, p_balances jsonb, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.finance_sheet_sources;
  v_written integer := 0;
  v_removed integer := 0;
begin
  select * into v_source from public.finance_sheet_sources where id = p_source_id;
  if v_source.id is null or not public.is_household_member(v_source.household_id) then
    raise exception 'Sheet source not found' using errcode = 'P0002';
  end if;

  if p_error is not null then
    update public.finance_sheet_sources set last_sync_error = left(p_error, 300) where id = v_source.id;
    return jsonb_build_object('written', 0, 'removed', 0);
  end if;
  if jsonb_typeof(p_balances) <> 'array' then
    raise exception 'p_balances must be an array' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_balances) b(account_id uuid, as_of date, balance_minor bigint)
    left join public.financial_accounts a
      on a.id = b.account_id and a.household_id = v_source.household_id and a.external_provider = 'google_sheet'
    where a.id is null or b.as_of is null or b.balance_minor is null
  ) then
    raise exception 'Balances must be for this household''s sheet-linked accounts' using errcode = '22023';
  end if;

  insert into public.account_balance_history (household_id, account_id, as_of, balance_minor, source)
  select v_source.household_id, b.account_id, b.as_of, b.balance_minor, 'sheet'
  from jsonb_to_recordset(p_balances) b(account_id uuid, as_of date, balance_minor bigint)
  on conflict (account_id, as_of) do update
    set balance_minor = excluded.balance_minor, source = 'sheet'
    where (public.account_balance_history.balance_minor, public.account_balance_history.source)
      is distinct from (excluded.balance_minor, 'sheet');
  get diagnostics v_written = row_count;

  -- A date column deleted from the sheet (or a cell cleared) removes that
  -- balance, but only for accounts that are still linked.
  delete from public.account_balance_history h
  using public.financial_accounts a
  where h.account_id = a.id
    and a.household_id = v_source.household_id
    and a.external_provider = 'google_sheet'
    and h.source = 'sheet'
    and not exists (
      select 1 from jsonb_to_recordset(p_balances) b(account_id uuid, as_of date)
      where b.account_id = h.account_id and b.as_of = h.as_of);
  get diagnostics v_removed = row_count;

  update public.finance_sheet_sources set last_synced_at = now(), last_sync_error = null where id = v_source.id;
  return jsonb_build_object('written', v_written, 'removed', v_removed);
end;
$$;

grant execute on function public.apply_sheet_balances(uuid, jsonb, text) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS + grants. Not in the realtime publication: balances it writes already
-- are, and that is what the other person's screens need to refresh.
-- -----------------------------------------------------------------------------
alter table public.finance_sheet_sources enable row level security;

create policy "finance_sheet_sources: members all" on public.finance_sheet_sources
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select, delete on public.finance_sheet_sources to authenticated;
grant insert (id, household_id, name, spreadsheet_id, sheet_name, enabled, skipped_row_keys) on public.finance_sheet_sources to authenticated;
grant update (name, spreadsheet_id, sheet_name, enabled, skipped_row_keys) on public.finance_sheet_sources to authenticated;

-- Linking an account to a sheet row is an ordinary account edit.
grant insert (external_provider, external_account_id), update (external_provider, external_account_id)
  on public.financial_accounts to authenticated;
