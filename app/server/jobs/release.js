// The weekly Release (plan Task 8). Called every hour. It finds the latest release instant at or before `now`
// (Monday 10:00 Zagreb time by default, so the clock changes are handled by prototype/src/schedule.js and not by a UTC
// cron) and makes sure every class that release opens exists. A class opens at the latest release at or before its start
// minus two weeks, so a release opens the classes that start before the next release plus two weeks. Classes that
// have already started are not made. Running it again, or twice at once, changes nothing: template_key is unique.
import { generateWeek, releaseWindowOpensAt } from '../../../prototype/src/schedule.js';
import { studioTime } from '../../../prototype/src/time.js';

const WEEKS_CHECKED = 4; // this week, and three more: a release reaches up to three weeks ahead for early Monday classes

export async function runRelease(db, now = new Date()) {
  const s = (await db.query('select release_day_of_week, release_hour, weeks_ahead from settings')).rows[0];
  const settings = { dayOfWeek: s.release_day_of_week, hour: s.release_hour, weeksAhead: s.weeks_ahead };
  const template = (
    await db.query(`select day_of_week, to_char(time_of_day, 'HH24:MI') as time, name, instructor_id, theme_name from template_entries`)
  ).rows.map((t) => ({ dayOfWeek: t.day_of_week, time: t.time, name: t.name, instructorId: t.instructor_id, themeName: t.theme_name }));
  const closedDays = (await db.query(`select to_char(day, 'YYYY-MM-DD') as d from closed_days`)).rows.map((r) => r.d);
  const existing = (await db.query('select id, template_key, starts_at, name, instructor_id from classes')).rows.map((c) => ({
    id: c.id,
    templateKey: c.template_key,
    startsAt: new Date(c.starts_at).toISOString(),
    name: c.name,
    instructorId: c.instructor_id,
  }));

  const release = releaseWindowOpensAt(settings, now);
  const releaseDay = studioTime.localDate(release);
  const firstMonday = studioTime.addDays(releaseDay, 1 - studioTime.dayOfWeek(release));
  const store = { settings, template, closedDays, classes: [...existing] };
  for (let w = 0; w < WEEKS_CHECKED; w += 1) {
    generateWeek(store, studioTime.toUtc(`${studioTime.addDays(firstMonday, 7 * w)}T00:00`));
  }

  const known = new Set(existing.map((c) => c.id));
  const open = store.classes.filter(
    (c) => !known.has(c.id) && Date.parse(c.releaseOpensAt) <= Date.parse(release) && Date.parse(c.startsAt) > now.getTime()
  );
  let created = 0;
  for (const c of open) {
    const r = await db.query(
      `insert into classes (id, template_key, name, instructor_id, theme_name, starts_at, duration_min, bike_count, release_opens_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (template_key) do nothing returning id`,
      [c.id, c.templateKey, c.name, c.instructorId, c.themeName, c.startsAt, c.durationMin, c.bikeCount, c.releaseOpensAt]
    );
    created += r.rows.length;
  }
  return { created };
}
