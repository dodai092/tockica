// A rider's bookings and waitlist places (plan 2026-11-25-booking-routes). Thin: the rules are in prototype/src/booking.js, run through
// runInTransaction, which locks the class row so two riders take turns. The account always comes from the session.
// Refusals carry a `code`, so a screen can word them in the rider's language.
import { runInTransaction } from './db/unit-of-work.js';
import {
  bookBike, cancelBooking, joinWaitlist, leaveWaitlist, cancelDeadline,
  BikeTakenError, BikeOutOfRangeError, NotBookableError, BookingNotOpenError, NotFullError, AlreadyBookedError, NotCancellableError,
} from '../../prototype/src/booking.js';
import { NoCreditError } from '../../prototype/src/ledger.js';
import { WaiverRequiredError } from '../../prototype/src/waiver.js';
import { descriptorLine } from '../../prototype/src/schedule.js';

const json = (body, status = 200) => Response.json(body, { status });
const readJson = async (req) => (await req.json().catch(() => null)) ?? {};
// Only what an id can look like. Anything else is refused before it reaches the database.
const isId = (v) => typeof v === 'string' && /^[\w-]{1,100}$/.test(v);
const bad = (code) => json({ error: 'That request is not complete', code }, 400);
const post = (handler) => (req, session) => (req.method === 'POST' ? handler(req, session) : json({ error: 'Use POST' }, 405));
const noClass = () => json({ error: 'No such class', code: 'no_class' }, 404);

const REFUSALS = [
  [BikeTakenError, 409, 'bike_taken'],
  [BikeOutOfRangeError, 400, 'bad_bike'],
  [NotBookableError, 409, 'not_bookable'],
  [BookingNotOpenError, 409, 'booking_not_open'],
  [NoCreditError, 409, 'no_credit'],
  [WaiverRequiredError, 409, 'waiver_required'],
  [NotFullError, 409, 'not_full'],
  [AlreadyBookedError, 409, 'already_booked'],
  [NotCancellableError, 409, 'not_cancellable'],
];

/** Runs fn and turns a rule's refusal into its answer. Anything else is a fault and is thrown on. */
async function ruleErrors(fn) {
  try {
    return await fn();
  } catch (e) {
    const found = REFUSALS.find(([type]) => e instanceof type);
    if (!found) throw e;
    const [, status, code] = found;
    return json({ error: e.message, code, ...(e.opensOn ? { opensOn: e.opensOn } : {}) }, status);
  }
}

const classExists = async (db, id) => (await db.query('select 1 from classes where id = $1', [id])).rows.length > 0;

// The rider's upcoming classes, with the instructor who actually teaches.
const UPCOMING = `join classes c on c.id = x.class_id join instructors i on i.id = coalesce(c.actual_instructor_id, c.instructor_id)
  where x.account_id = $1 and not c.cancelled and c.starts_at > $2`;
const classFields = (r) => ({
  classId: r.class_id,
  startsAt: new Date(r.starts_at).toISOString(),
  name: descriptorLine({ name: r.name, themeName: r.theme_name }),
  instructor: r.instructor,
});

async function ownList(db, accountId, now) {
  const params = [accountId, now.toISOString()];
  const bookings = (await db.query(
    `select x.id, x.bike_no, x.class_id, c.starts_at, c.name, c.theme_name, i.first_name as instructor
       from bookings x ${UPCOMING} and x.status = 'booked' order by c.starts_at, x.bike_no`, params)).rows;
  const waiting = (await db.query(
    `select x.class_id, c.starts_at, c.name, c.theme_name, i.first_name as instructor
       from waitlist x ${UPCOMING} order by c.starts_at, c.id`, params)).rows;
  return {
    bookings: bookings.map((r) => {
      const { classId, ...rest } = classFields(r);
      return { id: r.id, classId, bikeNo: r.bike_no, ...rest, cancelFreeUntil: cancelDeadline({ startsAt: rest.startsAt }).toISOString() };
    }),
    waitlist: waiting.map(classFields),
  };
}

/** GET lists the rider's own upcoming bookings and waitlist places, POST books one bike. */
export const bookingsHandler = ({ db, now }) => async (req, { accountId }) => {
  if (req.method === 'GET') return json(await ownList(db, accountId, now()));
  if (req.method !== 'POST') return json({ error: 'Use GET or POST' }, 405);
  const { classId, bikeNo } = await readJson(req);
  if (!isId(classId)) return bad('bad_class');
  if (!Number.isInteger(bikeNo)) return bad('bad_bike');
  if (!(await classExists(db, classId))) return noClass();
  return ruleErrors(async () => {
    const booking = await runInTransaction(db, { classId, accountId }, (store) => bookBike(store, { classId, bikeNo, accountId, now: now() }));
    return json({ id: booking.id }, 201);
  });
};

/**
 * Cancels one of the rider's own bookings. The id comes in the body, the router matches whole paths. Someone else's
 * booking gets the same answer as one that does not exist.
 */
export const cancelHandler = ({ db, now }) =>
  post(async (req, { accountId }) => {
    const { id } = await readJson(req);
    if (!isId(id)) return bad('bad_booking');
    // Read first to know which class to lock. The rule reads the status again under the lock.
    const own = (await db.query('select class_id from bookings where id = $1 and account_id = $2', [id, accountId])).rows[0];
    if (!own) return json({ error: 'No such booking', code: 'no_booking' }, 404);
    return ruleErrors(async () => {
      const booking = await runInTransaction(db, { classId: own.class_id, accountId }, (store) => cancelBooking(store, id, now()));
      return json({ status: booking.status });
    });
  });

/** Joins the waitlist of a full class. Asking twice keeps one place. */
export const waitlistJoinHandler = ({ db, now }) =>
  post(async (req, { accountId }) => {
    const { classId } = await readJson(req);
    if (!isId(classId)) return bad('bad_class');
    if (!(await classExists(db, classId))) return noClass();
    return ruleErrors(async () => {
      await runInTransaction(db, { classId, accountId }, (store) => joinWaitlist(store, { classId, accountId, now: now() }));
      return json({ ok: true }, 201);
    });
  });

/** Leaves it. Also fine when the rider was not waiting. */
export const waitlistLeaveHandler = ({ db }) =>
  post(async (req, { accountId }) => {
    const { classId } = await readJson(req);
    if (!isId(classId)) return bad('bad_class');
    await runInTransaction(db, { classId, accountId }, (store) => leaveWaitlist(store, { classId, accountId }));
    return json({ ok: true });
  });
