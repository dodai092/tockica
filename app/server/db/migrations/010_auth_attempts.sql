-- Limits on password guessing and on mail requests (plan item B8). One row per attempt. The key is a sha256 of the lower-cased
-- email, so the table holds no address, and a script that tries thousands of made-up addresses leaves no personal data behind.
-- Rows older than a day are removed when a new one is written (server/throttle.js).
create table auth_attempts (
  kind text        not null,
  key  text        not null,
  at   timestamptz not null
);
create index auth_attempts_lookup_idx on auth_attempts (kind, key, at);
create index auth_attempts_at_idx on auth_attempts (at);
