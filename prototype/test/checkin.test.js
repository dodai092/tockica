import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { studioTime } from '../src/time.js';
import { generateWeek } from '../src/schedule.js';
import { grantPack, balance } from '../src/ledger.js';
import { bookBike } from '../src/booking.js';
import {
  checkIn,
  checkInOpen,
  closeClass,
  correctStatus,
  CheckInClosedError,
} from '../src/checkin.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const MONDAY_30_NOV = studioTime.toUtc('2026-11-30T00:00');
const MIN = 60 * 1000;

function setup() {
  const store = createStore(NOW);
  generateWeek(store, MONDAY_30_NOV);
  const session = store.classes.find((c) => c.name === 'SOUL test');
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  grantPack(store, 'acc_test2', 'pk_5', NOW);
  return { store, session };
}

function book(store, session, bikeNo, accountId) {
  return bookBike(store, { classId: session.id, bikeNo, accountId, now: NOW });
}

test('check-in opens 30 minutes before the class starts', () => {
  const { session } = setup();
  const start = Date.parse(session.startsAt);

  assert.equal(checkInOpen(session, new Date(start - 30 * MIN)), true);
  assert.equal(checkInOpen(session, new Date(start - 31 * MIN)), false);
});

test('check-in closes when the class ends', () => {
  const { store, session } = setup();
  const booking = book(store, session, 1, 'acc_test1');
  const end = Date.parse(session.startsAt) + session.durationMin * MIN;

  assert.throws(() => checkIn(store, booking.id, new Date(end + 1)), CheckInClosedError);
});

test('check-in sets attended and does not change the credit balance', () => {
  const { store, session } = setup();
  const booking = book(store, session, 1, 'acc_test1');
  const before = balance(store, 'acc_test1', NOW);
  const during = new Date(Date.parse(session.startsAt) - 10 * MIN);

  const checked = checkIn(store, booking.id, during);

  assert.equal(checked.status, 'attended');
  assert.equal(balance(store, 'acc_test1', during), before);
});

test('closing a class marks remaining booked bookings as no-show', () => {
  const { store, session } = setup();
  const attended = book(store, session, 1, 'acc_test1');
  book(store, session, 2, 'acc_test2');
  const during = new Date(Date.parse(session.startsAt) - 10 * MIN);
  checkIn(store, attended.id, during);
  const end = new Date(Date.parse(session.startsAt) + session.durationMin * MIN + MIN);

  const changed = closeClass(store, session.id, end);

  assert.equal(changed.length, 1);
  assert.equal(store.bookings.find((b) => b.bikeNo === 2).status, 'no_show');
  assert.equal(store.bookings.find((b) => b.bikeNo === 1).status, 'attended');
});

test('closing a class before it ends is rejected', () => {
  const { store, session } = setup();
  book(store, session, 1, 'acc_test1');

  assert.throws(() => closeClass(store, session.id, new Date(Date.parse(session.startsAt))));
});

test('owner can correct a no-show to attended after the class', () => {
  const { store, session } = setup();
  const booking = book(store, session, 1, 'acc_test1');
  const end = new Date(Date.parse(session.startsAt) + session.durationMin * MIN + MIN);
  closeClass(store, session.id, end);

  const corrected = correctStatus(store, booking.id, 'attended', end);

  assert.equal(corrected.status, 'attended');
});

test('closing a class does not mail the waitlist, the class is already over', () => {
  const { store, session } = setup();
  book(store, session, 1, 'acc_test1');
  store.outbox = [];
  const end = new Date(Date.parse(session.startsAt) + session.durationMin * MIN + MIN);

  closeClass(store, session.id, end);

  assert.equal(store.outbox.length, 0);
});

// Reception check-in rules (plan 2026-11-21-reception-check-in.md). Namespace import: the old tests above keep running
// while these fail one by one until the functions exist.
import * as ci from '../src/checkin.js';

