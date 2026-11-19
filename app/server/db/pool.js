// One shared pg Pool per process. Null when DATABASE_URL is not set, so the app and its tests run without a database.
// max is small on purpose: every serverless instance holds its own pool and the Supabase session pooler has a limit.
import pg from 'pg';

let pool = null;

export function getPool(env = process.env) {
  if (!env.DATABASE_URL) return null;
  pool ??= new pg.Pool({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 5000,
  });
  // The pooler closes idle connections. pg then raises 'error' on the pool, and with no listener that crashes the process.
  // The pool drops the dead client by itself, so logging it is enough.
  pool.on('error', (e) => console.error('database pool error:', e.code ?? e.message));
  return pool;
}

export async function closePool() {
  const p = pool;
  pool = null;
  if (p) await p.end();
}
