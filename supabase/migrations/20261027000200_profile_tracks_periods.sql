-- =============================================================================
-- The period tracker belongs to one person (Sophie), not a setting anyone
-- toggles. profiles.tracks_periods marks whose Health tab shows it; clients
-- can read it (profiles select) but not change it (no update grant).
-- Replaces the user_preferences.settings.track_periods switch.
-- =============================================================================

alter table public.profiles add column tracks_periods boolean not null default false;

update public.profiles set tracks_periods = true where display_name = 'Sophie';

update public.user_preferences set settings = settings - 'track_periods' where settings ? 'track_periods';
