// While true, the waitlist page is the homepage (`/` and `/en`), the full homepage sits at the hidden /pocetna and
// /en/home, and "Lista čekanja" is in the nav. Opening checklist (Dunia may move 4 January):
//   1. set this to false, 2. deploy. `/` is then the full homepage, /pocetna and /waitlist redirect to it and the
//   nav loses "Lista čekanja". Check the Waitlist offer wording and the opening hours first.
export const waitlistOnHome = true;

// The first day anyone can book: 4 January, the same day as the first class (Antun, 2026-11-25, from Dunia; it replaces
// 21 December). Before it the schedule shows every class with a greyed-out button (schedule-days.ts isBookable). The
// app's database has the same day (settings.booking_opens_on). Dunia may move it: change it there too, and
// `waitlistOnHome`.
// Tests only: PUBLIC_BOOKING_OPENS_ON overrides the date for one build (npm run test:sheet), so the sheet suite can run
// before opening day. Never set it for a real build. `import.meta.env` does not exist in plain node, hence the `?.`.
export const bookingOpensOn: string = import.meta.env?.PUBLIC_BOOKING_OPENS_ON ?? '2027-01-04';

// The first day with a class. The schedule has no class before it, so it never looks as if we ran classes earlier.
// Tests only, like `bookingOpensOn`: PUBLIC_FIRST_CLASS_ON lets the mock schedule start near today in a test build.
export const firstClassOn: string = import.meta.env?.PUBLIC_FIRST_CLASS_ON ?? '2027-01-04';
