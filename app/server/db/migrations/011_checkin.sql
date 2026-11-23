-- Reception check-in (plan 2026-11-21-reception-check-in.md).
-- A trainer's login points at their instructor row, so they see only their own classes, read only.
alter table staff add column instructor_id text references instructors (id);
-- Which staff member made a change by hand. Null for older rows and for changes the system made.
alter table staff_log add column staff_id text references staff (id);
