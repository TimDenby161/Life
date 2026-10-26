-- =============================================================================
-- Several sheet rows -> one account.
--
-- A household may keep an account as more than one sheet row (e.g. "Revolut
-- Joint" and "Santander Edge Explorer" together are "Joint Current"). Links
-- move from financial_accounts.external_* (one row per account) to
-- finance_sheet_links (one account per row, any number of rows per account).
-- Each synced balance is the sum of the account's rows on that date, and
-- account_balance_history.breakdown keeps the parts for display.
-- =============================================================================

create table public.finance_sheet_links (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid not null,
  -- Row key from the sheet parser (section + labels, lower-cased).
  row_key text not null check (char_length(row_key) between 1 and 300),
  created_at timestamptz not null default now(),
  foreign key (account_id, household_id) references public.financial_accounts (id, household_id) on delete cascade,
  unique (household_id, row_key)
);

create index finance_sheet_links_account_idx on public.finance_sheet_links (account_id);

-- Written only by apply_sheet_balances: [{ "label": text, "balance_minor": bigint }]
alter table public.account_balance_history
  add column breakdown jsonb check (breakdown is null or jsonb_typeof(breakdown) = 'array');

-- Existing one-row links carry over.
insert into public.finance_sheet_links (household_id, account_id, row_key)
select household_id, id, external_account_id
from public.financial_accounts
where external_provider = 'google_sheet' and external_account_id is not null;

update public.financial_accounts set external_provider = null, external_account_id = null
where external_provider = 'google_sheet';

-- external_* stays for future bank connections, unrestricted again.
alter table public.financial_accounts drop constraint financial_accounts_external_provider_check;
revoke insert (external_provider, external_account_id), update (external_provider, external_account_id)
  on public.financial_accounts from authenticated;

-- -----------------------------------------------------------------------------
-- p_balances: [{ "account_id", "as_of", "balance_minor", "breakdown" }], one
-- entry per account and date (the Edge Function sums the rows).
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
    select 1 from jsonb_to_recordset(p_balances) b(account_id uuid, as_of date, balance_minor bigint, breakdown jsonb)
    where b.as_of is null or b.balance_minor is null
       or (b.breakdown is not null and jsonb_typeof(b.breakdown) <> 'array')
       or not exists (
         select 1 from public.finance_sheet_links l
         where l.account_id = b.account_id and l.household_id = v_source.household_id)
  ) then
    raise exception 'Balances must be for this household''s sheet-linked accounts' using errcode = '22023';
  end if;

  insert into public.account_balance_history (household_id, account_id, as_of, balance_minor, breakdown, source)
  select v_source.household_id, b.account_id, b.as_of, b.balance_minor, b.breakdown, 'sheet'
  from jsonb_to_recordset(p_balances) b(account_id uuid, as_of date, balance_minor bigint, breakdown jsonb)
  on conflict (account_id, as_of) do update
    set balance_minor = excluded.balance_minor, breakdown = excluded.breakdown, source = 'sheet'
    where (public.account_balance_history.balance_minor, public.account_balance_history.breakdown, public.account_balance_history.source)
      is distinct from (excluded.balance_minor, excluded.breakdown, 'sheet');
  get diagnostics v_written = row_count;

  -- A date column deleted from the sheet (or a cell cleared) removes that
  -- balance, but only for accounts that are still linked.
  delete from public.account_balance_history h
  where h.household_id = v_source.household_id
    and h.source = 'sheet'
    and exists (select 1 from public.finance_sheet_links l where l.account_id = h.account_id)
    and not exists (
      select 1 from jsonb_to_recordset(p_balances) b(account_id uuid, as_of date)
      where b.account_id = h.account_id and b.as_of = h.as_of);
  get diagnostics v_removed = row_count;

  update public.finance_sheet_sources set last_synced_at = now(), last_sync_error = null where id = v_source.id;
  return jsonb_build_object('written', v_written, 'removed', v_removed);
end;
$$;

-- -----------------------------------------------------------------------------
-- Replaces the links for the given rows in one transaction (the link dialog
-- saves every row at once). p_links: [{ "row_key", "account_id" | null }].
-- Invoker: RLS and the column grants below apply.
-- -----------------------------------------------------------------------------
create or replace function public.replace_sheet_links(p_household_id uuid, p_links jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.finance_sheet_links l
  using jsonb_to_recordset(p_links) x(row_key text)
  where l.household_id = p_household_id and l.row_key = x.row_key;

  insert into public.finance_sheet_links (household_id, account_id, row_key)
  select p_household_id, x.account_id, x.row_key
  from jsonb_to_recordset(p_links) x(row_key text, account_id uuid)
  where x.account_id is not null;
end;
$$;

grant execute on function public.replace_sheet_links(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS + grants. Not in the realtime publication (as finance_sheet_sources):
-- the balances a sync writes are, and those drive the other person's screens.
-- -----------------------------------------------------------------------------
alter table public.finance_sheet_links enable row level security;

create policy "finance_sheet_links: members all" on public.finance_sheet_links
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select, delete on public.finance_sheet_links to authenticated;
grant insert (id, household_id, account_id, row_key) on public.finance_sheet_links to authenticated;
