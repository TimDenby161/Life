-- Whose calendar it is, so the agents know whose day is busy: one person's,
-- or null for a shared calendar that counts for both.

alter table public.calendar_integrations
  add column owner_id uuid,
  add foreign key (household_id, owner_id) references public.household_members (household_id, user_id) on delete set null (owner_id);

grant insert (owner_id), update (owner_id) on public.calendar_integrations to authenticated;
