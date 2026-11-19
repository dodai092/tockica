// A stand-in for the booking app's three login calls (/api/login, /api/me, /api/logout), for tests that drive the built
// site in a browser. Not a test file: the runner only picks up *.test.mjs. `state.calls` records what the page asked.
export const ME = { firstName: 'Ana', lastName: 'Horvat', email: 'ana@example.com' };
export const PASSWORD = 'right-password-1';

/**
 * Routes the three calls on `page`. Options: `signedIn` starts with a valid session, `logoutStatus` is what /api/logout
 * answers, `meStatus` makes /api/me answer that status whatever the session (an unreachable app is 503).
 */
export async function fakeBookingApp(page, { signedIn = false, logoutStatus = 200, meStatus = null } = {}) {
  const state = { me: signedIn ? ME : null, logoutStatus, meStatus, calls: [] };
  await page.route('**/api/login', (route) => {
    const body = route.request().postDataJSON();
    state.calls.push({ path: 'login', body });
    if (body.email === ME.email && body.password === PASSWORD) {
      state.me = ME;
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    return route.fulfill({ status: 401, json: { error: 'Wrong email or password' } });
  });
  await page.route('**/api/me', (route) => {
    state.calls.push({ path: 'me' });
    if (state.meStatus) return route.fulfill({ status: state.meStatus, json: {} });
    return state.me
      ? route.fulfill({ status: 200, json: state.me })
      : route.fulfill({ status: 401, json: { error: 'Sign in first' } });
  });
  await page.route('**/api/logout', (route) => {
    state.calls.push({ path: 'logout' });
    if (state.logoutStatus === 200) state.me = null;
    return route.fulfill({ status: state.logoutStatus, json: {} });
  });
  return state;
}
