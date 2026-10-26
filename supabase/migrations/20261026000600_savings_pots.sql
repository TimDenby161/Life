-- =============================================================================
-- Savings pots.
--
-- A pot (e.g. "Holidays") is backed by one savings account. Its items are
-- savings_goals with pot_id set, in sort_order: the account's balance funds
-- them one at a time, the first in full before the next gets anything (the
-- waterfall is worked out in the app, finances/lib/pots.ts). Items have no
-- account of their own, so they never trigger "goal reached" on their own.
-- =============================================================================

create table public.savings_pots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  account_id uuid,
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (account_id, household_id) references public.financial_accounts (id, household_id) on delete set null (account_id)
);

create trigger savings_pots_updated_at before update on public.savings_pots
  for each row execute function public.set_updated_at();

alter table public.savings_goals
  add column pot_id uuid,
  add column sort_order integer not null default 0,
  add foreign key (pot_id, household_id) references public.savings_pots (id, household_id) on delete cascade,
  add check (pot_id is null or account_id is null);

create index savings_goals_pot_idx on public.savings_goals (pot_id, sort_order) where pot_id is not null;

-- -----------------------------------------------------------------------------
-- RLS + grants. Not in the realtime publication: pots change rarely, and their
-- items (savings_goals) and balances already sync.
-- -----------------------------------------------------------------------------
alter table public.savings_pots enable row level security;

create policy "savings_pots: members all" on public.savings_pots
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select, delete on public.savings_pots to authenticated;
grant insert (id, household_id, name, account_id, sort_order) on public.savings_pots to authenticated;
grant update (name, account_id, sort_order) on public.savings_pots to authenticated;

grant insert (pot_id, sort_order), update (sort_order) on public.savings_goals to authenticated;
