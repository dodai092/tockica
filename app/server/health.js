// GET /api/health. `db` is true only when the database answers a query. A down database is not an error here:
// the answer stays 200 so the page can show "app up, database down" instead of a failed request.
import { getPool } from './db/pool.js';

export async function handleHealth(_req, env = process.env, pool = getPool) {
  const db = pool(env);
  let up = false;
  if (db) {
    try {
      await db.query('select 1');
      up = true;
    } catch {
      up = false;
    }
  }
  return Response.json({ ok: true, db: up });
}
