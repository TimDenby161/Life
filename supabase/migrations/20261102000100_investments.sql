-- =============================================================================
-- Investments: each person's holdings and what to do with them.
--
-- * investment_holdings: one row per holding. value_minor is what the owner
--   last entered (there is no price feed), target_pct is its share of the
--   long-term mix (null = not part of it), action and reason are the verdict.
-- * investment_settings: one row per person: monthly contribution, how much
--   to keep safe for the wedding (null = not decided yet) and the date the
--   values were last checked.
--
-- The plan (sells, cash to set aside, buys) is worked out in the app
-- (src/modules/investments/lib/plan.ts), never stored.
--
-- Like health: both members can see everything, only the owner writes.
-- =============================================================================

create table public.investment_holdings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  ticker text not null check (char_length(ticker) between 1 and 12),
  name text not null check (char_length(name) between 1 and 80),
  in_pie boolean not null default false,
  asset_class text not null default 'shares' check (asset_class in ('shares', 'bonds', 'cash')),
  value_minor bigint not null default 0 check (value_minor >= 0),
  target_pct smallint check (target_pct between 0 and 100),
  action text not null default 'keep' check (action in ('keep', 'sell', 'review')),
  reason text check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  unique (user_id, ticker)
);

create trigger investment_holdings_updated_at before update on public.investment_holdings
  for each row execute function public.set_updated_at();

create table public.investment_settings (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid primary key default auth.uid(),
  monthly_minor bigint not null default 0 check (monthly_minor >= 0),
  wedding_minor bigint check (wedding_minor >= 0),
  values_as_of date,
  updated_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);

create trigger investment_settings_updated_at before update on public.investment_settings
  for each row execute function public.set_updated_at();

alter table public.investment_holdings enable row level security;
alter table public.investment_settings enable row level security;

create policy "investment_holdings: household read" on public.investment_holdings
  for select to authenticated using (public.is_household_member(household_id));
create policy "investment_holdings: owner insert" on public.investment_holdings
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));
create policy "investment_holdings: owner update" on public.investment_holdings
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "investment_holdings: owner delete" on public.investment_holdings
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "investment_settings: household read" on public.investment_settings
  for select to authenticated using (public.is_household_member(household_id));
create policy "investment_settings: owner insert" on public.investment_settings
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));
create policy "investment_settings: owner update" on public.investment_settings
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, delete on public.investment_holdings to authenticated;
grant insert (id, household_id, ticker, name, in_pie, asset_class, value_minor, target_pct, action, reason)
  on public.investment_holdings to authenticated;
grant update (ticker, name, in_pie, asset_class, value_minor, target_pct, action, reason)
  on public.investment_holdings to authenticated;

grant select on public.investment_settings to authenticated;
grant insert (household_id, monthly_minor, wedding_minor, values_as_of) on public.investment_settings to authenticated;
grant update (monthly_minor, wedding_minor, values_as_of) on public.investment_settings to authenticated;

alter publication supabase_realtime add table public.investment_holdings;
alter publication supabase_realtime add table public.investment_settings;
