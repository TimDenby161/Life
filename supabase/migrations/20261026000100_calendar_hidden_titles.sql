-- Events whose title exactly matches one of these (case- and
-- whitespace-insensitive) are dropped by the calendar-events function, e.g.
-- shift markers like "Work AM" that clutter the household view.
alter table public.calendar_integrations
  add column hidden_event_titles text[] not null default '{}'
    check (cardinality(hidden_event_titles) <= 50);

grant insert (hidden_event_titles), update (hidden_event_titles) on public.calendar_integrations to authenticated;

-- Existing calendars start with the shift titles the household asked to hide.
update public.calendar_integrations
set hidden_event_titles = array['Work', 'Work AM', 'Work PM']
where hidden_event_titles = '{}';
