// Reception check-in routes (plan 2026-11-21-reception-check-in.md). Thin, like the other handlers: the rules are
// setStatus in prototype/src/checkin.js and the no-show sweep. Reception and owner list today's classes, open a roster and
// set a rider's status. A trainer reads the roster of their own class and can change nothing.
import { HttpError } from './guard.js';
import { sweepEndedClasses } from './checkin-sweep.js';
import { inTransaction } from './db/tx.js';
import { runInStore } from './db/unit-of-work.js';
import { setStatus, StatusChangeNotAllowedError } from '../../prototype/src/checkin.js';

const json = (body, status = 200) => Response.json(body, { status });
const only = (method, handler) => (req, session) => (req.method === method ? handler(req, session) : json({ error: `Use ${method}` }, 405));
// Booked, Checked in and No-show are the riders in the room. A cancelled booking is not on the list.
const RIDER = `b.status in ('booked', 'attended', 'no_show')`;

async function roster(db, classId) {
  const cls = (await db.query(
    `select c.id, c.name, c.starts_at, c.duration_min, i.first_name as instructor
       from classes c join instructors i on i.id = coalesce(c.actual_instructor_id, c.instructor_id) where c.id = $1`, [classId])).rows[0];
  if (!cls) return null;
  const riders = (await db.query(
    `select b.id, b.bike_no, coalesce(b.guest_name, a.name) as name, b.status, b.checked_in_at
       from bookings b join accounts a on a.id = b.account_id where b.class_id = $1 and ${RIDER} order by b.bike_no`, [classId])).rows;
  return {
    class: { id: cls.id, name: cls.name, startsAt: new Date(cls.starts_at).toISOString(), durationMin: cls.duration_min, instructor: cls.instructor },
    riders: riders.map((r) => ({ bookingId: r.id, bikeNo: r.bike_no, name: r.name, status: r.status, checkedInAt: r.checked_in_at && new Date(r.checked_in_at).toISOString() })),
  };
}

const MILESTONE_RIDES = [50, 100, 150];

// Markers for the trainer screen. Only the account holder's own attended rides in earlier classes count, and a guest gets
// no markers. The birth date is compared here and only true or false is returned.
async function trainerMarkers(db, classId) {
  const { rows } = await db.query(
    `select b.id, b.guest_name is null as own,
            to_char(a.birth_date, 'MM-DD') = to_char(c.starts_at at time zone 'Europe/Zagreb', 'MM-DD') as birthday,
            (select count(*)::int from bookings p join classes pc on pc.id = p.class_id
              where p.account_id = b.account_id and p.guest_name is null and p.status = 'attended' and pc.starts_at < c.starts_at) as earlier
       from bookings b join accounts a on a.id = b.account_id join classes c on c.id = b.class_id
      where b.class_id = $1 and ${RIDER}`, [classId]);
  return new Map(rows.map((r) => [r.id, {
    firstTime: r.own && r.earlier === 0,
    birthday: r.own && r.birthday === true,
    milestone: r.own && MILESTONE_RIDES.includes(r.earlier + 1) ? r.earlier + 1 : null,
  }]));
}

/** Today's classes (studio day, Europe/Zagreb), with how many riders and how many are checked in. */
export const checkinListHandler = ({ db, now }) =>
  only('GET', async () => {
    await sweepEndedClasses(db, now());
    const { rows } = await db.query(
      `select c.id, c.name, c.starts_at, c.duration_min, i.first_name as instructor,
              count(b.id)::int as riders, (count(b.id) filter (where b.status = 'attended'))::int as checked_in
         from classes c
         join instructors i on i.id = coalesce(c.actual_instructor_id, c.instructor_id)
         left join bookings b on b.class_id = c.id and ${RIDER}
        where not c.cancelled and (c.starts_at at time zone 'Europe/Zagreb')::date = ($1::timestamptz at time zone 'Europe/Zagreb')::date
        group by c.id, i.first_name order by c.starts_at, c.id`, [now().toISOString()]);
    return json({ classes: rows.map((r) => ({ id: r.id, name: r.name, startsAt: new Date(r.starts_at).toISOString(), durationMin: r.duration_min, instructor: r.instructor, riders: r.riders, checkedIn: r.checked_in })) });
  });

