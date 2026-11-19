// The header's login sheet (ADR 0007): opens from Prijava on the same page, logs in against the booking app's /api, shows
// who is signed in with a log out button, and costs a visitor who never logged in no request. The app is faked
// (tests/fake-booking-app.mjs). Real browser against the built site.
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
  '/': {
    login: 'Prijava',
    account: 'Moj račun',
    wrong: 'Pogrešan email ili lozinka.',
    signedIn: 'Prijavljeni račun: Ana Horvat',
    logout: 'Odjava',
  },
  '/en/schedule': {
    login: 'Log in',
    account: 'My account',
    wrong: 'Wrong email or password.',
    signedIn: 'Signed in as Ana Horvat',
    logout: 'Log out',
  },
};

/** `hint` starts with the "this browser logged in" flag. `app` goes to the fake booking app. */
async function open({ width, path = '/', hint = false, app: appOptions } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const app = await fakeBookingApp(page, appOptions);
  if (hint) await page.addInitScript((k) => localStorage.setItem(k, '1'), HINT);
  await page.goto(`${origin}${path}`);
  await page.waitForLoadState('load');
  return { page, errors, app };
}

const sheet = (page) => page.locator('dialog[data-login-sheet]');
const closed = (page) => page.waitForFunction(() => !document.querySelector('dialog[data-login-sheet]')?.open);
const hintOf = (page) => page.evaluate((k) => localStorage.getItem(k), HINT);
const calls = (app, path) => app.calls.filter((c) => c.path === path);
const labels = async (page) => [
  ...new Set(await page.$$eval('[data-login]', (els) => els.map((e) => e.textContent.trim()))),
];
const settle = (page) => page.waitForTimeout(450);

/** The Prijava control a visitor really presses: in the bar from 1150px, in the open menu below it. */
async function trigger(page, width) {
  if (width < 1150) {
    await page.click('[data-aw-toggle-menu]');
    await page.waitForTimeout(700);
    return page.locator('[data-menu-panel] [data-login]:visible');
  }
  return page.locator('[data-menu-extras] [data-login]');
}
const press = async (page, width) => (await trigger(page, width)).click();
const logIn = async (page, email = ME.email, password = PASSWORD) => {
  await sheet(page).locator('input[name="email"]').fill(email);
  await sheet(page).locator('input[name="password"]').fill(password);
  await sheet(page).locator('[data-login-submit]').click();
};

for (const width of [390, 1280]) {
  test(`${width}px: Prijava opens the sheet on the same page, the email field has focus, and no /api/me call was made`, async () => {
    const { page, app, errors } = await open({ width });
    await settle(page);
    assert.equal(calls(app, 'me').length, 0, 'a visitor who never logged in costs no request');
    await press(page, width);
    await sheet(page).waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'email');
    assert.equal(page.url(), `${origin}/`, 'no navigation');
    assert.equal(page.context().pages().length, 1, 'no new tab');
    assert.equal(await sheet(page).locator('[data-sheet-title]').innerText(), 'Prijava');
    assert.deepEqual(errors, []);
    await page.close();
  });

  test(`${width}px: a wrong password shows the error, keeps the sheet open and the flag unset`, async () => {
    const { page, app } = await open({ width });
    await press(page, width);
    await sheet(page).waitFor({ state: 'visible' });
    await logIn(page, ME.email, 'wrong-password-1');
    await sheet(page).locator('[data-login-error]:not(:empty)').waitFor();
    assert.equal(await sheet(page).locator('[data-login-error]').innerText(), words['/'].wrong);
    assert.equal(await sheet(page).evaluate((d) => d.open), true);
    assert.equal(await hintOf(page), null);
    assert.equal(calls(app, 'login').length, 1);
    assert.deepEqual(await labels(page), ['Prijava']);
    await page.close();
  });

  test(`${width}px: the right password closes the sheet, every Prijava becomes Moj račun, the flag is set`, async () => {
    const { page, app, errors } = await open({ width });
    await press(page, width);
    await sheet(page).waitFor({ state: 'visible' });
    await logIn(page);
    await closed(page);
    assert.deepEqual(await labels(page), ['Moj račun']);
    assert.equal(await hintOf(page), '1');
    assert.equal(calls(app, 'me').length, 1, 'one /api/me call, to read the name after the login');
    assert.equal(await sheet(page).locator('input[name="password"]').inputValue(), '', 'the password field is cleared');
    assert.deepEqual(errors, []);
    await page.close();
  });

  test(`${width}px: signed in, the sheet shows who is signed in, and log out undoes it`, async () => {
    const { page, app } = await open({ width });
    await press(page, width);
    await sheet(page).waitFor({ state: 'visible' });
    await logIn(page);
    await closed(page);
    await settle(page);
    await press(page, width);
    await sheet(page).waitFor({ state: 'visible' });
    assert.equal(await sheet(page).locator('[data-sheet-title]').innerText(), 'Moj račun');
    assert.equal(await sheet(page).locator('[data-signed-in-text]').innerText(), words['/'].signedIn);
    assert.equal(
      await sheet(page).locator('[data-login-view="form"]').isHidden(),
      true,
      'no login form while signed in'
    );
    assert.equal(await sheet(page).locator('[data-logout]').innerText(), words['/'].logout);
    await sheet(page).locator('[data-logout]').click();
    await closed(page);
    assert.deepEqual(await labels(page), ['Prijava']);
    assert.equal(await hintOf(page), null);
    assert.equal(calls(app, 'logout').length, 1);
    await page.close();
  });

  test(`${width}px: a logout the app cannot confirm keeps the person signed in and says why`, async () => {
    const { page, app } = await open({ width, app: { signedIn: true, logoutStatus: 503 }, hint: true });
    await page.waitForFunction(() => document.querySelector('[data-login]')?.textContent.trim() === 'Moj račun');
    await press(page, width);
    await sheet(page).waitFor({ state: 'visible' });
    await sheet(page).locator('[data-logout]').click();
    await sheet(page).locator('[data-logout-error]:not(:empty)').waitFor();
    assert.equal(
      await sheet(page).locator('[data-logout-error]').innerText(),
      'Trenutno nije dostupno, pokušaj kasnije.'
    );
    assert.equal(await sheet(page).evaluate((d) => d.open), true);
    assert.deepEqual(await labels(page), ['Moj račun']);
    assert.equal(await hintOf(page), '1');
    assert.equal(calls(app, 'logout').length, 1);
    await page.close();
  });
}

