-- =============================================================================
-- Ingredients you already have: the Have list on the Plan view of /meals.
--
--   meal_pantry   things in the kitchen to use up ("chicken thighs", "half a
--                 squash"). Shared; either of you can add or remove them.
--                 The shopping-list function sends Claude just the names, so
--                 the plan leans on them, new recipes use them where they fit,
--                 and the shopping list leaves them off.
-- =============================================================================

create table public.meal_pantry (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create index meal_pantry_household_idx on public.meal_pantry (household_id, created_at);

alter table public.meal_pantry enable row level security;

create policy "meal_pantry: members all" on public.meal_pantry
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select, delete on public.meal_pantry to authenticated;
grant insert (household_id, name) on public.meal_pantry to authenticated;

alter publication supabase_realtime add table public.meal_pantry;