/** A trainer's classes for today and the next 6 studio days: the actual instructor if the class was swapped, else the planned one. Read only. */
export const trainerClassesHandler = ({ db, now }) =>
  only('GET', async (_req, session) => {
    await sweepEndedClasses(db, now());
    const { rows } = await db.query(
      `select c.id, c.name, c.starts_at, c.duration_min, count(b.id)::int as riders, (count(b.id) filter (where b.status = 'attended'))::int as checked_in
         from classes c
         join staff s on s.id = $2 and s.instructor_id is not null
         left join bookings b on b.class_id = c.id and ${RIDER}
        where not c.cancelled and s.instructor_id = coalesce(c.actual_instructor_id, c.instructor_id)
          and (c.starts_at at time zone 'Europe/Zagreb')::date - ($1::timestamptz at time zone 'Europe/Zagreb')::date between 0 and 6
        group by c.id order by c.starts_at, c.id`, [now().toISOString(), session.staffId]);
    return json({ classes: rows.map((r) => ({ id: r.id, name: r.name, startsAt: new Date(r.starts_at).toISOString(), durationMin: r.duration_min, riders: r.riders, checkedIn: r.checked_in })) });
  });

export const rosterHandler = ({ db, now }) =>
  only('GET', async (req) => {
    await sweepEndedClasses(db, now());
    const out = await roster(db, new URL(req.url).searchParams.get('id'));
    return out ? json(out) : json({ error: 'No such class' }, 404);
  });

/** POST { bookingId, status }. The change and its log row commit together. */
export const statusHandler = ({ db, now }) =>
  only('POST', async (req, session) => {
    const body = await req.json().catch(() => ({}));
    if (typeof body.bookingId !== 'string' || !['booked', 'attended', 'no_show'].includes(body.status)) return json({ error: 'Send bookingId and a status' }, 400);
    const found = (await db.query('select class_id from bookings where id = $1', [body.bookingId])).rows[0];
    if (!found) return json({ error: 'No such booking' }, 404);
    try {
      const booking = await inTransaction(db, async (conn) => {
        let from;
        const changed = await runInStore(conn, { classId: found.class_id }, (store) => {
          from = store.bookings.find((b) => b.id === body.bookingId).status;
          return setStatus(store, body.bookingId, body.status, { role: session.role, now: now() });
        });
        await conn.query(
          `insert into staff_log (type, booking_id, class_id, account_id, detail, staff_id) values ('check_in', $1, $2, $3, $4, $5)`,
          [changed.id, found.class_id, changed.accountId, `${from} to ${changed.status}`, session.staffId]);
        return changed;
      });
      return json({ ok: true, status: booking.status, checkedInAt: booking.checkedInAt });
    } catch (e) {
      if (e instanceof StatusChangeNotAllowedError) return json({ error: e.message }, 409);
      throw e;
    }
  });

/** A trainer's read only roster: only a class they teach (the actual instructor if the class was swapped, else the planned one). The owner sees any. */
export const trainerRosterHandler = ({ db, now }) =>
  only('GET', async (req, session) => {
    await sweepEndedClasses(db, now());
    const id = new URL(req.url).searchParams.get('id');
    if (session.role === 'instructor') {
      const own = (await db.query(
        `select 1 from classes c join staff s on s.id = $2 and s.instructor_id is not null
          where c.id = $1 and s.instructor_id = coalesce(c.actual_instructor_id, c.instructor_id)`, [id, session.staffId])).rows.length;
      if (!own) throw new HttpError(403, 'Not your class');
    }
    const out = await roster(db, id);
    if (!out) return json({ error: 'No such class' }, 404);
    const marks = await trainerMarkers(db, id);
    return json({ ...out, riders: out.riders.map((r) => ({ ...r, ...marks.get(r.bookingId) })) });
  });
