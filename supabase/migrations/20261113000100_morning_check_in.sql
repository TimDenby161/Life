-- =============================================================================
-- Home's morning check-in (weight, sleep, sleep score) is now per person:
-- user_preferences.morning_check_in, on by default, switched in Settings.
-- Sophie doesn't want it (Tim, 13 Nov 2026), so hers starts off.
-- user_preferences already has owner-only select/insert/update, which covers it.
-- =============================================================================

alter table public.user_preferences
  add column morning_check_in boolean not null default true;

update public.user_preferences
  set morning_check_in = false
  where user_id in (select id from public.profiles where display_name = 'Sophie');
