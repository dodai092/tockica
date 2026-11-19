-- Staff login (ADR 0004): the same rule as customer sessions. The cookie holds a random value, this table holds its sha256 hash.
-- No second step for now (ADR 0004 update 2026-11-19), so there is no table for a half-finished login.
create table staff_sessions (
  token_hash   text primary key,
  staff_id     text not null references staff (id) on delete cascade,
  created_at   timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at   timestamptz not null
);
create index staff_sessions_staff_idx on staff_sessions (staff_id);
