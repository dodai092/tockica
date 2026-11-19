// While true, the waitlist page is the homepage (`/` and `/en`), the full homepage sits at the hidden /pocetna and
// /en/home, and "Lista čekanja" is in the nav. Opening checklist (Dunia may move 4 January):
//   1. set this to false, 2. deploy. `/` is then the full homepage, /pocetna and /waitlist redirect to it and the
//   nav loses "Lista čekanja". Check the Waitlist offer wording and the opening hours first.
export const waitlistOnHome = true;

// The first day a class can be booked. Before it the schedule shows every class with a greyed-out button
// (schedule-days.ts isBookable). Dunia may move it with the opening: change it here with `waitlistOnHome`.
// Tests only: PUBLIC_BOOKING_OPENS_ON overrides the date for one build (npm run test:sheet), so the sheet suite can run
// before opening day. Never set it for a real build. `import.meta.env` does not exist in plain node, hence the `?.`.
export const bookingOpensOn: string = import.meta.env?.PUBLIC_BOOKING_OPENS_ON ?? '2027-01-04';
