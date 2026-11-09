-- =============================================================================
-- Sleep, logged each morning with the weight in Home's check-in (from a Garmin,
-- which has no personal API): hours slept and the watch's sleep score (0-100).
-- Built-in metrics like weight, so they use the same readings table, owner-only
-- writes and household reads. measured_at is the morning you woke up.
-- =============================================================================

insert into public.health_metric_definitions (key, name, unit, category, decimals, aggregation, sort_order) values
  ('sleep_duration', 'Sleep', 'hours', 'sleep', 2, 'latest', 20),
  ('sleep_score', 'Sleep score', 'score', 'sleep', 0, 'latest', 30)
on conflict (key) where owner_id is null do nothing;
