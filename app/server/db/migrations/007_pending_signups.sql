-- A signup waits here until the person confirms their email and logs in for the first time (ADR 0007). Only then is the
-- account row made, from this profile, so an unconfirmed signup holds no account and no email slot. The password is
-- never stored here, Supabase holds it.
create table pending_signups (
  supabase_user_id text primary key,
  email            text not null,
  profile          jsonb not null,
  created_at       timestamptz not null
);
create index pending_signups_email_idx on pending_signups (email);
