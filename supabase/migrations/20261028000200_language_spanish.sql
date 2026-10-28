-- Languages: add Spanish (Latin American). Same tables and rules as Mandarin;
-- Spanish has words only, no characters. The word list ships with the app
-- (src/modules/languages/data/spanish.json, built by scripts/build-spanish.mjs).

alter table public.language_study
  drop constraint language_study_language_check,
  add constraint language_study_language_check check (language in ('zh', 'es'));

alter table public.language_progress
  drop constraint language_progress_language_check,
  add constraint language_progress_language_check check (language in ('zh', 'es'));
