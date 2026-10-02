# Game Overview from PlayStation (Part 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Game pages show a trailer, screenshots, overview, ★ rating and game info read from PlayStation Store, refreshed from admin buttons, with the owner's own entries always winning.

**Architecture:** `lib/psn-game.js` finds a game's PlayStation concept (search index) and parses its store page; the result is stored on the game as `game.psn` in `games.json`. `lib/game-psn-view.js` resolves owner-vs-PlayStation values for the page. Public pages only read stored data. Admin gets an "Update all" route and a per-game section.

**Tech Stack:** Node, Express, EJS, lowdb v1, plain browser JS. No new dependencies. Tests are plain `node scripts/test-*.js`.

Spec: `docs/superpowers/specs/2026-10-02-game-psn-overview-design.md`

## Global Constraints

- Work directly on `main`; commit per task; **push only when the owner says "push"**.
- Commit messages end with: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- **Line endings** (use the provided edit scripts or the Edit tool; verify with `file`): `server.js` is CRLF + UTF-8 BOM; `public/css/style.css` is CRLF; `views/edit.ejs` is LF + BOM; `views/admin.ejs`, `views/game-detail.ejs`, `views/partials/admin/games/all-games.ejs`, `lib/*` and every new file are LF.
- **Tests never touch real data or the network:** boot tests use a temp `DATA_DIR`, `MONGODB_URI=''`, and stubbed PlayStation fetching; nothing reaches PlayStation, a database, the project's `games.json`, or the real admin. (`scripts/test-admin-psn.js` logs in to its own throwaway instance with a password it generates.)
- Public page rendering never calls PlayStation; it reads only stored `game.psn`.
- Owner wins: PlayStation fills only what the owner left empty (description, genre, release date, gallery). The owner's cover is never replaced. An update never modifies any field except `psn`.
- Media URLs are stored only if hosted on `image.api.playstation.com` (images) or `vulcan.dl.playstation.net` (videos); caps 12 screenshots, 3 videos.
- "Update all": 60 games per press, 300 ms between games (`PSN_PAUSE_MS` env overrides, tests set 0), games fetched within 7 days skipped unless `force=1`.
- A game with no `psn` renders exactly as before this feature.
- Spec differences decided while planning: About / Game info sit in a full-width block below the rent box (not in the left column) so on phones the rent box stays right under the trailer; no meta-description change (the page has none); with PlayStation data the description moves from under the poster into "About this game".
- Known unrelated failure: `scripts/test-requests-page.js` fails before and after. Report it, do not fix it.
- Scratch edit scripts live in `.superpowers/tmp-edits/` (git-excluded); never commit them; Task 5 removes the folder.

## File Structure

| File | Responsibility |
|---|---|
| `lib/psn-game.js` (new) | Search index → concept; parse store page; `fetchGameInfo` |
| `lib/game-psn-view.js` (new) | Resolve owner vs PlayStation values into `psnView` |
| `lib/psplus-title-search.js` | Export the Algolia constants |
| `views/partials/game-psn-media.ejs`, `-headline.ejs`, `-about.ejs` (new) | Trailer/screenshot block; tagline + rating; About + Game info |
| `public/css/game-psn.css`, `public/js/game-media.js` (new) | Styles; thumbnail/swipe switching and "Read more" |
| `views/game-detail.ejs`, `server.js` | Wire the view into the game page |
| `server.js`, `views/admin.ejs`, `views/edit.ejs`, `views/partials/admin/games/all-games.ejs`, `public/css/style.css` | Admin routes, buttons, toasts, edit-page section |

---

### Task 1: Read a game's details from PlayStation (library)

**Files:**
- Create: `lib/psn-game.js`, `scripts/fixtures/psn-concept.html`, `scripts/test-psn-game.js`
- Modify: `lib/psplus-title-search.js` (export four constants)

**Interfaces:**
- Produces: `cleanLink(s) → string` (a `store.playstation.com/<locale>/concept|product/<id>` link or `''`), `titleCandidates(title) → string[]`, `cleanDescription(raw) → string`, `parseConceptPage(html) → record|null`, `searchConcept(title, opts) → {ok, concept_id}|{ok:false, reason}`, `fetchGameInfo(game, { fetchImpl, timeoutMs, now }) → { ok: true, psn }|{ ok: false, reason }` where `psn = { concept_id, matched_title, description, tagline, genres[], release_date, publisher, voices[], age_rating, rating:{avg,count}|null, screenshots[], videos[], source:'auto'|'manual', store_url, fetched_at }`. `fetchGameInfo` reads `game.title` and `game.psn_link`. Tasks 3 and 4 consume these.

- [ ] **Step 1: Write the fixture and the test**

Create `scripts/fixtures/psn-concept.html`:

````html
<!-- Trimmed shape of a real store.playstation.com concept page: only the parts lib/psn-game.js reads. Invented game. -->
<html><body>
<h1 class="psw-m-b-5 psw-t-title-l" data-qa="mfe-game-title#name">Zzyzx Quest</h1>
<script id="__NEXT_DATA__" type="application/json">{"props":{"apolloState":{"Concept:900001":{"__typename":"Concept","id":"900001","conceptId":"900001","name":"Zzyzx Quest","descriptions":[{"__typename":"Description","type":"SHORT","value":"Dig deep. Dig far."},{"__typename":"Description","type":"LONG","value":"A new era of digging begins.<br/><br/>Explore <b>every</b> cave &amp; tunnel.<br/>Fight &quot;the Deep&quot;.<br/><br/> *There are other bundles that include this product. Please be careful of duplicate purchases.<br/>"}],"media":[{"__typename":"Media","role":"MASTER","type":"IMAGE","url":"https://image.api.playstation.com/vulcan/ap/rnd/1/master.png"},{"__typename":"Media","role":"SCREENSHOT","type":"IMAGE","url":"https://image.api.playstation.com/vulcan/ap/rnd/1/shot1.jpg"},{"__typename":"Media","role":"SCREENSHOT","type":"IMAGE","url":"https://image.api.playstation.com/vulcan/ap/rnd/1/shot2.jpg"},{"__typename":"Media","role":"SCREENSHOT","type":"IMAGE","url":"https://image.api.playstation.com/vulcan/ap/rnd/1/shot1.jpg"},{"__typename":"Media","role":"SCREENSHOT","type":"IMAGE","url":"https://evil.example/shot3.jpg"},{"__typename":"Media","role":"PREVIEW","type":"VIDEO","url":"https://vulcan.dl.playstation.net/img/rnd/1/trailer1.mp4"},{"__typename":"Media","role":"PREVIEW","type":"VIDEO","url":"https://evil.example/trailer.mp4"},{"__typename":"Media","role":"PREVIEW","type":"VIDEO","url":"https://vulcan.dl.playstation.net/img/rnd/1/trailer2.mp4"}]},"Product:UP1-PPSA1_00-ZZYZX":{"__typename":"Product","platforms":["PS5"],"publisherName":"Zzyzx Games, Inc.","releaseDate":"2026-02-27T05:00:00Z","starRating":{"__typename":"StarRating","averageRating":4.88,"totalRatingsCount":103548},"contentRating":{"__typename":"ProductContentRating","authority":"ESRB","description":"ESRB Mature","name":"ESRB_MATURE","url":"https://image.api.playstation.com/grc/m.png"},"spokenLanguages":["en","ja","es_MX","xx","en"],"spokenLanguagesByPlatform":[{"__typename":"X","platform":"PS4","spokenLanguages":[]}],"localizedGenres":[{"__typename":"LocalizedGenre","value":"Action"},{"__typename":"LocalizedGenre","value":"Adventure"}],"invariantName":"Zzyzx Quest","name":"Zzyzx Quest"}},"conceptId":"900001"}}</script>
</body></html>
````

Create `scripts/test-psn-game.js`:

````js
// Run: node scripts/test-psn-game.js
//
// lib/psn-game.js: parsing a store page (against scripts/fixtures/psn-concept.html,
// a trimmed invented copy of the real page shape) and fetching with a stubbed
// fetch. Nothing here reaches PlayStation.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const psn = require('../lib/psn-game');

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const PAGE = fs.readFileSync(path.join(__dirname, 'fixtures', 'psn-concept.html'), 'utf8');

// A fetch stub: the search index answers with `hits`, store pages with `page`.
function stubFetch({ hits = [], page = PAGE, searchStatus = 200, pageStatus = 200, throwOn = null } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (throwOn && url.includes(throwOn)) { const e = new Error('boom'); e.name = 'TypeError'; throw e; }
    if (url.includes('algolia')) {
      return { ok: searchStatus === 200, status: searchStatus, json: async () => ({ results: [{ hits }] }) };
    }
    return { ok: pageStatus === 200, status: pageStatus, text: async () => page };
  };
  impl.calls = calls;
  return impl;
}

