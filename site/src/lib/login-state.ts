// Who this page knows is signed in, shared by the header's login sheet and the bike sheet. State lives in this module
// and every change is announced on `document` (`login:changed`), which ClientRouter keeps across navigations.
// A visitor who never logged in makes no request: only a browser with the login flag asks /api/me.
import { clearHint, fetchMe, hasHint, logout, setHint } from './login.ts';
import type { Me } from './login.ts';

const EVENT = 'login:changed';
let me: Me | null = null;
let restored = false;

export const currentUser = (): Me | null => me;

const announce = () => document.dispatchEvent(new CustomEvent<Me | null>(EVENT, { detail: me }));

/** Calls back at once with the current state, and again on every change. */
export function onLoginChange(callback: (user: Me | null) => void): void {
  callback(me);
  document.addEventListener(EVENT, (e) => callback((e as CustomEvent<Me | null>).detail));
}

/** After a successful login: reads the account, remembers that this browser logged in, and announces it. */
export async function signedIn(): Promise<Me | null> {
  const user = await fetchMe();
  if (!user || user === 'unknown') return null;
  me = user;
  setHint();
  announce();
  return me;
}

/** Logs out. Returns false when the app could not confirm it, so the person stays signed in and can try again. */
export async function signOut(): Promise<boolean> {
  if (!(await logout())) return false;
  me = null;
  clearHint();
  announce();
  return true;
}

/** Once per page load: a browser with the login flag asks whether the cookie still holds. */
export async function restore(): Promise<void> {
  if (restored) return;
  restored = true;
  if (!hasHint()) return;
  const user = await fetchMe();
  if (user === 'unknown') return;
  if (user) {
    me = user;
    announce();
  } else clearHint();
}
