-- =============================================================================
-- Cashflow (Finance, Cashflow tab): the regular money coming in and going out,
-- typed in, to see what's left each month.
--
--   cashflow_items  one regular amount. direction 'in' (salary…) or 'out'
--                   (mortgage, bills…). every 'month' or 'year' (a year's
--                   amount counts as a twelfth a month). owner_id null =
--                   joint. Both of you can read and edit every row.
-- =============================================================================

create table public.cashflow_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  name text not null check (char_length(trim(name)) between 1 and 60),
  amount_minor bigint not null check (amount_minor between 1 and 100000000),
  every text not null default 'month' check (every in ('month', 'year')),
  -- Null = joint.
  owner_id uuid,
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id) on delete cascade
);

create index cashflow_items_household_idx on public.cashflow_items (household_id, direction, sort_order);

create trigger cashflow_items_updated_at before update on public.cashflow_items
  for each row execute function public.set_updated_at();

alter table public.cashflow_items enable row level security;

create policy "cashflow_items: members all" on public.cashflow_items
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select, delete on public.cashflow_items to authenticated;
grant insert (household_id, direction, name, amount_minor, every, owner_id, sort_order) on public.cashflow_items to authenticated;
grant update (direction, name, amount_minor, every, owner_id, sort_order) on public.cashflow_items to authenticated;

alter publication supabase_realtime add table public.cashflow_items;
