// Runs before `astro build` (npm run build). PUBLIC_BOOKING_OPENS_ON is a test-only override of the opening date
// (src/data/waitlist.ts, npm run test:sheet). A launch build must never carry it: exit 1 when LAUNCH=1 and it is set.
if (process.env.LAUNCH === '1' && process.env.PUBLIC_BOOKING_OPENS_ON) {
  console.error(
    'LAUNCH=1: PUBLIC_BOOKING_OPENS_ON is set. It is a test override of the opening date, unset it for a real build.'
  );
  process.exit(1);
}
