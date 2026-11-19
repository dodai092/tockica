-- The "First time ride?" tick box. prototype/src/waiver.js (needsWaiver) reads it, 001_core left it out.
alter table accounts add column first_ride boolean not null default false;
