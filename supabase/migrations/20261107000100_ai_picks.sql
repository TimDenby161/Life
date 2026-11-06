-- The day's AI-picked jobs per Top jobs tab: one person's, or 'together' for
-- jobs that need both. Readable by the household, like the tasks themselves,
-- so each tab shows its picks to whoever is looking. Written only by the
-- agents function (service role) once it has checked every pick is an open job
-- for that tab. Each pick says whether it needs you at home or can be done
-- anywhere, for the Home / Out switch.
create table public.ai_picks (
  household_id uuid not null references public.households (id) on delete cascade,
  -- A member's id, or 'together'.
  view text not null check (view = 'together' or view ~ '^[0-9a-f-]{36}$'),
  day date not null,
  picks jsonb not null check (jsonb_typeof(picks) = 'array' and jsonb_array_length(picks) <= 10),
  created_at timestamptz not null default now(),
  primary key (household_id, view, day)
);

alter table public.ai_picks enable row level security;

create policy "ai_picks: members read" on public.ai_picks
  for select to authenticated using (public.is_household_member(household_id));

grant select on public.ai_picks to authenticated;

create or replace function public.agent_save_picks(p_household_id uuid, p_view text, p_day date, p_picks jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.ai_picks (household_id, view, day, picks)
  values (p_household_id, p_view, p_day, p_picks)
  on conflict (household_id, view, day) do update set picks = excluded.picks, created_at = now();
  -- A week is plenty of history.
  delete from public.ai_picks where household_id = p_household_id and day < p_day - 7;
$$;

revoke execute on function public.agent_save_picks(uuid, text, date, jsonb) from public, anon, authenticated;
grant execute on function public.agent_save_picks(uuid, text, date, jsonb) to service_role;

alter publication supabase_realtime add table public.ai_picks;

-- Picks used to live on the person's briefing; nothing calls this any more.
drop function if exists public.agent_set_top_picks(uuid, uuid, date, jsonb);
