// Netlify scheduled function: turns Booked into No-show in every class that has ended. The sweep is safe to repeat,
// so the schedule is plain UTC and the clock changes need no special case.
import { getPool } from '../db/pool.js';
import { sweepEndedClasses } from '../checkin-sweep.js';

export default async () => {
  const db = getPool();
  if (!db) return new Response('No database', { status: 503 });
  return Response.json({ noShows: await sweepEndedClasses(db, new Date()) });
};

export const config = { schedule: '*/15 * * * *' };
