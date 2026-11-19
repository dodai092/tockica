-- Customer login sessions (plan Task 4). The cookie holds a random value, this table holds its sha256 hash,
-- so a copy of the table cannot be used to sign in. expires_at is the sliding 30 days, capped at created_at + 180 days.
create table sessions (
  token_hash   text primary key,
  account_id   text not null references accounts (id) on delete cascade,
  created_at   timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at   timestamptz not null
);
create index sessions_account_idx on sessions (account_id);
