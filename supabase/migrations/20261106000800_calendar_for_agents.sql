-- Whether the agents plan around a calendar. Off for one like Birthdays: the
-- Calendar page still shows it, but briefings and packed-day checks ignore it.

alter table public.calendar_integrations
  add column use_for_agents boolean not null default true;

grant insert (use_for_agents), update (use_for_agents) on public.calendar_integrations to authenticated;
