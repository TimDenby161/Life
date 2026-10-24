-- =============================================================================
-- Finances (manual entry; import/bank-ready).
--
-- Money is stored as bigint minor units (pence) with the currency on the
-- account. Balances are signed: assets positive, liabilities (credit cards,
-- loans, mortgages) negative.
--
-- Transfers are two legs sharing transfer_id with opposite signs and
-- kind = 'transfer'. They are excluded from income/expense statistics, and a
-- deferred constraint trigger guarantees both legs always exist together.
--
-- account_balance_history holds *recorded* balances (e.g. from a statement or
-- an investment valuation). A current balance is the latest recorded balance
-- plus transactions after it (or the opening balance plus all transactions).
-- A recording covers transactions dated before it, plus same-day transactions
-- entered before it was recorded.
-- =============================================================================

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  institution text check (char_length(institution) <= 80),
  account_type text not null check (account_type in
    ('current', 'savings', 'credit_card', 'loan', 'mortgage', 'investment', 'pension', 'cash', 'other')),
  ownership text not null check (ownership in ('joint', 'personal')),
  owner_id uuid,
  currency char(3) not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  opening_balance_minor bigint not null default 0,
  opening_date date not null default current_date,
  is_liability boolean generated always as (account_type in ('credit_card', 'loan', 'mortgage')) stored,
  include_in_net_worth boolean not null default true,
  color text not null default 'slate',
  sort_order integer not null default 0,
  -- Future bank/aggregator connections (not used yet).
  external_provider text,
  external_account_id text,
  archived_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, external_provider, external_account_id),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id),
  check ((ownership = 'personal') = (owner_id is not null))
);

create trigger financial_accounts_updated_at before update on public.financial_accounts
  for each row execute function public.set_updated_at();

create table public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  kind text not null check (kind in ('income', 'expense')),
  color text not null default 'slate',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, household_id)
);

create unique index finance_categories_name_uniq on public.finance_categories (household_id, kind, lower(name));

create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid not null,
  occurred_on date not null,
  amount_minor bigint not null check (amount_minor <> 0),
  kind text not null check (kind in ('income', 'expense', 'transfer', 'adjustment')),
  category_id uuid,
  description text not null check (char_length(trim(description)) between 1 and 200),
  notes text check (char_length(notes) <= 2000),
  transfer_id uuid,
  -- Import / bank-sync support.
  source text not null default 'manual' check (source in ('manual', 'import', 'bank')),
  external_id text,
  import_batch_id uuid,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, household_id) references public.financial_accounts (id, household_id) on delete cascade,
  foreign key (category_id, household_id) references public.finance_categories (id, household_id) on delete set null (category_id),
  unique (account_id, external_id),
  check ((kind = 'transfer') = (transfer_id is not null)),
  check (kind <> 'transfer' or category_id is null)
);

create index financial_transactions_household_date_idx on public.financial_transactions (household_id, occurred_on desc);
create index financial_transactions_account_date_idx on public.financial_transactions (account_id, occurred_on);
create index financial_transactions_transfer_idx on public.financial_transactions (transfer_id) where transfer_id is not null;

create trigger financial_transactions_updated_at before update on public.financial_transactions
  for each row execute function public.set_updated_at();

-- Transfers must always be exactly two legs on different accounts with
-- opposite signs. Deferred so both legs can be inserted in one transaction.
create or replace function public.check_transfer_pair()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer_id uuid := coalesce(new.transfer_id, old.transfer_id);
  v_legs integer;
  v_accounts integer;
  v_positive integer;
begin
  if v_transfer_id is null then
    return null;
  end if;
  select count(*), count(distinct account_id), count(*) filter (where amount_minor > 0)
  into v_legs, v_accounts, v_positive
  from public.financial_transactions
  where transfer_id = v_transfer_id;
  if v_legs <> 0 and (v_legs <> 2 or v_accounts <> 2 or v_positive <> 1) then
    raise exception 'A transfer needs exactly two legs on different accounts with opposite signs'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger financial_transactions_transfer_pair
  after insert or update or delete on public.financial_transactions
  deferrable initially deferred
  for each row execute function public.check_transfer_pair();

