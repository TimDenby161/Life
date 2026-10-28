-- Garden is not a task category, and Mandarin is a category, not a room.
-- Their tasks and jobs stay: the foreign keys clear category_id / room_id.

-- A job in the Mandarin room keeps Mandarin as its category.
update public.tasks t
set category_id = c.id
from public.task_rooms r, public.task_categories c
where t.room_id = r.id
  and lower(r.name) = 'mandarin'
  and t.category_id is null
  and c.household_id = t.household_id
  and lower(c.name) = 'mandarin';

delete from public.task_rooms where lower(name) = 'mandarin';

delete from public.task_categories where lower(name) = 'garden';
