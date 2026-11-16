-- =============================================================================
-- What each wedding venue costs, typed in by either of you (integer pence,
-- shown in whole pounds). Claude never fills it: its venue notes carry no
-- guessed prices, and agent_save_work doesn't touch this column.
-- Applied to live through the Supabase tools, so the file carries that version; safe to run twice.
-- =============================================================================

alter table public.wedding_venues
  add column if not exists price_minor bigint check (price_minor is null or (price_minor >= 0 and price_minor <= 100000000000));

grant insert (price_minor), update (price_minor) on public.wedding_venues to authenticated;