create table public.account_balance_history (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid not null,
  as_of date not null,
  balance_minor bigint not null,
  note text check (char_length(note) <= 500),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (account_id, household_id) references public.financial_accounts (id, household_id) on delete cascade,
  unique (account_id, as_of)
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  category_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  starts_month date not null check (extract(day from starts_month) = 1),
  ends_month date check (ends_month is null or extract(day from ends_month) = 1),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, household_id) references public.finance_categories (id, household_id) on delete cascade,
  unique (category_id, starts_month),
  check (ends_month is null or ends_month >= starts_month)
);

create trigger budgets_updated_at before update on public.budgets
  for each row execute function public.set_updated_at();

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  target_minor bigint not null check (target_minor > 0),
  currency char(3) not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  target_date date,
  -- Progress comes from the linked account's balance, or the manual amount.
  account_id uuid,
  manual_saved_minor bigint not null default 0 check (manual_saved_minor >= 0),
  ownership text not null default 'joint' check (ownership in ('joint', 'personal')),
  owner_id uuid,
  reached_at timestamptz,
  archived_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, household_id) references public.financial_accounts (id, household_id) on delete set null (account_id),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id),
  check ((ownership = 'personal') = (owner_id is not null))
);

create trigger savings_goals_updated_at before update on public.savings_goals
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Balances
-- -----------------------------------------------------------------------------
create or replace function public.account_balance_on(p_account_id uuid, p_date date)
returns bigint
language sql
stable
set search_path = ''
as $$
  with snap as (
    select h.as_of, h.balance_minor, h.created_at
    from public.account_balance_history h
    where h.account_id = p_account_id and h.as_of <= p_date
    order by h.as_of desc
    limit 1
  ),
  acct as (
    select a.opening_date, a.opening_balance_minor from public.financial_accounts a where a.id = p_account_id
  )
  select case
    when exists (select 1 from snap) then
      (select balance_minor from snap)
      + coalesce((select sum(t.amount_minor) from public.financial_transactions t
                  where t.account_id = p_account_id
                    and t.occurred_on <= p_date
                    -- Same-day transactions entered after the balance was recorded still count.
                    and (t.occurred_on > (select as_of from snap)
                         or (t.occurred_on = (select as_of from snap) and t.created_at > (select created_at from snap)))), 0)
    else
      (select opening_balance_minor from acct)
      + coalesce((select sum(t.amount_minor) from public.financial_transactions t, acct
                  where t.account_id = p_account_id
                    and t.occurred_on >= acct.opening_date and t.occurred_on <= p_date), 0)
  end::bigint;
$$;

grant execute on function public.account_balance_on(uuid, date) to authenticated;

-- Runs with the caller's privileges, so RLS on the underlying tables applies.
create view public.financial_account_balances
with (security_invoker = true)
as
  select
    a.id as account_id,
    a.household_id,
    a.currency,
    public.account_balance_on(a.id, current_date) as balance_minor,
    (select max(h.as_of) from public.account_balance_history h where h.account_id = a.id) as last_recorded_on
  from public.financial_accounts a;

