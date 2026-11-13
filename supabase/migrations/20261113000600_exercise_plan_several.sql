-- Several exercises on one day ("Gym, Run, Yoga"): room for them in one box.
alter table public.exercise_plan drop constraint exercise_plan_activity_check;
alter table public.exercise_plan add constraint exercise_plan_activity_check
  check (activity is null or char_length(trim(activity)) between 1 and 200);