async function main() {
  console.log('\ncleanLink / titleCandidates / cleanDescription');
  await ok('only PlayStation Store concept / product links are accepted', async () => {
    assert.strictEqual(psn.cleanLink(' https://store.playstation.com/en-ph/concept/10015533 '), 'https://store.playstation.com/en-ph/concept/10015533');
    assert.strictEqual(psn.cleanLink('https://store.playstation.com/en-us/product/UP0102-PPSA30803_00-REREQUIEM0000000'), 'https://store.playstation.com/en-us/product/UP0102-PPSA30803_00-REREQUIEM0000000');
    assert.strictEqual(psn.cleanLink('https://evil.example/en-us/concept/1'), '');
    assert.strictEqual(psn.cleanLink('http://store.playstation.com/en-us/concept/1'), '');
    assert.strictEqual(psn.cleanLink('https://store.playstation.com/en-us/concept/1?x=1'), '');
    assert.strictEqual(psn.cleanLink(undefined), '');
  });
  await ok('an edition suffix adds a base-name candidate', async () => {
    assert.deepStrictEqual(psn.titleCandidates('Control Resonant Deluxe Edition'), ['Control Resonant Deluxe Edition', 'Control Resonant']);
    assert.deepStrictEqual(psn.titleCandidates('Hades II'), ['Hades II']);
    assert.deepStrictEqual(psn.titleCandidates('Game: Ultimate Edition'), ['Game: Ultimate Edition', 'Game']);
  });
  await ok('descriptions become clean paragraphs without store fine print', async () => {
    const t = psn.cleanDescription('Line one.<br/><br/>Two &amp; <b>three</b>.<br/>&quot;Four&quot;<br/><br/> *There are other bundles. Be careful.<br/>');
    assert.strictEqual(t, 'Line one.\n\nTwo & three.\n"Four"');
    assert.strictEqual(psn.cleanDescription(''), '');
    assert.strictEqual(psn.cleanDescription('There are other bundles that include this product.'), '');
  });

  console.log('\nparseConceptPage');
  const p = psn.parseConceptPage(PAGE);
  await ok('reads the overview, tagline and details', async () => {
    assert.strictEqual(p.concept_id, '900001');
    assert.strictEqual(p.matched_title, 'Zzyzx Quest');
    assert.strictEqual(p.tagline, 'Dig deep. Dig far.');
    assert.strictEqual(p.description, 'A new era of digging begins.\n\nExplore every cave & tunnel.\nFight "the Deep".');
    assert.deepStrictEqual(p.genres, ['Action', 'Adventure']);
    assert.strictEqual(p.release_date, '2026-02-27');
    assert.strictEqual(p.publisher, 'Zzyzx Games, Inc.');
    assert.strictEqual(p.age_rating, 'ESRB Mature');
    assert.deepStrictEqual(p.rating, { avg: 4.9, count: 103548 });
  });
  await ok('voices are language names, unknown codes and repeats dropped', async () => {
    assert.deepStrictEqual(p.voices, ['English', 'Japanese', 'Latin American Spanish']);
  });
  await ok('media keeps only PlayStation hosts, without repeats, in page order', async () => {
    assert.deepStrictEqual(p.screenshots, [
      'https://image.api.playstation.com/vulcan/ap/rnd/1/shot1.jpg',
      'https://image.api.playstation.com/vulcan/ap/rnd/1/shot2.jpg'
    ]);
    assert.deepStrictEqual(p.videos, [
      'https://vulcan.dl.playstation.net/img/rnd/1/trailer1.mp4',
      'https://vulcan.dl.playstation.net/img/rnd/1/trailer2.mp4'
    ]);
  });
  await ok('media is capped at 12 screenshots and 3 videos', async () => {
    let many = '';
    for (let i = 0; i < 20; i++) many += '{"__typename":"Media","role":"SCREENSHOT","type":"IMAGE","url":"https://image.api.playstation.com/s' + i + '.jpg"},';
    for (let i = 0; i < 6; i++) many += '{"__typename":"Media","role":"PREVIEW","type":"VIDEO","url":"https://vulcan.dl.playstation.net/v' + i + '.mp4"},';
    const r = psn.parseConceptPage(many);
    assert.strictEqual(r.screenshots.length, 12);
    assert.strictEqual(r.videos.length, 3);
  });
  await ok('a page with nothing usable is null, not an empty record', async () => {
    assert.strictEqual(psn.parseConceptPage('<html>Just a moment...</html>'), null);
    assert.strictEqual(psn.parseConceptPage(''), null);
    assert.strictEqual(psn.parseConceptPage(undefined), null);
  });

  console.log('\nfetchGameInfo');
  const HIT = { productName: 'Zzyzx Quest', conceptId: '900001' };
  const NOW = () => new Date('2026-10-02T10:00:00.000Z');
  await ok('title search then page fetch gives a full record', async () => {
    const f = stubFetch({ hits: [HIT] });
    const r = await psn.fetchGameInfo({ title: 'Zzyzx Quest' }, { fetchImpl: f, now: NOW });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.psn.source, 'auto');
    assert.strictEqual(r.psn.store_url, 'https://store.playstation.com/en-us/concept/900001');
    assert.strictEqual(r.psn.fetched_at, '2026-10-02T10:00:00.000Z');
    assert.strictEqual(r.psn.description.startsWith('A new era'), true);
    assert.strictEqual(f.calls[1].url, 'https://store.playstation.com/en-us/concept/900001');
    assert.ok(/Mozilla/.test(f.calls[1].init.headers['User-Agent']));
  });
  await ok('a pasted store link wins over the search and is marked manual', async () => {
    const f = stubFetch({ hits: [] });
    const r = await psn.fetchGameInfo({ title: 'Anything', psn_link: 'https://store.playstation.com/en-ph/concept/900001' }, { fetchImpl: f, now: NOW });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.psn.source, 'manual');
    assert.strictEqual(f.calls.length, 1, 'no search call');
    assert.strictEqual(f.calls[0].url, 'https://store.playstation.com/en-ph/concept/900001');
  });
  await ok('a hit for a different game is not a match', async () => {
    const f = stubFetch({ hits: [{ productName: 'College Football 26', conceptId: '5' }] });
    assert.deepStrictEqual(await psn.fetchGameInfo({ title: 'Madden NFL 26' }, { fetchImpl: f }), { ok: false, reason: 'no_match' });
  });
  await ok('an edition title falls back to the base name', async () => {
    let n = 0;
    const f = async (url, init) => {
      if (url.includes('algolia')) {
        n++;
        const q = decodeURIComponent(JSON.parse(init.body).requests[0].params);
        return { ok: true, status: 200, json: async () => ({ results: [{ hits: /Deluxe/.test(q) ? [] : [HIT] }] }) };
      }
      return { ok: true, status: 200, text: async () => PAGE };
    };
    const r = await psn.fetchGameInfo({ title: 'Zzyzx Quest Deluxe Edition' }, { fetchImpl: f });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(n, 2);
  });
  await ok('failures come back as reasons and never throw', async () => {
    assert.deepStrictEqual(await psn.fetchGameInfo({ title: 'X' }, { fetchImpl: stubFetch({ searchStatus: 500 }) }), { ok: false, reason: 'http_500' });
    assert.deepStrictEqual(await psn.fetchGameInfo({ title: 'Zzyzx Quest' }, { fetchImpl: stubFetch({ hits: [HIT], pageStatus: 403 }) }), { ok: false, reason: 'http_403' });
    assert.deepStrictEqual(await psn.fetchGameInfo({ title: 'Zzyzx Quest' }, { fetchImpl: stubFetch({ hits: [HIT], page: '<html>Just a moment...</html>' }) }), { ok: false, reason: 'empty_page' });
    assert.deepStrictEqual(await psn.fetchGameInfo({ title: 'Zzyzx Quest' }, { fetchImpl: stubFetch({ hits: [HIT], throwOn: 'store.playstation' }) }), { ok: false, reason: 'network' });
    assert.deepStrictEqual(await psn.fetchGameInfo({ title: '' }, { fetchImpl: stubFetch() }), { ok: false, reason: 'empty_title' });
  });

  console.log('\n' + passed + ' assertions passed\n');
}
main().catch(e => { console.error(e); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-psn-game.js` → FAIL `Cannot find module '../lib/psn-game'`.

- [ ] **Step 3: Export the Algolia constants**

In `lib/psplus-title-search.js`, replace the last line

```js
module.exports = { searchCover, pickHit };
```

with

```js
module.exports = { searchCover, pickHit, ALGOLIA_URL, ALGOLIA_APP, ALGOLIA_KEY, ALGOLIA_INDEX };
```

- [ ] **Step 4: Create the module**

Create `lib/psn-game.js`:

````js
// Reads a game's public details from PlayStation Store: overview, rating,
// genres, release date, publisher, voice languages, age rating, screenshots and
// trailers. Used by the admin "Update from PlayStation" buttons; the public
// site never calls this — it only reads what was stored on the game.
//
// Two public sources, no PlayStation account or session involved:
//   1. PlayStation's site-search index (Algolia, same key as
//      lib/psplus-title-search.js) turns a title into a concept id.
//   2. The store page https://store.playstation.com/en-us/concept/<id> embeds the
//      rest as JSON inside its HTML.
// Nothing here throws: every failure comes back as { ok: false, reason }.
const { ALGOLIA_URL, ALGOLIA_APP, ALGOLIA_KEY, ALGOLIA_INDEX } = require('./psplus-title-search');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const IMG_HOST = /^https:\/\/image\.api\.playstation\.com\//;
const VIDEO_HOST = /^https:\/\/vulcan\.dl\.playstation\.net\//;
// A concept or product page on the store, any locale.
const STORE_LINK = /^https:\/\/store\.playstation\.com\/[a-z]{2}-[a-z]{2}\/(concept|product)\/[A-Za-z0-9_.-]+\/?$/;

const LANGS = {
  ar: 'Arabic', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek', en: 'English', es: 'Spanish',
  es_MX: 'Latin American Spanish', fi: 'Finnish', fr: 'French', fr_CA: 'Canadian French', hu: 'Hungarian',
  id: 'Indonesian', it: 'Italian', ja: 'Japanese', ko: 'Korean', nl: 'Dutch', no: 'Norwegian', pl: 'Polish',
  pt: 'Portuguese', pt_BR: 'Brazilian Portuguese', ro: 'Romanian', ru: 'Russian', sv: 'Swedish', th: 'Thai',
  tr: 'Turkish', uk: 'Ukrainian', vi: 'Vietnamese', zh: 'Chinese', zh_Hans: 'Chinese (Simplified)',
  zh_Hant: 'Chinese (Traditional)'
};

const MAX_SCREENSHOTS = 12;
const MAX_VIDEOS = 3;

// The owner's pasted store link, or '' when it is not a PlayStation Store page.
function cleanLink(s) {
  const t = String(s == null ? '' : s).trim();
  return STORE_LINK.test(t) ? t : '';
}

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// "Game: Deluxe Edition" → "Game" — a second search tries the base name.
function titleCandidates(title) {
  const t = String(title || '').trim();
  const base = t.replace(/\s*[-–:]?\s*(deluxe|standard|ultimate|digital|gold|complete|premium|definitive|special)\s+edition\s*$/i, '').trim();
  return base && base !== t ? [t, base] : [t];
}

// ── Parsing ────────────────────────────────────────────────────────────────
const JSON_STR = '((?:[^"\\\\]|\\\\.)*)';

function unjson(s) {
  try { return JSON.parse('"' + s + '"'); } catch (e) { return s; }
}

function first(html, re) {
  const m = re.exec(html);
  return m ? unjson(m[1]) : '';
}

function all(html, re) {
  const out = [];
  let m;
  const g = new RegExp(re.source, 'g');
  while ((m = g.exec(html))) out.push(unjson(m[1]));
  return out;
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

// Store descriptions are small HTML (<br/>, <b>, <li>). Returns plain text
// paragraphs separated by a blank line, without the store's fine print
// ("*There are other bundles that include this product…").
function cleanDescription(raw) {
  const text = String(raw || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, m => ENT[m]);
  const lines = text.split('\n').map(l => l.trim());
  const kept = lines.filter(l => !/^\*/.test(l) && !/^there are other bundles/i.test(l));
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function uniqueHosted(urls, hostRe, max) {
  const seen = new Set();
  const out = [];
  urls.forEach(u => {
    if (hostRe.test(u) && !seen.has(u)) { seen.add(u); out.push(u); }
  });
  return out.slice(0, max);
}

// Pure. Returns the details found in a store page, or null when the page holds
// nothing usable (a block page, a 404 shell, a changed layout).
function parseConceptPage(html) {
  const h = String(html || '');
  const description = cleanDescription(first(h, new RegExp('"type":"LONG","value":"' + JSON_STR + '"')));
  const tagline = cleanDescription(first(h, new RegExp('"type":"SHORT","value":"' + JSON_STR + '"')));
  const screenshots = uniqueHosted(all(h, new RegExp('"role":"SCREENSHOT","type":"IMAGE","url":"' + JSON_STR + '"')), IMG_HOST, MAX_SCREENSHOTS);
  const videos = uniqueHosted(all(h, new RegExp('"role":"PREVIEW","type":"VIDEO","url":"' + JSON_STR + '"')), VIDEO_HOST, MAX_VIDEOS);

  const genresBlock = /"localizedGenres":\[(.*?)\]/.exec(h);
  const genres = genresBlock ? all(genresBlock[1], new RegExp('"value":"' + JSON_STR + '"')) : [];
  const langBlock = /"spokenLanguages":\[([^\]]*)\]/.exec(h);
  const voices = [];
  (langBlock ? all(langBlock[1], new RegExp('"' + JSON_STR + '"')) : []).forEach(code => {
    const name = LANGS[code] || LANGS[code.split('_')[0]];
    if (name && !voices.includes(name)) voices.push(name);
  });
  const rate = /"averageRating":([0-9.]+),"totalRatingsCount":(\d+)/.exec(h);
  const rel = /"releaseDate":"(\d{4}-\d{2}-\d{2})/.exec(h);

  if (!description && !screenshots.length && !videos.length && !genres.length) return null;
  return {
    concept_id: first(h, /"conceptId":"(\d+)"/),
    matched_title: first(h, /data-qa="mfe-game-title#name">([^<]+)</) || first(h, new RegExp('"invariantName":"' + JSON_STR + '"')),
    description,
    tagline,
    genres,
    release_date: rel ? rel[1] : '',
    publisher: first(h, new RegExp('"publisherName":"' + JSON_STR + '"')),
    voices,
    age_rating: first(h, new RegExp('"contentRating":\\{"__typename":"ProductContentRating","authority":"[^"]*","description":"' + JSON_STR + '"')),
    rating: rate ? { avg: Math.round(parseFloat(rate[1]) * 10) / 10, count: parseInt(rate[2], 10) } : null,
    screenshots,
    videos
  };
}

// ── Network ────────────────────────────────────────────────────────────────
async function withTimeout(fetchImpl, url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, Object.assign({ signal: ctrl.signal }, init));
  } finally {
    clearTimeout(timer);
  }
}

function failure(e) {
  return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' };
}

// Search by title; a hit counts only if its title contains ours or ours
// contains it — "Madden NFL 26" must not quietly attach "College Football 26".
async function searchConcept(title, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const q = String(title || '').trim();
  if (!q) return { ok: false, reason: 'empty_title' };
  try {
    const res = await withTimeout(fetchImpl, ALGOLIA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Algolia-API-Key': ALGOLIA_KEY, 'X-Algolia-Application-Id': ALGOLIA_APP },
      body: JSON.stringify({ requests: [{ indexName: ALGOLIA_INDEX, params: 'query=' + encodeURIComponent(q) + '&hitsPerPage=5&filters=' + encodeURIComponent('pageType:game') }] })
    }, timeoutMs);
    if (!res || !res.ok) return { ok: false, reason: 'http_' + (res ? res.status : 0) };
    let json;
    try { json = await res.json(); } catch (e) { return { ok: false, reason: 'bad_json' }; }
    const hits = (json && json.results && json.results[0] && json.results[0].hits) || [];
    const nq = norm(q);
    const hit = hits.find(x => {
      const nt = norm(x && x.productName);
      return nt && (nt.includes(nq) || nq.includes(nt)) && x.conceptId;
    });
    return hit ? { ok: true, concept_id: String(hit.conceptId) } : { ok: false, reason: 'no_match' };
  } catch (e) {
    return failure(e);
  }
}

// Fetches and parses one game's store page. `game.psn_link` (a link the owner
// pasted) wins over the title search. Returns { ok: true, psn } or
// { ok: false, reason } — reasons: no_match, empty_title, empty_page, timeout,
// network, http_<status>, bad_json.
async function fetchGameInfo(game, { fetchImpl = globalThis.fetch, timeoutMs = 8000, now = () => new Date() } = {}) {
  let url = cleanLink(game && game.psn_link);
  const source = url ? 'manual' : 'auto';
  if (!url) {
    const candidates = titleCandidates(game && game.title);
    for (const t of candidates) {
      const r = await searchConcept(t, { fetchImpl, timeoutMs });
      if (r.ok) { url = 'https://store.playstation.com/en-us/concept/' + r.concept_id; break; }
      if (r.reason !== 'no_match') return r;
    }
    if (!url) return { ok: false, reason: 'no_match' };
  }
  let html;
  try {
    const res = await withTimeout(fetchImpl, url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } }, timeoutMs);
    if (!res || !res.ok) return { ok: false, reason: 'http_' + (res ? res.status : 0) };
    html = await res.text();
  } catch (e) {
    return failure(e);
  }
  const parsed = parseConceptPage(html);
  if (!parsed) return { ok: false, reason: 'empty_page' };
  const concept = parsed.concept_id;
  return {
    ok: true,
    psn: Object.assign(parsed, {
      source,
      store_url: concept ? 'https://store.playstation.com/en-us/concept/' + concept : url,
      fetched_at: now().toISOString()
    })
  };
}

module.exports = { cleanLink, titleCandidates, cleanDescription, parseConceptPage, searchConcept, fetchGameInfo };
````

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node scripts/test-psn-game.js` → `13 assertions passed`.
Run: `node scripts/test-psplus-title-search.js` → still passes.

- [ ] **Step 6: Commit**

```bash
git add lib/psn-game.js lib/psplus-title-search.js scripts/fixtures/psn-concept.html scripts/test-psn-game.js
git commit -m "Read a game's details from PlayStation Store

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Resolve owner vs PlayStation values (view model)

**Files:**
- Create: `lib/game-psn-view.js`, `scripts/test-game-psn-view.js`

**Interfaces:**
- Consumes: the `game.psn` shape from Task 1, plus owner fields `description`, `genre`, `release_date`, `gallery[]`, `cover_image`, `size_gb`, `platform`.
- Produces: `buildGamePsnView(game) → { hasPsn, media[{type:'video'|'image', src, poster?}], hideGallery, tagline, rating:{text,count}|null, about, aboutParas[], readMore, info[{label,value}], genre }`; also `fmtDate`, `fmtVoices`, `fmtSize`, `READ_MORE_CHARS`. A game with no `psn` object gives `hasPsn:false`, empty media/info and `genre: game.genre || ''`.

- [ ] **Step 1: Write the test**

Create `scripts/test-game-psn-view.js`:

````js
// Run: node scripts/test-game-psn-view.js
const assert = require('assert');
const v = require('../lib/game-psn-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const PSN = {
  description: 'First paragraph.\n\nSecond paragraph.', tagline: 'Dig deep.', genres: ['Action', 'Adventure'],
  release_date: '2026-02-27', publisher: 'Zzyzx Games', voices: ['English', 'Japanese', 'German', 'French', 'Italian'],
  age_rating: 'ESRB Mature', rating: { avg: 4.88, count: 103548 },
  screenshots: ['https://image.api.playstation.com/s1.jpg', 'https://image.api.playstation.com/s2.jpg'],
  videos: ['https://vulcan.dl.playstation.net/t1.mp4']
};

console.log('\nno PlayStation data');
ok('a game without psn renders as before', () => {
  assert.deepStrictEqual(v.buildGamePsnView({ title: 'X', description: 'Mine', gallery: ['/a.png'] }),
    { hasPsn: false, media: [], hideGallery: false, tagline: '', rating: null, about: '', aboutParas: [], readMore: false, info: [], genre: '' });
  assert.strictEqual(v.buildGamePsnView(null).hasPsn, false);
  assert.strictEqual(v.buildGamePsnView({ psn: 'junk' }).hasPsn, false);
});

console.log('\nmedia');
ok('videos come first, then PlayStation screenshots; videos use the first screenshot as poster', () => {
  const r = v.buildGamePsnView({ platform: 'PS5', psn: PSN });
  assert.deepStrictEqual(r.media, [
    { type: 'video', src: 'https://vulcan.dl.playstation.net/t1.mp4', poster: 'https://image.api.playstation.com/s1.jpg' },
    { type: 'image', src: 'https://image.api.playstation.com/s1.jpg' },
    { type: 'image', src: 'https://image.api.playstation.com/s2.jpg' }
  ]);
  assert.strictEqual(r.hideGallery, true);
});
ok("the owner's own gallery replaces PlayStation's screenshots", () => {
  const r = v.buildGamePsnView({ gallery: ['/uploads/a.png', '', '/uploads/b.png'], psn: PSN });
  assert.deepStrictEqual(r.media.map(m => m.src), ['https://vulcan.dl.playstation.net/t1.mp4', '/uploads/a.png', '/uploads/b.png']);
  assert.strictEqual(r.media[0].poster, '/uploads/a.png');
});
ok('with no screenshots the poster falls back to the cover; with no media nothing is hidden', () => {
  const r = v.buildGamePsnView({ cover_image: '/c.png', psn: Object.assign({}, PSN, { screenshots: [] }) });
  assert.strictEqual(r.media[0].poster, '/c.png');
  const none = v.buildGamePsnView({ psn: Object.assign({}, PSN, { screenshots: [], videos: [] }) });
  assert.deepStrictEqual(none.media, []);
  assert.strictEqual(none.hideGallery, false);
});

console.log('\nowner wins');
ok("the owner's description, genre and release date beat PlayStation's", () => {
  const r = v.buildGamePsnView({ platform: 'PS5', description: 'Mine only.', genre: 'RPG / Co-op', release_date: '2025-12-01', psn: PSN });
  assert.strictEqual(r.about, 'Mine only.');
  const byLabel = Object.fromEntries(r.info.map(x => [x.label, x.value]));
  assert.strictEqual(byLabel['Genre'], 'RPG / Co-op');
  assert.strictEqual(byLabel['Release date'], 'Dec 1, 2025');
});
ok('empty owner fields fall back to PlayStation', () => {
  const r = v.buildGamePsnView({ platform: 'PS5', description: '', genre: '', release_date: '', psn: PSN });
  assert.strictEqual(r.about, 'First paragraph.\n\nSecond paragraph.');
  assert.deepStrictEqual(r.aboutParas, ['First paragraph.', 'Second paragraph.']);
  const byLabel = Object.fromEntries(r.info.map(x => [x.label, x.value]));
  assert.strictEqual(byLabel['Genre'], 'Action / Adventure');
  assert.strictEqual(r.genre, 'Action / Adventure');
  assert.strictEqual(byLabel['Release date'], 'Feb 27, 2026');
});

console.log('\ninfo, rating, read more');
ok('rows appear in order, only when known; voices are shortened; size only when typed', () => {
  const r = v.buildGamePsnView({ platform: 'PS5', size_gb: 54.3, psn: PSN });
  assert.deepStrictEqual(r.info.map(x => x.label), ['Release date', 'Genre', 'Publisher', 'Size', 'Platform', 'Voice', 'Age rating']);
  const by = Object.fromEntries(r.info.map(x => [x.label, x.value]));
  assert.strictEqual(by['Size'], '54.3 GB');
  assert.strictEqual(by['Voice'], 'English, Japanese, German +2');
  const bare = v.buildGamePsnView({ platform: 'PS4', psn: { description: 'x' } });
  assert.deepStrictEqual(bare.info, [{ label: 'Platform', value: 'PS4' }]);
  assert.strictEqual(v.fmtSize(60), '60 GB');
  assert.strictEqual(v.fmtSize(0), '');
});
ok('rating text and count', () => {
  assert.deepStrictEqual(v.buildGamePsnView({ psn: PSN }).rating, { text: '★ 4.9', count: '103,548' });
  assert.strictEqual(v.buildGamePsnView({ psn: Object.assign({}, PSN, { rating: null }) }).rating, null);
});
ok('read more only for long overviews', () => {
  assert.strictEqual(v.buildGamePsnView({ psn: PSN }).readMore, false);
  assert.strictEqual(v.buildGamePsnView({ psn: Object.assign({}, PSN, { description: 'x'.repeat(v.READ_MORE_CHARS + 1) }) }).readMore, true);
});
ok('dates format and reject junk', () => {
  assert.strictEqual(v.fmtDate('2026-02-27'), 'Feb 27, 2026');
  assert.strictEqual(v.fmtDate('2026-02-27T05:00:00Z'), 'Feb 27, 2026');
  assert.strictEqual(v.fmtDate('TBA'), '');
  assert.strictEqual(v.fmtDate('2026-13-01'), '');
});

console.log('\n' + passed + ' assertions passed\n');
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-game-psn-view.js` → FAIL `Cannot find module '../lib/game-psn-view'`.

- [ ] **Step 3: Create the module**

Create `lib/game-psn-view.js`:

````js
// What a game page shows from PlayStation's data, resolved against the owner's
// own entries. Pure: views/game-detail.ejs gets the result as `psnView`.
//
// Rule: the owner's value wins; PlayStation only fills what the owner left
// empty. A game with no stored `psn` (or one PlayStation did not know) gets
// hasPsn:false and the page renders exactly as it did before this feature.
const READ_MORE_CHARS = 260;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const month = MONTHS[parseInt(m[2], 10) - 1];
  return month ? month + ' ' + parseInt(m[3], 10) + ', ' + m[1] : '';
}

function fmtVoices(list) {
  const v = (list || []).filter(Boolean);
  if (!v.length) return '';
  return v.length <= 3 ? v.join(', ') : v.slice(0, 3).join(', ') + ' +' + (v.length - 3);
}

function fmtSize(gb) {
  const n = Number(gb);
  return n > 0 ? (Number.isInteger(n) ? n : n.toFixed(1)) + ' GB' : '';
}

function buildGamePsnView(game) {
  const g = game || {};
  const psn = g.psn && typeof g.psn === 'object' ? g.psn : null;
  if (!psn) {
    return { hasPsn: false, media: [], hideGallery: false, tagline: '', rating: null, about: '', aboutParas: [], readMore: false, info: [], genre: g.genre || '' };
  }

  const ownerGallery = (g.gallery || []).filter(Boolean);
  const images = ownerGallery.length ? ownerGallery : (psn.screenshots || []);
  const poster = images[0] || g.cover_image || '';
  const media = (psn.videos || []).map(src => ({ type: 'video', src, poster }))
    .concat(images.map(src => ({ type: 'image', src })));

  const about = String(g.description || psn.description || '').trim();
  const genre = g.genre || (psn.genres || []).join(' / ');
  const release = fmtDate(g.release_date || psn.release_date);
  const rows = [
    ['Release date', release],
    ['Genre', genre],
    ['Publisher', psn.publisher || ''],
    ['Size', fmtSize(g.size_gb)],
    ['Platform', g.platform || ''],
    ['Voice', fmtVoices(psn.voices)],
    ['Age rating', psn.age_rating || '']
  ].filter(r => r[1]).map(r => ({ label: r[0], value: r[1] }));

  const rating = psn.rating && psn.rating.avg > 0
    ? { text: '★ ' + Number(psn.rating.avg).toFixed(1), count: Number(psn.rating.count || 0).toLocaleString('en-US') }
    : null;

  return {
    hasPsn: true,
    media,
    // The owner's Gameplay gallery is folded into the media block, so the
    // separate gallery section below the page would only repeat it.
    hideGallery: media.length > 0,
    tagline: psn.tagline || '',
    rating,
    about,
    aboutParas: about ? about.split(/\n{2,}/).map(p => p.trim()).filter(Boolean) : [],
    readMore: about.length > READ_MORE_CHARS,
    info: rows,
    genre
  };
}

module.exports = { buildGamePsnView, fmtDate, fmtVoices, fmtSize, READ_MORE_CHARS };
````

- [ ] **Step 4: Run it and watch it pass**

Run: `node scripts/test-game-psn-view.js` → `10 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/game-psn-view.js scripts/test-game-psn-view.js
git commit -m "Resolve a game's owner-typed values against PlayStation's

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Public game page — trailer on top, About and Game info

**Files:**
- Create: `views/partials/game-psn-media.ejs`, `views/partials/game-psn-headline.ejs`, `views/partials/game-psn-about.ejs`, `public/css/game-psn.css`, `public/js/game-media.js`, `scripts/test-game-psn-page.js`
- Modify: `views/game-detail.ejs` (LF), `server.js` (CRLF + BOM) — via the edit script

**Interfaces:**
- Consumes: Task 2's `buildGamePsnView`; Task 1's `psn-game` (only required by `server.js` here so Task 4 can call it).
- Produces: `GET /game/:slug` renders with `psnView`; element ids `gpMedia`, `gpmStage`, `gpmCount`, `gpAbout`, `gpaText`, `gpaMore`; `server.js` gains `const gamePsnView = require('./lib/game-psn-view'); const psnGame = require('./lib/psn-game');`.

- [ ] **Step 1: Write the test**

Create `scripts/test-game-psn-page.js`:

````js
// Run: node scripts/test-game-psn-page.js
//
// Boots the real server against a throwaway DATA_DIR (blank MONGODB_URI) and
// checks the public game page: with stored PlayStation data it shows the
// trailer / screenshots block, rating, About and Game info; the owner's own
// entries win; a game with no PlayStation data renders as before.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4596;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'game-psn-page-'));
const base = { platform: 'PS5', nt_price_7d: 399, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 799, non_trophy_slots: 2, trophy_slots: 1, cover_image: '/uploads/cover.png' };
const PSN = {
  concept_id: '900001', source: 'auto', fetched_at: '2026-10-02T10:00:00.000Z', store_url: 'https://store.playstation.com/en-us/concept/900001',
  description: 'A new era of digging begins.\n\nExplore every cave & tunnel.', tagline: 'Dig deep. Dig far.', genres: ['Action', 'Adventure'],
  release_date: '2026-02-27', publisher: 'Zzyzx Games', voices: ['English', 'Japanese'], age_rating: 'ESRB Mature', rating: { avg: 4.88, count: 103548 },
  screenshots: ['https://image.api.playstation.com/s1.jpg', 'https://image.api.playstation.com/s2.jpg'], videos: ['https://vulcan.dl.playstation.net/t1.mp4']
};
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  games: [
    Object.assign({ id: 1, title: 'Zzyzx Known', size_gb: 54.3, psn: PSN }, base),
    Object.assign({ id: 2, title: 'Zzyzx Owner Wins', description: 'My own words.', genre: 'RPG', gallery: ['/uploads/g1.png', '/uploads/g2.png'], psn: PSN }, base),
    Object.assign({ id: 3, title: 'Zzyzx Plain', description: 'Plain description.', gallery: ['/uploads/p1.png'] }, base)
  ]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path: p, timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone) Safari' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
  });
}

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await get('/browse'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  console.log('\na game with PlayStation data');
  const known = await get('/game/zzyzx-known');
  await okAsync('the trailer block replaces the poster: trailer first, screenshots after, thumbnails', async () => {
    assert.strictEqual(known.status, 200);
    assert.ok(known.body.includes('id="gpMedia"') && known.body.includes('data-count="3"'));
    assert.ok(/<video controls playsinline preload="none" poster="https:\/\/image\.api\.playstation\.com\/s1\.jpg"><source src="https:\/\/vulcan\.dl\.playstation\.net\/t1\.mp4" type="video\/mp4">/.test(known.body));
    assert.ok(known.body.includes('▶ TRAILER') && known.body.includes('1 / 3'));
    assert.strictEqual((known.body.match(/class="gpm-thumb[ "]/g) || []).length, 3);
    assert.ok(!known.body.includes('gdh-poster'), 'the static poster is not drawn');
  });
  await okAsync('tagline, rating, About and Game info show; Size appears because the owner typed it', async () => {
    assert.ok(known.body.includes('Dig deep. Dig far.'));
    assert.ok(known.body.includes('★ 4.9') && known.body.includes('103,548 ratings'));
    assert.ok(known.body.includes('About this game') && known.body.includes('<p>A new era of digging begins.</p>') && known.body.includes('<p>Explore every cave &amp; tunnel.</p>'));
    assert.ok(/<tr><td>Release date<\/td><td>Feb 27, 2026<\/td><\/tr>/.test(known.body));
    assert.ok(/<tr><td>Size<\/td><td>54\.3 GB<\/td><\/tr>/.test(known.body));
    assert.ok(/<tr><td>Voice<\/td><td>English, Japanese<\/td><\/tr>/.test(known.body));
    assert.ok(/<tr><td>Age rating<\/td><td>ESRB Mature<\/td><\/tr>/.test(known.body));
    assert.ok(known.body.includes('>Action<') && known.body.includes('>Adventure<'), 'genre chips use PlayStation genres');
  });
  await okAsync('the rent box and the Messenger button are still there', async () => {
    assert.ok(known.body.includes('id="ctaMsgPrimary"') && known.body.includes('id="rentPanel"'));
    assert.ok(known.body.includes('/js/game-media.js?v=') && known.body.includes('/css/game-psn.css?v='));
  });

  console.log('\nthe owner wins');
  const own = await get('/game/zzyzx-owner-wins');
  await okAsync("the owner's description and genre show, PlayStation's overview does not", async () => {
    assert.ok(own.body.includes('<p>My own words.</p>'));
    assert.ok(!own.body.includes('A new era of digging begins.'));
    assert.ok(own.body.includes('>RPG<'));
    assert.ok(/<tr><td>Genre<\/td><td>RPG<\/td><\/tr>/.test(own.body));
  });
  await okAsync("the owner's gallery is used in the media block and the separate Gameplay section is skipped", async () => {
    assert.ok(own.body.includes('src="/uploads/g1.png"') && own.body.includes('src="/uploads/g2.png"'));
    assert.ok(!own.body.includes('class="rsv-gallery-section"'));
    assert.ok(!own.body.includes('https://image.api.playstation.com/s1.jpg"'), "PlayStation's screenshots are not mixed in");
  });

  console.log('\na game with no PlayStation data');
  const plain = await get('/game/zzyzx-plain');
  await okAsync('renders as before: poster, description under it, Gameplay gallery, no new blocks', async () => {
    assert.ok(plain.body.includes('gdh-poster') && plain.body.includes('Plain description.'));
    assert.ok(plain.body.includes('class="rsv-gallery-section"'));
    assert.ok(!plain.body.includes('id="gpMedia"') && !plain.body.includes('id="gpAbout"') && !plain.body.includes('gpa-headline'));
    assert.ok(!plain.body.includes('/js/game-media.js'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-game-psn-page.js` → FAIL (`id="gpMedia"` missing).

- [ ] **Step 3: Create the partials, stylesheet and script**

Create `views/partials/game-psn-media.ejs`:

````ejs
<%#
  Trailer + screenshots block that takes the place of the static poster on a game
  page (see lib/game-psn-view.js). The first item shows; thumbnails and swipe
  (public/js/game-media.js) switch. A trailer is a <video preload="none">, so no
  video bytes load until the visitor taps play.

  Locals: items [{ type: 'video'|'image', src, poster? }], title
%>
<div class="gpm" id="gpMedia" data-count="<%= items.length %>">
  <div class="gpm-stage" id="gpmStage">
    <% items.forEach((m, i) => { %>
    <div class="gpm-slide"<%= i === 0 ? '' : ' hidden' %>>
      <% if (m.type === 'video') { %>
      <video controls playsinline preload="none"<% if (m.poster) { %> poster="<%= m.poster %>"<% } %>><source src="<%= m.src %>" type="video/mp4"></video>
      <span class="gpm-badge">▶ TRAILER</span>
      <% } else { %>
      <img src="<%= m.src %>" alt="<%= title %> screenshot <%= i + 1 %>" decoding="async"<%= i === 0 ? '' : ' loading="lazy"' %>>
      <% } %>
    </div>
    <% }) %>
    <% if (items.length > 1) { %><span class="gpm-count" id="gpmCount">1 / <%= items.length %></span><% } %>
  </div>
  <% if (items.length > 1) { %>
  <div class="gpm-thumbs" id="gpmThumbs">
    <% items.forEach((m, i) => { %>
    <button type="button" class="gpm-thumb<%= i === 0 ? ' on' : '' %><%= m.type === 'video' ? ' gpm-thumb-v' : '' %>" aria-label="<%= m.type === 'video' ? 'Trailer' : 'Screenshot' %> <%= i + 1 %>">
      <% const th = m.type === 'video' ? m.poster : m.src; %>
      <% if (th) { %><img src="<%= th %>" alt="" loading="lazy" decoding="async"><% } %>
    </button>
    <% }) %>
  </div>
  <% } %>
</div>
````

Create `views/partials/game-psn-headline.ejs`:

````ejs
<%#
  Tagline and PlayStation Store rating under a game's title. Renders nothing
  when PlayStation gave neither. Locals: psnView (lib/game-psn-view.js)
%>
<% if (psnView.tagline || psnView.rating) { %>
<div class="gpa-headline">
  <% if (psnView.tagline) { %><div class="gpa-tagline"><%= psnView.tagline %></div><% } %>
  <% if (psnView.rating) { %><div class="gpa-rating"><b><%= psnView.rating.text %></b> on PlayStation Store<% if (psnView.rating.count !== '0') { %> · <%= psnView.rating.count %> ratings<% } %></div><% } %>
</div>
<% } %>
````

Create `views/partials/game-psn-about.ejs`:

````ejs
<%#
  "About this game" and "Game info" blocks, full width below the rent box
  (lib/game-psn-view.js). Renders nothing for a game with no PlayStation data.
  Locals: psnView
%>
<% if (psnView.hasPsn && (psnView.about || psnView.info.length)) { %>
<section class="gpa" id="gpAbout">
  <% if (psnView.about) { %>
  <h2 class="gpa-h">About this game</h2>
  <div class="gpa-text<%= psnView.readMore ? ' gpa-clamp' : '' %>" id="gpaText">
    <% psnView.aboutParas.forEach(p => { %><p><%= p %></p><% }) %>
  </div>
  <% if (psnView.readMore) { %><button type="button" class="gpa-more" id="gpaMore" aria-expanded="false">Read more</button><% } %>
  <% } %>
  <% if (psnView.info.length) { %>
  <h2 class="gpa-h">Game info</h2>
  <table class="gpa-info">
    <% psnView.info.forEach(r => { %><tr><td><%= r.label %></td><td><%= r.value %></td></tr><% }) %>
  </table>
  <% } %>
</section>
<% } %>
````

Create `public/js/game-media.js`:

````js
// Game page trailer / screenshot block (views/partials/game-psn-media.ejs) and
// the "Read more" toggle of the overview (game-psn-about.ejs).
(function () {
  var root = document.getElementById('gpMedia');
  if (root) {
    var slides = Array.prototype.slice.call(root.querySelectorAll('.gpm-slide'));
    var thumbs = Array.prototype.slice.call(root.querySelectorAll('.gpm-thumb'));
    var count = document.getElementById('gpmCount');
    var cur = 0;

    var show = function (i) {
      if (i < 0 || i >= slides.length) return;
      cur = i;
      slides.forEach(function (s, k) {
        s.hidden = k !== i;
        if (k !== i) {
          var v = s.querySelector('video');
          if (v && !v.paused) v.pause();
        }
      });
      thumbs.forEach(function (t, k) { t.classList.toggle('on', k === i); });
      if (count) count.textContent = (i + 1) + ' / ' + slides.length;
    };

    thumbs.forEach(function (t, k) { t.addEventListener('click', function () { show(k); }); });

    // Swipe on the picture (ignored while the video's own controls are used).
    var stage = document.getElementById('gpmStage');
    var x0 = null;
    stage.addEventListener('touchstart', function (e) { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (x0 === null || e.target.tagName === 'VIDEO') { x0 = null; return; }
      var dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 50) show(dx < 0 ? Math.min(cur + 1, slides.length - 1) : Math.max(cur - 1, 0));
    }, { passive: true });

    // A thumbnail whose picture fails to load is dropped; the rest still work.
    root.querySelectorAll('.gpm-thumb img').forEach(function (img) {
      img.addEventListener('error', function () { img.remove(); });
    });
  }

  var more = document.getElementById('gpaMore');
  var text = document.getElementById('gpaText');
  if (more && text) {
    more.addEventListener('click', function () {
      var open = text.classList.toggle('gpa-open');
      more.textContent = open ? 'Show less' : 'Read more';
      more.setAttribute('aria-expanded', String(open));
    });
  }
})();
````

