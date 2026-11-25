// The credit number in the header: a red dot and the number, or the unlimited sign. Left of the language flag on desktop,
// in the middle of the bar on a phone. Nothing shows unless /api/me carries credits. Real browser against the built
// site, the app is faked (tests/fake-booking-app.mjs).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import { chromium } from 'playwright';
import { fakeBookingApp, ME } from './fake-booking-app.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const PORT = 4328;
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
  // `astro preview` keeps its server running after the process that started it is gone.
  spawnSync('npx', ['--no-install', 'astro', 'preview', 'stop'], { cwd: root, stdio: 'ignore' });
});

/** Signed in unless `signedOut`. `credits` undefined is the app with credits switched off. */
async function open({ width, path = '/', credits, signedOut = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  await fakeBookingApp(page, { signedIn: !signedOut });
  if (!signedOut) {
    await page.route('**/api/me', (route) => route.fulfill({ status: 200, json: { ...ME, credits } }));
    await page.addInitScript((k) => localStorage.setItem(k, '1'), HINT);
  }
  await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
  return page;
}
const count = (page) => page.locator('#header [data-credits]');
const spoken = async (page) => (await count(page).locator('[data-credits-spoken]').textContent()).trim();
const signedInHeader = (page) =>
  page.waitForFunction(() => /Moj račun|My account/.test(document.querySelector('#header [data-login]').textContent));

for (const [path, credits, shown, words] of [
  ['/', 0, '0', '0 kredita'],
  ['/', 1, '1', '1 kredit'],
  ['/', 3, '3', '3 kredita'],
  ['/', 11, '11', '11 kredita'],
  ['/', 21, '21', '21 kredit'],
  ['/', 'unlimited', '', 'neograničeno'],
  ['/en', 1, '1', '1 credit'],
  ['/en', 21, '21', '21 credits'],
  ['/en', 'unlimited', '', 'unlimited'],
]) {
  test(`${path}: ${credits} shows as "${shown || '∞'}" and is read as "${words}"`, async () => {
    const page = await open({ width: 375, path, credits });
    await count(page).waitFor();
    assert.equal((await count(page).locator('[data-credits-number]').textContent()).trim(), shown);
    assert.equal(await count(page).locator('[data-credits-infinity]').isVisible(), credits === 'unlimited');
    assert.equal(await spoken(page), words);
    await page.close();
  });
}

test('nothing shows when the app sends no credits (switched off), or when signed out', async () => {
  const off = await open({ width: 375 });
  await signedInHeader(off).catch(() => {});
  await off.waitForTimeout(300);
  assert.equal(await count(off).isVisible(), false, 'credits off');
  await off.close();
  const out = await open({ width: 375, signedOut: true });
  assert.equal(await count(out).isVisible(), false, 'signed out');
  await out.close();
});

for (const width of [320, 375]) {
  test(`${width}px: the count is in the middle of the bar, outside the menu, clear of the logo and flag`, async () => {
    const page = await open({ width, credits: 100 });
    await count(page).waitFor();
    const m = await page.evaluate(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      const c = box('#header [data-credits]');
      const logo = box('#header .tk-logo');
      const flag = box('#header [data-lang-switch]');
      return {
        centre: Math.abs((c.left + c.right) / 2 - innerWidth / 2),
        level: Math.abs((c.top + c.bottom) / 2 - (flag.top + flag.bottom) / 2),
        gap: Math.min(c.left - logo.right, flag.left - c.right),
        inMenu: !!document.querySelector('#header [data-menu-panel] [data-credits]'),
        overflow: document.documentElement.scrollWidth - innerWidth,
        flagText: document.querySelector('#header [data-lang-switch]').textContent.trim(),
      };
    });
    assert.ok(m.centre <= 1 && m.level <= 1 && m.gap >= 8 && !m.inMenu && m.overflow <= 0, JSON.stringify(m));
    assert.equal(m.flagText, '', 'the language toggle stays a flag only');
    await page.close();
  });
}

for (const path of ['/', '/en/schedule']) {
  for (const width of [1150, 1280]) {
    test(`${path} at ${width}px: the count sits left of the flag and the bar stays on one line`, async () => {
      const page = await open({ width, path, credits: 100 });
      await count(page).waitFor();
      await signedInHeader(page);
      const m = await page.evaluate(() => {
        const box = (s) => document.querySelector(s).getBoundingClientRect();
        const c = box('#header [data-credits]');
        const flag = box('#header [data-lang-switch]');
        const nav = box('#header nav ul');
        const book = box('#header [data-book]');
        return {
          beforeFlag: flag.left - c.right,
          afterNav: c.left - nav.right,
          level: Math.abs((c.top + c.bottom) / 2 - (flag.top + flag.bottom) / 2),
          inside: innerWidth - book.right,
          navHeight: nav.height,
        };
      });
      assert.ok(m.beforeFlag >= 0 && m.beforeFlag <= 20 && m.afterNav >= 12, JSON.stringify(m));
      assert.ok(m.level <= 1 && m.inside >= 0 && m.navHeight < 60, JSON.stringify(m));
      await page.close();
    });
  }
}

test('the count is still there after moving to another page, and goes on log out', async () => {
  const page = await open({ width: 1280, credits: 3 });
  await count(page).waitFor();
  await page.locator('#header nav a[href$="/kontakt"]').click();
  await page.waitForURL('**/kontakt');
  await page.waitForTimeout(800);
  assert.equal(await count(page).isVisible(), true, 'after navigation');
  await page.locator('#header [data-menu-extras] [data-login]').click();
  await page.locator('dialog[data-login-sheet] [data-logout]').click();
  await count(page).waitFor({ state: 'hidden' });
  await page.close();
});

for (const credits of [3, 'unlimited']) {
  test(`${credits}: the dot sits the same short step from what follows it`, async () => {
    const page = await open({ width: 375, credits });
    await count(page).waitFor();
    const step = await count(page).evaluate((el) => {
      const [dot, ...rest] = [...el.children].filter((c) => !c.matches('.sr-only'));
      const next = rest.find((c) => c.getBoundingClientRect().width > 0);
      return next.getBoundingClientRect().left - dot.getBoundingClientRect().right;
    });
    assert.ok(Math.abs(step - 8) <= 1, `${step}px`);
    await page.close();
  });
}