test('a browser with the flag asks /api/me once on load and shows Moj račun', async () => {
  const { page, app } = await open({ width: 1280, app: { signedIn: true }, hint: true });
  await page.waitForFunction(() => document.querySelector('[data-login]')?.textContent.trim() === 'Moj račun');
  assert.equal(calls(app, 'me').length, 1);
  await page.close();
});

test('a stale flag (the session ended) is cleared and the header stays Prijava', async () => {
  const { page, app } = await open({ width: 1280, hint: true });
  await page.waitForFunction((k) => localStorage.getItem(k) === null, HINT);
  assert.equal(calls(app, 'me').length, 1);
  assert.deepEqual(await labels(page), ['Prijava']);
  await page.close();
});

test('when the app cannot be reached the flag is kept and nothing is decided', async () => {
  const { page, app } = await open({ width: 1280, app: { signedIn: true, meStatus: 503 }, hint: true });
  await page.waitForFunction(() => true);
  await settle(page);
  assert.equal(calls(app, 'me').length, 1);
  assert.equal(await hintOf(page), '1');
  assert.deepEqual(await labels(page), ['Prijava']);
  await page.close();
});

test('Esc closes the sheet and focus goes back to Prijava', async () => {
  const { page } = await open({ width: 1280 });
  await press(page, 1280);
  await sheet(page).waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await closed(page);
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-login')), true);
  await page.close();
});

for (const path of Object.keys(words)) {
  test(`${path}: Prijava is a real link to the booking app's page, so it still works without JavaScript`, async () => {
    const { page } = await open({ width: 1280, path });
    const want = path.startsWith('/en') ? '/en/prijava' : '/prijava';
    const hrefs = await page.$$eval('[data-login]', (els) => els.map((e) => e.getAttribute('href')));
    assert.ok(hrefs.length >= 2 && hrefs.every((h) => h === want), JSON.stringify(hrefs));
    // The "forgot" and "sign up" links in the form go to the same page, in the page's language.
    const formHrefs = await page.$$eval('[data-login-form] a', (els) => els.map((e) => e.getAttribute('href')));
    assert.ok(formHrefs.length >= 2 && formHrefs.every((h) => h === want), JSON.stringify(formHrefs));
    await page.close();
  });
}

test('the English page speaks English: label, error, and signed-in view', async () => {
  const w = words['/en/schedule'];
  const { page } = await open({ width: 1280, path: '/en/schedule' });
  assert.deepEqual(await labels(page), [w.login]);
  await press(page, 1280);
  await sheet(page).waitFor({ state: 'visible' });
  await logIn(page, ME.email, 'wrong-password-1');
  await sheet(page).locator('[data-login-error]:not(:empty)').waitFor();
  assert.equal(await sheet(page).locator('[data-login-error]').innerText(), w.wrong);
  await logIn(page);
  await closed(page);
  assert.deepEqual(await labels(page), [w.account]);
  await settle(page);
  await press(page, 1280);
  await sheet(page).waitFor({ state: 'visible' });
  assert.equal(await sheet(page).locator('[data-signed-in-text]').innerText(), w.signedIn);
  assert.equal(await sheet(page).locator('[data-logout]').innerText(), w.logout);
  await page.close();
});
