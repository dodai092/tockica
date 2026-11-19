// Applies the SQL files in migrations/ that are not yet recorded in schema_migrations. Usage: node --env-file=.env server/db/migrate.js
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';

const dir = new URL('./migrations/', import.meta.url);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(name)) continue;
  await client.query('begin');
  try {
    await client.query(readFileSync(new URL(name, dir), 'utf8'));
    await client.query('insert into schema_migrations (name) values ($1)', [name]);
    await client.query('commit');
    console.log('applied', name);
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}
await client.end();
