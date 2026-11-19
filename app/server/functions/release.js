// Netlify scheduled function: runs the weekly Release check every hour. runRelease decides itself whether a release
// has happened, so the schedule is plain hourly UTC and the clock changes need no special case.
import { getPool } from '../db/pool.js';
import { runRelease } from '../jobs/release.js';

export default async () => {
  const db = getPool();
  if (!db) return new Response('No database', { status: 503 });
  return Response.json(await runRelease(db));
};

export const config = { schedule: '@hourly' };
