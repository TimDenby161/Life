-- The morning routine's one-line versions of the day's top news headlines, for
-- Home. Readable by the household; written only by the agents function (service
-- role), which checks each one belongs to a headline it served.
create table public.ai_headlines (
  household_id uuid not null references public.households (id) on delete cascade,
  day date not null,
  -- [{ url, title, short }]
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 10),
  created_at timestamptz not null default now(),
  primary key (household_id, day)
);

alter table public.ai_headlines enable row level security;

create policy "ai_headlines: members read" on public.ai_headlines
  for select to authenticated using (public.is_household_member(household_id));

grant select on public.ai_headlines to authenticated;

create or replace function public.agent_save_headlines(p_household_id uuid, p_day date, p_items jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.ai_headlines (household_id, day, items)
  values (p_household_id, p_day, p_items)
  on conflict (household_id, day) do update set items = excluded.items, created_at = now();
  delete from public.ai_headlines where household_id = p_household_id and day < p_day - 7;
$$;

revoke execute on function public.agent_save_headlines(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.agent_save_headlines(uuid, date, jsonb) to service_role;

alter publication supabase_realtime add table public.ai_headlines;
