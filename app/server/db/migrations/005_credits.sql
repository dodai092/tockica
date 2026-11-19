-- 005_credits: the credit ledger on the database (plan Task 15, pulled forward, update 2026-11-17 section 2.9).
-- Shapes follow prototype/src/ledger.js. A lot is a batch of classes with one expiry. Credits are spent from the lot
-- that expires first. A returned or restored credit is a new lot, so history is never rewritten.

create table lots (
  id          text primary key,
  account_id  text not null references accounts (id),
  pack_id     text references packs (id),  -- null for legacy lots
  expires_at  timestamptz not null,
  remaining   integer not null check (remaining >= 0),
  origin      text not null check (origin in ('purchase', 'returned', 'legacy', 'restore')),
  created_at  timestamptz not null default now()
);
create index lots_account on lots (account_id);

create table spent_log (
  id          bigserial primary key,
  account_id  text not null references accounts (id),
  lot_id      text not null references lots (id),
  at          timestamptz not null
);
create index spent_log_account on spent_log (account_id);

-- What the owner gave back by hand, and why.
create table restored_log (
  id          bigserial primary key,
  account_id  text not null references accounts (id),
  count       integer not null check (count > 0),
  reason      text not null,
  at          timestamptz not null
);

-- Classes the owner types in for someone who held them under the old setup. They wait here until an account with the
-- same email exists, then become a lot. The email is stored in lower case.
create table legacy_packs (
  id          text primary key,
  email       text not null check (email = lower(email)),
  classes     integer not null check (classes > 0),
  expires_at  timestamptz not null,
  entered_at  timestamptz not null,
  claimed_by  text references accounts (id)
);
create index legacy_packs_email on legacy_packs (email) where claimed_by is null;

alter table bookings add constraint bookings_credit_lot_fk foreign key (credit_lot_id) references lots (id);