const dayOf = (session) => studioTime.localDate(session.startsAt);
const dayStart = (session) => new Date(studioTime.toUtc(`${dayOf(session)}T00:00`));
const nextDayStart = (session) => new Date(studioTime.toUtc(`${studioTime.addDays(dayOf(session), 1)}T00:00`));
const endOfClass = (session) => new Date(Date.parse(session.startsAt) + session.durationMin * MIN);

test('check-in is allowed any time on the class day until it ends, not the day before or after', () => {
  const { session } = setup();

  assert.equal(ci.checkInAllowed(session, dayStart(session)), true);
  assert.equal(ci.checkInAllowed(session, new Date(dayStart(session).getTime() - MIN)), false);
  assert.equal(ci.checkInAllowed(session, new Date(endOfClass(session).getTime() - MIN)), true);
  assert.equal(ci.checkInAllowed(session, new Date(endOfClass(session).getTime() + MIN)), false);
});

test('reception can check a rider in hours before the class and take it back the same day', () => {
  const { store, session } = setup();
  const booking = book(store, session, 1, 'acc_test1');
  const morning = dayStart(session);

  ci.setStatus(store, booking.id, 'attended', { role: 'reception', now: morning });
  assert.equal(booking.status, 'attended');
  assert.ok(booking.checkedInAt);

  ci.setStatus(store, booking.id, 'booked', { role: 'reception', now: morning });
  assert.equal(booking.status, 'booked');
  assert.equal(booking.checkedInAt, null);
});

test('after the class ends reception can set attended or no-show but not booked', () => {
  const { store, session } = setup();
  const booking = book(store, session, 1, 'acc_test1');
  const after = new Date(endOfClass(session).getTime() + MIN);
  closeClass(store, session.id, after);

  ci.setStatus(store, booking.id, 'attended', { role: 'reception', now: after });
  assert.equal(booking.status, 'attended');
  ci.setStatus(store, booking.id, 'no_show', { role: 'reception', now: after });
  assert.equal(booking.status, 'no_show');
  assert.throws(() => ci.setStatus(store, booking.id, 'booked', { role: 'reception', now: after }), { name: 'StatusChangeNotAllowedError' });
});

test('the next day only the owner can change a status', () => {
  const { store, session } = setup();
  const booking = book(store, session, 1, 'acc_test1');
  const nextDay = new Date(nextDayStart(session).getTime() + MIN);
  closeClass(store, session.id, nextDay);

  assert.throws(() => ci.setStatus(store, booking.id, 'attended', { role: 'reception', now: nextDay }), { name: 'StatusChangeNotAllowedError' });
  ci.setStatus(store, booking.id, 'attended', { role: 'owner', now: nextDay });
  assert.equal(booking.status, 'attended');
});

test('an instructor can never change a status', () => {
  const { store, session } = setup();
  const booking = book(store, session, 1, 'acc_test1');

  assert.throws(() => ci.setStatus(store, booking.id, 'attended', { role: 'instructor', now: dayStart(session) }), { name: 'StatusChangeNotAllowedError' });
  assert.equal(booking.status, 'booked');
});

test('a cancelled or late-cancelled booking cannot be checked in', () => {
  const { store, session } = setup();
  const booking = book(store, session, 1, 'acc_test1');
  for (const status of ['cancelled', 'late_cancel']) {
    booking.status = status;
    assert.throws(() => ci.setStatus(store, booking.id, 'attended', { role: 'reception', now: dayStart(session) }), { name: 'StatusChangeNotAllowedError' });
    assert.equal(booking.status, status);
  }
});

test('a no-show keeps its credit spent, also after reception flips it back and forth', () => {
  const { store, session } = setup();
  const booking = book(store, session, 1, 'acc_test1');
  const before = balance(store, 'acc_test1', NOW);
  const after = new Date(endOfClass(session).getTime() + MIN);

  closeClass(store, session.id, after);
  assert.equal(booking.status, 'no_show');
  assert.equal(balance(store, 'acc_test1', after), before);
  ci.setStatus(store, booking.id, 'attended', { role: 'reception', now: after });
  ci.setStatus(store, booking.id, 'no_show', { role: 'reception', now: after });
  assert.equal(balance(store, 'acc_test1', after), before);
});
