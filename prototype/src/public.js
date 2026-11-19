import { isBookable, descriptorLine } from './schedule.js';
export { descriptorLine };
import { takenBikes } from './booking.js';
import { taughtBy } from './payroll.js';

export function firstName(name) {
  return name.trim().split(/\s+/)[0] ?? '';
}

// The instructor's profile page on the public site ("Ena" is /instruktori/ena). At launch the app runs under
// tockicanai.hr (ADR 0005), so a path on the same host is enough. Matches site/src/lib/instructor-link.ts.
export function profilePath(first, lang) {
  const slug = first.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return `${lang === 'en' ? '/en/instructors/' : '/instruktori/'}${slug}`;
}

// What the public site may show: next open classes, first names only, no customer data.
export function publicNextClasses(store, now, limit = 4) {
  return store.classes
    .filter((c) => isBookable(c, now))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      startsAt: c.startsAt,
      name: c.name,
      themeName: c.themeName?.trim() || null,
      instructor: firstName(store.instructors.find((i) => i.id === taughtBy(c))?.name ?? ''),
      freeBikes: c.bikeCount - takenBikes(store, c.id).length,
      capacity: c.bikeCount,
    }));
}
