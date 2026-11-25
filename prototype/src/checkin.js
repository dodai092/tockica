import { studioTime } from './time.js';

const MIN_MS = 60 * 1000;
const OPENS_BEFORE_MS = 30 * MIN_MS;

export class CheckInClosedError extends Error {
  constructor(bookingId) {
    super(`Check-in is closed for ${bookingId}`);
    this.name = 'CheckInClosedError';
  }
}

function endOf(session) {
  return Date.parse(session.startsAt) + session.durationMin * MIN_MS;
}

export function checkInOpen(session, now) {
  const t = now.getTime();
  return t >= Date.parse(session.startsAt) - OPENS_BEFORE_MS && t < endOf(session);
}

function findBooking(store, bookingId) {
  return store.bookings.find((b) => b.id === bookingId);
}

export function checkIn(store, bookingId, now) {
  const booking = findBooking(store, bookingId);
  const session = store.classes.find((c) => c.id === booking.classId);
  if (!checkInOpen(session, now)) throw new CheckInClosedError(bookingId);
  booking.status = 'attended';
  booking.checkedInAt = now.toISOString();
  return booking;
}

// Once the class has ended, every booking still "booked" becomes a no-show.
// No waitlist mail here: the class is already over, so the bike has no use to anyone.
export function closeClass(store, classId, now) {
  const session = store.classes.find((c) => c.id === classId);
  if (now.getTime() < endOf(session)) throw new Error(`Class ${classId} has not ended yet`);

  const changed = store.bookings.filter((b) => b.classId === classId && b.status === 'booked');
  for (const booking of changed) booking.status = 'no_show';
  return changed;
}

// Owner correction, allowed after the class has ended.
export function correctStatus(store, bookingId, status, now) {
  const booking = findBooking(store, bookingId);
  const session = store.classes.find((c) => c.id === booking.classId);
  if (now.getTime() < endOf(session)) throw new Error('Correction is only after the class ends');
  booking.status = status;
  return booking;
}

export class StatusChangeNotAllowedError extends Error {
  constructor(bookingId, reason) {
    super(`Status of ${bookingId} cannot be changed: ${reason}`);
    this.name = 'StatusChangeNotAllowedError';
  }
}

const SAME_DAY = studioTime.localDate;

// Reception check-in: any class on the studio day, until it ends (Antun and Dunia, 2026-11-21).
export function checkInAllowed(session, now) {
  return SAME_DAY(now.toISOString()) === SAME_DAY(session.startsAt) && now.getTime() < endOf(session);
}

// The one entry point for reception and owner. Reception works on the class day, the owner any time. After the
// class ends the sweep has run, so Booked is no longer a valid target. Credits are never touched here.
export function setStatus(store, bookingId, status, { role, now }) {
  const deny = (reason) => {
    throw new StatusChangeNotAllowedError(bookingId, reason);
  };
  if (role !== 'reception' && role !== 'owner') deny(`role ${role}`);
  const booking = findBooking(store, bookingId);
  const session = store.classes.find((c) => c.id === booking.classId);
  if (!['booked', 'attended', 'no_show'].includes(booking.status)) deny(`booking is ${booking.status}`);
  if (!['booked', 'attended', 'no_show'].includes(status)) deny(`unknown status ${status}`);
  if (role === 'reception' && SAME_DAY(now.toISOString()) !== SAME_DAY(session.startsAt)) deny('not the class day');
  if (now.getTime() >= endOf(session) && status === 'booked') deny('the class has ended');
  // A second Dolazak press keeps the first time. Only a new check-in stamps the clock.
  const checkedInAt = status !== 'attended' ? null : booking.status === 'attended' ? booking.checkedInAt : now.toISOString();
  booking.status = status;
  booking.checkedInAt = checkedInAt;
  return booking;
}
