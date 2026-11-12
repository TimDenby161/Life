-- =============================================================================
-- Shopping (/shopping): things you need or would like to buy. Not the weekly
-- food shop, which is Meals' shopping_items.
--
--   wants  one thing to buy. owner_id null = for both of you. need_by is an
--          optional deadline; without it, it's just on the list. bought_at is
--          set when it's ticked off and cleared to put it back.
-- Both of you can read and edit every row.
-- =============================================================================

create table public.wants (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Null = for both of you.
  owner_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 80),
  need_by date,
  note text check (note is null or char_length(note) <= 300),
  url text check (url is null or (char_length(url) <= 500 and url ~ '^https?://')),
  bought_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id) on delete cascade
);

create index wants_household_idx on public.wants (household_id, bought_at);

create trigger wants_updated_at before update on public.wants
  for each row execute function public.set_updated_at();

alter table public.wants enable row level security;

create policy "wants: members all" on public.wants
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select, delete on public.wants to authenticated;
grant insert (household_id, owner_id, name, need_by, note, url, bought_at) on public.wants to authenticated;
grant update (owner_id, name, need_by, note, url, bought_at) on public.wants to authenticated;

alter publication supabase_realtime add table public.wants;
