// Test database. Default is in-process PGlite. With TEST_REAL_DB=1 it is the Postgres in DATABASE_URL, inside a
// throwaway schema that is dropped afterwards, so the project's public schema is never touched.
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export async function openTestDb() {
  if (!process.env.TEST_REAL_DB) {
    const db = new PGlite();
    return { exec: (s) => db.exec(s), query: (s, p) => db.query(s, p), close: () => db.close() };
  }
  const schema = `t_${Math.random().toString(36).slice(2, 10)}`;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(`create schema ${schema}; set search_path to ${schema}`);
  return {
    exec: (s) => client.query(s),
    query: (s, p) => client.query(s, p),
    close: async () => {
      await client.query(`drop schema ${schema} cascade`);
      await client.end();
    },
  };
}
