-- =============================================================================
-- Per-person agent settings beyond on/off, e.g. the Fitness Coach's weekly
-- goals: {"activeDays": 6, "activities": [{"name": "Padel", "times": 1}, ...]}.
-- Owner only, like the rest of agent_settings. The agents validate the shape
-- and ignore anything they don't recognise.
-- =============================================================================

alter table public.agent_settings
  add column config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 4000);

grant insert (config), update (config) on public.agent_settings to authenticated;
