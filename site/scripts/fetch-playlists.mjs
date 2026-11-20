// Saves what the instructor pages show before Spotify's player has loaded: each playlist's name, cover and songs.
// Run `npm run playlists` after a playlist id changes in src/data/instructors.ts, or when someone edits a playlist,
// then commit src/data/playlists.json and public/playlists/. Visitors never trigger this.
// The name and cover come from Spotify's oEmbed endpoint. The songs are read from the embed page's own data, which
// Spotify does not document, so if it changes shape this stops with a clear error and writes nothing.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { instructors } from '../src/data/instructors.ts';

const UA = 'Mozilla/5.0 (compatible; tockica-site-build)';
const get = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res;
};

const ids = [...new Set(instructors.map((i) => i.playlist).filter(Boolean))];
const out = {};
const covers = {};

for (const id of ids) {
  const oembed = await (
    await get(`https://open.spotify.com/oembed?url=https://open.spotify.com/playlist/${id}`)
  ).json();
  const html = await (await get(`https://open.spotify.com/embed/playlist/${id}`)).text();
  const data = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  const list = data && JSON.parse(data).props?.pageProps?.state?.data?.entity?.trackList;
  if (!Array.isArray(list) || list.length === 0)
    throw new Error(`${id}: no song list in the embed page, its format changed`);
  if (!oembed.title || !oembed.thumbnail_url) throw new Error(`${id}: oEmbed has no title or cover`);
  out[id] = { title: oembed.title, tracks: list.map((t) => ({ title: t.title, artist: t.subtitle })) };
  covers[id] = Buffer.from(await (await get(oembed.thumbnail_url)).arrayBuffer());
  console.log(`${id}  ${oembed.title}  ${list.length} songs`);
}

const dir = new URL('../public/playlists/', import.meta.url);
await mkdir(dir, { recursive: true });
for (const [id, buf] of Object.entries(covers)) await writeFile(new URL(`${id}.jpg`, dir), buf);
await writeFile(
  fileURLToPath(new URL('../src/data/playlists.json', import.meta.url)),
  `${JSON.stringify(out, null, 2)}\n`
);
console.log(`saved ${ids.length} playlists`);
