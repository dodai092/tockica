// The login step inside the bike sheet (ADR 0006 and 0007): a visitor who picked a bike logs in with the real form and
// moves on to the notice, can go back to the bikes, and skips the step when already signed in. The app is faked
// (tests/fake-booking-app.mjs). Real browser against the built site.
// Booking is closed before 4 January (isBookable), so the Book buttons cannot open the sheet yet. The tests open it with
// the same `schedule:book` event the page sends, which the sheet itself does not gate.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import { chromium } from 'playwright';
import { fakeBookingApp, ME, PASSWORD } from './fake-booking-app.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const PORT = 4326;
const origin = `http://127.0.0.1:${PORT}`;
const HINT = 'tockica.login-hint';
const CHOICE = 'tockica.choice';
let browser;
let server;

before(async () => {
  browser = await chromium.launch();
  server = spawn('npx', ['--no-install', 'astro', 'preview', '--host', '127.0.0.1', '--port', String(PORT)], {
    cwd: root,
    stdio: 'ignore',
    detached: true,
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      // still starting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('preview did not start');
});

after(async () => {
  await browser?.close();
  if (server?.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
});

const words = {
  '/raspored': {
    back: 'Natrag na bicikle',
    submit: 'Prijavi me',
    wrong: 'Pogrešan email ili lozinka.',
    soon: 'uskoro',
    waitlist: 'Lista čekanja',
    account: 'Moj račun',
  },
  '/en/schedule': {
    back: 'Back to the bikes',
    submit: 'Log in',
    wrong: 'Wrong email or password.',
    soon: 'soon',
    waitlist: 'Waiting list',
    account: 'My account',
  },
};

async function open({ width = 390, path = '/raspored', hint = false, app: appOptions, init } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const app = await fakeBookingApp(page, appOptions);
  if (hint) await page.addInitScript((k) => localStorage.setItem(k, '1'), HINT);
  if (init) await page.addInitScript(init);
  await page.goto(`${origin}${path}`);
  await page.waitForSelector('[data-schedule]');
  return { page, errors, app };
}

const sheet = (page) => page.locator('dialog[data-bike-sheet]');
const step = (page, name) => sheet(page).locator(`[data-step="${name}"]`);
const calls = (app, path) => app.calls.filter((c) => c.path === path);
const labels = async (page) => [
  ...new Set(await page.$$eval('[data-login]', (els) => els.map((e) => e.textContent.trim()))),
];
const classes = (page) => page.evaluate(() => JSON.parse(document.querySelector('[data-schedule-data]').textContent));

/** Opens the sheet the way a press on Book does. `full` is the waiting list (no bike map). */
async function book(page, { full = false } = {}) {
  const c = (await classes(page)).find((x) => x.takenBikes.length < x.capacity);
  await page.evaluate(
    ({ id, full: f }) => document.dispatchEvent(new CustomEvent('schedule:book', { detail: { classId: id, full: f } })),
    { id: c.id, full }
  );
  await sheet(page).waitFor({ state: 'visible' });
  return c;
}
async function pickAndContinue(page) {
  await book(page);
  const free = sheet(page).locator('button[data-bike]:not([disabled])').first();
  const n = Number(await free.getAttribute('data-bike'));
  await free.click();
  await sheet(page).locator('[data-continue]').click();
  return n;
}
const logIn = async (page, password = PASSWORD) => {
  const login = step(page, 'login');
  await login.locator('input[name="email"]').fill(ME.email);
  await login.locator('input[name="password"]').fill(password);
  await login.locator('[data-login-submit]').click();
};

for (const width of [390, 1280]) {
  for (const path of Object.keys(words)) {
    test(`${width}px ${path}: Continue shows the real login, a wrong password stays, the right one moves on to the notice`, async () => {
      const w = words[path];
      const { page, app, errors } = await open({ width, path });
      const n = await pickAndContinue(page);
      await step(page, 'login').waitFor({ state: 'visible' });
      assert.ok((await step(page, 'login').innerText()).includes(String(n)), 'the summary names the bike');
      assert.equal(await step(page, 'login').locator('[data-login-submit]').innerText(), w.submit);
      assert.equal(
        await step(page, 'login').locator('input[type="password"]').count(),
        1,
        'a password field, not a "send code" form'
      );
      assert.equal(
        await step(page, 'login').locator('[data-send-code]').count(),
        0,
        'the emailed-code placeholder is gone'
      );
      assert.equal(await step(page, 'login').locator('[data-back-to-map]').innerText(), w.back);
      await logIn(page, 'wrong-password-1');
      await step(page, 'login').locator('[data-login-error]:not(:empty)').waitFor();
      assert.equal(await step(page, 'login').locator('[data-login-error]').innerText(), w.wrong);
      assert.ok(await step(page, 'login').isVisible(), 'still on the login step');
      await logIn(page);
      await step(page, 'soon').waitFor({ state: 'visible' });
      assert.ok(await step(page, 'login').isHidden());
      const soon = await step(page, 'soon').innerText();
      assert.ok(soon.toLowerCase().includes(w.soon), 'the notice says booking opens soon');
      assert.ok(soon.includes(String(n)), 'the notice keeps the bike');
      assert.deepEqual(await labels(page), [w.account], 'the header knows too');
      const stored = await page.evaluate((k) => sessionStorage.getItem(k), CHOICE);
      assert.ok(!stored?.includes(ME.email) && !stored?.includes(PASSWORD), 'neither email nor password is stored');
      assert.equal(calls(app, 'login').length, 2);
      assert.deepEqual(errors, []);
      await page.close();
    });
  }
}

test('Back to the bikes goes from the login step to the map with the pick still on', async () => {
  const { page } = await open();
  const n = await pickAndContinue(page);
  await step(page, 'login').waitFor({ state: 'visible' });
  await step(page, 'login').locator('[data-back-to-map]').click();
  await step(page, 'map').waitFor({ state: 'visible' });
  assert.ok(await step(page, 'login').isHidden());
  assert.equal(await sheet(page).locator(`button[data-bike="${n}"]`).getAttribute('aria-pressed'), 'true');
  await page.close();
});

test('already signed in, Continue skips the login step and goes straight to the notice', async () => {
  const { page, app } = await open({ app: { signedIn: true }, hint: true });
  await page.waitForFunction(() => document.querySelector('[data-login]')?.textContent.trim() === 'Moj račun');
  await book(page);
  await sheet(page).locator('button[data-bike]:not([disabled])').first().click();
  await sheet(page).locator('[data-continue]').click();
  await step(page, 'soon').waitFor({ state: 'visible' });
  assert.ok(await step(page, 'login').isHidden(), 'the login step never showed');
  assert.equal(calls(app, 'login').length, 0);
  await page.close();
});

test('the waiting list for a full class goes to login without a back button, and signed in it goes to the notice', async () => {
  const { page } = await open();
  await book(page, { full: true });
  await step(page, 'login').waitFor({ state: 'visible' });
  assert.ok((await step(page, 'login').innerText()).includes('Lista čekanja'), 'the summary says waiting list');
  assert.ok(await step(page, 'login').locator('[data-back-to-map]').isHidden(), 'no map to go back to');
  await page.close();
  const signed = await open({ app: { signedIn: true }, hint: true });
  await signed.page.waitForFunction(() => document.querySelector('[data-login]')?.textContent.trim() === 'Moj račun');
  await book(signed.page, { full: true });
  await step(signed.page, 'soon').waitFor({ state: 'visible' });
  assert.ok(await step(signed.page, 'login').isHidden());
  await signed.page.close();
});

test('the "your pick" bar after a reload continues to the login step, or to the notice when signed in', async () => {
  const { page } = await open();
  const c = (await classes(page)).find((x) => x.takenBikes.length < x.capacity);
  // A bike that is free in this class: the mock feed changes with the day, so a fixed number can be taken.
  const bike = Array.from({ length: c.capacity }, (_, i) => i + 1).find((n) => !c.takenBikes.includes(n));
  const choice = JSON.stringify({ classId: c.id, startsAt: c.startsAt, bike });
  await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [CHOICE, choice]);
  await page.reload();
  await page.waitForSelector('[data-schedule]');
  await page.locator('[data-pending]').waitFor({ state: 'visible' });
  await page.locator('[data-pending-continue]').click();
  await step(page, 'login').waitFor({ state: 'visible' });
  await page.close();
  const signed = await open({ app: { signedIn: true }, hint: true });
  await signed.page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [CHOICE, choice]);
  await signed.page.reload();
  await signed.page.waitForSelector('[data-schedule]');
  await signed.page.locator('[data-pending]').waitFor({ state: 'visible' });
  await signed.page.locator('[data-pending-continue]').click();
  await step(signed.page, 'soon').waitFor({ state: 'visible' });
  assert.ok(await step(signed.page, 'login').isHidden());
  await signed.page.close();
});

test('reopening the sheet starts with an empty login form, no old error and no old password', async () => {
  const { page } = await open();
  await pickAndContinue(page);
  await step(page, 'login').waitFor({ state: 'visible' });
  await logIn(page, 'wrong-password-1');
  await step(page, 'login').locator('[data-login-error]:not(:empty)').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[data-bike-sheet]')?.open);
  await pickAndContinue(page);
  await step(page, 'login').waitFor({ state: 'visible' });
  assert.equal(await step(page, 'login').locator('[data-login-error]').innerText(), '');
  assert.equal(await step(page, 'login').locator('input[name="password"]').inputValue(), '');
  assert.equal(await step(page, 'login').locator('input[name="email"]').inputValue(), '');
  await page.close();
});
