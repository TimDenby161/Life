-- =============================================================================
-- A wedding date can be known only to the month ("around September 2028").
-- wedding_date then holds the 1st of that month, and the app shows the month
-- and "about N months to go" instead of an exact countdown.
-- =============================================================================

alter table public.wedding_settings
  add column wedding_date_approx boolean not null default false;

grant insert (wedding_date_approx), update (wedding_date_approx) on public.wedding_settings to authenticated;
