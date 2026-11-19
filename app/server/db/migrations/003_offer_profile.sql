-- 003_offer_profile: the signup profile, the Waitlist offer pass and the booking opening day
-- (docs/superpowers/plans/2026-11-17-booking-plan-update.md, sections 2.2, 2.3 and 2.6).
-- `name` stays until the prototype modules stop reading it. The new columns are null for walk-ins and old rows.

alter table accounts
  add column first_name          text,
  add column last_name           text,
  add column birth_date          date,
  add column waitlist_joined_at  timestamptz;

-- Bought 4 to 31 January, valid 30 days from the day of purchase. order_id gets its foreign key in 004.
create table passes (
  id          text primary key,
  account_id  text not null references accounts (id),
  kind        text not null default 'waitlist_offer' check (kind in ('waitlist_offer')),
  valid_from  date not null,
  valid_to    date not null check (valid_to > valid_from),
  price_cents integer not null check (price_cents >= 0),
  order_id    text,
  paid_on     date,
  note        text,
  created_at  timestamptz not null default now()
);
create unique index passes_one_offer_per_account on passes (account_id) where kind = 'waitlist_offer';

-- No booking before this studio day, whatever the screen shows. max_passes null means no cap on the offer.
alter table settings
  add column booking_opens_on date not null default '2027-01-04',
  add column max_passes       integer check (max_passes is null or max_passes > 0);
