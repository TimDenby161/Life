-- The morning run's summary pops up over Home once a day for people with AI
-- picks on, until they accept it. The day they last accepted it is kept here,
-- so accepting on one device closes it on the others. user_preferences already
-- has owner-only select/insert/update, which covers the new column.
alter table public.user_preferences
  add column ai_work_seen_on date;
