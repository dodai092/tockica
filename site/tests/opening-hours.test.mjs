// The opening hours card on the waitlist page (home) and on Kontakt. On the home page it has two columns from the md
// breakpoint (heading and address left, hours right). On Kontakt it sits beside the form, so it is always stacked. Reads the built pages, so run `npm run build` first.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { contact } from '../src/data/contact.ts';

const section = async (page) => {
  const html = await readFile(new URL(`../dist/${page}`, import.meta.url), 'utf8');
  const m = html.match(/<section[^>]*data-section="hours"[\s\S]*?<\/section>/);
  assert.ok(m, `the hours section is on ${page}`);
  return m[0];
};

test('every hours range in the data has spaces around the hyphen', () => {
  for (const h of contact.hours)
    assert.match(h.time, /^\d{1,2}:\d{2} - \d{1,2}:\d{2}(, \d{1,2}:\d{2} - \d{1,2}:\d{2})?$/, h.days.en);
});

for (const [page, lang, heading] of [
  ['index.html', 'hr', 'Radno vrijeme od 4. siječnja'],
  ['en/index.html', 'en', 'Opening hours from 4 January'],
  ['kontakt/index.html', 'hr', 'Radno vrijeme od 4. siječnja'],
  ['en/contact/index.html', 'en', 'Opening hours from 4 January'],
]) {
  test(`${page}: heading, address and all seven days with their times are there`, async () => {
    const s = await section(page);
    assert.ok(s.includes(heading), 'heading');
    assert.match(s, new RegExp(`data-contact="address"[^>]*>[\\s\\S]*?${contact.address}`));
    const items = s.match(/<li[\s\S]*?<\/li>/g) ?? [];
    assert.equal(items.length, 7);
    contact.hours.forEach((h, i) => {
      assert.ok(items[i].includes(h.days[lang]), `${h.days[lang]} label`);
      assert.ok(items[i].includes(h.time), `${h.days[lang]} time`);
    });
  });

  test(`${page}: the heading is balanced so it does not leave one word on its own line`, async () => {
    const s = await section(page);
    assert.match(s, /<h2[^>]*class="[^"]*\btext-balance\b/);
  });

  test(`${page}: the address icon is hidden from screen readers and the address text stays outside it`, async () => {
    const s = await section(page);
    const p = s.match(/<p[^>]*data-contact="address"[\s\S]*?<\/p>/)[0];
    assert.match(p, /<svg[^>]*aria-hidden="true"/);
    assert.ok(p.replace(/<svg[\s\S]*?<\/svg>/, '').includes(contact.address));
  });
}

for (const page of ['kontakt/index.html', 'en/contact/index.html']) {
  test(`${page}: the card is stacked, the address and hours appear once, e-mail and phone stay beside them`, async () => {
    const html = await readFile(new URL(`../dist/${page}`, import.meta.url), 'utf8');
    const main = html.match(/<main[\s\S]*?<\/main>/)[0];
    assert.doesNotMatch(await section(page), /md:grid-cols|md:first:/);
    assert.equal(main.split(contact.address).length - 1, 1);
    assert.equal((main.match(/data-contact="hours"/g) ?? []).length, 1);
    assert.match(main, /data-contact="email"[\s\S]*?mailto:info@tockicanai\.hr/);
    assert.match(main, /data-contact="phone"/);
  });
}
