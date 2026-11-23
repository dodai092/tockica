// The no-show sweep. The rule is closeClass in prototype/src/checkin.js (every Booked becomes No-show once the class has
// ended, no mail). This finds the classes that need it and runs the rule on each, one transaction per class.
import { runInTransaction } from './db/unit-of-work.js';
import { closeClass } from '../../prototype/src/checkin.js';

/** Returns how many bookings became No-show. Safe to run as often as you like: a class with nothing Booked is skipped. */
export async function sweepEndedClasses(pool, now) {
  const { rows } = await pool.query(
    `select distinct c.id from classes c join bookings b on b.class_id = c.id
     where b.status = 'booked' and c.starts_at + make_interval(mins => c.duration_min) <= $1`,
    [now.toISOString()],
  );
  let changed = 0;
  for (const { id } of rows) {
    changed += (await runInTransaction(pool, { classId: id }, (store) => closeClass(store, id, now))).length;
  }
  return changed;
}
