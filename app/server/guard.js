// Who may open which route (plan Task 4, ADR 0004). Closed by default: a path nobody registered is a 404, and
// a route is opened on purpose with open(), customer() or staff(). Roles are checked here, on the server.
// Sessions come from getSession(req): { kind: 'customer', accountId } or { kind: 'staff', staffId, role }.
// Customers and staff are separate accounts, so a staff session never opens a customer route.
export const STAFF_ROLES = ['owner', 'reception', 'instructor', 'admin'];
const STAFF_PREFIX = '/api/osoblje/';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createGuardedRouter({ getSession }) {
  const routes = [];

  const add = (area, path, roles, handler) => {
    if ((area === 'staff') !== path.startsWith(STAFF_PREFIX)) {
      throw new Error(`${path}: only staff routes live under ${STAFF_PREFIX}, and every route there is a staff route`);
    }
    routes.push({ area, path, roles, handler });
  };

  const check = (route, session) => {
    if (route.area === 'open') return;
    if (!session) throw new HttpError(401, 'Sign in first');
    if (route.area === 'customer') {
      if (session.kind !== 'customer') throw new HttpError(403, 'This is a customer page');
      return;
    }
    if (session.kind !== 'staff' || !route.roles.includes(session.role)) throw new HttpError(403, 'Not allowed');
  };

  return {
    routes,
    open: (path, handler) => add('open', path, [], handler),
    customer: (path, handler) => add('customer', path, [], handler),
    staff(path, roles, handler) {
      if (!roles.length) throw new Error(`${path}: a staff route needs at least one role`);
      const unknown = roles.find((r) => !STAFF_ROLES.includes(r));
      if (unknown) throw new Error(`${path}: unknown role "${unknown}"`);
      add('staff', path, roles, handler);
    },
    async handle(req) {
      const route = routes.find((r) => r.path === new URL(req.url).pathname);
      if (!route) return new Response('Not found', { status: 404 });
      try {
        const session = await getSession(req, route);
        check(route, session);
        const res = await route.handler(req, session);
        // A visit that slid the session sends the cookie again. A handler that set its own cookie (logout) wins.
        if (session?.cookie && !res.headers.has('set-cookie')) res.headers.append('set-cookie', session.cookie);
        return res;
      } catch (e) {
        if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
        throw e;
      }
    },
  };
}
