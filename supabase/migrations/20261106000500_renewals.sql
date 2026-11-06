-- =============================================================================
-- Renewals: things that expire and need renewing (passport, MOT, insurance…),
-- for the Life Admin agent. Shared by the household like most data; a personal
-- one names its owner, and only they get its reminders. Dates and names only:
-- no policy numbers, documents or notes.
-- =============================================================================

create table public.renewals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  -- Null = joint (both get reminders).
  owner_id uuid,
  expires_on date not null,
  -- Start reminding this many days before.
  warn_days smallint not null default 30 check (warn_days between 1 and 365),
  -- Renewed every n months (12 for insurance), so "Renewed" moves the date on. Null = set it by hand.
  every_months smallint check (every_months between 1 and 120),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id) on delete cascade
);

create index renewals_household_idx on public.renewals (household_id, expires_on);

create trigger renewals_updated_at before update on public.renewals
  for each row execute function public.set_updated_at();

alter table public.renewals enable row level security;

create policy "renewals: members all" on public.renewals
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select, delete on public.renewals to authenticated;
grant insert (household_id, name, owner_id, expires_on, warn_days, every_months) on public.renewals to authenticated;
grant update (name, owner_id, expires_on, warn_days, every_months) on public.renewals to authenticated;

alter publication supabase_realtime add table public.renewals;