-- -----------------------------------------------------------------------------
-- Savings goal reached detection -> activity event (no amounts in the feed).
-- -----------------------------------------------------------------------------
create or replace function public.refresh_savings_goals(p_household_id uuid, p_account_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal record;
begin
  for v_goal in
    update public.savings_goals g
    set reached_at = now()
    where g.household_id = p_household_id
      and g.reached_at is null
      and g.archived_at is null
      and (p_account_id is null or g.account_id = p_account_id)
      and (case when g.account_id is not null
                then public.account_balance_on(g.account_id, current_date)
                else g.manual_saved_minor end) >= g.target_minor
    returning g.id, g.name
  loop
    perform public.log_feed_event(
      p_household_id, auth.uid(), 'goal.reached', 'savings_goal', v_goal.id,
      'Savings goal reached: ' || v_goal.name, '{}'::jsonb);
  end loop;
end;
$$;

create or replace function public.finance_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'savings_goals' then
    perform public.refresh_savings_goals(coalesce(new.household_id, old.household_id), null);
  else
    perform public.refresh_savings_goals(coalesce(new.household_id, old.household_id), coalesce(new.account_id, old.account_id));
  end if;
  return null;
end;
$$;

create trigger financial_transactions_goals after insert or update or delete on public.financial_transactions
  for each row execute function public.finance_after_change();
create trigger account_balance_history_goals after insert or update or delete on public.account_balance_history
  for each row execute function public.finance_after_change();
create trigger savings_goals_refresh after insert or update of target_minor, manual_saved_minor, account_id, archived_at
  on public.savings_goals
  for each row when (pg_trigger_depth() = 0)
  execute function public.finance_after_change();

-- -----------------------------------------------------------------------------
-- Transfers (RLS applies: SECURITY INVOKER).
-- -----------------------------------------------------------------------------
create or replace function public.create_transfer(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount_minor bigint,
  p_occurred_on date,
  p_description text,
  p_to_amount_minor bigint default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_transfer_id uuid := gen_random_uuid();
  v_from public.financial_accounts;
  v_to public.financial_accounts;
begin
  if p_amount_minor is null or p_amount_minor <= 0 or coalesce(p_to_amount_minor, p_amount_minor) <= 0 then
    raise exception 'Transfer amount must be positive' using errcode = '22023';
  end if;
  select * into v_from from public.financial_accounts where id = p_from_account_id;
  select * into v_to from public.financial_accounts where id = p_to_account_id;
  if v_from.id is null or v_to.id is null then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if v_from.household_id <> v_to.household_id then
    raise exception 'Accounts must belong to the same household' using errcode = '22023';
  end if;
  if v_from.currency <> v_to.currency and p_to_amount_minor is null then
    raise exception 'Cross-currency transfers need the received amount' using errcode = '22023';
  end if;

  insert into public.financial_transactions (household_id, account_id, occurred_on, amount_minor, kind, description, notes, transfer_id)
  values
    (v_from.household_id, v_from.id, p_occurred_on, -p_amount_minor, 'transfer', p_description, p_notes, v_transfer_id),
    (v_to.household_id, v_to.id, p_occurred_on, coalesce(p_to_amount_minor, p_amount_minor), 'transfer', p_description, p_notes, v_transfer_id);
  return v_transfer_id;
end;
$$;

grant execute on function public.create_transfer(uuid, uuid, bigint, date, text, bigint, text) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS + grants. Both members see and manage the complete household picture.
-- -----------------------------------------------------------------------------
alter table public.financial_accounts enable row level security;
alter table public.finance_categories enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.account_balance_history enable row level security;
alter table public.budgets enable row level security;
alter table public.savings_goals enable row level security;

create policy "financial_accounts: members all" on public.financial_accounts
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "finance_categories: members all" on public.finance_categories
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "financial_transactions: members all" on public.financial_transactions
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "account_balance_history: members all" on public.account_balance_history
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "budgets: members all" on public.budgets
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "savings_goals: members all" on public.savings_goals
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select, delete on public.financial_accounts to authenticated;
grant insert (id, household_id, name, institution, account_type, ownership, owner_id, currency,
              opening_balance_minor, opening_date, include_in_net_worth, color, sort_order)
  on public.financial_accounts to authenticated;
grant update (name, institution, account_type, ownership, owner_id, opening_balance_minor, opening_date,
              include_in_net_worth, color, sort_order, archived_at)
  on public.financial_accounts to authenticated;
grant select, insert, update, delete on public.finance_categories to authenticated;
grant select, delete on public.financial_transactions to authenticated;
grant insert (id, household_id, account_id, occurred_on, amount_minor, kind, category_id, description, notes,
              transfer_id, source, external_id, import_batch_id)
  on public.financial_transactions to authenticated;
grant update (occurred_on, amount_minor, kind, category_id, description, notes)
  on public.financial_transactions to authenticated;
grant select, delete on public.account_balance_history to authenticated;
grant insert (id, household_id, account_id, as_of, balance_minor, note) on public.account_balance_history to authenticated;
grant update (as_of, balance_minor, note) on public.account_balance_history to authenticated;
grant select, delete on public.budgets to authenticated;
grant insert (id, household_id, category_id, amount_minor, currency, starts_month, ends_month) on public.budgets to authenticated;
grant update (amount_minor, starts_month, ends_month) on public.budgets to authenticated;
grant select, delete on public.savings_goals to authenticated;
grant insert (id, household_id, name, target_minor, currency, target_date, account_id, manual_saved_minor, ownership, owner_id)
  on public.savings_goals to authenticated;
grant update (name, target_minor, target_date, account_id, manual_saved_minor, ownership, owner_id, archived_at)
  on public.savings_goals to authenticated;
grant select on public.financial_account_balances to authenticated;
