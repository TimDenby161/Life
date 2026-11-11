-- Plan: say whether you want a quick meal or a longer cook for each lunch and
-- dinner. It lives on the slot's note row, so a row can now hold a note, an
-- effort or both (never neither: an empty row is deleted instead).

alter table public.meal_slot_notes drop constraint meal_slot_notes_note_check;
alter table public.meal_slot_notes alter column note set default '';
alter table public.meal_slot_notes
  add constraint meal_slot_notes_note_check check (char_length(note) <= 120),
  add column effort text check (effort in ('quick', 'long')),
  add constraint meal_slot_notes_not_empty check (char_length(trim(note)) > 0 or effort is not null);

grant insert (effort) on public.meal_slot_notes to authenticated;
grant update (effort) on public.meal_slot_notes to authenticated;
