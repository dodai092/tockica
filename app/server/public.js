// GET /api/schedule.json (plan Task 5): the public, read-only schedule the website reads in the visitor's browser.
// Same path and shape as the site's mock (site/src/lib/schedule-feed.ts). Classes and bike numbers only, the
// instructor's first name, never who booked what: the schedule is public. A bike holds its place until the
// booking is cancelled or late-cancelled, the same rule as the unique index on bookings.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

const limitFrom = (url) => {
  const n = Number.parseInt(new URL(url).searchParams.get('limit') ?? '', 10);
  return Number.isNaN(n) ? DEFAULT_LIMIT : Math.min(MAX_LIMIT, Math.max(1, n));
};

/** `db` is anything with query(sql, params) returning { rows }. `now` is a function so tests can fix the time. */
export function scheduleHandler({ db, now = () => new Date() }) {
  return async (req) => {
    const { rows } = await db.query(
      `select c.id, c.starts_at, c.name, c.theme_name, c.bike_count, i.first_name as instructor,
              coalesce((select array_agg(b.bike_no order by b.bike_no) from bookings b
                         where b.class_id = c.id and b.status not in ('cancelled', 'late_cancel')), '{}') as taken
         from classes c
         join instructors i on i.id = coalesce(c.actual_instructor_id, c.instructor_id)
        where not c.cancelled and c.starts_at > $1
        order by c.starts_at, c.id
        limit $2`,
      [now().toISOString(), limitFrom(req.url)]
    );
    const classes = rows.map((r) => {
      const theme = r.theme_name?.trim();
      return {
        id: r.id,
        startsAt: new Date(r.starts_at).toISOString(),
        name: r.name,
        ...(theme ? { themeName: theme } : {}),
        instructor: r.instructor,
        freeBikes: r.bike_count - r.taken.length,
        capacity: r.bike_count,
        takenBikes: r.taken,
      };
    });
    return Response.json({ source: 'app', classes }, { headers: { 'Cache-Control': 'public, max-age=10' } });
  };
}
