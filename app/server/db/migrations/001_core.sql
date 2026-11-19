-- 001_core: December scope. Shapes follow prototype/src/model.js (docs/superpowers/plans/2026-11-11-schema-gap-check.md).
-- Left for later migrations: credit lots and their logs, legacy packs, instructor rates (Q1), Sculpt Room (Q2).
-- Ids are text and keep the prototype prefixes (acc_, bk_, cls_, wl_, wv_, tpl_). Money is integer cents.
-- Times are timestamptz, stored in UTC. The studio's day is Europe/Zagreb, handled by the app.

create table accounts (
  id                   text primary key,
  supabase_user_id     text unique,
  name                 text not null,
  email                text not null,
  phone                text,
  multisport_tag       boolean not null default false,
  marketing_opt_in     boolean not null default false,
  marketing_opt_in_at  timestamptz,
  terms_accepted_at    timestamptz,
  terms_version        integer,
  referred_by          text,
  created_at           timestamptz not null default now()
);
create unique index accounts_email_key on accounts (lower(email));

create table staff (
  id                text primary key,
  supabase_user_id  text unique,
  name              text not null,
  email             text not null,
  role              text not null check (role in ('owner', 'reception', 'instructor', 'admin')),
  pin_hash          text,
  active            boolean not null default true
);
create unique index staff_email_key on staff (lower(email));

create table packs (
  id                     text primary key,
  name                   text not null,
  price_cents            integer not null check (price_cents >= 0),
  multisport_price_cents integer check (multisport_price_cents >= 0),
  classes                integer not null check (classes > 0),
  valid_days             integer not null check (valid_days > 0),
  intro                  boolean not null default false,
  active                 boolean not null default true
);

create table instructors (
  id          text primary key,
  first_name  text not null,
  full_name   text not null,
  slug        text not null unique,
  active      boolean not null default true
);

-- One row only. The Monday 10:00 Release and the rest of the owner's settings.
create table settings (
  id                    boolean primary key default true check (id),
  release_day_of_week   smallint not null default 1 check (release_day_of_week between 1 and 7),
  release_hour          smallint not null default 10 check (release_hour between 0 and 23),
  weeks_ahead           smallint not null default 2 check (weeks_ahead >= 1),
  returned_credit_days  smallint not null default 7,
  bonus_threshold       smallint not null default 15,
  bonus_cents           integer not null default 200,
  credits_enabled       boolean not null default false,
  terms_version         integer not null default 1
);
insert into settings default values;

create table template_entries (
  id             text primary key,
  day_of_week    smallint not null check (day_of_week between 1 and 7),
  time_of_day    time not null,
  name           text not null,
  instructor_id  text not null references instructors (id),
  theme_name     text
);

-- The date is the key. The Release skips these days.
create table closed_days (
  day date primary key
);

create table classes (
  id                    text primary key,
  template_key          text unique,
  name                  text not null,
  instructor_id         text not null references instructors (id),
  actual_instructor_id  text references instructors (id),
  theme_name            text,
  starts_at             timestamptz not null,
  duration_min          smallint not null default 50,
  bike_count            smallint not null default 20 check (bike_count between 1 and 20),
  release_opens_at      timestamptz not null,
  cancelled             boolean not null default false,
  cancel_reason         text,
  created_at            timestamptz not null default now()
);
create index classes_starts_at on classes (starts_at);

create table bookings (
  id             text primary key,
  class_id       text not null references classes (id),
  bike_no        smallint not null check (bike_no between 1 and 20),
  account_id     text not null references accounts (id),
  guest_name     text,
  status         text not null default 'booked'
                 check (status in ('booked', 'attended', 'no_show', 'cancelled', 'late_cancel')),
  credit_lot_id  text,  -- no foreign key until the Q1 ledger exists
  created_at     timestamptz not null default now(),
  cancelled_at   timestamptz,
  checked_in_at  timestamptz,
  charged_at     timestamptz,
  removed_reason text
);
-- One bike, one rider per class. A cancelled or late-cancelled booking frees the bike.
create unique index bookings_bike_taken on bookings (class_id, bike_no)
  where status not in ('cancelled', 'late_cancel');
create index bookings_account on bookings (account_id);

create table waitlist (
  id          text primary key,
  class_id    text not null references classes (id),
  account_id  text not null references accounts (id),
  created_at  timestamptz not null default now(),
  unique (class_id, account_id)
);

create table waiver_texts (
  version       integer primary key,
  body          text not null,
  published_at  timestamptz not null default now()
);

-- Signed once per account. A first-time Guest has no account, so the signature hangs on the booking.
create table waivers (
  id          text primary key,
  account_id  text references accounts (id),
  booking_id  text references bookings (id),
  name        text not null,
  version     integer not null references waiver_texts (version),
  signed_at   timestamptz not null default now(),
  check (account_id is not null or booking_id is not null)
);
create unique index waivers_one_per_account on waivers (account_id) where account_id is not null;

-- What staff changed by hand, so the owner can look back at who was removed or moved.
create table staff_log (
  id          bigserial primary key,
  type        text not null,
  booking_id  text,
  class_id    text,
  account_id  text,
  detail      text,
  at          timestamptz not null default now()
);

-- Mail waiting to go out. sent_at stays null until the provider accepts it.
create table outbox (
  id            bigserial primary key,
  to_email      text not null,
  from_email    text not null default 'info@tockicanai.hr',
  subject       text not null,
  body          text not null,
  action_label  text,
  action_url    text,
  lang          text not null default 'hr' check (lang in ('hr', 'en')),
  status        text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts      smallint not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);
create index outbox_pending on outbox (created_at) where status = 'pending';
