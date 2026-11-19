import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { generateWeek } from '../src/schedule.js';
import { bookBike } from '../src/booking.js';
import { descriptorLine, firstName, publicNextClasses } from '../src/public.js';
import { studioTime } from '../src/time.js';
import { confirmationMail, cancellationMail } from '../src/mails.js';

const NOW = new Date('2026-10-27T08:00:00Z');

function seeded() {
  const store = createStore(NOW);
  store.settings.credits = false;
  store.instructors = [{ id: 'ins_1', name: 'Dunia Mando' }, { id: 'ins_2', name: 'Mirna Zebec' }];
  store.template = [
    { dayOfWeek: 2, time: '17:30', name: "50' Riders Room", instructorId: 'ins_1', themeName: null },
    { dayOfWeek: 2, time: '18:30', name: "50' Riders Room", instructorId: 'ins_2', themeName: 'Britney Spears' },
    { dayOfWeek: 3, time: '17:30', name: "50' Riders Room", instructorId: 'ins_1', themeName: null },
    { dayOfWeek: 3, time: '18:30', name: "50' Riders Room", instructorId: 'ins_2', themeName: null },
    { dayOfWeek: 4, time: '17:30', name: "50' Riders Room", instructorId: 'ins_1', themeName: null },
  ];
  generateWeek(store, studioTime.toUtc('2026-10-26T00:00'));
  return store;
}

test('descriptor line is the theme when set, else the class name', () => {
  assert.equal(descriptorLine({ name: "50' Riders Room", themeName: 'Britney Spears' }), 'Britney Spears');
  assert.equal(descriptorLine({ name: "50' Riders Room", themeName: null }), "50' Riders Room");
  assert.equal(descriptorLine({ name: "50' Riders Room", themeName: '  ' }), "50' Riders Room");
});

test('first name takes the first word only', () => {
  assert.equal(firstName('Dunia Mando'), 'Dunia');
  assert.equal(firstName(''), '');
});

test('next classes: at most the limit, ordered by start, only upcoming open classes', () => {
  const store = seeded();
  const list = publicNextClasses(store, NOW, 4);
  assert.equal(list.length, 4);
  const starts = list.map((c) => c.startsAt);
  assert.deepEqual(starts, [...starts].sort());
  assert.ok(list.every((c) => Date.parse(c.startsAt) > NOW.getTime()));
});

test('next classes carry first names and no customer or surname data', () => {
  const store = seeded();
  const [first] = publicNextClasses(store, NOW, 4);
  assert.deepEqual(Object.keys(first).sort(), ['capacity', 'freeBikes', 'id', 'instructor', 'name', 'startsAt', 'themeName']);
  assert.ok(['Dunia', 'Mirna'].includes(first.instructor));
  assert.equal(JSON.stringify(publicNextClasses(store, NOW, 4)).match(/Mando|Zebec|@|phone/), null);
});

test('free bikes is capacity minus active bookings', () => {
  const store = seeded();
  const target = publicNextClasses(store, NOW, 4)[0];
  bookBike(store, { classId: target.id, bikeNo: 3, accountId: 'acc_test1', now: NOW });
  const after = publicNextClasses(store, NOW, 4)[0];
  assert.equal(after.freeBikes, target.capacity - 1);
});

test('cancelled classes and classes not yet released are left out', () => {
  const store = seeded();
  const all = publicNextClasses(store, NOW, 10);
  store.classes.find((c) => c.id === all[0].id).cancelled = true;
  const after = publicNextClasses(store, NOW, 10);
  assert.ok(!after.some((c) => c.id === all[0].id));
  const future = store.classes.find((c) => c.id === after[0].id);
  future.releaseOpensAt = '2099-01-01T00:00:00.000Z';
  assert.ok(!publicNextClasses(store, NOW, 10).some((c) => c.id === future.id));
});

test('a substitute is shown as the instructor who teaches', () => {
  const store = seeded();
  const target = publicNextClasses(store, NOW, 4)[0];
  const cls = store.classes.find((c) => c.id === target.id);
  const other = cls.instructorId === 'ins_1' ? 'ins_2' : 'ins_1';
  cls.actualInstructorId = other;
  const expected = store.instructors.find((i) => i.id === other).name.split(' ')[0];
  assert.equal(publicNextClasses(store, NOW, 4)[0].instructor, expected);
});

test('booking mails name the theme when set, else the class name', () => {
  const account = { name: 'Test Klijent', email: 'a@example.com' };
  const booking = { id: 'bk_1', bikeNo: 4, guestName: null };
  const deadline = new Date('2026-11-30T10:00:00Z');
  const themed = { name: "Rhythm Ride", themeName: 'Britney Spears', startsAt: '2026-11-30T17:00:00.000Z' };
  const plain = { ...themed, themeName: null };
  const mail = confirmationMail({ settings: {} }, booking, themed, account, deadline);
  assert.match(mail.subject, /Britney Spears/);
  assert.match(mail.body, /Britney Spears/);
  assert.doesNotMatch(mail.body, /Rhythm Ride/);
  assert.match(confirmationMail({ settings: {} }, booking, plain, account, deadline).subject, /Rhythm Ride/);
  assert.match(cancellationMail(booking, themed, account, true, 6).subject, /Britney Spears/);
});

test('a profile link is the first name without accents, in the page language', async () => {
  const { profilePath } = await import('../src/public.js');
  assert.equal(profilePath('Ena', 'hr'), '/instruktori/ena');
  assert.equal(profilePath('Vončina', 'hr'), '/instruktori/voncina');
  assert.equal(profilePath('Ena', 'en'), '/en/instructors/ena');
});
