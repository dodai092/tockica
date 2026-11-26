-- Supabase's Data API serves the public schema to the roles anon and authenticated, and gives them every right on new
-- tables. The app does not use that API: it connects as the table owner, which row level security does not limit.
-- So row level security goes on with no policies, and both roles lose their rights, also on tables made later.
-- A later migration that makes a table still has to turn row level security on for it (test/schema-rls.test.js).
-- current_schema() so the tests can run this in a throwaway schema. A plain database may not have the two roles.
do $$
declare
  t record;
  r text;
  s text := current_schema();
begin
  for t in select tablename from pg_tables where schemaname = s loop
    execute format('alter table %I.%I enable row level security', s, t.tablename);
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema %I from %I', s, r);
      execute format('revoke all on all sequences in schema %I from %I', s, r);
      execute format('alter default privileges in schema %I revoke all on tables from %I', s, r);
      execute format('alter default privileges in schema %I revoke all on sequences from %I', s, r);
    end if;
  end loop;
end $$;
