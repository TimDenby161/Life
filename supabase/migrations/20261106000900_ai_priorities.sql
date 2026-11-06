-- AI picks a person's top jobs each morning (Claude, via the agents function).
-- Per person and off by default: it sends that person's job titles, dates and
-- today's busy times (not event titles) to Anthropic.
alter table public.user_preferences
  add column ai_priorities boolean not null default false;
-- user_preferences already has table-level select/insert/update for the owner.
