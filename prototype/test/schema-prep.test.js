// Fields the database schema needs, added to the prototype first (docs/superpowers/plans/2026-11-11-schema-gap-check.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { studioTime } from '../src/time.js';
import { generateWeek } from '../src/schedule.js';
import { grantPack } from '../src/ledger.js';
import { bookBike, cancelBooking } from '../src/booking.js';
import { checkIn } from '../src/checkin.js';
import { acceptTerms } from '../src/waiver.js';
import { addTemplateEntry, cancelClass, removeFromClass } from '../src/admin.js';
import { markMonthPaid, addClosedDay } from '../src/sculpt.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const MONDAY_30_NOV = studioTime.toUtc('2026-11-30T00:00');

function setup() {
  const store = createStore(NOW);
  generateWeek(store, MONDAY_30_NOV);
  const session = store.classes.find((c) => c.name === 'SOUL test');
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  store.waivers.push({ id: 'wv_x', accountId: 'acc_test1', bookingId: null, name: 'T', version: 1, signedAt: NOW.toISOString() });
  return { store, session };
}

test('1: accepting the terms stores date and version once, marketing stays off by default', () => {
  const store = createStore(NOW);
  const acct = acceptTerms(store, { accountId: 'acc_test1', now: NOW });
  assert.equal(acct.termsAcceptedAt, NOW.toISOString());
  assert.equal(acct.termsVersion, 1);
  assert.equal(acct.marketingOptIn, false);
  assert.equal(acct.marketingOptInAt, null);
  const later = new Date('2026-11-21T12:00:00Z');
  assert.equal(acceptTerms(store, { accountId: 'acc_test1', marketingOptIn: true, now: later }).termsAcceptedAt, NOW.toISOString());
});

test('1: marketing opt-in at signup is dated', () => {
  const store = createStore(NOW);
  const acct = acceptTerms(store, { accountId: 'acc_test2', marketingOptIn: true, now: NOW });
  assert.equal(acct.marketingOptIn, true);
  assert.equal(acct.marketingOptInAt, NOW.toISOString());
});

test('2: cancel, late cancel, removal and studio cancel record cancelledAt, check-in records checkedInAt', () => {
  const { store, session } = setup();
  const early = new Date(Date.parse(session.startsAt) - 24 * 3600000);
  const late = new Date(Date.parse(session.startsAt) - 3600000);
  const a = bookBike(store, { classId: session.id, bikeNo: 1, accountId: 'acc_test1', now: NOW });
  const b = bookBike(store, { classId: session.id, bikeNo: 2, accountId: 'acc_test1', now: NOW });
  const c = bookBike(store, { classId: session.id, bikeNo: 3, accountId: 'acc_test1', now: NOW });
  const d = bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  cancelBooking(store, a.id, early);
  assert.equal(a.cancelledAt, early.toISOString());
  cancelBooking(store, b.id, late);
  assert.equal(b.status, 'late_cancel');
  assert.equal(b.cancelledAt, late.toISOString());
  removeFromClass(store, { bookingId: c.id, reason: 'test', now: NOW });
  assert.equal(c.cancelledAt, NOW.toISOString());
  const opens = new Date(Date.parse(session.startsAt) - 10 * 60000);
  checkIn(store, d.id, opens);
  assert.equal(d.checkedInAt, opens.toISOString());
});

test('2: studio cancel stamps each cancelled booking', () => {
  const { store, session } = setup();
  const bk = bookBike(store, { classId: session.id, bikeNo: 1, accountId: 'acc_test1', now: NOW });
  cancelClass(store, session.id, NOW);
  assert.equal(bk.cancelledAt, NOW.toISOString());
});

test('3: studio cancel keeps the reason, null when none is given', () => {
  const { store, session } = setup();
  cancelClass(store, session.id, NOW, 'Instruktorica je bolesna');
  assert.equal(session.cancelReason, 'Instruktorica je bolesna');
  const other = createStore(NOW);
  generateWeek(other, MONDAY_30_NOV);
  const s2 = other.classes[0];
  cancelClass(other, s2.id, NOW);
  assert.equal(s2.cancelReason, null);
});

test('4: template entries and paid months have ids', () => {
  const store = createStore(NOW);
  assert.ok(store.template.every((e) => e.id));
  const entry = addTemplateEntry(store, { dayOfWeek: 3, time: '18:00', name: 'Nova', instructorId: 'ins_1' });
  assert.match(entry.id, /^tpl_/);
  assert.notEqual(entry.id, addTemplateEntry(store, { dayOfWeek: 3, time: '19:00', name: 'Nova', instructorId: 'ins_1' }).id);
  const paid = markMonthPaid(store, { trainerId: 'tr_1', month: '2026-12', now: NOW });
  assert.match(paid.id, /^pm_/);
});

test('5: closed days are a top-level list, not part of the Sculpt Room', () => {
  const store = createStore(NOW);
  assert.deepEqual(store.closedDays, []);
  assert.equal('closedDays' in store.sculpt, false);
  addClosedDay(store, '2026-11-30');
  assert.deepEqual(store.closedDays, ['2026-11-30']);
  generateWeek(store, MONDAY_30_NOV);
  assert.equal(store.classes.length, 0);
});
