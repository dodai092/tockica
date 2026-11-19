// Runs fn inside one transaction. `db` is a pg Pool (a client is taken and given back), a client already taken from a
// pool, or a single connection such as PGlite. Any error rolls back and propagates.
// A call made on a connection that is already inside a transaction joins it, so a rule that opens its own transaction
// can run inside a bigger one and everything commits or rolls back together. A pool is told apart by totalCount:
// a checked-out pg client has connect() too, and must not be connected again.
const open = new WeakSet();

export async function inTransaction(db, fn) {
  if (open.has(db)) return fn(db);
  const conn = typeof db.totalCount === 'number' ? await db.connect() : db;
  open.add(conn);
  try {
    await conn.query('begin');
    const out = await fn(conn);
    await conn.query('commit');
    return out;
  } catch (e) {
    await conn.query('rollback').catch(() => {});
    throw e;
  } finally {
    open.delete(conn);
    if (conn !== db) conn.release();
  }
}
