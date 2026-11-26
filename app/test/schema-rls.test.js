// Migration 012: Supabase's public roles get nothing. The app connects as the table owner, which row level security
// does not limit. Supabase grants those roles everything on new tables, so the test sets that up before migrating.
// A later migration that adds a table without row level security fails here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';

let db;
let schema;

before(async () => {
  db = await openTestDb();
  schema = (await db.query('select current_schema() as s')).rows[0].s;
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    end $$;
    alter default privileges in schema ${schema} grant all on tables to anon, authenticated;
    alter default privileges in schema ${schema} grant all on sequences to anon, authenticated;
    create table schema_migrations (name text primary key, applied_at timestamptz not null default now());
  `);
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
after(() => db.close());

const names = async (sql) => (await db.query(sql, [schema])).rows.map((r) => r.name);

test('every table has row level security on', async () => {
  const open = await names(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind in ('r', 'p') and not c.relrowsecurity`
  );
  assert.deepEqual(open, []);
});

const GRANTED = `
  select r.role || ' ' || c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace, (values ('anon'), ('authenticated')) r(role)
   where n.nspname = $1 and case
     when c.relkind in ('r', 'p', 'v', 'm') then has_table_privilege(r.role, c.oid, 'select, insert, update, delete, truncate, references, trigger')
     when c.relkind = 'S' then has_sequence_privilege(r.role, c.oid, 'usage, select, update')
     else false end`;

test('the public roles have no rights on any table or sequence', async () => {
  assert.deepEqual(await names(GRANTED), []);
});

test('a table made after the migrations gives the public roles nothing', async () => {
  await db.exec('create table later_table (id serial primary key)');
  assert.deepEqual(await names(GRANTED), []);
  await db.exec('drop table later_table');
});

test('the owner, which the app connects as, still reads and writes', async () => {
  await db.exec(`insert into instructors (id, first_name, full_name, slug) values ('ins_1', 'Test', 'Test Person', 'test')`);
  assert.equal((await db.query('select count(*)::int as n from instructors')).rows[0].n, 1);
});
