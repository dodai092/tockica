// Staff accounts without SQL (ADR 0004). Needs app/.env (database URL, Supabase URL and service key).
//   npm run staff -- create --email a@studio.hr --name "Ime Prezime" --role owner [--out file]
//   npm run staff -- reset  --email a@studio.hr [--out file]
// The new password is written to a file only you can read (mode 600) and never printed. The file is not overwritten.
import { existsSync, writeFileSync } from 'node:fs';
import { getPool, closePool } from '../server/db/pool.js';
import { createSupabaseAdmin } from '../server/supabase-admin.js';
import { createStaff, resetStaffPassword, StaffAdminError } from '../server/staff-admin.js';

const [command, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.flatMap((a, i) => (a.startsWith('--') ? [[a.slice(2), rest[i + 1]]] : [])));
const fail = (m) => { console.error(m); process.exitCode = 1; };

try {
  const missing = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing in app/.env: ${missing.join(', ')}`);
  if (!['create', 'reset'].includes(command) || !opt.email) throw new Error('Usage: staff create --email E --name N --role R [--out F] | staff reset --email E [--out F]');
  const db = getPool();
  const admin = createSupabaseAdmin({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
  const out = opt.out ?? `.staff-password-${opt.email.replace(/[^a-z0-9]+/gi, '-')}.txt`;
  if (existsSync(out)) throw new Error(`${out} already exists, move it or pick --out`);
  const r = command === 'create' ? await createStaff({ db, admin, email: opt.email, name: opt.name, role: opt.role }) : await resetStaffPassword({ db, admin, email: opt.email });
  writeFileSync(out, `Staff login (${command})\nemail: ${opt.email.trim().toLowerCase()}\npassword: ${r.password}\nSave it in a password manager, then delete this file.\n`, { mode: 0o600, flag: 'wx' });
  console.log(`${command === 'create' ? 'Created' : 'Reset'} ${opt.email}. Password written to ${out} (mode 600). Not printed.`);
} catch (e) {
  fail(e instanceof StaffAdminError ? `Refused: ${e.code}${e.message !== e.code ? ` (${e.message})` : ''}` : `Failed: ${e.message}`);
} finally {
  await closePool();
}
