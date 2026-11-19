// Netlify Function that serves every /api/* request through server/index.js.
import { route } from '../index.js';

export default (req) => route(req);

export const config = { path: '/api/*' };