Create `public/css/game-psn.css`:

````css
/* Game page: trailer + screenshots, tagline / rating, About and Game info.
   views/partials/game-psn-*.ejs */
.gpm { width: 100%; }
.gpm-stage { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 12px; overflow: hidden; }
.gpm-slide { position: absolute; inset: 0; }
.gpm-slide[hidden] { display: none; }
.gpm-slide video, .gpm-slide img { width: 100%; height: 100%; display: block; }
.gpm-slide video { object-fit: contain; background: #000; }
.gpm-slide img { object-fit: cover; }
.gpm-badge { position: absolute; left: 0.6rem; top: 0.6rem; padding: 0.15rem 0.5rem; border-radius: 6px; background: rgba(0, 0, 0, 0.7); color: #fff; font-size: 0.68rem; font-weight: 800; pointer-events: none; }
.gpm-count { position: absolute; right: 0.6rem; bottom: 0.6rem; padding: 0.15rem 0.5rem; border-radius: 6px; background: rgba(0, 0, 0, 0.7); color: #fff; font-size: 0.68rem; font-weight: 800; pointer-events: none; }
.gpm-thumbs { display: flex; gap: 0.4rem; margin-top: 0.5rem; overflow-x: auto; scrollbar-width: none; }
.gpm-thumb { position: relative; flex: none; width: 76px; aspect-ratio: 16 / 9; padding: 0; border: 2px solid transparent; border-radius: 6px; overflow: hidden; background: #1a1a1a; cursor: pointer; }
.gpm-thumb.on { border-color: #3b82f6; }
.gpm-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.gpm-thumb-v::after { content: '▶'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; color: #fff; background: rgba(0, 0, 0, 0.35); }

.gpa-headline { margin: 0.35rem 0 0; }
.gpa-tagline { font-size: 0.9rem; font-style: italic; color: #aaa; }
.gpa-rating { margin-top: 0.25rem; font-size: 0.8rem; color: #bbb; }
.gpa-rating b { color: #ffd700; }

.gpa { max-width: 1100px; margin: 1.5rem auto 0; padding: 0 1rem; }
.gpa-h { margin: 1.25rem 0 0.5rem; font-size: 0.78rem; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; color: #888; }
.gpa-h:first-child { margin-top: 0; }
.gpa-text p { margin: 0 0 0.7rem; font-size: 0.92rem; line-height: 1.6; color: #ccc; overflow-wrap: anywhere; }
.gpa-clamp:not(.gpa-open) { max-height: 7.5em; overflow: hidden; -webkit-mask-image: linear-gradient(#000 60%, transparent); mask-image: linear-gradient(#000 60%, transparent); }
.gpa-more { margin-top: 0.2rem; padding: 0; border: 0; background: none; color: #3b9be8; font-size: 0.85rem; font-weight: 700; cursor: pointer; }
.gpa-info { width: 100%; max-width: 560px; border-collapse: collapse; font-size: 0.88rem; }
.gpa-info td { padding: 0.45rem 0; border-top: 1px solid #1c1c1c; vertical-align: top; }
.gpa-info td:first-child { width: 38%; color: #777; }
.gpa-info td:last-child { color: #eee; font-weight: 700; }

body.light-mode .gpa-tagline { color: #555; }
body.light-mode .gpa-rating { color: #444; }
body.light-mode .gpa-text p { color: #333; }
body.light-mode .gpa-info td { border-color: #ddd; }
body.light-mode .gpa-info td:first-child { color: #666; }
body.light-mode .gpa-info td:last-child { color: #111; }
````

- [ ] **Step 4: Wire the page**

Create `.superpowers/tmp-edits/rep.js` (CRLF/BOM-safe single replace used by the edit scripts in this plan):

````js
// scratch helper: rep(file, oldLF, newLF) — CRLF/BOM-safe single replace
const fs = require('fs');
module.exports = function rep(file, oldS, newS) {
  const s = fs.readFileSync(file, 'utf8');
  const crlf = s.includes('\r\n');
  const o = crlf ? oldS.replace(/\n/g, '\r\n') : oldS;
  const n = crlf ? newS.replace(/\n/g, '\r\n') : newS;
  const i = s.indexOf(o);
  if (i < 0) throw new Error('anchor not found in ' + file + ': ' + oldS.slice(0, 60));
  if (s.indexOf(o, i + 1) >= 0) throw new Error('anchor not unique in ' + file + ': ' + oldS.slice(0, 60));
  fs.writeFileSync(file, s.slice(0, i) + n + s.slice(i + o.length));
};
````

Create `.superpowers/tmp-edits/edit-p4-page.js`. It adds the stylesheet link, the `gdPsn` stand-in, the resolved genre chips, the tagline/rating, the media block in place of the poster, moves the description for PlayStation-backed games, includes About/Game info above the gallery section (which is skipped when its pictures are already in the media block), loads `game-media.js`, and in `server.js` requires the two libs and passes `psnView` to the game page:

````js
const rep = require('./rep');
const V = 'views/game-detail.ejs';

// Stylesheet.
rep(V, `  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
`, `  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
  <link rel="stylesheet" href="/css/game-psn.css?v=<%= assetV %>">
`);

// The resolved PlayStation view (lib/game-psn-view.js); a stand-in when the
// route did not pass one, so the page renders exactly as before.
rep(V, `  const availability = computeAvailability(game, sum);
`, `  const availability = computeAvailability(game, sum);
  const gdPsn = typeof psnView !== 'undefined' && psnView ? psnView : { hasPsn: false, media: [], hideGallery: false, info: [], genre: game.genre || '' };
`);

// Genre chips use the resolved genre (the owner's, else PlayStation's).
rep(V, `<% if (game.genre) { game.genre.split('/').forEach(g => { %>`, `<% if (gdPsn.genre) { gdPsn.genre.split('/').forEach(g => { %>`);

// Tagline and rating under the title.
rep(V, `      <h1 class="usd-title"><%= game.title %></h1>
`, `      <h1 class="usd-title"><%= game.title %></h1>
      <% if (gdPsn.hasPsn) { %><%- include('partials/game-psn-headline', { psnView: gdPsn }) %><% } %>
`);

// Trailer + screenshots take the poster's place.
rep(V, `    <div class="gd-cover-col">
      <% if (game.cover_image) { %>`, `    <div class="gd-cover-col">
      <% if (gdPsn.media.length) { %>
        <%- include('partials/game-psn-media', { items: gdPsn.media, title: game.title }) %>
      <% } else if (game.cover_image) { %>`);

// With PlayStation data the description moves to "About this game".
rep(V, `<% if (game.description) { %><p class="gd-desc gdh-poster-desc">`, `<% if (game.description && !gdPsn.hasPsn) { %><p class="gd-desc gdh-poster-desc">`);

// About + Game info above the gallery section; the gallery is skipped when its
// pictures are already in the media block.
rep(V, `  <% if (gdhGallery.length) { %>`, `  <%- include('partials/game-psn-about', { psnView: gdPsn }) %>

  <% if (gdhGallery.length && !gdPsn.hideGallery) { %>`);

rep(V, `<script src="/js/messenger-text.js?v=<%= assetV %>"></script>`, `<% if (gdPsn.media.length || gdPsn.about) { %><script src="/js/game-media.js?v=<%= assetV %>" defer></script><% } %>
<script src="/js/messenger-text.js?v=<%= assetV %>"></script>`);

// server.js: hand the page its resolved view.
rep('server.js', "const visitorFunnel = require('./lib/visitor-funnel');\n", "const visitorFunnel = require('./lib/visitor-funnel');\nconst gamePsnView = require('./lib/game-psn-view');\nconst psnGame = require('./lib/psn-game');\n");
rep('server.js', "res.render('game-detail', Object.assign({ game: resolved, ", "res.render('game-detail', Object.assign({ game: resolved, psnView: gamePsnView.buildGamePsnView(resolved), ");
console.log('edited');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-p4-page.js` → `edited`.
Then: `node --check server.js && file server.js views/game-detail.ejs` → `server.js` still BOM + CRLF, `game-detail.ejs` LF.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node scripts/test-game-psn-page.js` → `6 assertions passed`.
Run: `node scripts/test-game-detail-messenger.js && node scripts/test-js-extraction-game-detail.js` → pass.

- [ ] **Step 6: Look at it in a browser (throwaway instance, never production)**

Start a throwaway server on a temp `DATA_DIR` with `MONGODB_URI=` on port 4602, with a `games.json` holding one game whose `psn` is the parsed fixture (or `parseConceptPage` of any saved store page). Open `/game/<slug>` at 390px: trailer first with ▶ TRAILER and a `1 / N` counter, thumbnails, the rent box under it, tagline and ★ rating under the title, "About this game" with Read more, the Game info table, no horizontal scroll. Stop the server afterwards.

- [ ] **Step 7: Commit**

```bash
git add views/partials/game-psn-media.ejs views/partials/game-psn-headline.ejs views/partials/game-psn-about.ejs public/css/game-psn.css public/js/game-media.js scripts/test-game-psn-page.js views/game-detail.ejs server.js
git commit -m "Game page: trailer, screenshots, overview and game info from PlayStation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Admin — Update all, per-game section, size

**Files:**
- Create: `scripts/test-admin-psn.js`
- Modify: `server.js`, `views/admin.ejs`, `views/edit.ejs`, `views/partials/admin/games/all-games.ejs`, `public/css/style.css` — via the two edit scripts

**Interfaces:**
- Consumes: Task 1's `psnGame.fetchGameInfo` and `psnGame.cleanLink` (called through the module object at request time, so tests can stub it); `server.js` already requires `psnGame` (Task 3).
- Produces: `POST /admin/games/psn/refresh` (`force=1` optional; redirects `/admin?tab=games&msg=psn_refreshed|psn_nothing`; writes lowdb key `psn_last_run = { at, updated, nomatch[], failed[], remaining }`); `POST /admin/games/:id/psn` (`action` = `update`|`save`|`remove`, fields `psn_link`, `size_gb`; redirects `/admin/edit/:id?msg=psn_updated|psn_saved|psn_removed|psn_nomatch|psn_failed|psn_badlink`); game fields `psn_link` (string) and `size_gb` (number or null); constants `PSN_REFRESH_CAP = 60`, `PSN_FRESH_MS` (7 days), `PSN_PAUSE_MS` (env `PSN_PAUSE_MS`, default 300).

- [ ] **Step 1: Write the test**

Create `scripts/test-admin-psn.js` (boots a throwaway instance with an in-memory session store and a stubbed `fetchGameInfo`):

````js
// Run: node scripts/test-admin-psn.js
//
// The admin side of "game info from PlayStation": the Games tab's "Update all"
// route and the per-game section on the edit page. Boots a throwaway instance
// (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a made-up admin
// password) with lib/psn-game's fetchGameInfo replaced by a stub, so nothing
// reaches PlayStation, a database, or the real admin.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4597;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-psn-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const OLD = new Date(Date.now() - 10 * 86400000).toISOString();
const FRESH = new Date(Date.now() - 1 * 86400000).toISOString();
const g = (id, title, extra) => Object.assign({ id, title, platform: 'PS5', nt_price_7d: 100, nt_price_30d: 300, tr_price_7d: 100, tr_price_30d: 300 }, extra || {});
const games = [
  g(1, 'Zzyzx Known One'),
  g(2, 'Zzyzx Known Stale', { psn: { description: 'old', fetched_at: OLD } }),
  g(3, 'Zzyzx Known Fresh', { psn: { description: 'keep me', fetched_at: FRESH } }),
  g(4, 'Zzyzx Nomatch'),
  g(5, 'Zzyzx Broken')
];
// 65 more, already fetched today: skipped by a normal run, counted by a forced
// one (which is how the 60-per-press cap is exercised).
for (let i = 100; i < 165; i++) games.push(g(i, 'Zzyzx Bulk ' + i, { psn: { description: 'bulk', fetched_at: FRESH } }));
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({ admin_password: TEST_PASSWORD, games }));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.PSN_PAUSE_MS = '0';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const readDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const gameById = id => readDb().games.find(x => x.id === id);

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: p, method, headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, headers), timeout: 20000 }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}
const form = o => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  // Sessions normally live in MongoDB, which this test does not have: swap in
  // express-session's in-memory store (the only difference from production).
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  // Stub PlayStation: known titles succeed, "Nomatch" has no game unless a store link is pasted, "Broken" fails.
  const psnGame = require('../lib/psn-game');
  const fetched = [];
  psnGame.fetchGameInfo = async game => {
    fetched.push({ id: game.id, link: game.psn_link || '' });
    if (!game.psn_link && /Nomatch/.test(game.title)) return { ok: false, reason: 'no_match' };
    if (/Broken/.test(game.title)) return { ok: false, reason: 'network' };
    return {
      ok: true,
      psn: {
        source: game.psn_link ? 'manual' : 'auto', fetched_at: new Date().toISOString(),
        store_url: 'https://store.playstation.com/en-us/concept/1', matched_title: game.title,
        description: 'fresh for ' + game.title, videos: [], screenshots: []
      }
    };
  };
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  console.log('\naccess');
  await okAsync('both routes need the admin login', async () => {
    const a = await call('POST', '/admin/games/psn/refresh', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' });
    const b = await call('POST', '/admin/games/1/psn', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ action: 'update' }) });
    assert.strictEqual(a.status, 302);
    assert.ok(a.headers.location.includes('/admin/login'));
    assert.strictEqual(b.status, 302);
    assert.ok(b.headers.location.includes('/admin/login'));
    assert.strictEqual(fetched.length, 0);
  });

  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in to the throwaway instance');
  const post = (p, o) => call('POST', p, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form(o || {}) });

  console.log('\nUpdate all from PlayStation');
  await okAsync('fetches games never fetched or older than 7 days, skips the fresh ones', async () => {
    const r = await post('/admin/games/psn/refresh');
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.includes('msg=psn_refreshed'));
    assert.deepStrictEqual(fetched.map(f => f.id).sort((a, b) => a - b), [1, 2, 4, 5]);
    assert.strictEqual(gameById(1).psn.description, 'fresh for Zzyzx Known One');
    assert.strictEqual(gameById(2).psn.description, 'fresh for Zzyzx Known Stale');
    assert.strictEqual(gameById(3).psn.description, 'keep me', 'fresh game untouched');
  });
  await okAsync('a game with no match or a failed fetch keeps its data and is listed in the last run', async () => {
    assert.strictEqual(gameById(4).psn, undefined);
    assert.strictEqual(gameById(5).psn, undefined);
    const run = readDb().psn_last_run;
    assert.strictEqual(run.updated, 2);
    assert.deepStrictEqual(run.nomatch, ['Zzyzx Nomatch']);
    assert.deepStrictEqual(run.failed, ['Zzyzx Broken']);
    assert.strictEqual(run.remaining, 0);
  });
  await okAsync('the Games tab shows the button and the last run', async () => {
    const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('Update all from PlayStation'));
    assert.ok(/updated <strong[^>]*>2<\/strong>/.test(r.body));
    assert.ok(r.body.includes('Zzyzx Nomatch') && r.body.includes('Zzyzx Broken'));
  });
  await okAsync('pressing it again straight away only retries games that have no data', async () => {
    fetched.length = 0;
    await post('/admin/games/psn/refresh');
    assert.deepStrictEqual(fetched.map(f => f.id).sort((a, b) => a - b), [4, 5]);
  });
  await okAsync('force re-fetches fresh games too, but at most 60 per press, and says how many are left', async () => {
    fetched.length = 0;
    await post('/admin/games/psn/refresh', { force: '1' });
    assert.strictEqual(fetched.length, 60);
    assert.deepStrictEqual(fetched.slice(0, 5).map(f => f.id), [1, 2, 3, 4, 5], 'in catalogue order');
    assert.strictEqual(readDb().psn_last_run.remaining, 10);
  });

  console.log('\nGame edit page');
  await okAsync('the edit page has the PlayStation section', async () => {
    const r = await call('GET', '/admin/edit/1', { headers: { Cookie: cookie } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('PlayStation info') && r.body.includes('name="psn_link"') && r.body.includes('name="size_gb"'));
    assert.ok(r.body.includes('value="update"') && r.body.includes('Remove PlayStation info'));
  });
  await okAsync('save link and size: stored, nothing fetched', async () => {
    fetched.length = 0;
    const r = await post('/admin/games/4/psn', { action: 'save', psn_link: 'https://store.playstation.com/en-us/concept/123', size_gb: '54.34' });
    assert.ok(r.headers.location.endsWith('/admin/edit/4?msg=psn_saved'));
    assert.strictEqual(gameById(4).psn_link, 'https://store.playstation.com/en-us/concept/123');
    assert.strictEqual(gameById(4).size_gb, 54.3);
    assert.strictEqual(fetched.length, 0);
  });
  await okAsync('update uses the pasted link and stores the result', async () => {
    const r = await post('/admin/games/4/psn', { action: 'update', psn_link: 'https://store.playstation.com/en-us/concept/123', size_gb: '54.3' });
    assert.ok(r.headers.location.endsWith('/admin/edit/4?msg=psn_updated'));
    assert.strictEqual(fetched[fetched.length - 1].link, 'https://store.playstation.com/en-us/concept/123');
    assert.strictEqual(gameById(4).psn.source, 'manual');
  });
  await okAsync('a link that is not a PlayStation Store link is refused and changes nothing', async () => {
    const r = await post('/admin/games/4/psn', { action: 'save', psn_link: 'https://evil.example/x', size_gb: '10' });
    assert.ok(r.headers.location.endsWith('/admin/edit/4?msg=psn_badlink'));
    assert.strictEqual(gameById(4).size_gb, 54.3);
  });
  await okAsync('a failed fetch reports it and keeps what was stored', async () => {
    const a = await post('/admin/games/5/psn', { action: 'update' });
    assert.ok(a.headers.location.endsWith('/admin/edit/5?msg=psn_failed'));
    assert.strictEqual(gameById(5).psn, undefined);
    assert.ok(gameById(4).psn, 'game 4 keeps its data');
  });
  await okAsync('size is validated and remove clears the stored info', async () => {
    await post('/admin/games/1/psn', { action: 'save', size_gb: '9999' });
    assert.strictEqual(gameById(1).size_gb, null);
    const r = await post('/admin/games/1/psn', { action: 'remove' });
    assert.ok(r.headers.location.endsWith('/admin/edit/1?msg=psn_removed'));
    assert.strictEqual(gameById(1).psn, null);
    assert.strictEqual((await post('/admin/games/999/psn', { action: 'save' })).headers.location, '/admin');
  });
  await okAsync('the banner text shows for a message', async () => {
    const r = await call('GET', '/admin/edit/4?msg=psn_nomatch', { headers: { Cookie: cookie } });
    assert.ok(r.body.includes('PlayStation has no game with that name'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-admin-psn.js` → FAIL (a refresh request returns the wrong redirect or the Games tab lacks the button).

- [ ] **Step 3: Apply the admin edits**

Create `.superpowers/tmp-edits/edit-p4-admin.js`. It adds both routes just above the monthly-covers route, sets `res.locals.psnLastRun` in the `/admin` route, adds the toast texts and tab mapping in `admin.ejs`, adds the "Update all" form and last-run summary under the Games toolbar, and adds the banner and the "PlayStation info" section (link box, Size box, three buttons) to `edit.ejs`:

````js
const rep = require('./rep');

// ── server.js: the two routes, and last-run data for the Games tab ──
rep('server.js', "app.post('/admin/psplus/monthly-covers/fetch', requireAuth,", `// ── PlayStation game info (lib/psn-game.js) ─────────────────────────────────
// "Update all" walks the games one at a time with a short pause (PlayStation is
// not ours to hammer), skips games fetched in the last 7 days unless forced, and
// stops at 60 per click. A failed fetch never touches stored data. The public
// pages never call PlayStation — they read what is stored here.
const PSN_REFRESH_CAP = 60;
const PSN_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const PSN_PAUSE_MS = process.env.PSN_PAUSE_MS != null ? Number(process.env.PSN_PAUSE_MS) : 300;
const psnSleep = ms => new Promise(r => setTimeout(r, ms));

app.post('/admin/games/psn/refresh', requireAuth, asyncRoute(async (req, res) => {
  const force = (req.body && req.body.force === '1') || req.query.force === '1';
  const due = getGames().filter(g => force || !g.psn || !g.psn.fetched_at || Date.now() - Date.parse(g.psn.fetched_at) > PSN_FRESH_MS);
  const batch = due.slice(0, PSN_REFRESH_CAP);
  const run = { at: new Date().toISOString(), updated: 0, nomatch: [], failed: [], remaining: due.length - batch.length };
  for (let i = 0; i < batch.length; i++) {
    const g = batch[i];
    const r = await psnGame.fetchGameInfo(g);
    if (r.ok) {
      db.get('games').find({ id: g.id }).assign({ psn: r.psn }).write();
      run.updated++;
    } else if (r.reason === 'no_match') {
      run.nomatch.push(g.title);
    } else {
      run.failed.push(g.title);
    }
    if (i < batch.length - 1 && PSN_PAUSE_MS > 0) await psnSleep(PSN_PAUSE_MS);
  }
  if (batch.length) db.set('psn_last_run', run).write();
  res.redirect('/admin?tab=games&msg=' + (batch.length ? 'psn_refreshed' : 'psn_nothing'));
}));

// One game's PlayStation section on its edit page: save the pasted store link
// and the typed size, update from PlayStation, or remove the stored info.
app.post('/admin/games/:id/psn', requireAuth, asyncRoute(async (req, res) => {
  const game = getGame(req.params.id);
  if (!game) return res.redirect('/admin');
  const body = req.body || {};
  const back = '/admin/edit/' + game.id + '?msg=';
  const rawLink = String(body.psn_link || '').trim();
  const link = psnGame.cleanLink(rawLink);
  if (rawLink && !link) return res.redirect(back + 'psn_badlink');
  const size = Number(body.size_gb);
  const patch = { psn_link: link, size_gb: size > 0 && size <= 500 ? Math.round(size * 10) / 10 : null };
  if (body.action === 'remove') patch.psn = null;
  db.get('games').find({ id: game.id }).assign(patch).write();
  if (body.action === 'remove') return res.redirect(back + 'psn_removed');
  if (body.action !== 'update') return res.redirect(back + 'psn_saved');
  const r = await psnGame.fetchGameInfo(Object.assign({}, game, patch));
  if (r.ok) {
    db.get('games').find({ id: game.id }).assign({ psn: r.psn }).write();
    return res.redirect(back + 'psn_updated');
  }
  res.redirect(back + (r.reason === 'no_match' ? 'psn_nomatch' : 'psn_failed'));
}));

app.post('/admin/psplus/monthly-covers/fetch', requireAuth,`);

rep('server.js', "  res.render('admin', { qaUpcoming,", "  res.locals.psnLastRun = db.get('psn_last_run').value() || null;\n  res.render('admin', { qaUpcoming,");

// ── admin.ejs: toast text and which tab it belongs to ──
rep('views/admin.ejs', "const messages = { added:'✅ Game added!',", "const messages = { psn_refreshed:'✅ PlayStation info updated', psn_nothing:'Nothing to update — every game was fetched in the last 7 days', added:'✅ Game added!',");
rep('views/admin.ejs', "    added:'games', updated:'games', deleted:'games',\n", "    added:'games', updated:'games', deleted:'games', psn_refreshed:'games', psn_nothing:'games',\n");

// ── Games tab: the update-all button and what the last run did ──
rep('views/partials/admin/games/all-games.ejs', `    <option value="slots">Fewest slots left</option>
  </select>
</div>
`, `    <option value="slots">Fewest slots left</option>
  </select>
</div>
<%
  const psnRun = typeof psnLastRun !== 'undefined' ? psnLastRun : null;
%>
<form method="POST" action="/admin/games/psn/refresh" class="gm-psn" style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin:0.75rem 0;"
      onsubmit="var b=this.querySelector('button');b.disabled=true;b.textContent='Updating… this can take a minute';">
  <button type="submit" style="padding:0.5rem 0.9rem;border-radius:8px;border:1px solid #333;background:#161616;color:#fff;font-weight:700;cursor:pointer;">🎮 Update all from PlayStation</button>
  <label style="font-size:0.78rem;color:#888;"><input type="checkbox" name="force" value="1"> Also re-fetch games updated in the last 7 days</label>
  <% if (psnRun) { %>
  <span style="font-size:0.78rem;color:#888;">Last run <%= psnRun.at.slice(0, 16).replace('T', ' ') %> UTC · updated <strong style="color:#4ade80;"><%= psnRun.updated %></strong>
    <% if (psnRun.nomatch.length) { %> · no match <strong style="color:#fbbf24;"><%= psnRun.nomatch.length %></strong><% } %>
    <% if (psnRun.failed.length) { %> · failed <strong style="color:#f87171;"><%= psnRun.failed.length %></strong><% } %>
    <% if (psnRun.remaining) { %> · <%= psnRun.remaining %> still to do — press again<% } %></span>
  <% if (psnRun.nomatch.length || psnRun.failed.length) { %>
  <details style="flex-basis:100%;font-size:0.78rem;color:#888;"><summary>Which games?</summary>
    <% if (psnRun.nomatch.length) { %><div>No match (open the game and paste its PS Store link): <%= psnRun.nomatch.join(', ') %></div><% } %>
    <% if (psnRun.failed.length) { %><div>Could not reach PlayStation: <%= psnRun.failed.join(', ') %></div><% } %>
  </details>
  <% } %>
  <% } %>
</form>
`);

// ── Edit page: banner + PlayStation section ──
rep('views/edit.ejs', `  <%- include('partials/upload-error-banner', { msg, nothingSavedNote: 'None of the changes below were saved — please fix the picture and re-enter the rest.' }) %>
`, `  <%- include('partials/upload-error-banner', { msg, nothingSavedNote: 'None of the changes below were saved — please fix the picture and re-enter the rest.' }) %>
  <%
    const psnMsgs = {
      psn_updated: '✅ Updated from PlayStation.', psn_saved: '✅ Saved.', psn_removed: '🗑 PlayStation info removed.',
      psn_nomatch: '⚠️ PlayStation has no game with that name. Paste its PS Store link below and press Update again.',
      psn_failed: '⚠️ Could not read PlayStation just now — nothing was changed. Try again in a minute.',
      psn_badlink: '⚠️ That is not a PlayStation Store link. Use one like https://store.playstation.com/en-us/concept/10015533'
    };
  %>
  <% if (msg && psnMsgs[msg]) { %><div style="margin:0 0 1rem;padding:0.7rem 0.9rem;border-radius:10px;background:#16202f;border:1px solid #2d4a73;color:#cfe0f5;font-size:0.9rem;"><%= psnMsgs[msg] %></div><% } %>
`);

rep('views/edit.ejs', `  </form>
`, `  </form>

  <!-- PlayStation info: filled from PlayStation Store, never replaces what you typed above. -->
  <form method="POST" action="/admin/games/<%= game.id %>/psn" style="margin-top:2rem;padding:1.25rem;border:1px solid #222;border-radius:14px;background:#0f0f0f;">
    <h2 style="margin:0 0 0.4rem;font-size:1.05rem;">🎮 PlayStation info</h2>
    <p style="margin:0 0 1rem;font-size:0.82rem;color:#888;">
      Trailer, screenshots, overview, rating and details come from PlayStation Store. Anything you typed above (description, genre, release date, gallery) is shown instead.
    </p>
    <% if (game.psn) { %>
    <p style="margin:0 0 1rem;font-size:0.85rem;color:#ccc;">
      Matched: <a href="<%= game.psn.store_url %>" target="_blank" rel="noopener" style="color:#3b9be8;"><%= game.psn.matched_title || game.title %></a>
      (<%= game.psn.source === 'manual' ? 'from your link' : 'found by name' %>) · fetched <%= String(game.psn.fetched_at || '').slice(0, 16).replace('T', ' ') %> UTC
      · <%= (game.psn.videos || []).length %> trailer<%= (game.psn.videos || []).length === 1 ? '' : 's' %>, <%= (game.psn.screenshots || []).length %> screenshots
    </p>
    <% } else { %>
    <p style="margin:0 0 1rem;font-size:0.85rem;color:#888;">Not fetched yet.</p>
    <% } %>
    <div class="form-group">
      <label>PS Store link <span style="color:#555;font-size:0.75rem;">(only if the automatic match is wrong)</span></label>
      <input type="text" name="psn_link" value="<%= game.psn_link || '' %>" placeholder="https://store.playstation.com/en-us/concept/10015533" autocomplete="off">
    </div>
    <div class="form-group">
      <label>Size (GB) <span style="color:#555;font-size:0.75rem;">(PlayStation does not publish it — type it in; shown on the game page when filled)</span></label>
      <input type="number" name="size_gb" value="<%= game.size_gb || '' %>" min="0" max="500" step="0.1" placeholder="e.g. 54.3">
    </div>
    <div style="display:flex;gap:0.6rem;flex-wrap:wrap;">
      <button type="submit" name="action" value="update" style="padding:0.6rem 1rem;border-radius:8px;border:0;background:#f0a500;color:#000;font-weight:800;cursor:pointer;">Update from PlayStation</button>
      <button type="submit" name="action" value="save" style="padding:0.6rem 1rem;border-radius:8px;border:1px solid #333;background:#161616;color:#fff;font-weight:700;cursor:pointer;">Save link &amp; size only</button>
      <% if (game.psn) { %><button type="submit" name="action" value="remove" onclick="return confirm('Remove the stored PlayStation info for this game?')" style="padding:0.6rem 1rem;border-radius:8px;border:1px solid #4a1d1d;background:#1f1010;color:#f87171;font-weight:700;cursor:pointer;">Remove PlayStation info</button><% } %>
    </div>
  </form>
`);
console.log('edited');
````

Create `.superpowers/tmp-edits/edit-p4-css.js` (the Games-tab form uses a class so the stylesheet-coverage test in `test-games-template.js` stays green):

````js
const rep = require('./rep');
rep('views/partials/admin/games/all-games.ejs',
  ` class="gm-psn" style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin:0.75rem 0;"\n`,
  ` class="gm-psn"\n`);
rep('public/css/style.css',
  `.vf-ask-other { color: #666; font-size: 0.74rem; padding-top: 0.5rem; border-top: 1px solid #161616; margin-top: 0.25rem; }\n`,
  `.vf-ask-other { color: #666; font-size: 0.74rem; padding-top: 0.5rem; border-top: 1px solid #161616; margin-top: 0.25rem; }\n/* Games tab: "Update all from PlayStation" row */\n.gm-psn { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin: 0.75rem 0; }\n`);
console.log('edited');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-p4-admin.js && node .superpowers/tmp-edits/edit-p4-css.js` → `edited` twice.
Then: `node --check server.js && file server.js public/css/style.css views/edit.ejs views/admin.ejs views/partials/admin/games/all-games.ejs` → `server.js` BOM + CRLF, `style.css` CRLF, `edit.ejs` LF + BOM, the others LF.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-admin-psn.js` → `13 assertions passed`.
Run: `node scripts/test-games-template.js && node scripts/test-games-view.js && node scripts/test-admin-visitors-render.js` → pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-admin-psn.js server.js views/admin.ejs views/edit.ejs views/partials/admin/games/all-games.ejs public/css/style.css
git commit -m "Admin: update game info from PlayStation, per game and for all

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Full regression and cleanup

**Files:** none changed.

- [ ] **Step 1: Run every test file and list failures**

```bash
fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail of $(ls scripts/test-*.js | wc -l)"
```
Expected: only `FAIL scripts/test-requests-page.js`, `failed: 1`.

- [ ] **Step 2: Remove the scratch scripts and check the tree**

```bash
rm -rf .superpowers/tmp-edits && git status --short
```
Expected: no output except possibly the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.

Do not push; tell the owner it is ready and that, after deploy, they press **Update all from PlayStation** (repeat while it says games are still to do), then type a Size (GB) on the games they want it shown for.
