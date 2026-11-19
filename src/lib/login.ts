// The site's side of the booking app login (ADR 0007). The site only talks to /api on its own domain, which Netlify
// proxies to the booking app, so the login cookie is first party. Nothing here keeps a name, email or password: the
// only thing the browser keeps is a flag saying "this browser has logged in", so a visitor who never did causes no
// request on page load (the Netlify free plan has a hard cap on function credits).
import { withBase } from './base.ts';

export type Me = { firstName: string; lastName: string; email: string };
export type LoginResult = { ok: true } | { ok: false; reason: 'credentials' | 'no-account' | 'unavailable' };

type Send = (url: string, init?: RequestInit) => Promise<Pick<Response, 'status' | 'json'>>;

const JSON_HEADERS = { 'content-type': 'application/json' };
const HINT = 'tockica.login-hint';

export async function login(email: string, password: string, send: Send = fetch): Promise<LoginResult> {
  try {
    const r = await send(withBase('/api/login'), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, password }),
      credentials: 'same-origin',
    });
    if (r.status === 200) return { ok: true };
    if (r.status === 401) return { ok: false, reason: 'credentials' };
    if (r.status === 403) return { ok: false, reason: 'no-account' };
    return { ok: false, reason: 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** The signed-in account, null when signed out, 'unknown' when the app could not be reached (then nothing is decided). */
export async function fetchMe(send: Send = fetch): Promise<Me | null | 'unknown'> {
  try {
    const r = await send(withBase('/api/me'), { credentials: 'same-origin' });
    if (r.status === 401) return null;
    if (r.status !== 200) return 'unknown';
    const { firstName, lastName, email } = (await r.json()) as Me;
    return { firstName, lastName, email };
  } catch {
    return 'unknown';
  }
}

export async function logout(send: Send = fetch): Promise<boolean> {
  try {
    const r = await send(withBase('/api/logout'), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{}',
      credentials: 'same-origin',
    });
    return r.status === 200;
  } catch {
    return false;
  }
}

const store = (storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) => {
  try {
    return storage ?? localStorage;
  } catch {
    return undefined;
  }
};

export function hasHint(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): boolean {
  try {
    return store(storage)?.getItem(HINT) === '1';
  } catch {
    return false;
  }
}

export function setHint(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): void {
  try {
    store(storage)?.setItem(HINT, '1');
  } catch {
    /* storage blocked: the header shows Prijava until the next login */
  }
}

export function clearHint(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): void {
  try {
    store(storage)?.removeItem(HINT);
  } catch {
    /* storage blocked */
  }
}
