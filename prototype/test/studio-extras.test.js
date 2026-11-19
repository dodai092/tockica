import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { studioTime } from '../src/time.js';
import { generateWeek } from '../src/schedule.js';
import { bookBike, cancelBooking, joinWaitlist, waitlistPosition } from '../src/booking.js';
import { addLegacyPack, claimLegacyPacks, balance } from '../src/ledger.js';
import { removeFromClass, moveBooking, changeLog } from '../src/admin.js';
import { guestWaiverMissing, signGuestWaiver } from '../src/waiver.js';
import { confirmationMail } from '../src/mails.js';
import { sendReminders } from '../src/reminders.js';
import { creditLots } from '../src/dashboard.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const HOUR = 60 * 60 * 1000;

function setup() {
  const store = createStore(NOW);
  store.settings.credits = false;
  generateWeek(store, studioTime.toUtc('2026-11-30T00:00'));
  const session = store.classes.find((c) => c.name === 'SOUL test');
  return { store, session };
}

// 6-hour cutoff is absolute time, so the March and October clock changes must not move it.
for (const [label, startsAt] of [
  ['spring change, class on Sunday 29 March 2026', studioTime.toUtc('2026-03-29T10:00')],
  ['spring change, class just after the gap', studioTime.toUtc('2026-03-29T06:00')],
  ['autumn change, class on Sunday 25 October 2026', studioTime.toUtc('2026-10-25T08:00')],
  ['autumn change, class right after the repeated hour', studioTime.toUtc('2026-10-25T04:00')],
]) {
  test(`cutoff at the clock change: ${label}`, () => {
    const store = createStore(NOW);
    store.settings.credits = false;
    store.classes.push({ id: 'cls_dst', name: 'x', instructorId: 'ins_1', startsAt, durationMin: 60, bikeCount: 20, releaseOpensAt: '2026-01-01T00:00:00.000Z' });
    const start = Date.parse(startsAt);
    const book = () => bookBike(store, { classId: 'cls_dst', bikeNo: 1, accountId: 'acc_test1', now: new Date(start - 48 * HOUR) });

    const late = book();
    assert.equal(cancelBooking(store, late.id, new Date(start - 6 * HOUR + 60 * 1000)).status, 'late_cancel');
    store.bookings = [];
    const free = book();
    assert.equal(cancelBooking(store, free.id, new Date(start - 6 * HOUR)).status, 'cancelled');
  });
}

test('mails name the instructor, and a guest without a waiver is told to sign at the desk', () => {
  const { store, session } = setup();
  store.instructors = [{ id: session.instructorId, name: 'Mirna Zebec' }];
  const booking = bookBike(store, { classId: session.id, bikeNo: 3, accountId: 'acc_test1', guestName: 'Ana', now: NOW });
  const account = store.accounts.find((a) => a.id === 'acc_test1');
  const mail = confirmationMail(store, booking, session, account, new Date(Date.parse(session.startsAt) - 6 * HOUR));
  assert.match(mail.body, /Trener: Mirna\./);
  assert.match(mail.body, /Ana potpisuje izjavu na recepciji/);
  signGuestWaiver(store, { bookingId: booking.id, now: NOW });
  assert.doesNotMatch(confirmationMail(store, booking, session, account, new Date()).body, /potpisuje izjavu/);
});

test('the 24h reminder tells riders to arrive 10 minutes early', () => {
  const { store, session } = setup();
  bookBike(store, { classId: session.id, bikeNo: 3, accountId: 'acc_test1', now: NOW });
  const [mail] = sendReminders(store, new Date(Date.parse(session.startsAt) - 20 * HOUR));
  assert.match(mail.body, /Dođi 10 minuta prije početka\./);
});

test('waitlist position counts from 1 in joining order and is null when not waiting', () => {
  const { store, session } = setup();
  session.bikeCount = 1;
  bookBike(store, { classId: session.id, bikeNo: 1, accountId: 'acc_test1', now: NOW });
  joinWaitlist(store, { classId: session.id, accountId: 'acc_test2', now: new Date(NOW.getTime() + 1000) });
  store.accounts.push({ id: 'acc_x', name: 'X', email: 'x@example.com', phone: '', multisportTag: false, marketingOptIn: false });
  joinWaitlist(store, { classId: session.id, accountId: 'acc_x', now: new Date(NOW.getTime() + 2000) });
  assert.equal(waitlistPosition(store, session.id, 'acc_test2'), 1);
  assert.equal(waitlistPosition(store, session.id, 'acc_x'), 2);
  assert.equal(waitlistPosition(store, session.id, 'acc_test1'), null);
});

test('a legacy pack waits for the account with that email, then becomes a credit lot', () => {
  const { store } = setup();
  const lot = addLegacyPack(store, { email: 'Test1@Example.com', classes: 4, expiresOn: '2027-01-31', now: NOW });
  assert.equal(lot.claimedBy, null);
  assert.equal(balance(store, 'acc_test1', NOW), 0);
  const claimed = claimLegacyPacks(store, store.accounts[0], NOW);
  assert.equal(claimed.length, 1);
  assert.equal(balance(store, 'acc_test1', NOW), 4);
  assert.equal(creditLots(store, 'acc_test1', NOW)[0].origin, 'legacy');
  assert.equal(claimLegacyPacks(store, store.accounts[0], NOW).length, 0);
  assert.equal(balance(store, 'acc_test2', NOW), 0);
});

test('a legacy pack needs an email, a class count and a date', () => {
  const { store } = setup();
  assert.throws(() => addLegacyPack(store, { email: '', classes: 4, expiresOn: '2027-01-31', now: NOW }), RangeError);
  assert.throws(() => addLegacyPack(store, { email: 'a@b.hr', classes: 0, expiresOn: '2027-01-31', now: NOW }), RangeError);
  assert.throws(() => addLegacyPack(store, { email: 'a@b.hr', classes: 2, expiresOn: '31.1.2027', now: NOW }), RangeError);
});

test('staff see who was removed or moved, newest first', () => {
  const { store, session } = setup();
  const a = bookBike(store, { classId: session.id, bikeNo: 3, accountId: 'acc_test1', now: NOW });
  const b = bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test2', now: NOW });
  moveBooking(store, { bookingId: a.id, toBikeNo: 9, now: NOW });
  removeFromClass(store, { bookingId: b.id, reason: 'bolest', now: new Date(NOW.getTime() + 1000) });
  const log = changeLog(store);
  assert.deepEqual(log.map((e) => e.type), ['removed', 'moved']);
  assert.match(log[0].detail, /bolest/);
  assert.match(log[1].detail, /3.*9/);
  assert.equal(log[1].account.id, 'acc_test1');
});

test('check-in can tell staff a guest has not signed the waiver', () => {
  const { store, session } = setup();
  const guest = bookBike(store, { classId: session.id, bikeNo: 3, accountId: 'acc_test1', guestName: 'Ana', now: NOW });
  const own = bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test2', now: NOW });
  assert.equal(guestWaiverMissing(store, guest.id), true);
  assert.equal(guestWaiverMissing(store, own.id), false);
  signGuestWaiver(store, { bookingId: guest.id, now: NOW });
  assert.equal(guestWaiverMissing(store, guest.id), false);
});
