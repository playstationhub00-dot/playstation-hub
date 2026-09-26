# PS Plus Deluxe Game Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the whole PS Plus Deluxe catalog on the site. A new **PS Plus** menu item opens `/ps-plus` on a searchable **All Games** tab: about 520 games with PlayStation's covers, plus the owner's monthly games. The owner keeps the list current with an admin **Refresh from PlayStation** button that previews every change before saving.

**Architecture:**
- **Three focused libraries hold all the logic:**
  - `lib/psplus-feed.js` reads PlayStation's own game-finder JSON (Indonesia).
  - `lib/psplus-catalog.js` holds the refresh rules: name cleanup, merge, per-list safety check, diff, and what Apply writes, never touching owner choices.
  - `lib/psplus-catalog-view.js` holds the display rules for the customer page and the admin card.
- **`lib/psplus-catalog-store.js` saves the games** in their own MongoDB collection, with an in-memory copy for page reads. It is not the lowdb blob, which is rewritten in full on every save.
- **The server routes and templates stay thin:**
  - admin refresh / apply / owner-choice routes;
  - `/ps-plus` gets three tabs and a grid drawn in the browser;
  - a PS Plus nav item;
  - catalog games added to site search.

**Tech Stack:**
- Node / Express 4, EJS, lowdb (month entries), MongoDB (catalog).
- `fetch` + `AbortController` (Node built-ins).
- Tests are plain `node scripts/test-*.js` with `assert`.

**Spec:** `docs/superpowers/specs/2026-09-27-psplus-catalog-design.md`
**Mockups:** `.superpowers/brainstorm/1836-1790445991/content/` (local only).

**Already committed with this plan:** `scripts/fixtures/psplus-feed/{catalog,classics,ubisoft,monthly}.json`. This is PlayStation's real feed, saved 2026-09-27, and every test reads it instead of the network.

## Global Constraints

**Data source.**
- The feed URL is `https://www.playstation.com/bin/imagic/gameslist?locale=en-id&categoryList=<list>` (`FEED_LOCALE = 'en-id'`).
- Lists: `catalog`→`plus-games-list`, `classics`→`plus-classics-list`, `ubisoft`→`ubisoft-classics-list`, `monthly`→`plus-monthly-games-list`.
- **Stored lists** (`STORED_LISTS`): `catalog`, `classics`, `ubisoft`. PlayStation's monthly list is never stored. It only feeds the "Create <Month Year> entry" suggestion.

**Keys.**
- A PlayStation game is `c:<conceptId>`.
- A game added by hand is `m:<n>`.
- A monthly-only tile is `mo:<entryId>:<lineIndex>`. It is never stored.

**Owner fields** (`OWNER_FIELDS`): `hidden`, `hidden_note`, `cover_override`, `rent_game_id`, `rent_override`. A refresh never changes them, and never removes a game added by hand.

**Safety, per stored list:**
- **failed:** it couldn't be read.
- **blocked:** it was read but has 0 games. Never applied.
- **warn:** it shrank by 30% or more (`BIG_DROP = 0.3`). Shown, and still applicable.
- **ok:** otherwise.
- Apply only uses `ok` and `warn` lists. Memberships in held-back lists stay exactly as stored.

**Preview lifetime.** A Refresh preview lives in server memory for 30 minutes under a random token. Apply re-plans against what is stored at that moment.

**Toasts, exact text.** Each maps to the `psplus` tab.

| Key | Text |
|---|---|
| `catalog_applied` | ✅ Game list updated. |
| `catalog_expired` | ⏳ That preview expired — refresh again. |
| `catalog_unreachable` | ❌ Couldn't reach PlayStation — nothing changed. |
| `catalog_nothing` | ⛔ Nothing to apply — every list was held back. |
| `catalog_saved` | ✅ Saved. |
| `catalog_error` | ❌ Couldn't save that — try again. |

**Covers.** Feed covers only from `https://image.api.playstation.com/…`, sized with `?w=240` (cards), `?w=600` (sheet), `?w=80` (admin) and `?w=120` (search). An owner cover (`/uploads/…`) always wins.

**Line endings.**
- `server.js` and `views/ps-plus.ejs` are **CRLF with a UTF-8 BOM**, and `views/partials/nav.ejs` is **CRLF**. Change these three with the **Edit tool only** (never Write, never shell), then check with `file`.
- `views/admin.ejs` and `views/partials/admin/psplus.ejs` are LF.
- Every new file is LF.

**Do not touch.**
- Do not edit `public/css/style.css`. The new styles live in `public/css/psplus-catalog.css`.
- Do not alter the substrings `templateTokens: templates.TOKENS, gamesView, orderQueue,` or `refundsOwed, releasedOrders, upcomingReservedCount, abandonedOrders` in `server.js`.

**Safety rules.**
- Never log into the real admin and never touch production data.
- The new tests never write the project's `games.json` and never reach a database. The one new test that boots the server gives it a throwaway `DATA_DIR` and a blank `MONGODB_URI`.

**Git.**
- Every commit message ends with the Co-Authored-By line from the session's current attribution reminder (at the time of writing: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Work directly on `main`. Do not push.
- Never commit anything under `.superpowers/` or `.impeccable/`.
- The full test run is expected to show only the pre-existing `scripts/test-requests-page.js` failure.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/psplus-feed.js` | Create | Read and parse PlayStation's four game-finder lists; never throws |
| `lib/psplus-catalog.js` | Create | Refresh rules: names, merge, safety, diff, Apply plan, preview |
| `lib/psplus-catalog-view.js` | Create | Display rules: tags, "Also for rent", Monthly tags, customer payload, admin rows, preview view, month suggestion |
| `lib/psplus-catalog-store.js` | Create | MongoDB collection + in-memory copy; owner-field-only edits; hand-added games |
| `server.js` | Modify | Requires + boot load; admin catalog routes; admin + `/ps-plus` locals; search index entries |
| `views/partials/admin/psplus/catalog.ejs` | Create | Admin card: header, preview, add-by-hand, counts, browser-drawn table |
| `views/partials/admin/psplus.ejs` | Modify | Include the card at the top; id on the Add Monthly form |
| `views/admin.ejs` | Modify | The six toasts |
| `views/ps-plus.ejs` | Modify | New hero, three tabs, panels, tab script |
| `views/partials/psplus-catalog-grid.ejs` | Create | All Games toolbar, chips, grid, quick-view sheet, grid script |
| `public/css/psplus-catalog.css` | Create | Styles for the hero, tabs, grid and sheet |
| `views/partials/nav.ejs` | Modify | PS Plus item in both menus |
| `scripts/test-psplus-*.js` (7 files) | Create | One test per task |

---

### Task 1: Read PlayStation's feed — `lib/psplus-feed.js`

**Files:**
- Create: `lib/psplus-feed.js`
- Test: `scripts/test-psplus-feed.js`
- Uses: `scripts/fixtures/psplus-feed/*.json` (already committed)

**Interfaces:**
- Consumes: nothing.
- Produces, from `lib/psplus-feed.js`:
  - `FEED_LOCALE = 'en-id'`
  - `LISTS`: `{ catalog, classics, ubisoft, monthly }` → categoryList
  - `feedUrl(list) → string` (throws on an unknown list)
  - `parseFeed(json) → game[] | null`. Each game is `{ concept_id: string, name_raw, image_url, platforms: ('PS5'|'PS4')[], genres: string[], release_date: 'YYYY-MM-DD'|'', store_url }`; the result is null for an unknown shape.
  - `fetchList(list, { timeoutMs = 15000, fetchImpl = fetch }) → Promise<{ ok, games, reason }>`; `reason` ∈ `http_<n> | bad_json | bad_shape | network | timeout`.
  - `fetchAll(opts) → Promise<{ catalog, classics, ubisoft, monthly }>`, each a `fetchList` result.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-psplus-feed.js`:

```js
// Run: node scripts/test-psplus-feed.js
//
// lib/psplus-feed.js against a saved copy of PlayStation's real game-finder
// feed (scripts/fixtures/psplus-feed/, captured 2026-09-27) and a stubbed
// fetch — no network. Checks the parse keeps what the site shows (name,
// cover, platforms, store link) and that every way a fetch can fail comes
// back as { ok: false } instead of throwing or looking like an empty list.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const feed = require('../lib/psplus-feed');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const FIX = path.join(__dirname, 'fixtures', 'psplus-feed');
const load = name => JSON.parse(fs.readFileSync(path.join(FIX, name + '.json'), 'utf8'));

console.log('\nfeedUrl()');

ok('builds the Indonesia URL for each list', () => {
  assert.strictEqual(feed.FEED_LOCALE, 'en-id');
  assert.strictEqual(feed.feedUrl('catalog'), 'https://www.playstation.com/bin/imagic/gameslist?locale=en-id&categoryList=plus-games-list');
  assert.strictEqual(feed.feedUrl('classics'), 'https://www.playstation.com/bin/imagic/gameslist?locale=en-id&categoryList=plus-classics-list');
  assert.strictEqual(feed.feedUrl('ubisoft'), 'https://www.playstation.com/bin/imagic/gameslist?locale=en-id&categoryList=ubisoft-classics-list');
  assert.strictEqual(feed.feedUrl('monthly'), 'https://www.playstation.com/bin/imagic/gameslist?locale=en-id&categoryList=plus-monthly-games-list');
});

ok('refuses a list it does not know', () => {
  assert.throws(() => feed.feedUrl('extra'), /unknown list/);
});

console.log('\nparseFeed() on the saved feed');

ok('reads every game in every list', () => {
  assert.strictEqual(feed.parseFeed(load('catalog')).length, 388);
  assert.strictEqual(feed.parseFeed(load('classics')).length, 151);
  assert.strictEqual(feed.parseFeed(load('ubisoft')).length, 67);
  assert.strictEqual(feed.parseFeed(load('monthly')).length, 6);
});

ok('keeps what the site needs from each game', () => {
  const gow = feed.parseFeed(load('catalog')).find(g => g.name_raw === 'God of War Ragnarök');
  assert.ok(gow, 'God of War Ragnarök is in the catalog');
  assert.ok(/^\d+$/.test(gow.concept_id));
  assert.ok(gow.image_url.startsWith('https://image.api.playstation.com/'));
  assert.deepStrictEqual(gow.platforms, ['PS5', 'PS4']);
  assert.ok(gow.store_url.startsWith('https://store.playstation.com/en-id/concept/'));
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(gow.release_date));
  assert.ok(Array.isArray(gow.genres) && gow.genres.length > 0);
});

ok('drops a cover or store link from anywhere else, and a game with no id or name', () => {
  const games = feed.parseFeed([{ catalogKey: 'A', games: [
    { conceptId: 1, name: 'A', imageUrl: 'https://evil.example/x.png', conceptUrl: 'javascript:alert(1)', device: ['PS4'] },
    { conceptId: null, name: 'No id' },
    { conceptId: 2, name: '   ' }
  ] }]);
  assert.strictEqual(games.length, 1);
  assert.strictEqual(games[0].image_url, '');
  assert.strictEqual(games[0].store_url, '');
  assert.deepStrictEqual(games[0].platforms, ['PS4']);
});

ok('a feed in any other shape is unreadable, not empty', () => {
  assert.strictEqual(feed.parseFeed({ games: [] }), null);
  assert.strictEqual(feed.parseFeed(null), null);
  assert.deepStrictEqual(feed.parseFeed([]), []);
});

console.log('\nfetchList() with a stubbed fetch');

function stub(response) { return async () => response; }

(async () => {
  await okAsync('a good response is parsed', async () => {
    const r = await feed.fetchList('classics', { fetchImpl: stub({ ok: true, status: 200, json: async () => load('classics') }) });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.games.length, 151);
  });

  await okAsync('a non-200 response is a failed list', async () => {
    const r = await feed.fetchList('catalog', { fetchImpl: stub({ ok: false, status: 503, json: async () => ({}) }) });
    assert.deepStrictEqual([r.ok, r.reason, r.games.length], [false, 'http_503', 0]);
  });

  await okAsync('a body that is not JSON is a failed list', async () => {
    const r = await feed.fetchList('catalog', { fetchImpl: stub({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }) });
    assert.deepStrictEqual([r.ok, r.reason], [false, 'bad_json']);
  });

  await okAsync('JSON in the wrong shape is a failed list', async () => {
    const r = await feed.fetchList('catalog', { fetchImpl: stub({ ok: true, status: 200, json: async () => ({ error: 'moved' }) }) });
    assert.deepStrictEqual([r.ok, r.reason], [false, 'bad_shape']);
  });

  await okAsync('a network error is a failed list', async () => {
    const r = await feed.fetchList('catalog', { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    assert.deepStrictEqual([r.ok, r.reason], [false, 'network']);
  });

  await okAsync('a fetch that never answers times out', async () => {
    const hang = (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    });
    const r = await feed.fetchList('catalog', { fetchImpl: hang, timeoutMs: 20 });
    assert.deepStrictEqual([r.ok, r.reason], [false, 'timeout']);
  });

  await okAsync('fetchAll reads all four lists by name', async () => {
    const seen = [];
    const r = await feed.fetchAll({ fetchImpl: async url => { seen.push(url); return { ok: true, status: 200, json: async () => [] }; } });
    assert.deepStrictEqual(Object.keys(r).sort(), ['catalog', 'classics', 'monthly', 'ubisoft']);
    assert.strictEqual(seen.length, 4);
    assert.ok(Object.values(r).every(x => x.ok === true));
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-psplus-feed.js`
Expected: FAIL — `Cannot find module '../lib/psplus-feed'`

- [ ] **Step 3: Write the module**

Create `lib/psplus-feed.js`:

```js
// PlayStation's own PS Plus game-finder data. The public page
// https://www.playstation.com/en-id/ps-plus/games/ builds its game finder from
// these JSON lists — the complete Game Catalog, Classics and Ubisoft+ Classics,
// each game with its cover, platforms and store link — which is far more than
// the 211-title A–Z text list on the same page (that one misses God of War,
// Spider-Man, Ghost of Tsushima and most other first-party games).
//
// Read only when the owner presses "Refresh from PlayStation" in the admin; the
// refresh is previewed and applied by lib/psplus-catalog.js. Nothing here
// touches the database.

// One region for now. Singapore ('en-sg') serves the same feed shape.
const FEED_LOCALE = 'en-id';

// Our list name → PlayStation's categoryList. 'monthly' is never stored as
// catalog games: it only feeds the "Create <Month> entry" suggestion.
const LISTS = Object.freeze({
  catalog: 'plus-games-list',
  classics: 'plus-classics-list',
  ubisoft: 'ubisoft-classics-list',
  monthly: 'plus-monthly-games-list'
});

// Covers are shown straight from PlayStation's image CDN; anything else in the
// feed is dropped rather than rendered on the site.
const IMAGE_HOST = /^https:\/\/image\.api\.playstation\.com\//;
const STORE_HOST = /^https:\/\/store\.playstation\.com\//;

function feedUrl(list) {
  const category = LISTS[list];
  if (!category) throw new Error('lib/psplus-feed: unknown list ' + list);
  return 'https://www.playstation.com/bin/imagic/gameslist?locale=' + FEED_LOCALE + '&categoryList=' + category;
}

// The feed is an array of letter groups: [{ catalogKey: 'A', count, games: [...] }].
// Returns null for any other shape, so a changed feed reads as a failed list
// instead of an empty one.
function parseFeed(json) {
  if (!Array.isArray(json)) return null;
  const games = [];
  json.forEach(group => {
    const list = group && Array.isArray(group.games) ? group.games : [];
    list.forEach(g => {
      if (!g || g.conceptId == null || g.conceptId === '') return;
      const nameRaw = String(g.name || g.nameEn || '').trim();
      if (!nameRaw) return;
      const image = String(g.imageUrl || '');
      const store = String(g.conceptUrl || '');
      const device = Array.isArray(g.device) ? g.device : [];
      const release = String(g.releaseDate || '');
      games.push({
        concept_id: String(g.conceptId),
        name_raw: nameRaw,
        image_url: IMAGE_HOST.test(image) ? image : '',
        // Always PS5 before PS4, whatever order the feed uses.
        platforms: ['PS5', 'PS4'].filter(p => device.includes(p)),
        genres: Array.isArray(g.genre) ? g.genre.map(String) : [],
        release_date: /^\d{4}-\d{2}-\d{2}/.test(release) ? release.slice(0, 10) : '',
        store_url: STORE_HOST.test(store) ? store : ''
      });
    });
  });
  return games;
}

// Never throws: every failure comes back as { ok: false, reason } so the
// refresh can hold that one list back and still offer the others.
async function fetchList(list, { timeoutMs = 15000, fetchImpl = globalThis.fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(feedUrl(list), {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json' }
    });
    if (!res || !res.ok) return { ok: false, games: [], reason: 'http_' + (res ? res.status : 0) };
    let json;
    try { json = await res.json(); } catch (e) { return { ok: false, games: [], reason: 'bad_json' }; }
    const games = parseFeed(json);
    if (!games) return { ok: false, games: [], reason: 'bad_shape' };
    return { ok: true, games, reason: '' };
  } catch (e) {
    return { ok: false, games: [], reason: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

// All four lists at once: { catalog: {ok, games, reason}, classics: …, ubisoft: …, monthly: … }.
async function fetchAll(opts) {
  const names = Object.keys(LISTS);
  const results = await Promise.all(names.map(name => fetchList(name, opts)));
  const out = {};
  names.forEach((name, i) => { out[name] = results[i]; });
  return out;
}

module.exports = { FEED_LOCALE, LISTS, feedUrl, parseFeed, fetchList, fetchAll };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-psplus-feed.js`
Expected: ends `13 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/psplus-feed.js scripts/test-psplus-feed.js
git commit -m "$(cat <<'EOF'
Add lib/psplus-feed: read PlayStation's PS Plus game-finder lists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Refresh rules — `lib/psplus-catalog.js`

**Files:**
- Create: `lib/psplus-catalog.js`
- Test: `scripts/test-psplus-catalog.js`

**Interfaces:**
- Consumes: Task 1 `parseFeed` (the test only) and the parsed game shape.
- Produces, from `lib/psplus-catalog.js`:
  - `STORED_LISTS`: `['catalog','classics','ubisoft']`
  - `OWNER_FIELDS`
  - `OWNER_DEFAULTS`: `{ hidden:false, hidden_note:'', cover_override:'', rent_game_id:null, rent_override:false }`
  - `BIG_DROP = 0.3`
  - `displayName(raw) → string` and `matchKey(name) → string`
  - `mergeFeed(results) → game[]`. Each game has `key: 'c:<id>'`, `name`, `lists` and the feed fields.
  - `storedCounts(stored) → { catalog, classics, ubisoft }`
  - `listSafety(counts, results) → { [list]: { state: 'ok'|'warn'|'failed'|'blocked', stored, incoming, reason } }`
  - `appliedLists(safety) → string[]`
  - `diffCatalog(stored, incoming, applied) → { added, leaving, updated: [{before, after}], unchanged: number }`
  - `applyPlan(stored, incoming, applied, nowIso) → { upserts: game[], removals: key[], diff }`
  - `buildPreview(stored, results) → { safety, applied, incoming, diff, monthlyNames: string[] }`
- A stored game is `{ key, source: 'feed'|'manual', concept_id, name, name_raw, lists, image_url, platforms, genres, release_date, store_url, first_seen_at, updated_at, …OWNER_FIELDS }`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-psplus-catalog.js`:

```js
// Run: node scripts/test-psplus-catalog.js
//
// lib/psplus-catalog.js — the refresh rules for the PS Plus Deluxe game list:
// cleaning PlayStation's names, merging the three stored lists into one game
// per concept, the per-list safety check, the comparison with what the site
// has, and what Apply writes. The one promise that matters most is tested
// hardest: a refresh never loses the owner's own choices, never removes a game
// added by hand, and never lets a broken list wipe anything.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const feed = require('../lib/psplus-feed');
const cat = require('../lib/psplus-catalog');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const FIX = path.join(__dirname, 'fixtures', 'psplus-feed');
const loadList = name => ({ ok: true, games: feed.parseFeed(JSON.parse(fs.readFileSync(path.join(FIX, name + '.json'), 'utf8'))), reason: '' });
const REAL = { catalog: loadList('catalog'), classics: loadList('classics'), ubisoft: loadList('ubisoft'), monthly: loadList('monthly') };

// A tiny feed game, as lib/psplus-feed.js parses it.
function fg(id, name, extra) {
  return Object.assign({ concept_id: String(id), name_raw: name, image_url: 'https://image.api.playstation.com/' + id + '.png',
    platforms: ['PS5'], genres: ['ACTION'], release_date: '2024-01-01', store_url: 'https://store.playstation.com/en-id/concept/' + id }, extra || {});
}
const okList = games => ({ ok: true, games, reason: '' });
const failed = { ok: false, games: [], reason: 'timeout' };
// A stored PlayStation game, as the store holds it.
function sg(id, name, lists, extra) {
  return Object.assign({}, cat.OWNER_DEFAULTS, fg(id, name), { key: 'c:' + id, name: cat.displayName(name), source: 'feed', lists,
    first_seen_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }, extra || {});
}

console.log('\ndisplayName()');

ok('strips platform, edition and trademark noise from store names', () => {
  const cases = {
    'Ghost of Tsushima DIRECTOR’S CUT (PlayStation Plus)': 'Ghost of Tsushima DIRECTOR’S CUT',
    'Arcade Paradise PS4™ & PS5™': 'Arcade Paradise',
    'Assassin\'s Creed Valhalla - Digital Standard Edition PS4 & PS5': 'Assassin\'s Creed Valhalla',
    'Assassin\'s Creed® IV Black Flag - Digital Standard Edition – PlayStation®Hits': 'Assassin\'s Creed IV Black Flag',
    'Back 4 Blood: Standard Edition PS4 & PS5': 'Back 4 Blood',
    'The Elder Scrolls V: Skyrim Special Edition - PS5 & PS4': 'The Elder Scrolls V: Skyrim Special Edition',
    'Shadow Warrior 3: Definitive Edition | PS4 &amp; PS5': 'Shadow Warrior 3: Definitive Edition',
    'Granblue Fantasy: Relink Standard Edition PS4＆PS5': 'Granblue Fantasy: Relink',
    'GRAVITY RUSH 2  (Standard Edition)': 'GRAVITY RUSH 2',
    'Insurgency: Sandstorm [PS4 & PS5]': 'Insurgency: Sandstorm',
    'Days Gone Standard Edition': 'Days Gone',
    'Anno 1800™ Console Edition - Standard': 'Anno 1800 Console Edition',
    'Far Cry®3 Classic Edition - Digital Standard Edition': 'Far Cry 3 Classic Edition',
    'LocoRoco™2 Remastered': 'LocoRoco 2 Remastered',
    'RESOGUN™ full game': 'RESOGUN',
    'Stellaris: Console Edition PS5': 'Stellaris: Console Edition',
    'Horizon Zero Dawn™: Complete Edition PlayStation®Hits': 'Horizon Zero Dawn: Complete Edition',
    'Ys VIII -Lacrimosa of DANA- Standard Edition': 'Ys VIII -Lacrimosa of DANA-',
    'God of War Ragnarök': 'God of War Ragnarök'
  };
  Object.keys(cases).forEach(raw => assert.strictEqual(cat.displayName(raw), cases[raw], raw));
});

ok('every name in the real feed comes out clean', () => {
  cat.mergeFeed(REAL).forEach(g => {
    assert.ok(g.name, 'empty name for ' + g.name_raw);
    assert.ok(!/[™®©＆]|PS[45]\s*&|PlayStation\s*Hits|\s{2}|[|:&]$/.test(g.name), g.name_raw + ' => ' + g.name);
  });
});

console.log('\nmatchKey()');

ok('the same game written two ways gives the same key', () => {
  assert.strictEqual(cat.matchKey('Ghost of Tsushima DIRECTOR’S CUT (PlayStation Plus)'), cat.matchKey("Ghost of Tsushima Director's Cut"));
  assert.strictEqual(cat.matchKey('God of War Ragnarök'), 'god of war ragnarok');
  assert.strictEqual(cat.matchKey("Marvel's Spider-Man: Miles Morales PS4 & PS5"), 'marvel s spider man miles morales');
  assert.notStrictEqual(cat.matchKey('God of War'), cat.matchKey('God of War Ragnarök'));
});

console.log('\nmergeFeed()');

ok('the real feed merges to one game per concept, with every list it is in', () => {
  const merged = cat.mergeFeed(REAL);
  assert.strictEqual(merged.length, 515);
  const combos = {};
  merged.forEach(g => { const k = g.lists.join('+'); combos[k] = (combos[k] || 0) + 1; });
  assert.deepStrictEqual(combos, { catalog: 300, 'catalog+ubisoft': 66, classics: 149 });
  assert.ok(merged.every(g => /^c:\d+$/.test(g.key)));
});

ok('a concept listed twice keeps its first entry', () => {
  const merged = cat.mergeFeed({ catalog: okList([fg(1, 'FF7 (Japanese/English Version)'), fg(1, 'FF7 (Chinese/Korean Version)')]) });
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].name_raw, 'FF7 (Japanese/English Version)');
});

ok('a list that did not read is left out', () => {
  const merged = cat.mergeFeed({ catalog: okList([fg(1, 'A')]), classics: failed, ubisoft: okList([fg(1, 'A'), fg(2, 'B')]) });
  assert.deepStrictEqual(merged.map(g => [g.key, g.lists.join('+')]), [['c:1', 'catalog+ubisoft'], ['c:2', 'ubisoft']]);
});

console.log('\nlistSafety()');

ok('failed, empty, big drop and normal lists', () => {
  const counts = { catalog: 100, classics: 50, ubisoft: 10 };
  const games = n => Array.from({ length: n }, (_, i) => fg(i + 1, 'G' + i));
  const s = cat.listSafety(counts, { catalog: okList(games(70)), classics: okList([]), ubisoft: failed });
  assert.deepStrictEqual([s.catalog.state, s.catalog.stored, s.catalog.incoming], ['warn', 100, 70]);
  assert.strictEqual(s.classics.state, 'blocked');
  assert.deepStrictEqual([s.ubisoft.state, s.ubisoft.reason], ['failed', 'timeout']);
  assert.strictEqual(cat.listSafety(counts, { catalog: okList(games(71)) }).catalog.state, 'ok');
  assert.deepStrictEqual(cat.appliedLists(s), ['catalog']);
});

ok('the first ever refresh has nothing stored to compare with', () => {
  const s = cat.listSafety({ catalog: 0, classics: 0, ubisoft: 0 }, { catalog: okList([fg(1, 'A')]), classics: okList([fg(2, 'B')]), ubisoft: okList([fg(1, 'A')]) });
  assert.deepStrictEqual(cat.appliedLists(s), ['catalog', 'classics', 'ubisoft']);
});

ok('duplicates in a list count once', () => {
  const s = cat.listSafety({ catalog: 2 }, { catalog: okList([fg(1, 'A'), fg(1, 'A'), fg(2, 'B')]) });
  assert.strictEqual(s.catalog.incoming, 2);
});

console.log('\ndiffCatalog() and applyPlan()');

const NOW = '2026-09-27T05:00:00.000Z';

ok('new, leaving, updated and unchanged', () => {
  const stored = [
    sg(1, 'Keeps', ['catalog']),
    sg(2, 'Leaves', ['catalog']),
    sg(3, 'New Cover', ['catalog']),
    sg(4, 'Joins Ubisoft', ['catalog'])
  ];
  const incoming = cat.mergeFeed({
    catalog: okList([fg(1, 'Keeps'), fg(3, 'New Cover', { image_url: 'https://image.api.playstation.com/new.png' }), fg(4, 'Joins Ubisoft'), fg(5, 'Brand New')]),
    ubisoft: okList([fg(4, 'Joins Ubisoft')])
  });
  const d = cat.diffCatalog(stored, incoming, ['catalog', 'ubisoft']);
  assert.deepStrictEqual(d.added.map(g => g.key), ['c:5']);
  assert.deepStrictEqual(d.leaving.map(g => g.key), ['c:2']);
  assert.deepStrictEqual(d.updated.map(u => u.before.key).sort(), ['c:3', 'c:4']);
  assert.deepStrictEqual(d.updated.find(u => u.before.key === 'c:4').after.lists, ['catalog', 'ubisoft']);
  assert.strictEqual(d.unchanged, 1);
});

ok('a list held back keeps its memberships, so nothing in it leaves', () => {
  const stored = [sg(1, 'Classic One', ['classics']), sg(2, 'Both', ['catalog', 'ubisoft'])];
  const incoming = cat.mergeFeed({ catalog: okList([fg(2, 'Both')]) });
  const d = cat.diffCatalog(stored, incoming, ['catalog']);
  assert.strictEqual(d.leaving.length, 0);
  assert.strictEqual(d.updated.length, 0);
  assert.strictEqual(d.unchanged, 2);
});

ok('Apply keeps every choice the owner made, and stamps new games', () => {
  const stored = [sg(3, 'New Cover', ['catalog'], { hidden: true, hidden_note: 'not on our region', cover_override: '/uploads/mine.webp',
    rent_game_id: 12, rent_override: true, first_seen_at: '2025-05-05T00:00:00.000Z' })];
  const incoming = cat.mergeFeed({ catalog: okList([fg(3, 'New Cover PS4 & PS5', { image_url: 'https://image.api.playstation.com/new.png' }), fg(5, 'Brand New')]) });
  const plan = cat.applyPlan(stored, incoming, ['catalog'], NOW);
  const kept = plan.upserts.find(g => g.key === 'c:3');
  assert.deepStrictEqual([kept.hidden, kept.hidden_note, kept.cover_override, kept.rent_game_id, kept.rent_override],
    [true, 'not on our region', '/uploads/mine.webp', 12, true]);
  assert.strictEqual(kept.image_url, 'https://image.api.playstation.com/new.png');
  assert.strictEqual(kept.name, 'New Cover');
  assert.strictEqual(kept.first_seen_at, '2025-05-05T00:00:00.000Z');
  assert.strictEqual(kept.updated_at, NOW);
  const fresh = plan.upserts.find(g => g.key === 'c:5');
  assert.deepStrictEqual([fresh.source, fresh.first_seen_at, fresh.hidden, fresh.rent_game_id, fresh.rent_override], ['feed', NOW, false, null, false]);
  assert.deepStrictEqual(plan.removals, []);
});

ok('Apply removes games that left, and never a game added by hand', () => {
  const manual = Object.assign({}, cat.OWNER_DEFAULTS, { key: 'm:1', source: 'manual', name: 'My Own', name_raw: 'My Own', lists: ['catalog'] });
  const stored = [sg(2, 'Leaves', ['catalog']), manual];
  const plan = cat.applyPlan(stored, cat.mergeFeed({ catalog: okList([fg(9, 'Other')]) }), ['catalog'], NOW);
  assert.deepStrictEqual(plan.removals, ['c:2']);
  assert.ok(!plan.upserts.some(g => g.key === 'm:1'));
});

console.log('\nbuildPreview()');

ok('a blocked list is not applied and its games stay put', () => {
  const stored = [sg(1, 'Catalog Game', ['catalog']), sg(2, 'Classic Game', ['classics'])];
  const p = cat.buildPreview(stored, { catalog: okList([fg(1, 'Catalog Game'), fg(3, 'New One')]), classics: okList([]), ubisoft: failed, monthly: failed });
  assert.deepStrictEqual(p.applied, ['catalog']);
  assert.strictEqual(p.safety.classics.state, 'blocked');
  assert.strictEqual(p.safety.ubisoft.state, 'failed');
  assert.deepStrictEqual(p.diff.added.map(g => g.key), ['c:3']);
  assert.strictEqual(p.diff.leaving.length, 0);
  assert.deepStrictEqual(p.monthlyNames, []);
});

ok("PlayStation's monthly games come back as clean names, once each", () => {
  const p = cat.buildPreview([], REAL);
  assert.deepStrictEqual(p.monthlyNames, ['Chained Echoes', 'Fallout 76', 'MLB The Show 26', 'MLB The Show 26 Jump Start Bundle', 'Sniper Elite: Resistance', 'Wobbly Life']);
  assert.strictEqual(p.diff.added.length, 515);
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-psplus-catalog.js`
Expected: FAIL — `Cannot find module '../lib/psplus-catalog'`

- [ ] **Step 3: Write the module**

Create `lib/psplus-catalog.js`:

```js
// The PS Plus Deluxe game list: how a refresh from PlayStation's feed
// (lib/psplus-feed.js) is merged, checked, compared with what the site has,
// and applied without ever losing the owner's own choices. Pure functions —
// lib/psplus-catalog-store.js saves the result, server.js wires the routes.
//
// See docs/superpowers/specs/2026-09-27-psplus-catalog-design.md.

// The lists stored as catalog games. PlayStation's monthly list is not one of
// them: the owner's own month entries are the only source of Monthly tags.
const STORED_LISTS = Object.freeze(['catalog', 'classics', 'ubisoft']);

// Set by the owner in the admin and never overwritten by a refresh.
const OWNER_FIELDS = Object.freeze(['hidden', 'hidden_note', 'cover_override', 'rent_game_id', 'rent_override']);
const OWNER_DEFAULTS = Object.freeze({ hidden: false, hidden_note: '', cover_override: '', rent_game_id: null, rent_override: false });

// A list that shrinks by this much or more in one refresh gets a warning.
const BIG_DROP = 0.3;

// ── Names ─────────────────────────────────────────────────────────────

const ENTITIES = { '&amp;': '&', '&#39;': "'", '&#039;': "'", '&apos;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>' };

// Trailing noise, stripped repeatedly until none is left, since PlayStation
// stacks them in any order ("… - Digital Standard Edition PlayStation®Hits").
const SUFFIXES = [
  /(?:\s+[-–|])?\s+PS[45]\s*&\s*PS[45]$/i,                          // " PS4 & PS5", " - PS5 & PS4", " | PS4 & PS5"
  /\s+PS[45]$/i,                                                    // " PS5"
  /(?:\s+[-–])?\s*PlayStation\s*Hits$/i,                            // " PlayStation Hits", " – PlayStation Hits"
  /(?:\s+[-–]|:)?\s+(?:Digital\s+)?Standard(?:\s+Digital)?\s+Edition$/i, // " - Digital Standard Edition", ": Standard Edition"
  /\s+-\s+Standard$/i,                                              // " - Standard"
  /\s+full game$/i                                                  // " full game"
];

// PlayStation's store names carry platform and edition noise the site doesn't
// need: "Arcade Paradise PS4™ & PS5™", "Days Gone Standard Edition",
// "Ghost of Tsushima DIRECTOR’S CUT (PlayStation Plus)".
function displayName(raw) {
  let s = String(raw || '').replace(/&(amp|#39|#039|apos|quot|lt|gt);/g, m => ENTITIES[m]);
  // A mark glued between two words becomes a space ("Far Cry®3" → "Far Cry 3").
  s = s.replace(/[™®©](?=[A-Za-z0-9])/g, ' ').replace(/[™®©]/g, '');
  // Full-width characters ("PS4＆PS5") to plain ones — after the marks above,
  // which NFKC would otherwise spell out as "TM".
  s = s.normalize('NFKC');
  s = s.replace(/\s*[([](?:PS4\s*&\s*PS5|PS5|PS4|PlayStation\s*Plus|Standard\s+Edition)[)\]]/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  let prev;
  do {
    prev = s;
    SUFFIXES.forEach(re => { s = s.replace(re, '').trim(); });
  } while (s !== prev);
  return s;
}

// Loose key for "is this the same game": lowercase, accents folded, every run
// of punctuation a single space. "Ghost of Tsushima DIRECTOR’S CUT" and the
// owner's "Ghost of Tsushima Director's Cut" give the same key.
function matchKey(name) {
  return displayName(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// ── Refresh ───────────────────────────────────────────────────────────

// One game per PlayStation concept across the stored lists. The same concept
// can appear twice in one list (two language versions) and in several lists
// (every Ubisoft+ game is also in the Game Catalog): the first occurrence's
// data is kept and the memberships are unioned. Lists that did not read OK are
// skipped. Returns games keyed 'c:<conceptId>', in feed order.
function mergeFeed(results) {
  const byKey = new Map();
  STORED_LISTS.forEach(list => {
    const r = results && results[list];
    if (!r || !r.ok) return;
    r.games.forEach(g => {
      const key = 'c:' + g.concept_id;
      let game = byKey.get(key);
      if (!game) {
        game = Object.assign({ key, name: displayName(g.name_raw) }, g, { lists: [] });
        byKey.set(key, game);
      }
      if (!game.lists.includes(list)) game.lists.push(list);
    });
  });
  return [...byKey.values()];
}

// How many stored PlayStation games are in each list.
function storedCounts(stored) {
  const counts = { catalog: 0, classics: 0, ubisoft: 0 };
  (stored || []).forEach(g => {
    if (!g || g.source !== 'feed') return;
    (g.lists || []).forEach(l => { if (l in counts) counts[l] += 1; });
  });
  return counts;
}

// Per stored list: 'failed' (couldn't read it), 'blocked' (read, but empty —
// almost always PlayStation's site misbehaving, never applied), 'warn' (lost
// 30% or more at once — shown, still applicable) or 'ok'.
function listSafety(counts, results) {
  const out = {};
  STORED_LISTS.forEach(list => {
    const r = results && results[list];
    const stored = (counts && counts[list]) || 0;
    if (!r || !r.ok) {
      out[list] = { state: 'failed', stored, incoming: 0, reason: (r && r.reason) || 'missing' };
      return;
    }
    const incoming = new Set(r.games.map(g => g.concept_id)).size;
    let state = 'ok';
    if (incoming === 0) state = 'blocked';
    else if (stored > 0 && incoming <= stored * (1 - BIG_DROP)) state = 'warn';
    out[list] = { state, stored, incoming, reason: '' };
  });
  return out;
}

// The lists a refresh may apply: read OK and not empty.
function appliedLists(safety) {
  return STORED_LISTS.filter(l => safety[l] && (safety[l].state === 'ok' || safety[l].state === 'warn'));
}

const FEED_FIELDS = ['concept_id', 'name_raw', 'name', 'image_url', 'platforms', 'genres', 'release_date', 'store_url'];

function sameArray(a, b) {
  return (a || []).length === (b || []).length && (a || []).every((x, i) => x === (b || [])[i]);
}

// A stored game's lists after the refresh: its memberships in lists that were
// held back stay exactly as they were; in applied lists it is a member only if
// the incoming feed says so.
function nextLists(storedGame, incomingGame, applied) {
  return STORED_LISTS.filter(l => applied.includes(l)
    ? !!(incomingGame && incomingGame.lists.includes(l))
    : (storedGame.lists || []).includes(l));
}

// Compares the stored games with a merged feed. Hand-added games are never
// part of the comparison.
//   added     — incoming games the site doesn't have
//   leaving   — stored PlayStation games left in no list at all
//   updated   — [{ before, after }] where a feed field or a membership changed
//   unchanged — count
function diffCatalog(stored, incoming, applied) {
  const inByKey = new Map((incoming || []).map(g => [g.key, g]));
  const feedStored = (stored || []).filter(g => g && g.source === 'feed');
  const storedKeys = new Set(feedStored.map(g => g.key));
  const added = (incoming || []).filter(g => !storedKeys.has(g.key));
  const leaving = [];
  const updated = [];
  let unchanged = 0;
  feedStored.forEach(s => {
    const inc = inByKey.get(s.key);
    const lists = nextLists(s, inc, applied);
    if (!lists.length) { leaving.push(s); return; }
    const after = Object.assign({}, s, inc ? pick(inc, FEED_FIELDS) : {}, { lists });
    const changed = !sameArray(s.lists, lists) || FEED_FIELDS.some(f =>
      Array.isArray(s[f]) || Array.isArray(after[f]) ? !sameArray(s[f], after[f]) : s[f] !== after[f]);
    if (changed) updated.push({ before: s, after });
    else unchanged += 1;
  });
  return { added, leaving, updated, unchanged };
}

function pick(obj, fields) {
  const out = {};
  fields.forEach(f => { if (f in obj) out[f] = obj[f]; });
  return out;
}

// What Apply writes: full documents to upsert and keys to delete. The owner's
// fields on an existing game are carried over untouched; a new game starts
// with the defaults and first_seen_at = now (the "Newest added" sort).
function applyPlan(stored, incoming, applied, nowIso) {
  const diff = diffCatalog(stored, incoming, applied);
  const upserts = [];
  diff.added.forEach(g => {
    upserts.push(Object.assign({}, OWNER_DEFAULTS, pick(g, FEED_FIELDS), {
      key: g.key, source: 'feed', lists: g.lists.slice(), first_seen_at: nowIso, updated_at: nowIso
    }));
  });
  diff.updated.forEach(({ before, after }) => {
    upserts.push(Object.assign({}, after, pick(before, OWNER_FIELDS), {
      key: before.key, source: 'feed', first_seen_at: before.first_seen_at || nowIso, updated_at: nowIso
    }));
  });
  return { upserts, removals: diff.leaving.map(g => g.key), diff };
}

// Everything the admin's Refresh preview needs, from the four fetched lists.
// `incoming` and `applied` are kept with the preview so Apply can re-plan
// against whatever is stored at the moment it is pressed.
function buildPreview(stored, results) {
  const safety = listSafety(storedCounts(stored), results);
  const applied = appliedLists(safety);
  const onlyApplied = {};
  applied.forEach(l => { onlyApplied[l] = results[l]; });
  const incoming = mergeFeed(onlyApplied);
  const diff = diffCatalog(stored, incoming, applied);
  const seen = new Set();
  const monthlyNames = [];
  const monthly = results && results.monthly;
  if (monthly && monthly.ok) {
    monthly.games.forEach(g => {
      const name = displayName(g.name_raw);
      const k = matchKey(name);
      if (!k || seen.has(k)) return;
      seen.add(k);
      monthlyNames.push(name);
    });
  }
  return { safety, applied, incoming, diff, monthlyNames };
}

module.exports = {
  STORED_LISTS, OWNER_FIELDS, OWNER_DEFAULTS, BIG_DROP,
  displayName, matchKey, mergeFeed, storedCounts, listSafety, appliedLists,
  diffCatalog, applyPlan, buildPreview
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node scripts/test-psplus-catalog.js
node scripts/test-psplus-feed.js
```

Expected: `test-psplus-catalog.js` ends `15 assertions passed`, and `test-psplus-feed.js` still ends `13 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/psplus-catalog.js scripts/test-psplus-catalog.js
git commit -m "$(cat <<'EOF'
Add lib/psplus-catalog: refresh rules for the PS Plus game list

Cleans PlayStation's names, merges the three lists into one game per
concept, checks each list before it may be applied, and plans Apply
without ever touching the owner's own choices or hand-added games.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Display rules — `lib/psplus-catalog-view.js`

**Files:**
- Create: `lib/psplus-catalog-view.js`
- Test: `scripts/test-psplus-catalog-view.js`

**Interfaces:**
- Consumes: Task 2 `matchKey`, `STORED_LISTS`, `OWNER_DEFAULTS`.
- Produces, from `lib/psplus-catalog-view.js`:
  - `primaryTag(lists) → 'classics'|'ubisoft'|'catalog'`
  - `prettyGenre(genres) → string`
  - `coverUrl(game, width) → string`
  - `resolveRentLink(game, siteGames) → siteGame|null`
  - `monthlyTags(entries, games) → { tagByKey: Map<key,'SEP 2026'>, tiles: [{ key, name, label }] }`
  - `buildPublicCatalog({ games, siteGames, entries, slugFor }) → { items, counts: { all, catalog, classics, ubisoft, monthly, rent } }`. Items use the short keys documented in the file.
  - `buildAdminCatalog({ games, siteGames, entries, meta, now }) → { rows, counts: { catalog, classics, ubisoft, monthly, hidden, rent, manual }, lastRefreshedAt, daysAgo }`
  - `previewView(preview, mostPlayedTitles, cap) → { lists, held, warned, added, addedMore, addedCount, leaving, leavingMore, leavingCount, leavingInMostPlayed, updatedCount, unchanged, appliedCount }`
  - `monthSuggestion(names, entries, today) → { year, month, monthName, names } | null`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-psplus-catalog-view.js`:

```js
// Run: node scripts/test-psplus-catalog-view.js
//
// lib/psplus-catalog-view.js — what the PS Plus Deluxe game list looks like:
// the tag on each card, the "Also for rent" link to the owner's own game, the
// Monthly tag from the owner's month entries, the customer payload with its
// chip counts, the admin rows, and the Refresh preview.
const assert = require('assert');
const view = require('../lib/psplus-catalog-view');
const { OWNER_DEFAULTS } = require('../lib/psplus-catalog');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

function game(id, name, lists, extra) {
  return Object.assign({}, OWNER_DEFAULTS, {
    key: 'c:' + id, source: 'feed', concept_id: String(id), name, name_raw: name, lists,
    image_url: 'https://image.api.playstation.com/' + id + '.png', platforms: ['PS5', 'PS4'], genres: ['ROLE_PLAYING_GAMES'],
    release_date: '2020-07-17', store_url: 'https://store.playstation.com/en-id/concept/' + id,
    first_seen_at: '2026-09-20T01:00:00.000Z', updated_at: '2026-09-20T01:00:00.000Z'
  }, extra || {});
}
const SITE = [
  { id: 7, title: "Ghost of Tsushima Director's Cut" },
  { id: 8, title: 'God of War Ragnarök' },
  { id: 9, title: 'PS Plus Deluxe' }
];
const slugFor = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

console.log('\nsmall rules');

ok('the tag is the most specific list', () => {
  assert.strictEqual(view.primaryTag(['catalog']), 'catalog');
  assert.strictEqual(view.primaryTag(['catalog', 'ubisoft']), 'ubisoft');
  assert.strictEqual(view.primaryTag(['classics']), 'classics');
  assert.strictEqual(view.primaryTag([]), 'catalog');
});

ok('genres and covers read well', () => {
  assert.strictEqual(view.prettyGenre(['ROLE_PLAYING_GAMES', 'ACTION']), 'Role Playing Games');
  assert.strictEqual(view.prettyGenre([]), '');
  assert.strictEqual(view.coverUrl(game(1, 'A', ['catalog']), 240), 'https://image.api.playstation.com/1.png?w=240');
  assert.strictEqual(view.coverUrl(game(1, 'A', ['catalog'], { cover_override: '/uploads/a.webp' }), 240), '/uploads/a.webp');
  assert.strictEqual(view.coverUrl({ image_url: '' }, 240), '');
});

console.log('\nresolveRentLink()');

ok('links automatically when the title is the same game', () => {
  const g = game(1, 'Ghost of Tsushima DIRECTOR’S CUT', ['catalog']);
  assert.strictEqual(view.resolveRentLink(g, SITE).id, 7);
  assert.strictEqual(view.resolveRentLink(game(2, 'God of War', ['catalog']), SITE), null);
});

ok("the owner's choice stands: a picked game, or none", () => {
  assert.strictEqual(view.resolveRentLink(game(2, 'God of War', ['catalog'], { rent_override: true, rent_game_id: 8 }), SITE).id, 8);
  assert.strictEqual(view.resolveRentLink(game(1, 'Ghost of Tsushima DIRECTOR’S CUT', ['catalog'], { rent_override: true, rent_game_id: null }), SITE), null);
});

ok('a link to a game that was deleted is no link', () => {
  assert.strictEqual(view.resolveRentLink(game(2, 'X', ['catalog'], { rent_override: true, rent_game_id: 404 }), SITE), null);
});

console.log('\nmonthlyTags()');

const ENTRIES = [
  { id: 1, year: 2026, month: 8, games_list: 'God of War Ragnarök\nStray' },
  { id: 2, year: 2026, month: 9, games_list: 'God of War Ragnarök PS4 & PS5\n\n  Wobbly Life  ' },
  { id: 3, year: 2025, month: 12, games_list: '' }
];

ok('a monthly line that is a catalog game tags it, newest month winning', () => {
  const r = view.monthlyTags(ENTRIES, [game(8, 'God of War Ragnarök', ['catalog'])]);
  assert.strictEqual(r.tagByKey.get('c:8'), 'SEP 2026');
});

ok('any other line becomes a tile, once', () => {
  const r = view.monthlyTags(ENTRIES, [game(8, 'God of War Ragnarök', ['catalog'])]);
  assert.deepStrictEqual(r.tiles.map(t => [t.name, t.label]), [['Wobbly Life', 'SEP 2026'], ['Stray', 'AUG 2026']]);
  assert.ok(r.tiles.every(t => /^mo:\d+:\d+$/.test(t.key)));
});

console.log('\nbuildPublicCatalog()');

const GAMES = [
  game(1, 'Ghost of Tsushima DIRECTOR’S CUT', ['catalog']),
  game(2, 'Ape Escape', ['classics'], { platforms: ['PS5', 'PS4'] }),
  game(3, "Assassin's Creed Origins", ['catalog', 'ubisoft'], { platforms: ['PS4'] }),
  game(4, 'Hidden Game', ['catalog'], { hidden: true, hidden_note: 'not on our region' }),
  game(8, 'God of War Ragnarök', ['catalog'], { cover_override: '/uploads/gow.webp' }),
  Object.assign({}, OWNER_DEFAULTS, { key: 'm:1', source: 'manual', name: 'Zeta Hand Added', name_raw: 'Zeta Hand Added', lists: ['catalog'],
    image_url: '', platforms: ['PS5'], genres: [], release_date: '', store_url: 'https://store.playstation.com/x', first_seen_at: '2026-09-27T01:00:00.000Z' })
];

ok('visible games and monthly tiles, A–Z, with the chip counts', () => {
  const c = view.buildPublicCatalog({ games: GAMES, siteGames: SITE, entries: ENTRIES, slugFor });
  assert.deepStrictEqual(c.items.map(i => i.n), ['Ape Escape', "Assassin's Creed Origins", 'Ghost of Tsushima DIRECTOR’S CUT', 'God of War Ragnarök', 'Stray', 'Wobbly Life', 'Zeta Hand Added']);
  assert.deepStrictEqual(c.counts, { all: 7, catalog: 4, classics: 1, ubisoft: 1, monthly: 3, rent: 2 });
});

ok('each item carries what the card and the sheet show', () => {
  const c = view.buildPublicCatalog({ games: GAMES, siteGames: SITE, entries: ENTRIES, slugFor });
  const ghost = c.items.find(i => i.k === 'c:1');
  assert.deepStrictEqual(ghost, {
    k: 'c:1', n: 'Ghost of Tsushima DIRECTOR’S CUT', i: 'https://image.api.playstation.com/1.png', c: '', p: ['PS5', 'PS4'],
    l: ['catalog'], t: 'catalog', m: '', g: 'Role Playing Games', r: '2020-07-17', f: '2026-09-20',
    s: 'https://store.playstation.com/en-id/concept/1', rent: { u: '/game/ghost-of-tsushima-director-s-cut', t: "Ghost of Tsushima Director's Cut" }
  });
  const gow = c.items.find(i => i.k === 'c:8');
  assert.deepStrictEqual([gow.i, gow.c, gow.m, gow.rent.u], ['', '/uploads/gow.webp', 'SEP 2026', '/game/god-of-war-ragnar-k']);
  assert.strictEqual(c.items.find(i => i.k === 'c:3').t, 'ubisoft');
  assert.strictEqual(c.items.find(i => i.k === 'm:1').s, '', 'a hand-added game has no PlayStation store link');
  const tile = c.items.find(i => i.n === 'Stray');
  assert.deepStrictEqual([tile.tile, tile.t, tile.m, tile.i, tile.rent], [true, 'monthly', 'AUG 2026', '', null]);
});

ok('a hidden game is nowhere on the customer page', () => {
  const c = view.buildPublicCatalog({ games: GAMES, siteGames: SITE, entries: [], slugFor });
  assert.ok(!c.items.some(i => i.k === 'c:4'));
});

ok('an empty list is an empty page, not an error', () => {
  assert.deepStrictEqual(view.buildPublicCatalog({ games: [], siteGames: [], entries: [], slugFor }).counts,
    { all: 0, catalog: 0, classics: 0, ubisoft: 0, monthly: 0, rent: 0 });
});

console.log('\nbuildAdminCatalog()');

ok('every game, hidden too, with the header counts', () => {
  const a = view.buildAdminCatalog({ games: GAMES, siteGames: SITE, entries: ENTRIES, meta: { last_refreshed_at: '2026-09-24T02:00:00.000Z' }, now: new Date('2026-09-27T05:00:00.000Z') });
  assert.strictEqual(a.rows.length, 6);
  assert.deepStrictEqual(a.counts, { catalog: 5, classics: 1, ubisoft: 1, monthly: 3, hidden: 1, rent: 2, manual: 1 });
  assert.deepStrictEqual([a.lastRefreshedAt, a.daysAgo], ['2026-09-24T02:00:00.000Z', 3]);
  const hidden = a.rows.find(r => r.k === 'c:4');
  assert.deepStrictEqual([hidden.h, hidden.hn, hidden.img], [true, 'not on our region', 'https://image.api.playstation.com/4.png?w=80']);
  const gow = a.rows.find(r => r.k === 'c:8');
  assert.deepStrictEqual([gow.co, gow.rt, gow.ro, gow.rg], [true, 'God of War Ragnarök', false, null]);
  assert.strictEqual(a.rows.find(r => r.k === 'm:1').man, true);
});

ok('never refreshed', () => {
  const a = view.buildAdminCatalog({ games: [], siteGames: [], entries: [], meta: {}, now: new Date() });
  assert.deepStrictEqual([a.lastRefreshedAt, a.daysAgo, a.rows.length], ['', null, 0]);
});

console.log('\npreviewView()');

ok('caps each column, counts the rest, and flags Most Played games that are leaving', () => {
  const many = Array.from({ length: 15 }, (_, i) => game(100 + i, 'New ' + i, ['catalog']));
  const preview = {
    applied: ['catalog', 'ubisoft'],
    safety: { catalog: { state: 'ok', stored: 5, incoming: 20 }, classics: { state: 'blocked', stored: 151, incoming: 0 }, ubisoft: { state: 'warn', stored: 67, incoming: 40 } },
    diff: { added: many, leaving: [game(1, 'Ghost of Tsushima DIRECTOR’S CUT', ['catalog']), game(2, 'Ape Escape', ['classics'])], updated: [{}, {}, {}], unchanged: 598 }
  };
  const v = view.previewView(preview, ["Ghost of Tsushima Director's Cut"], 12);
  assert.deepStrictEqual([v.added.length, v.addedMore, v.addedCount], [12, 3, 15]);
  assert.deepStrictEqual([v.leavingCount, v.leavingInMostPlayed, v.leaving[0].most, v.leaving[1].most], [2, 1, true, false]);
  assert.deepStrictEqual([v.updatedCount, v.unchanged, v.appliedCount], [3, 598, 2]);
  assert.deepStrictEqual(v.held.map(l => [l.list, l.state, l.label]), [['classics', 'blocked', 'Classics']]);
  assert.deepStrictEqual(v.warned.map(l => l.list), ['ubisoft']);
});

console.log('\nmonthSuggestion()');

ok("offers PlayStation's monthly games only when this month has no entry yet", () => {
  const names = ['Chained Echoes', 'Fallout 76'];
  assert.deepStrictEqual(view.monthSuggestion(names, ENTRIES, '2026-10-02'),
    { year: 2026, month: 10, monthName: 'October', names: ['Chained Echoes', 'Fallout 76'] });
  assert.strictEqual(view.monthSuggestion(names, ENTRIES, '2026-09-27'), null, 'September already has an entry');
  assert.strictEqual(view.monthSuggestion([], ENTRIES, '2026-10-02'), null, 'nothing to suggest');
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-psplus-catalog-view.js`
Expected: FAIL — `Cannot find module '../lib/psplus-catalog-view'`

- [ ] **Step 3: Write the module**

Create `lib/psplus-catalog-view.js`:

```js
// What the PS Plus Deluxe game list looks like to customers (/ps-plus, All
// Games tab) and to the owner (admin PS Plus tab): which tag a game carries,
// which of the owner's own games it links to, which month's Monthly tag it
// gets, and the compact rows both pages render from. Pure functions over what
// lib/psplus-catalog-store.js holds — nothing here reads or writes the store.
const { matchKey, STORED_LISTS } = require('./psplus-catalog');

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const LIST_LABELS = Object.freeze({ catalog: 'Game Catalog', classics: 'Classics', ubisoft: 'Ubisoft+ Classics' });

// The one tag on a card: the most specific list the game is in.
function primaryTag(lists) {
  const l = lists || [];
  if (l.includes('classics')) return 'classics';
  if (l.includes('ubisoft')) return 'ubisoft';
  return 'catalog';
}

// "ROLE_PLAYING_GAMES" → "Role Playing Games".
function prettyGenre(genres) {
  const g = (genres || [])[0];
  if (!g) return '';
  return String(g).toLowerCase().split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// The owner's own cover wins; otherwise PlayStation's, resized by its CDN.
function coverUrl(game, width) {
  if (game && game.cover_override) return game.cover_override;
  if (game && game.image_url) return game.image_url + '?w=' + width;
  return '';
}

// The owner's game this catalog game links to ("Also for rent"), or null.
// Automatic by default (same matchKey as the owner's game title); once the
// owner picks one — or "none" — in the admin, that choice stands.
function resolveRentLink(game, siteGames) {
  const list = Array.isArray(siteGames) ? siteGames : [];
  if (game.rent_override) {
    if (game.rent_game_id == null) return null;
    return list.find(g => g && String(g.id) === String(game.rent_game_id)) || null;
  }
  const k = matchKey(game.name || game.name_raw);
  if (!k) return null;
  return list.find(g => g && g.title && matchKey(g.title) === k) || null;
}

// The owner's month entries (lowdb 'psplus': { id, year, month, games_list })
// are the only source of Monthly tags. Each non-empty games_list line is one
// monthly game; the newest entry wins when a game appears in several. A line
// that matches a catalog game tags that game; any other line becomes a tile.
function monthlyTags(entries, games) {
  const byKey = new Map();
  (games || []).forEach(g => {
    const k = matchKey(g.name || g.name_raw);
    if (!k) return;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(g.key);
  });
  const newestFirst = [...(entries || [])].sort((a, b) => (b.year - a.year) || (b.month - a.month));
  const tagByKey = new Map();
  const tiles = [];
  const seen = new Set();
  newestFirst.forEach(entry => {
    const label = (MONTHS[(entry.month || 1) - 1] || '') + ' ' + entry.year;
    String(entry.games_list || '').split('\n').map(s => s.trim()).filter(Boolean).forEach((line, i) => {
      const k = matchKey(line);
      if (!k || seen.has(k)) return;
      seen.add(k);
      const keys = byKey.get(k);
      if (keys) keys.forEach(key => tagByKey.set(key, label));
      else tiles.push({ key: 'mo:' + entry.id + ':' + i, name: line, label });
    });
  });
  return { tagByKey, tiles };
}

const byName = (a, b) => a.n.localeCompare(b.n, 'en', { sensitivity: 'base' });

// The customer page payload: every visible game plus the monthly-only tiles,
// A–Z, in short keys (the page embeds it as JSON), with the chip counts.
//   k key · n name · i PlayStation cover (no size) · c owner cover · p platforms
//   l lists · t tag · m monthly label · g genre · r release date · f first seen
//   s store link · rent { u, t } · tile (monthly-only)
function buildPublicCatalog({ games, siteGames, entries, slugFor }) {
  const visible = (games || []).filter(g => g && !g.hidden);
  const monthly = monthlyTags(entries, visible);
  const items = visible.map(g => {
    const link = resolveRentLink(g, siteGames);
    return {
      k: g.key, n: g.name || g.name_raw || '', i: g.cover_override ? '' : (g.image_url || ''), c: g.cover_override || '',
      p: g.platforms || [], l: g.lists || [], t: primaryTag(g.lists), m: monthly.tagByKey.get(g.key) || '',
      g: prettyGenre(g.genres), r: g.release_date || '', f: String(g.first_seen_at || '').slice(0, 10),
      s: g.source === 'feed' ? (g.store_url || '') : '',
      rent: link ? { u: '/game/' + slugFor(link.title), t: link.title } : null
    };
  });
  monthly.tiles.forEach(t => items.push({
    k: t.key, n: t.name, i: '', c: '', p: [], l: [], t: 'monthly', m: t.label, g: '', r: '', f: '', s: '', rent: null, tile: true
  }));
  items.sort(byName);
  const counts = { all: items.length, catalog: 0, classics: 0, ubisoft: 0, monthly: 0, rent: 0 };
  items.forEach(it => {
    STORED_LISTS.forEach(l => { if (it.l.includes(l)) counts[l] += 1; });
    if (it.m) counts.monthly += 1;
    if (it.rent) counts.rent += 1;
  });
  return { items, counts };
}

// The admin table rows (every game, hidden too) and the header counts.
//   k key · n name · img cover (sized) · p platforms · t tag · h hidden · hn note
//   ro rent chosen by owner · rg chosen game id · rt linked title · man hand-added
//   co owner cover set
function buildAdminCatalog({ games, siteGames, entries, meta, now }) {
  const all = (games || []).filter(Boolean);
  const monthly = monthlyTags(entries, all.filter(g => !g.hidden));
  const rows = all.map(g => {
    const link = resolveRentLink(g, siteGames);
    return {
      k: g.key, n: g.name || g.name_raw || '', img: coverUrl(g, 80), p: g.platforms || [], t: primaryTag(g.lists),
      h: !!g.hidden, hn: g.hidden_note || '', ro: !!g.rent_override, rg: g.rent_game_id == null ? null : g.rent_game_id,
      rt: link ? link.title : '', man: g.source === 'manual', co: !!g.cover_override
    };
  }).sort(byName);
  const counts = { catalog: 0, classics: 0, ubisoft: 0, monthly: monthly.tagByKey.size + monthly.tiles.length, hidden: 0, rent: 0, manual: 0 };
  all.forEach(g => STORED_LISTS.forEach(l => { if ((g.lists || []).includes(l)) counts[l] += 1; }));
  rows.forEach(r => {
    if (r.h) counts.hidden += 1;
    if (r.rt) counts.rent += 1;
    if (r.man) counts.manual += 1;
  });
  const last = meta && meta.last_refreshed_at ? new Date(meta.last_refreshed_at) : null;
  const daysAgo = last && !isNaN(last) ? Math.max(0, Math.floor(((now || new Date()) - last) / 86400000)) : null;
  return { rows, counts, lastRefreshedAt: last && !isNaN(last) ? last.toISOString() : '', daysAgo };
}

// The Refresh preview, ready to render: at most `cap` games per column, and a
// leaving game flagged when it is also in the owner's Most Played list.
function previewView(preview, mostPlayedTitles, cap) {
  const most = new Set((mostPlayedTitles || []).map(matchKey).filter(Boolean));
  const card = g => ({ n: g.name || g.name_raw, img: coverUrl(g, 80), p: g.platforms || [], t: primaryTag(g.lists),
    most: most.has(matchKey(g.name || g.name_raw)) });
  const d = preview.diff;
  const lists = STORED_LISTS.map(l => Object.assign({ list: l, label: LIST_LABELS[l] }, preview.safety[l]));
  const held = lists.filter(l => l.state === 'failed' || l.state === 'blocked');
  return {
    lists, held, warned: lists.filter(l => l.state === 'warn'),
    added: d.added.slice(0, cap).map(card), addedMore: Math.max(0, d.added.length - cap), addedCount: d.added.length,
    leaving: d.leaving.slice(0, cap).map(card), leavingMore: Math.max(0, d.leaving.length - cap), leavingCount: d.leaving.length,
    leavingInMostPlayed: d.leaving.filter(g => most.has(matchKey(g.name || g.name_raw))).length,
    updatedCount: d.updated.length, unchanged: d.unchanged,
    appliedCount: preview.applied.length
  };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// PlayStation's monthly games, offered as a ready-made month entry — only when
// the owner has no entry for the current Manila month yet. `today` is the
// Manila date 'YYYY-MM-DD' (orders.manilaDate()).
function monthSuggestion(names, entries, today) {
  if (!names || !names.length) return null;
  const [year, month] = String(today || '').split('-').map(Number);
  if (!year || !month) return null;
  if ((entries || []).some(e => Number(e.year) === year && Number(e.month) === month)) return null;
  return { year, month, monthName: MONTH_NAMES[month - 1], names: names.slice() };
}

module.exports = {
  MONTHS, LIST_LABELS, primaryTag, prettyGenre, coverUrl, resolveRentLink, monthlyTags,
  buildPublicCatalog, buildAdminCatalog, previewView, monthSuggestion
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-psplus-catalog-view.js`
Expected: ends `15 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/psplus-catalog-view.js scripts/test-psplus-catalog-view.js
git commit -m "$(cat <<'EOF'
Add lib/psplus-catalog-view: what the PS Plus game list looks like

Card tags, the "Also for rent" link to the owner's own game, Monthly
tags from the owner's month entries, the customer payload with its chip
counts, the admin rows, the Refresh preview and the month suggestion.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The store — `lib/psplus-catalog-store.js`

**Files:**
- Create: `lib/psplus-catalog-store.js`
- Test: `scripts/test-psplus-catalog-store.js`

**Interfaces:**
- Consumes: Task 2 `OWNER_FIELDS`, `OWNER_DEFAULTS`, `STORED_LISTS`.
- Produces, from `lib/psplus-catalog-store.js`:
  - `init(getDb)`, where `getDb` is server.js's `_getMongoDb`. It resolves to a Db or null, and null means memory-only.
  - `isKey(key) → bool`, for `c:<n>` or `m:<n>`.
  - `load() → Promise<bool>`
  - `all() → game[]` (copies) and `get(key) → game|null`
  - `meta() → { last_refreshed_at, locale }`
  - `applyChanges({ upserts, removals, meta }) → Promise<true>`. It throws on a database error, and the cache is then untouched.
  - `setOwnerFields(key, patch) → Promise<bool>`. Only `OWNER_FIELDS` are written.
  - `addManual({ name, list, platforms, cover_override }, nowIso?) → Promise<game|null>`
  - `removeManual(key) → Promise<bool>` (`m:` keys only)
  - `_reset(games, meta)`, for tests only.
- Collections:
  - `psplus_catalog`, one document per game with `_id` = key;
  - `psplus_catalog_meta`, one document `{ _id: 'meta', last_refreshed_at, locale }`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-psplus-catalog-store.js`:

```js
// Run: node scripts/test-psplus-catalog-store.js
//
// lib/psplus-catalog-store.js against a fake MongoDB (just enough of find,
// findOne, bulkWrite, replaceOne, updateOne and deleteOne) and in memory-only
// mode. Checks the in-memory copy pages read from always matches what was
// written, that a failed write leaves it untouched, and that the owner-field
// route can't be used to change anything PlayStation sends.
const assert = require('assert');
const store = require('../lib/psplus-catalog-store');
const { OWNER_DEFAULTS } = require('../lib/psplus-catalog');

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

function fakeDb({ failWrites } = {}) {
  const cols = { psplus_catalog: new Map(), psplus_catalog_meta: new Map() };
  const fail = () => { if (failWrites) throw new Error('simulated MongoDB failure'); };
  const collection = name => {
    const docs = cols[name];
    return {
      find: () => ({ toArray: async () => [...docs.values()].map(d => Object.assign({}, d)) }),
      findOne: async f => { const d = docs.get(f._id); return d ? Object.assign({}, d) : null; },
      bulkWrite: async ops => {
        fail();
        ops.forEach(op => {
          if (op.replaceOne) docs.set(op.replaceOne.filter._id, Object.assign({}, op.replaceOne.replacement));
          if (op.deleteOne) docs.delete(op.deleteOne.filter._id);
        });
      },
      replaceOne: async (f, doc) => { fail(); docs.set(f._id, Object.assign({}, doc)); },
      updateOne: async (f, u) => {
        fail();
        const d = docs.get(f._id);
        if (!d) return { matchedCount: 0 };
        Object.assign(d, u.$set);
        return { matchedCount: 1 };
      },
      deleteOne: async f => { fail(); docs.delete(f._id); }
    };
  };
  return { db: { collection }, cols };
}

function game(id, name, extra) {
  return Object.assign({}, OWNER_DEFAULTS, { key: 'c:' + id, source: 'feed', concept_id: String(id), name, name_raw: name,
    lists: ['catalog'], image_url: 'https://image.api.playstation.com/' + id + '.png', platforms: ['PS5'], genres: [],
    release_date: '', store_url: '', first_seen_at: '2026-09-27T00:00:00.000Z', updated_at: '2026-09-27T00:00:00.000Z' }, extra || {});
}

(async () => {
  console.log('\nwith MongoDB');

  await okAsync('refuses to run before init()', async () => {
    store.init(null);
    await assert.rejects(() => store.load(), /init\(getDb\) was never called/);
  });

  await okAsync('Apply writes, and the in-memory copy follows', async () => {
    const { db, cols } = fakeDb();
    store.init(async () => db);
    store._reset([]);
    await store.applyChanges({ upserts: [game(1, 'A'), game(2, 'B')], removals: [], meta: { last_refreshed_at: '2026-09-27T05:00:00.000Z', locale: 'en-id' } });
    assert.deepStrictEqual(store.all().map(g => g.key).sort(), ['c:1', 'c:2']);
    assert.strictEqual(cols.psplus_catalog.get('c:1')._id, 'c:1');
    assert.deepStrictEqual(store.meta(), { last_refreshed_at: '2026-09-27T05:00:00.000Z', locale: 'en-id' });
    await store.applyChanges({ upserts: [game(2, 'B2')], removals: ['c:1'] });
    assert.deepStrictEqual(store.all().map(g => [g.key, g.name]), [['c:2', 'B2']]);
    assert.ok(!cols.psplus_catalog.has('c:1'));
    assert.strictEqual(store.meta().locale, 'en-id', 'meta kept when a write carries none');
  });

  await okAsync('load() fills the in-memory copy from the database', async () => {
    const { db, cols } = fakeDb();
    cols.psplus_catalog.set('c:5', Object.assign({ _id: 'c:5' }, game(5, 'Loaded')));
    cols.psplus_catalog_meta.set('meta', { _id: 'meta', last_refreshed_at: '2026-09-20T00:00:00.000Z', locale: 'en-id' });
    store.init(async () => db);
    store._reset([]);
    assert.strictEqual(await store.load(), true);
    assert.deepStrictEqual(store.all().map(g => g.key), ['c:5']);
    assert.ok(!('_id' in store.all()[0]));
    assert.strictEqual(store.meta().last_refreshed_at, '2026-09-20T00:00:00.000Z');
  });

  await okAsync('a failed write leaves the in-memory copy untouched', async () => {
    const { db } = fakeDb({ failWrites: true });
    store.init(async () => db);
    store._reset([game(1, 'A')]);
    await assert.rejects(() => store.applyChanges({ upserts: [game(2, 'B')], removals: ['c:1'] }), /simulated/);
    assert.deepStrictEqual(store.all().map(g => g.key), ['c:1']);
    await assert.rejects(() => store.setOwnerFields('c:1', { hidden: true }), /simulated/);
    assert.strictEqual(store.get('c:1').hidden, false);
  });

  await okAsync('owner fields only — nothing PlayStation sends can be changed', async () => {
    const { db, cols } = fakeDb();
    store.init(async () => db);
    store._reset([]);
    await store.applyChanges({ upserts: [game(1, 'A')], removals: [] });
    assert.strictEqual(await store.setOwnerFields('c:1', { hidden: true, hidden_note: 'not on our region', name: 'Hacked', image_url: 'x' }), true);
    const g = store.get('c:1');
    assert.deepStrictEqual([g.hidden, g.hidden_note, g.name, g.image_url], [true, 'not on our region', 'A', 'https://image.api.playstation.com/1.png']);
    assert.strictEqual(cols.psplus_catalog.get('c:1').name, 'A');
    assert.strictEqual(await store.setOwnerFields('c:1', { name: 'Hacked' }), false, 'a patch with no owner field does nothing');
    assert.strictEqual(await store.setOwnerFields('c:99', { hidden: true }), false, 'no such game');
    assert.strictEqual(await store.setOwnerFields('../etc', { hidden: true }), false, 'not a key');
  });

  await okAsync('games added by hand get their own keys and can be removed; PlayStation games cannot', async () => {
    const { db, cols } = fakeDb();
    store.init(async () => db);
    store._reset([game(1, 'A')]);
    const a = await store.addManual({ name: '  My Game ', list: 'classics', platforms: ['PS4', 'PS5'], cover_override: '/uploads/m.webp' }, '2026-09-27T06:00:00.000Z');
    const b = await store.addManual({ name: 'Second', list: 'catalog', platforms: [] });
    assert.deepStrictEqual([a.key, a.name, a.lists, a.platforms, a.source, a.cover_override, a.first_seen_at],
      ['m:1', 'My Game', ['classics'], ['PS5', 'PS4'], 'manual', '/uploads/m.webp', '2026-09-27T06:00:00.000Z']);
    assert.strictEqual(b.key, 'm:2');
    assert.ok(cols.psplus_catalog.has('m:1'));
    assert.strictEqual(await store.addManual({ name: '', list: 'catalog' }), null);
    assert.strictEqual(await store.addManual({ name: 'X', list: 'monthly' }), null);
    assert.strictEqual(await store.removeManual('m:1'), true);
    assert.strictEqual(await store.removeManual('c:1'), false);
    assert.strictEqual(await store.removeManual('m:77'), false);
    assert.deepStrictEqual(store.all().map(g => g.key).sort(), ['c:1', 'm:2']);
  });

  console.log('\nwithout MongoDB (local dev)');

  await okAsync('everything works from memory alone', async () => {
    store.init(async () => null);
    store._reset([]);
    assert.strictEqual(await store.load(), false);
    await store.applyChanges({ upserts: [game(1, 'A')], removals: [], meta: { last_refreshed_at: 'x', locale: 'en-id' } });
    assert.strictEqual(await store.setOwnerFields('c:1', { rent_override: true, rent_game_id: 7 }), true);
    assert.deepStrictEqual([store.get('c:1').rent_game_id, store.meta().locale], [7, 'en-id']);
    assert.ok(store.isKey('c:12') && store.isKey('m:3') && !store.isKey('mo:1:0') && !store.isKey('c:1;x'));
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-psplus-catalog-store.js`
Expected: FAIL — `Cannot find module '../lib/psplus-catalog-store'`

- [ ] **Step 3: Write the module**

Create `lib/psplus-catalog-store.js`:

```js
// Where the PS Plus Deluxe game list lives: its own MongoDB collection, one
// document per game, NOT the lowdb blob — server.js rewrites that blob in
// full on every save of anything, and ~500 games would add ~250 KB to every
// customer edit for data that changes about once a month.
//
// Pages read from an in-memory copy (all()), filled once at boot by load() and
// updated only after a write succeeds. With no MONGODB_URI (local dev) the
// store runs from memory alone.
//
//   psplus_catalog       { _id: key, key, source: 'feed'|'manual', …game }
//   psplus_catalog_meta  { _id: 'meta', last_refreshed_at, locale }
const { OWNER_FIELDS, OWNER_DEFAULTS, STORED_LISTS } = require('./psplus-catalog');

const KEY_RE = /^(c|m):\d+$/;

let _getDb = null;
let _cache = [];
let _meta = { last_refreshed_at: '', locale: '' };

function init(getDbFn) { _getDb = getDbFn; }

async function _db() {
  if (!_getDb) throw new Error('lib/psplus-catalog-store: init(getDb) was never called');
  return _getDb();
}

function isKey(key) { return KEY_RE.test(String(key || '')); }

function _fromDoc(doc) {
  const g = Object.assign({}, doc);
  delete g._id;
  return g;
}
function _toDoc(game) { return Object.assign({ _id: game.key }, game); }

function _setCache(games) { _cache = games.map(g => Object.assign({}, g)); }

async function load() {
  const db = await _db();
  if (!db) return false;
  const docs = await db.collection('psplus_catalog').find({}).toArray();
  const meta = await db.collection('psplus_catalog_meta').findOne({ _id: 'meta' });
  _setCache(docs.map(_fromDoc));
  if (meta) _meta = { last_refreshed_at: meta.last_refreshed_at || '', locale: meta.locale || '' };
  return true;
}

function all() { return _cache.map(g => Object.assign({}, g)); }
function get(key) { const g = _cache.find(x => x.key === key); return g ? Object.assign({}, g) : null; }
function meta() { return Object.assign({}, _meta); }

// A refresh's Apply: upsert whole documents, delete the leavers, record when.
// Throws if the database write fails, in which case the cache is untouched.
async function applyChanges({ upserts, removals, meta }) {
  const ups = upserts || [];
  const rem = removals || [];
  const db = await _db();
  if (db) {
    const ops = ups.map(g => ({ replaceOne: { filter: { _id: g.key }, replacement: _toDoc(g), upsert: true } }))
      .concat(rem.map(key => ({ deleteOne: { filter: { _id: key } } })));
    if (ops.length) await db.collection('psplus_catalog').bulkWrite(ops, { ordered: false });
    if (meta) {
      await db.collection('psplus_catalog_meta').replaceOne({ _id: 'meta' }, Object.assign({ _id: 'meta' }, meta), { upsert: true });
    }
  }
  const byKey = new Map(_cache.map(g => [g.key, g]));
  rem.forEach(key => byKey.delete(key));
  ups.forEach(g => byKey.set(g.key, Object.assign({}, g)));
  _cache = [...byKey.values()];
  if (meta) _meta = { last_refreshed_at: meta.last_refreshed_at || '', locale: meta.locale || '' };
  return true;
}

// The owner's own choices on one game. Only OWNER_FIELDS are ever written, so
// nothing PlayStation sends can be changed from here. False when there is no
// such game.
async function setOwnerFields(key, patch) {
  if (!isKey(key)) return false;
  const current = _cache.find(g => g.key === key);
  if (!current) return false;
  const clean = {};
  OWNER_FIELDS.forEach(f => { if (patch && f in patch) clean[f] = patch[f]; });
  if (!Object.keys(clean).length) return false;
  const db = await _db();
  if (db) {
    const r = await db.collection('psplus_catalog').updateOne({ _id: key }, { $set: clean });
    if (!r || r.matchedCount === 0) return false;
  }
  Object.assign(current, clean);
  return true;
}

// A game on the owner's accounts that PlayStation's feed doesn't list.
// Refreshes never touch it. Returns the stored game.
async function addManual({ name, list, platforms, cover_override }, nowIso) {
  const title = String(name || '').trim();
  if (!title || !STORED_LISTS.includes(list)) return null;
  const next = _cache.filter(g => /^m:\d+$/.test(g.key)).reduce((n, g) => Math.max(n, Number(g.key.slice(2))), 0) + 1;
  const now = nowIso || new Date().toISOString();
  const game = Object.assign({}, OWNER_DEFAULTS, {
    key: 'm:' + next, source: 'manual', concept_id: '', name: title, name_raw: title, lists: [list],
    image_url: '', platforms: ['PS5', 'PS4'].filter(p => (platforms || []).includes(p)), genres: [], release_date: '',
    store_url: '', first_seen_at: now, updated_at: now, cover_override: cover_override || ''
  });
  const db = await _db();
  if (db) await db.collection('psplus_catalog').replaceOne({ _id: game.key }, _toDoc(game), { upsert: true });
  _cache.push(Object.assign({}, game));
  return Object.assign({}, game);
}

// Only hand-added games can be removed by hand; PlayStation's leave on refresh.
async function removeManual(key) {
  if (!/^m:\d+$/.test(String(key || ''))) return false;
  if (!_cache.some(g => g.key === key)) return false;
  const db = await _db();
  if (db) await db.collection('psplus_catalog').deleteOne({ _id: key });
  _cache = _cache.filter(g => g.key !== key);
  return true;
}

// Tests only: start from a known state.
function _reset(games, metaDoc) {
  _setCache(games || []);
  _meta = Object.assign({ last_refreshed_at: '', locale: '' }, metaDoc || {});
}

module.exports = { init, isKey, load, all, get, meta, applyChanges, setOwnerFields, addManual, removeManual, _reset };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-psplus-catalog-store.js`
Expected: ends `7 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/psplus-catalog-store.js scripts/test-psplus-catalog-store.js
git commit -m "$(cat <<'EOF'
Add lib/psplus-catalog-store: the PS Plus game list's own collection

One MongoDB document per game with an in-memory copy for pages, kept
out of the lowdb blob that is rewritten on every save. Owner edits can
only touch owner fields; memory-only without MONGODB_URI.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Admin — refresh, preview, Apply and owner choices

**Files:**
- Modify: `server.js` (CRLF + BOM, **Edit tool only**)
- Create: `views/partials/admin/psplus/catalog.ejs`
- Modify: `views/partials/admin/psplus.ejs` (LF)
- Modify: `views/admin.ejs` (LF)
- Test: `scripts/test-psplus-admin-catalog.js`

**Interfaces:**
- Consumes:
  - Task 1 `fetchAll`, `FEED_LOCALE`;
  - Task 2 `STORED_LISTS`, `buildPreview`, `applyPlan`;
  - Task 3 `buildAdminCatalog`, `previewView`, `monthSuggestion`;
  - Task 4 `init`, `load`, `all`, `meta`, `applyChanges`, `setOwnerFields`, `addManual`, `removeManual`.
- Produces:
  - `server.js` module-level names used by Tasks 6–7: `psplusFeed`, `psplusCatalog`, `psplusCatalogView`, `psplusCatalogStore`.
  - Routes, all POST and all `requireAuth` + `asyncRoute`:
    - `/admin/psplus/catalog/refresh` → redirect `/admin?tab=psplus&catalog_preview=<token>` or `catalog_unreachable`;
    - `/apply` (body `token`);
    - `/cancel` (body `token`);
    - `/add` (multipart: `name`, `list`, `platforms[]`, `cover_image`);
    - `/:key/visibility` (`hidden` `'1'`/`'0'`, `note`);
    - `/:key/rent-link` (`rent`: `auto`|`none`|<game id>);
    - `/:key/cover` (multipart `cover_image`, or `reset=1`);
    - `/:key/remove`.
  - Admin render local `psplusCatalog`.
  - The Add Monthly form gets id `psplusAddMonthForm`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-psplus-admin-catalog.js`:

```js
// Run: node scripts/test-psplus-admin-catalog.js
//
// Admin PS Plus tab → 🎮 PS Plus Deluxe game list. Renders the real partial
// (views/partials/admin/psplus/catalog.ejs, inside views/partials/admin/psplus.ejs)
// from lib/psplus-catalog-view.js output in its three states — normal, a
// Refresh preview, a preview with a list held back — and checks at source
// level that server.js wires every route behind requireAuth and asyncRoute,
// feeds the partial, and that every toast opens the PS Plus tab.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const view = require('../lib/psplus-catalog-view');
const { OWNER_DEFAULTS } = require('../lib/psplus-catalog');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const SHELL = path.join(ROOT, 'views', 'partials', 'admin', 'psplus.ejs');

function game(id, name, lists, extra) {
  return Object.assign({}, OWNER_DEFAULTS, { key: 'c:' + id, source: 'feed', concept_id: String(id), name, name_raw: name, lists,
    image_url: 'https://image.api.playstation.com/' + id + '.png', platforms: ['PS5', 'PS4'], genres: [], release_date: '',
    store_url: '', first_seen_at: '2026-09-20T00:00:00.000Z', updated_at: '2026-09-20T00:00:00.000Z' }, extra || {});
}
const GAMES = [
  game(1, 'God of War Ragnarök', ['catalog']),
  game(2, 'Ape Escape', ['classics'], { hidden: true, hidden_note: 'not on our region' }),
  game(3, '</script><script>alert(1)</script>', ['catalog'])
];
const SITE = [{ id: 8, title: 'God of War Ragnarök' }];
const NOW = new Date('2026-09-27T05:00:00.000Z');

function catalogLocal(extra) {
  return Object.assign(view.buildAdminCatalog({ games: GAMES, siteGames: SITE, entries: [], meta: { last_refreshed_at: '2026-09-24T02:00:00.000Z' }, now: NOW }),
    { preview: null, previewToken: '', previewExpired: false, monthSuggestion: null, siteGames: SITE }, extra || {});
}
function render(psplusCatalog) {
  return ejs.render(fs.readFileSync(SHELL, 'utf8'), {
    psplusCatalog, psplus: [], psplusPopular: [], psplusPrices: { nt_price_7d: 99, nt_price_30d: 249, tr_price_7d: 149, tr_price_30d: 299 }
  }, { filename: SHELL });
}
function preview(safety, diffExtra) {
  const many = Array.from({ length: 14 }, (_, i) => game(100 + i, 'New Game ' + i, ['catalog']));
  return view.previewView({
    applied: Object.keys(safety).filter(l => safety[l].state === 'ok' || safety[l].state === 'warn'),
    safety,
    diff: Object.assign({ added: many, leaving: [game(1, 'God of War Ragnarök', ['catalog'])], updated: [{}], unchanged: 500 }, diffExtra || {})
  }, ['God of War Ragnarök'], 12);
}
const OK3 = { catalog: { state: 'ok', stored: 388, incoming: 390 }, classics: { state: 'ok', stored: 151, incoming: 151 }, ubisoft: { state: 'ok', stored: 67, incoming: 67 } };

console.log('\nnormal state');

ok('sits at the top of the PS Plus tab, with Refresh and Add by hand', () => {
  const html = render(catalogLocal());
  const card = html.indexOf('id="psplusCatalog"');
  assert.ok(card > 0 && card < html.indexOf('Add Most Played PS Plus Game'), 'the card comes first in the tab');
  assert.ok(html.includes('action="/admin/psplus/catalog/refresh"'));
  assert.ok(html.includes('🔄 Refresh from PlayStation'));
  assert.ok(html.includes('action="/admin/psplus/catalog/add"'));
  assert.ok(html.includes('From PlayStation (Indonesia)'));
  assert.ok(html.includes('last refreshed <b>Sep 24, 2026</b> (3 days ago)'));
});

ok('shows the counts', () => {
  const html = render(catalogLocal());
  assert.ok(html.includes('<b>2</b><span>Game Catalog</span>'));
  assert.ok(html.includes('<b>1</b><span>Classics</span>'));
  assert.ok(html.includes('<b>1</b><span>Hidden by you</span>'));
  assert.ok(html.includes('<b>1</b><span>Also for rent</span>'));
});

ok('the rows travel as JSON the page can never be broken out of', () => {
  const html = render(catalogLocal());
  const m = /<script type="application\/json" id="ppcaData">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'data block present');
  assert.ok(!m[1].includes('</script'), 'a title cannot close the script tag');
  const data = JSON.parse(m[1]);
  assert.strictEqual(data.rows.length, 3);
  assert.deepStrictEqual(data.games, SITE);
  assert.ok(data.rows.some(r => r.n === '</script><script>alert(1)</script>'));
});

ok('the monthly form below has the id the suggestion button fills', () => {
  assert.ok(render(catalogLocal()).includes('id="psplusAddMonthForm"'));
});

ok('never refreshed, nothing stored', () => {
  const html = render(Object.assign(view.buildAdminCatalog({ games: [], siteGames: [], entries: [], meta: {}, now: NOW }),
    { preview: null, previewToken: '', previewExpired: false, monthSuggestion: null, siteGames: [] }));
  assert.ok(html.includes('never refreshed'));
  assert.ok(html.includes('No games yet.'));
  assert.ok(!html.includes('id="ppcaRows"'));
});

ok('an expired preview says so', () => {
  assert.ok(render(catalogLocal({ previewExpired: true })).includes('That preview expired'));
});

console.log('\nRefresh preview');

ok('pills, capped columns and the Most Played warning', () => {
  const html = render(catalogLocal({ preview: preview(OK3), previewToken: 'abc123' }));
  assert.ok(html.includes('+ 14 new'));
  assert.ok(html.includes('− 1 leaving'));
  assert.ok(html.includes('1 updated (cover or name)'));
  assert.ok(html.includes('500 unchanged'));
  assert.ok(html.includes('+ 2 more…'));
  assert.ok(html.includes("⚠ it's in your Most Played list"));
  assert.ok(html.includes('nothing is saved until you press Apply'));
});

ok('Apply and Cancel carry the preview token', () => {
  const html = render(catalogLocal({ preview: preview(OK3), previewToken: 'abc123' }));
  assert.ok(/action="\/admin\/psplus\/catalog\/apply"[\s\S]*?name="token" value="abc123"[\s\S]*?Apply changes/.test(html));
  assert.ok(/action="\/admin\/psplus\/catalog\/cancel"[\s\S]*?name="token" value="abc123"/.test(html));
});

ok('a blocked list is explained, and Apply names the lists that look OK', () => {
  const safety = { catalog: { state: 'warn', stored: 388, incoming: 270 }, classics: { state: 'blocked', stored: 151, incoming: 0 }, ubisoft: { state: 'ok', stored: 67, incoming: 67 } };
  const html = render(catalogLocal({ preview: preview(safety), previewToken: 't' }));
  assert.ok(html.includes('Classics came back with 0 games'));
  assert.ok(html.includes('(you have 151)'));
  assert.ok(html.includes('It was <b>not</b> applied'));
  assert.ok(html.includes('Game Catalog lost 30% of its games at once'));
  assert.ok(html.includes('(388 → 270)'));
  assert.ok(html.includes('Apply the 2 lists that look OK'));
});

ok('no Apply button when every list was held back', () => {
  const safety = { catalog: { state: 'failed', stored: 388, incoming: 0 }, classics: { state: 'blocked', stored: 151, incoming: 0 }, ubisoft: { state: 'failed', stored: 67, incoming: 0 } };
  const html = render(catalogLocal({ preview: preview(safety, { added: [], leaving: [], updated: [], unchanged: 0 }), previewToken: 't' }));
  assert.ok(!html.includes('action="/admin/psplus/catalog/apply"'));
  assert.ok(html.includes('Game Catalog couldn&#39;t be read from PlayStation'));
});

ok("PlayStation's monthly games offered as next month's entry", () => {
  const html = render(catalogLocal({ preview: preview(OK3), previewToken: 't',
    monthSuggestion: { year: 2026, month: 10, monthName: 'October', names: ['Chained Echoes', 'Fallout 76'] } }));
  assert.ok(html.includes("PlayStation's monthly games for <b>October 2026</b>: Chained Echoes, Fallout 76."));
  assert.ok(html.includes('data-year="2026" data-month="10" data-games="Chained Echoes\nFallout 76"'));
  assert.ok(html.includes('Create Oct 2026 entry from these'));
});

console.log('\nwiring');

const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
function block(startMarker) {
  const i = SRC.indexOf(startMarker);
  assert.ok(i >= 0, 'server.js still has ' + startMarker);
  const next = SRC.indexOf('\napp.', i + startMarker.length);
  return SRC.slice(i, next > 0 ? next : undefined);
}

ok('server.js loads the libs and the store at boot', () => {
  ["require('./lib/psplus-feed')", "require('./lib/psplus-catalog')", "require('./lib/psplus-catalog-view')", "require('./lib/psplus-catalog-store')",
    'psplusCatalogStore.init(_getMongoDb);', 'psplusCatalogStore.load()'].forEach(s => assert.ok(SRC.includes(s), s));
});

ok('every catalog route is admin-only and wrapped', () => {
  ['refresh', 'apply', 'cancel', 'add', ':key/visibility', ':key/rent-link', ':key/cover', ':key/remove'].forEach(r => {
    const b = block("app.post('/admin/psplus/catalog/" + r + "', requireAuth,");
    assert.ok(b.includes('asyncRoute(async'), r + ' is wrapped');
  });
});

ok('Apply re-plans against what is stored now and stamps the refresh', () => {
  const b = block("app.post('/admin/psplus/catalog/apply', requireAuth,");
  assert.ok(b.includes('psplusCatalog.applyPlan(psplusCatalogStore.all(), entry.preview.incoming, entry.preview.applied, nowIso)'));
  assert.ok(b.includes('last_refreshed_at: nowIso'));
  assert.ok(b.includes("catalog_expired") && b.includes("catalog_nothing") && b.includes("catalog_error") && b.includes("catalog_applied"));
});

ok('the admin page gets the catalog', () => {
  assert.ok(SRC.includes('psplusSlots: getPsplusSlots(), psplusCatalog: psplusCatalogAdmin,'));
  assert.ok(SRC.includes('psplusCatalogView.buildAdminCatalog({'));
});

ok('every toast exists and opens the PS Plus tab', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'views', 'admin.ejs'), 'utf8');
  ['catalog_applied', 'catalog_expired', 'catalog_unreachable', 'catalog_nothing', 'catalog_saved', 'catalog_error'].forEach(m => {
    assert.ok(admin.includes(m + ":'psplus'"), m + ' tab');
    assert.ok(new RegExp(m + ":'[^']*[^:]'").test(admin.replace(m + ":'psplus'", '')), m + ' text');
  });
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-psplus-admin-catalog.js`
Expected: FAIL on the first check, `sits at the top of the PS Plus tab, with Refresh and Add by hand` (there is no card yet).

- [ ] **Step 3: Create the admin card**

Create `views/partials/admin/psplus/catalog.ejs`:

```ejs
<%#
  Admin PS Plus tab → 🎮 PS Plus Deluxe game list. The full Deluxe catalog
  from PlayStation's game-finder feed (lib/psplus-feed.js). "Refresh from
  PlayStation" only builds a preview (+new / −leaving / updated, per-list
  safety checks); nothing is saved until Apply. The owner's own choices —
  hide, "Also for rent" link, own cover, games added by hand — survive every
  refresh (lib/psplus-catalog.js applyPlan).

  Locals: psplusCatalog, built by the /admin route from
  lib/psplus-catalog-view.js buildAdminCatalog() plus { preview, previewToken,
  previewExpired, monthSuggestion, siteGames }.
%>
<%
  const pc = (typeof psplusCatalog !== 'undefined' && psplusCatalog) ? psplusCatalog : null;
  const PPCA_TAG = { catalog: 'CATALOG', classics: 'CLASSIC', ubisoft: 'UBISOFT+' };
  const ppcaWhen = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
  const ppcaAgo = n => n === 0 ? 'today' : n === 1 ? '1 day ago' : n + ' days ago';
%>
<% if (pc) { %>
<style>
  .ppca { padding:0 !important; overflow:hidden; }
  .ppca-head { display:flex; justify-content:space-between; align-items:center; gap:0.75rem; flex-wrap:wrap; padding:1rem 1.15rem; border-left:3px solid #FFD700; background:#111; }
  .ppca-head h2 { margin:0 !important; padding:0 !important; border:0 !important; font-size:1rem; }
  .ppca-sub { font-size:0.78rem; color:#777; margin-top:0.2rem; }
  .ppca-sub b { color:#ccc; }
  .ppca-actions { display:flex; gap:0.5rem; flex-wrap:wrap; }
  .ppca-body { padding:1rem 1.15rem; }
  .ppca-btn { border-radius:8px; padding:0.5rem 0.9rem; font-weight:800; font-size:0.8rem; cursor:pointer; font-family:inherit; border:1px solid transparent; white-space:nowrap; }
  .ppca-gold { background:#FFD700; color:#000; }
  .ppca-green { background:#16a34a; color:#fff; }
  .ppca-ghost { background:#161616; color:#ccc; border-color:#2e2e2e; }
  .ppca-purple { background:#1a0f29; color:#e9d5ff; border-color:#6b21a8; }
  .ppca-btn:disabled { opacity:0.6; cursor:wait; }
  .ppca-stats { display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.9rem; }
  .ppca-stat { background:#141414; border:1px solid #242424; border-radius:10px; padding:0.45rem 0.75rem; min-width:88px; }
  .ppca-stat b { display:block; font-size:1.05rem; color:#fff; }
  .ppca-stat span { font-size:0.65rem; color:#888; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; }
  .ppca-stat.red { border-color:#3f1d1d; } .ppca-stat.red b { color:#f87171; }
  .ppca-stat.green { border-color:#14532d; } .ppca-stat.green b { color:#4ade80; }
  .ppca-preview { border:1px solid #2a2a2a; border-radius:12px; padding:0.9rem 1rem; margin-bottom:1rem; background:#0d0d0d; }
  .ppca-preview-title { font-weight:800; margin-bottom:0.6rem; }
  .ppca-preview-title span { font-weight:400; color:#777; font-size:0.8rem; }
  .ppca-bad { background:#1f0808; border:1px solid #7f1d1d; color:#fca5a5; border-radius:10px; padding:0.55rem 0.7rem; font-size:0.8rem; margin-bottom:0.5rem; }
  .ppca-warn { background:#1f1405; border:1px solid #713f12; color:#fcd34d; border-radius:10px; padding:0.55rem 0.7rem; font-size:0.8rem; margin-bottom:0.5rem; }
  .ppca-pills { display:flex; gap:0.4rem; flex-wrap:wrap; margin:0.3rem 0 0.8rem; }
  .ppca-pill { font-weight:800; font-size:0.75rem; border-radius:50px; padding:0.25rem 0.65rem; border:1px solid; }
  .ppca-p-add { background:rgba(34,197,94,.12); color:#4ade80; border-color:rgba(34,197,94,.3); }
  .ppca-p-rem { background:rgba(239,68,68,.12); color:#f87171; border-color:rgba(239,68,68,.3); }
  .ppca-p-chg { background:rgba(96,165,250,.12); color:#93c5fd; border-color:rgba(96,165,250,.3); }
  .ppca-p-same { background:#161616; color:#888; border-color:#262626; }
  .ppca-cols { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:0.9rem; }
  .ppca-cols h4 { margin:0 0 0.35rem; font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em; color:#888; }
  .ppca-it { display:flex; align-items:center; gap:0.55rem; padding:0.3rem 0; border-top:1px solid #1a1a1a; }
  .ppca-it:first-of-type { border-top:0; }
  .ppca-it img, .ppca-ph { width:32px; height:32px; border-radius:6px; object-fit:cover; flex:none; background:#222; display:block; }
  .ppca-n { font-weight:700; font-size:0.8rem; color:#eee; }
  .ppca-m { font-size:0.7rem; color:#777; }
  .ppca-none { font-size:0.8rem; color:#555; padding:0.3rem 0; }
  .ppca-tag { font-size:0.55rem; font-weight:900; padding:1px 5px; border-radius:3px; margin-left:0.3rem; vertical-align:1px; }
  .ppca-tag-catalog { background:#FFD700; color:#000; }
  .ppca-tag-classics { background:#38bdf8; color:#00111a; }
  .ppca-tag-ubisoft { background:#e2e8f0; color:#0f172a; }
  .ppca-month { background:#140a20; border:1px solid #33204d; color:#e9d5ff; border-radius:10px; padding:0.6rem 0.75rem; display:flex; justify-content:space-between; align-items:center; gap:0.6rem; flex-wrap:wrap; font-size:0.8rem; margin-top:0.8rem; }
  .ppca-foot { display:flex; gap:0.5rem; justify-content:flex-end; flex-wrap:wrap; margin-top:0.8rem; }
  .ppca-addbox { border:1px dashed #2e2e2e; border-radius:10px; padding:0.6rem 0.8rem; margin-bottom:0.9rem; }
  .ppca-addbox summary { cursor:pointer; font-weight:700; font-size:0.85rem; color:#ccc; }
  .ppca-addform { display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center; margin-top:0.6rem; font-size:0.8rem; }
  .ppca-addform input[type=text] { flex:1 1 220px; }
  .ppca-note { font-size:0.72rem; color:#666; margin:0.5rem 0 0; }
  .ppca-toolbar { display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; margin-bottom:0.5rem; }
  .ppca-toolbar input[type=search] { flex:1 1 220px; background:#141414; border:1px solid #2a2a2a; color:#ddd; border-radius:8px; padding:0.45rem 0.7rem; font-size:0.8rem; }
  .ppca-chips { display:flex; gap:0.3rem; flex-wrap:wrap; }
  .ppca-chip { font-size:0.72rem; font-weight:700; padding:0.25rem 0.65rem; border-radius:50px; border:1px solid #2e2e2e; color:#999; background:none; cursor:pointer; font-family:inherit; }
  .ppca-chip.on { background:#fff; color:#000; border-color:#fff; }
  .ppca-table { width:100%; border-collapse:collapse; font-size:0.8rem; }
  .ppca-table th { text-align:left; font-size:0.65rem; color:#666; text-transform:uppercase; letter-spacing:0.04em; padding:0.4rem; border-bottom:1px solid #1f1f1f; }
  .ppca-table td { padding:0.4rem; border-bottom:1px solid #161616; vertical-align:middle; }
  .ppca-table img { width:34px; height:34px; border-radius:6px; object-fit:cover; display:block; }
  .ppca-table tr.ppca-off td { opacity:0.55; }
  .ppca-sel { background:#141414; border:1px solid #2a2a2a; color:#bbb; border-radius:6px; padding:0.2rem 0.35rem; font-size:0.75rem; max-width:220px; }
  .ppca-tog { width:34px; height:19px; border-radius:20px; background:#16a34a; border:0; position:relative; cursor:pointer; }
  .ppca-tog::after { content:''; position:absolute; top:2px; right:2px; width:15px; height:15px; border-radius:50%; background:#fff; }
  .ppca-tog.off { background:#333; }
  .ppca-tog.off::after { right:auto; left:2px; }
  .ppca-acts { white-space:nowrap; }
  .ppca-link { background:none; border:0; color:#888; font-size:0.72rem; cursor:pointer; padding:0.1rem 0.3rem; font-family:inherit; text-decoration:underline; }
  .ppca-danger { color:#f87171; }
  .ppca-more { text-align:center; margin-top:0.6rem; }
  .ppca-empty { text-align:center; color:#888; padding:1.5rem 1rem; font-size:0.85rem; }
</style>

<div class="table-card ppca" id="psplusCatalog" style="border-color:rgba(255,215,0,0.25);">
  <div class="ppca-head">
    <div>
      <h2>🎮 PS Plus Deluxe game list</h2>
      <div class="ppca-sub">From PlayStation (Indonesia) ·
        <% if (pc.lastRefreshedAt) { %>last refreshed <b><%= ppcaWhen(pc.lastRefreshedAt) %></b> (<%= ppcaAgo(pc.daysAgo) %>)<% } else { %>never refreshed<% } %>
      </div>
    </div>
    <div class="ppca-actions">
      <button type="button" class="ppca-btn ppca-ghost" onclick="ppcaOpenAdd()">➕ Add a game by hand</button>
      <form method="POST" action="/admin/psplus/catalog/refresh" style="margin:0;" onsubmit="var b=this.querySelector('button');b.disabled=true;b.textContent='⏳ Checking PlayStation…';">
        <button type="submit" class="ppca-btn ppca-gold">🔄 Refresh from PlayStation</button>
      </form>
    </div>
  </div>

  <div class="ppca-body">
    <% if (pc.previewExpired) { %>
    <div class="ppca-warn">⏳ That preview expired (they last 30 minutes) — press <b>Refresh from PlayStation</b> again.</div>
    <% } %>

    <% if (pc.preview) { const pv = pc.preview; %>
    <div class="ppca-preview" id="ppcaPreview">
      <div class="ppca-preview-title">🔄 Refresh preview <span>· checked PlayStation just now · nothing is saved until you press Apply</span></div>
      <% pv.held.forEach(l => { %>
      <div class="ppca-bad">⛔ <b><%= l.label %> <%= l.state === 'blocked' ? 'came back with 0 games' : "couldn't be read from PlayStation" %></b><%= l.stored ? ' (you have ' + l.stored + ')' : '' %>.<%= l.state === 'blocked' ? " This usually means PlayStation's site changed or was briefly down." : '' %> It was <b>not</b> applied — your <%= l.label %> list is unchanged.</div>
      <% }) %>
      <% pv.warned.forEach(l => { %>
      <div class="ppca-warn">⚠ <b><%= l.label %> lost <%= Math.round((1 - l.incoming / l.stored) * 100) %>% of its games at once</b> (<%= l.stored %> → <%= l.incoming %>). That's unusual — look through "Leaving" before you apply.</div>
      <% }) %>
      <div class="ppca-pills">
        <span class="ppca-pill ppca-p-add">+ <%= pv.addedCount %> new</span>
        <span class="ppca-pill ppca-p-rem">− <%= pv.leavingCount %> leaving</span>
        <span class="ppca-pill ppca-p-chg"><%= pv.updatedCount %> updated (cover or name)</span>
        <span class="ppca-pill ppca-p-same"><%= pv.unchanged %> unchanged</span>
      </div>
      <div class="ppca-cols">
        <div>
          <h4>New in PS Plus</h4>
          <% if (!pv.added.length) { %><div class="ppca-none">Nothing new.</div><% } %>
          <% pv.added.forEach(g => { %>
          <div class="ppca-it"><% if (g.img) { %><img src="<%= g.img %>" alt="" loading="lazy"><% } else { %><span class="ppca-ph"></span><% } %><div><div class="ppca-n"><%= g.n %> <span class="ppca-tag ppca-tag-<%= g.t %>"><%= PPCA_TAG[g.t] %></span></div><div class="ppca-m"><%= g.p.join(' · ') %></div></div></div>
          <% }) %>
          <% if (pv.addedMore) { %><div class="ppca-none">+ <%= pv.addedMore %> more…</div><% } %>
        </div>
        <div>
          <h4>Leaving (no longer on PlayStation's list)</h4>
          <% if (!pv.leaving.length) { %><div class="ppca-none">Nothing leaving.</div><% } %>
          <% pv.leaving.forEach(g => { %>
          <div class="ppca-it"><% if (g.img) { %><img src="<%= g.img %>" alt="" loading="lazy"><% } else { %><span class="ppca-ph"></span><% } %><div><div class="ppca-n"><%= g.n %> <span class="ppca-tag ppca-tag-<%= g.t %>"><%= PPCA_TAG[g.t] %></span></div><div class="ppca-m"><%= g.p.join(' · ') %><% if (g.most) { %> · <span style="color:#fbbf24;">⚠ it's in your Most Played list</span><% } %></div></div></div>
          <% }) %>
          <% if (pv.leavingMore) { %><div class="ppca-none">+ <%= pv.leavingMore %> more…</div><% } %>
        </div>
      </div>
      <% if (pc.monthSuggestion) { const ms = pc.monthSuggestion; %>
      <div class="ppca-month">
        <div>📅 PlayStation's monthly games for <b><%= ms.monthName %> <%= ms.year %></b>: <%= ms.names.join(', ') %>. You don't have a <%= ms.monthName %> entry yet.</div>
        <button type="button" class="ppca-btn ppca-purple" data-year="<%= ms.year %>" data-month="<%= ms.month %>" data-games="<%= ms.names.join('\n') %>" onclick="ppcaFillMonth(this)">Create <%= ms.monthName.slice(0, 3) %> <%= ms.year %> entry from these</button>
      </div>
      <% } %>
      <div class="ppca-foot">
        <form method="POST" action="/admin/psplus/catalog/cancel" style="margin:0;">
          <input type="hidden" name="token" value="<%= pc.previewToken %>">
          <button type="submit" class="ppca-btn ppca-ghost">Cancel</button>
        </form>
        <% if (pv.appliedCount > 0) { %>
        <form method="POST" action="/admin/psplus/catalog/apply" style="margin:0;">
          <input type="hidden" name="token" value="<%= pc.previewToken %>">
          <button type="submit" class="ppca-btn ppca-green"><%= pv.held.length ? 'Apply the ' + pv.appliedCount + (pv.appliedCount === 1 ? ' list that looks' : ' lists that look') + ' OK' : 'Apply changes' %></button>
        </form>
        <% } %>
      </div>
    </div>
    <% } %>

    <details class="ppca-addbox" id="ppcaAdd">
      <summary>➕ Add a game by hand</summary>
      <form method="POST" action="/admin/psplus/catalog/add" enctype="multipart/form-data" class="ppca-addform">
        <input type="text" name="name" required maxlength="120" placeholder="Game title, as customers know it" aria-label="Game title">
        <select name="list" aria-label="Which list">
          <option value="catalog">Game Catalog</option>
          <option value="classics">Classics</option>
          <option value="ubisoft">Ubisoft+ Classics</option>
        </select>
        <label><input type="checkbox" name="platforms" value="PS5" checked> PS5</label>
        <label><input type="checkbox" name="platforms" value="PS4" checked> PS4</label>
        <label>Cover (optional) <input type="file" name="cover_image" accept="image/*"></label>
        <button type="submit" class="ppca-btn ppca-gold">Add game</button>
      </form>
      <p class="ppca-note">For a game on your accounts that PlayStation's list doesn't show. Refreshes never remove it.</p>
    </details>

    <div class="ppca-stats">
      <div class="ppca-stat"><b><%= pc.counts.catalog %></b><span>Game Catalog</span></div>
      <div class="ppca-stat"><b><%= pc.counts.classics %></b><span>Classics</span></div>
      <div class="ppca-stat"><b><%= pc.counts.ubisoft %></b><span>Ubisoft+</span></div>
      <div class="ppca-stat"><b><%= pc.counts.monthly %></b><span>Monthly (yours)</span></div>
      <div class="ppca-stat red"><b><%= pc.counts.hidden %></b><span>Hidden by you</span></div>
      <div class="ppca-stat green"><b><%= pc.counts.rent %></b><span>Also for rent</span></div>
      <div class="ppca-stat"><b><%= pc.counts.manual %></b><span>Added by hand</span></div>
    </div>

    <% if (!pc.rows.length) { %>
    <div class="ppca-empty">No games yet. Press <b>🔄 Refresh from PlayStation</b> to load PlayStation's list — you'll see a preview before anything is saved.</div>
    <% } else { %>
    <div class="ppca-toolbar">
      <input type="search" id="ppcaSearch" placeholder="🔍 Find a game in the list…" aria-label="Find a game">
      <div class="ppca-chips" id="ppcaChips">
        <button type="button" class="ppca-chip on" data-f="all">All</button>
        <button type="button" class="ppca-chip" data-f="hidden">Hidden</button>
        <button type="button" class="ppca-chip" data-f="rent">Also for rent</button>
        <button type="button" class="ppca-chip" data-f="manual">Added by hand</button>
      </div>
    </div>
    <div style="overflow-x:auto;">
      <table class="ppca-table">
        <thead><tr><th></th><th>Game</th><th>List</th><th>Also for rent (your game)</th><th>Shown</th><th></th></tr></thead>
        <tbody id="ppcaRows"></tbody>
      </table>
    </div>
    <div class="ppca-more"><button type="button" id="ppcaMore" class="ppca-btn ppca-ghost" hidden>Show more</button></div>
    <% } %>
  </div>

  <%# One hidden form each for every row action — the rows are drawn in the
      browser, 50 at a time, so ~500 games don't mean ~1,500 forms in the page. %>
  <form method="POST" id="ppcaAction" style="display:none;">
    <input type="hidden" name="hidden"><input type="hidden" name="note"><input type="hidden" name="rent"><input type="hidden" name="reset">
  </form>
  <form method="POST" id="ppcaCover" enctype="multipart/form-data" style="display:none;">
    <input type="file" name="cover_image" accept="image/*" id="ppcaCoverFile">
  </form>
  <script type="application/json" id="ppcaData"><%- JSON.stringify({ rows: pc.rows, games: pc.siteGames || [] }).replace(/</g, '\\u003c') %></script>
  <script>
  function ppcaOpenAdd() {
    var d = document.getElementById('ppcaAdd');
    d.open = true;
    d.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  // Fills the existing "+ Add Monthly Games" form below; the owner still reviews and submits it.
  function ppcaFillMonth(btn) {
    var f = document.getElementById('psplusAddMonthForm');
    if (!f) return;
    f.elements.year.value = btn.dataset.year;
    f.elements.month.value = btn.dataset.month;
    f.elements.games_list.value = btn.dataset.games;
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
    f.elements.games_list.focus();
  }
  (function () {
    var dataEl = document.getElementById('ppcaData');
    var body = document.getElementById('ppcaRows');
    if (!dataEl || !body) return;
    var data = JSON.parse(dataEl.textContent || '{}');
    var rows = data.rows || [], games = data.games || [];
    var TAG = { catalog: 'CATALOG', classics: 'CLASSIC', ubisoft: 'UBISOFT+' };
    var PAGE = 50, shown = PAGE, filter = 'all', q = '';
    var more = document.getElementById('ppcaMore');
    var action = document.getElementById('ppcaAction');
    var coverForm = document.getElementById('ppcaCover');
    var coverFile = document.getElementById('ppcaCoverFile');

    function base(k) { return '/admin/psplus/catalog/' + encodeURIComponent(k); }
    function post(url, fields) {
      action.action = url;
      ['hidden', 'note', 'rent', 'reset'].forEach(function (n) { action.elements[n].value = fields[n] != null ? fields[n] : ''; });
      action.submit();
    }
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function norm(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
    rows.forEach(function (r) { r._q = norm(r.n); });

    function visible() {
      return rows.filter(function (r) {
        if (filter === 'hidden' && !r.h) return false;
        if (filter === 'rent' && !r.rt) return false;
        if (filter === 'manual' && !r.man) return false;
        return !q || r._q.indexOf(q) >= 0;
      });
    }
    function row(r) {
      var tr = el('tr', r.h ? 'ppca-off' : '');
      var c0 = el('td');
      if (r.img) { var im = el('img'); im.src = r.img; im.alt = ''; im.loading = 'lazy'; c0.appendChild(im); } else c0.appendChild(el('span', 'ppca-ph'));
      tr.appendChild(c0);
      var c1 = el('td');
      c1.appendChild(el('b', null, r.n));
      var meta = r.p.join(' · ');
      if (r.h) meta += r.hn ? ' · hidden: "' + r.hn + '"' : ' · hidden';
      if (r.man) meta += ' · added by hand';
      c1.appendChild(el('div', 'ppca-m', meta));
      tr.appendChild(c1);
      var c2 = el('td');
      c2.appendChild(el('span', 'ppca-tag ppca-tag-' + r.t, TAG[r.t]));
      tr.appendChild(c2);
      var c3 = el('td');
      var sel = el('select', 'ppca-sel');
      sel.setAttribute('aria-label', 'Also for rent: ' + r.n);
      var auto = el('option', null, 'Automatic' + (!r.ro ? (r.rt ? ' — ' + r.rt : ' — none found') : ''));
      auto.value = 'auto';
      sel.appendChild(auto);
      var none = el('option', null, '— none —');
      none.value = 'none';
      sel.appendChild(none);
      games.forEach(function (g) { var o = el('option', null, g.title); o.value = String(g.id); sel.appendChild(o); });
      sel.value = !r.ro ? 'auto' : (r.rg == null ? 'none' : String(r.rg));
      sel.addEventListener('change', function () { post(base(r.k) + '/rent-link', { rent: sel.value }); });
      c3.appendChild(sel);
      tr.appendChild(c3);
      var c4 = el('td');
      var tog = el('button', 'ppca-tog' + (r.h ? ' off' : ''));
      tog.type = 'button';
      tog.setAttribute('aria-pressed', String(!r.h));
      tog.setAttribute('aria-label', (r.h ? 'Show ' : 'Hide ') + r.n);
      tog.addEventListener('click', function () {
        if (r.h) { post(base(r.k) + '/visibility', { hidden: '0' }); return; }
        var note = window.prompt('Hide "' + r.n + '" from customers?\nOptional note for yourself (e.g. not on our region):', '');
        if (note === null) return;
        post(base(r.k) + '/visibility', { hidden: '1', note: note });
      });
      c4.appendChild(tog);
      tr.appendChild(c4);
      var c5 = el('td', 'ppca-acts');
      var cv = el('button', 'ppca-link', 'Change cover');
      cv.type = 'button';
      cv.addEventListener('click', function () { coverForm.action = base(r.k) + '/cover'; coverFile.value = ''; coverFile.click(); });
      c5.appendChild(cv);
      if (r.co) {
        var rs = el('button', 'ppca-link', r.man ? 'Remove cover' : "Use PlayStation's");
        rs.type = 'button';
        rs.addEventListener('click', function () { post(base(r.k) + '/cover', { reset: '1' }); });
        c5.appendChild(rs);
      }
      if (r.man) {
        var rm = el('button', 'ppca-link ppca-danger', 'Remove');
        rm.type = 'button';
        rm.addEventListener('click', function () { if (window.confirm('Remove "' + r.n + '" from the list?')) post(base(r.k) + '/remove', {}); });
        c5.appendChild(rm);
      }
      tr.appendChild(c5);
      return tr;
    }
    function render() {
      var list = visible();
      body.textContent = '';
      var frag = document.createDocumentFragment();
      list.slice(0, shown).forEach(function (r) { frag.appendChild(row(r)); });
      body.appendChild(frag);
      more.hidden = list.length <= shown;
      more.textContent = 'Show more (' + (list.length - shown) + ' left)';
    }
    more.addEventListener('click', function () { shown += PAGE; render(); });
    var search = document.getElementById('ppcaSearch'), timer = null;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { q = norm(search.value); shown = PAGE; render(); }, 120);
    });
    document.getElementById('ppcaChips').addEventListener('click', function (e) {
      var b = e.target.closest('.ppca-chip');
      if (!b) return;
      filter = b.dataset.f;
      shown = PAGE;
      this.querySelectorAll('.ppca-chip').forEach(function (c) { c.classList.toggle('on', c === b); });
      render();
    });
    coverFile.addEventListener('change', function () { if (coverFile.files.length) coverForm.submit(); });
    render();
  })();
  </script>
</div>
<% } %>
```

- [ ] **Step 4: Put it in the PS Plus tab — `views/partials/admin/psplus.ejs`**

4a. Replace:

```ejs
  <div class="tab-panel" id="tab-psplus">
```

with:

```ejs
  <div class="tab-panel" id="tab-psplus">

    <%- include('psplus/catalog') %>
```

4b. Replace:

```ejs
      <form method="POST" action="/admin/psplus/add" enctype="multipart/form-data">
```

with:

```ejs
      <form method="POST" action="/admin/psplus/add" enctype="multipart/form-data" id="psplusAddMonthForm">
```

- [ ] **Step 5: Toasts — `views/admin.ejs`**

5a. In `msgTabMap`, replace:

```js
    psplus_added:'psplus', psplus_updated:'psplus', psplus_deleted:'psplus',
```

with:

```js
    catalog_applied:'psplus', catalog_expired:'psplus', catalog_unreachable:'psplus', catalog_nothing:'psplus', catalog_saved:'psplus', catalog_error:'psplus',
    psplus_added:'psplus', psplus_updated:'psplus', psplus_deleted:'psplus',
```

5b. In `messages`, replace:

```js
psplus_added:'⭐ Monthly entry added!',
```

with:

```js
catalog_applied:'✅ Game list updated.', catalog_expired:'⏳ That preview expired — refresh again.', catalog_unreachable:'❌ Couldn\'t reach PlayStation — nothing changed.', catalog_nothing:'⛔ Nothing to apply — every list was held back.', catalog_saved:'✅ Saved.', catalog_error:'❌ Couldn\'t save that — try again.', psplus_added:'⭐ Monthly entry added!',
```

- [ ] **Step 6: Wire `server.js`** (Edit tool; five edits)

6a. Replace:

```js
const quickAddSettle = require('./lib/quick-add-settle');
```

with:

```js
const quickAddSettle = require('./lib/quick-add-settle');
const psplusFeed = require('./lib/psplus-feed');
const psplusCatalog = require('./lib/psplus-catalog');
const psplusCatalogView = require('./lib/psplus-catalog-view');
const psplusCatalogStore = require('./lib/psplus-catalog-store');
```

6b. Replace:

```js
gameRequests.ensureIndexes().catch(e => console.error('[requests] ensureIndexes', e.message));
```

with:

```js
gameRequests.ensureIndexes().catch(e => console.error('[requests] ensureIndexes', e.message));

// The PS Plus Deluxe game list (~500 games from PlayStation's game-finder
// feed) has its own collection rather than living in the lowdb blob, which is
// rewritten in full on every save. Pages read the in-memory copy load() fills.
psplusCatalogStore.init(_getMongoDb);
psplusCatalogStore.load().catch(e => console.error('[psplus-catalog] load', e.message));
```

6c. The routes. Replace:

```js
app.post('/admin/psplus/prices', requireAuth, (req, res) => {
```

with:

```js
// ── PS Plus Deluxe game list ──────────────────────────────────────────
// The full Deluxe catalog from PlayStation's own game-finder feed
// (lib/psplus-feed.js). Refresh only builds a preview; Apply writes it. See
// docs/superpowers/specs/2026-09-27-psplus-catalog-design.md.

// Refresh previews waiting for Apply, by random token. In memory on purpose:
// this is a single-process app, and a preview older than 30 minutes — or lost
// to a restart — must be refreshed again rather than applied stale.
const catalogPreviews = new Map();
const CATALOG_PREVIEW_MS = 30 * 60 * 1000;
function getCatalogPreview(token) {
  const now = Date.now();
  for (const [t, p] of catalogPreviews) {
    if (now - p.createdAt > CATALOG_PREVIEW_MS) catalogPreviews.delete(t);
  }
  return catalogPreviews.get(String(token || '')) || null;
}

const CATALOG_BACK = '/admin?tab=psplus&msg=';

async function saveCatalogOwnerFields(res, key, patch) {
  let saved = false;
  try {
    saved = await psplusCatalogStore.setOwnerFields(key, patch);
  } catch (e) {
    console.error('[psplus-catalog] save', key, e.message);
  }
  res.redirect(CATALOG_BACK + (saved ? 'catalog_saved' : 'catalog_error'));
}

app.post('/admin/psplus/catalog/refresh', requireAuth, asyncRoute(async (req, res) => {
  const results = await psplusFeed.fetchAll();
  if (!psplusCatalog.STORED_LISTS.some(l => results[l] && results[l].ok)) {
    return res.redirect(CATALOG_BACK + 'catalog_unreachable');
  }
  const preview = psplusCatalog.buildPreview(psplusCatalogStore.all(), results);
  const token = require('crypto').randomBytes(12).toString('hex');
  getCatalogPreview(''); // drops expired previews before adding another
  catalogPreviews.set(token, { createdAt: Date.now(), preview });
  res.redirect('/admin?tab=psplus&catalog_preview=' + token);
}));

app.post('/admin/psplus/catalog/apply', requireAuth, asyncRoute(async (req, res) => {
  const token = String(req.body.token || '');
  const entry = getCatalogPreview(token);
  if (!entry) return res.redirect(CATALOG_BACK + 'catalog_expired');
  if (!entry.preview.applied.length) return res.redirect(CATALOG_BACK + 'catalog_nothing');
  const nowIso = new Date().toISOString();
  // Re-planned against what is stored at this moment, not when the preview
  // was made, so an owner edit in between is never overwritten.
  const plan = psplusCatalog.applyPlan(psplusCatalogStore.all(), entry.preview.incoming, entry.preview.applied, nowIso);
  try {
    await psplusCatalogStore.applyChanges({
      upserts: plan.upserts, removals: plan.removals,
      meta: { last_refreshed_at: nowIso, locale: psplusFeed.FEED_LOCALE }
    });
  } catch (e) {
    console.error('[psplus-catalog] apply', e.message);
    return res.redirect(CATALOG_BACK + 'catalog_error');
  }
  catalogPreviews.delete(token);
  res.redirect(CATALOG_BACK + 'catalog_applied');
}));

app.post('/admin/psplus/catalog/cancel', requireAuth, asyncRoute(async (req, res) => {
  catalogPreviews.delete(String(req.body.token || ''));
  res.redirect('/admin?tab=psplus');
}));

app.post('/admin/psplus/catalog/add', requireAuth, upload.single('cover_image'), asyncRoute(async (req, res) => {
  const cover = req.file ? await processUploadedImage(req.file) : '';
  let game = null;
  try {
    game = await psplusCatalogStore.addManual({
      name: req.body.name, list: req.body.list,
      platforms: [].concat(req.body.platforms || []), cover_override: cover
    });
  } catch (e) {
    console.error('[psplus-catalog] add', e.message);
  }
  res.redirect(CATALOG_BACK + (game ? 'catalog_saved' : 'catalog_error'));
}));

app.post('/admin/psplus/catalog/:key/visibility', requireAuth, asyncRoute(async (req, res) => {
  const hidden = req.body.hidden === '1';
  await saveCatalogOwnerFields(res, req.params.key, {
    hidden, hidden_note: hidden ? String(req.body.note || '').trim().slice(0, 120) : ''
  });
}));

// "auto" = link by title automatically; "none" = never link; or one of the
// owner's own game ids.
app.post('/admin/psplus/catalog/:key/rent-link', requireAuth, asyncRoute(async (req, res) => {
  const choice = String(req.body.rent || '');
  let patch = null;
  if (choice === 'auto') patch = { rent_override: false, rent_game_id: null };
  else if (choice === 'none') patch = { rent_override: true, rent_game_id: null };
  else if (/^\d+$/.test(choice) && getGame(choice)) patch = { rent_override: true, rent_game_id: Number(choice) };
  if (!patch) return res.redirect(CATALOG_BACK + 'catalog_error');
  await saveCatalogOwnerFields(res, req.params.key, patch);
}));

app.post('/admin/psplus/catalog/:key/cover', requireAuth, upload.single('cover_image'), asyncRoute(async (req, res) => {
  if (req.body.reset === '1') return saveCatalogOwnerFields(res, req.params.key, { cover_override: '' });
  if (!req.file) return res.redirect(CATALOG_BACK + 'catalog_error');
  const cover = await processUploadedImage(req.file);
  await saveCatalogOwnerFields(res, req.params.key, { cover_override: cover });
}));

app.post('/admin/psplus/catalog/:key/remove', requireAuth, asyncRoute(async (req, res) => {
  let removed = false;
  try {
    removed = await psplusCatalogStore.removeManual(req.params.key);
  } catch (e) {
    console.error('[psplus-catalog] remove', e.message);
  }
  res.redirect(CATALOG_BACK + (removed ? 'catalog_saved' : 'catalog_error'));
}));

app.post('/admin/psplus/prices', requireAuth, (req, res) => {
```

6d. The admin page's data. Replace (the one in `app.get('/admin', …)` — this exact line, ending `));`, is unique):

```js
  const psplusPopular = [...getPsplusPopular()].sort((a, b) => (a.rank || 999) - (b.rank || 999));
```

with:

```js
  const psplusPopular = [...getPsplusPopular()].sort((a, b) => (a.rank || 999) - (b.rank || 999));
  // PS Plus tab → PS Plus Deluxe game list. ?catalog_preview=<token> shows
  // that Refresh's preview until it is applied, cancelled or expires.
  const catalogPreviewToken = String(req.query.catalog_preview || '');
  const catalogPreview = catalogPreviewToken ? getCatalogPreview(catalogPreviewToken) : null;
  const psplusCatalogAdmin = Object.assign(psplusCatalogView.buildAdminCatalog({
    games: psplusCatalogStore.all(), siteGames: getGames(), entries: psplus,
    meta: psplusCatalogStore.meta(), now: new Date()
  }), {
    preview: catalogPreview ? psplusCatalogView.previewView(catalogPreview.preview, psplusPopular.map(p => p.title), 12) : null,
    previewToken: catalogPreview ? catalogPreviewToken : '',
    previewExpired: !!catalogPreviewToken && !catalogPreview,
    monthSuggestion: catalogPreview ? psplusCatalogView.monthSuggestion(catalogPreview.preview.monthlyNames, psplus, orders.manilaDate()) : null,
    siteGames: getGames().map(g => ({ id: g.id, title: g.title })).sort((a, b) => a.title.localeCompare(b.title))
  });
```

6e. In the `res.render('admin', { … })` line, replace:

```js
psplus, psplusPopular, psplusPrices: getPsplusPrices(), psplusSlots: getPsplusSlots(),
```

with:

```js
psplus, psplusPopular, psplusPrices: getPsplusPrices(), psplusSlots: getPsplusSlots(), psplusCatalog: psplusCatalogAdmin,
```

- [ ] **Step 7: Verify**

```bash
node --check server.js
node scripts/test-psplus-admin-catalog.js
node scripts/test-admin-tabs.js
node scripts/test-order-routes-wrapped.js
node scripts/test-release-wiring.js
node scripts/test-games-template.js
file server.js views/admin.ejs views/partials/admin/psplus.ejs
```

Expected:
- `node --check` prints nothing.
- `test-psplus-admin-catalog.js` ends `16 assertions passed`.
- The others pass as before (10, 19, 8, 22).
- `server.js` is still `UTF-8 (with BOM)` with CRLF, and the two views are still LF.

- [ ] **Step 8: Commit**

```bash
git add server.js views/admin.ejs views/partials/admin/psplus.ejs views/partials/admin/psplus/catalog.ejs scripts/test-psplus-admin-catalog.js
git commit -m "$(cat <<'EOF'
Admin: refresh the PS Plus game list from PlayStation, with a preview

Refresh reads PlayStation's lists and shows new / leaving / updated games
and any list held back as broken; nothing is saved until Apply. Hide a
game, link it to one of your own games, change its cover, or add one by
hand — all kept through every refresh.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The customer page — `/ps-plus` with three tabs and All Games

**Files:**
- Create: `public/css/psplus-catalog.css`
- Create: `views/partials/psplus-catalog-grid.ejs`
- Modify: `views/ps-plus.ejs` (CRLF + BOM, **Edit tool only**)
- Modify: `server.js` (CRLF + BOM, **Edit tool only**)
- Test: `scripts/test-psplus-page.js`

**Interfaces:**
- Consumes:
  - Task 3 `buildPublicCatalog`;
  - Task 4 `all()`;
  - the Task 5 `server.js` names `psplusCatalogView` and `psplusCatalogStore`.
- Produces:
  - `/ps-plus` render locals `catalog` (`{ items, counts }`), `activeTab` (`'games'|'monthly'|'pricing'`) and `fromWeekly` (number).
  - `?tab=` selects the tab; `?month=` opens Monthly; `?game=<key>` opens that game's sheet.
  - DOM ids used by Task 7's test and by the grid script: `ppc-panel-games|monthly|pricing`, `ppcMostPlayed`, `ppcGrid`, `ppcData`, `ppcSheet`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-psplus-page.js`:

```js
// Run: node scripts/test-psplus-page.js
//
// Renders the real views/ps-plus.ejs (with views/partials/psplus-catalog-grid.ejs)
// from the saved PlayStation feed (scripts/fixtures/psplus-feed/) run through
// the real lib/psplus-catalog.js and lib/psplus-catalog-view.js. Checks the
// three tabs and which one is open, the hero, the filter chips and their
// counts, the Most Played row, the embedded game list, and that the old
// "go to playstation.com" button and "PM us for the list" note are gone.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const feed = require('../lib/psplus-feed');
const cat = require('../lib/psplus-catalog');
const view = require('../lib/psplus-catalog-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const VIEW = path.join(ROOT, 'views', 'ps-plus.ejs');
const FIX = path.join(__dirname, 'fixtures', 'psplus-feed');
const loadList = name => ({ ok: true, games: feed.parseFeed(JSON.parse(fs.readFileSync(path.join(FIX, name + '.json'), 'utf8'))) });
const slugFor = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// What Apply would store on a first refresh of the saved feed.
const STORED = cat.applyPlan([], cat.mergeFeed({ catalog: loadList('catalog'), classics: loadList('classics'), ubisoft: loadList('ubisoft') }),
  ['catalog', 'classics', 'ubisoft'], '2026-09-27T05:00:00.000Z').upserts;
STORED.push(Object.assign({}, cat.OWNER_DEFAULTS, { key: 'c:999999', source: 'feed', name: '</script><b>x</b>', name_raw: 'x', lists: ['catalog'],
  image_url: '', platforms: [], genres: [], release_date: '', store_url: '', first_seen_at: '2026-09-27T05:00:00.000Z' }));
const ENTRIES = [{ id: 4, year: 2026, month: 9, month_name: 'September', games_list: 'God of War Ragnarök\nSome Monthly-Only Game', cover_image: '', notes: '' }];
const SITE = [{ id: 8, title: 'God of War Ragnarök' }];
const POPULAR = [{ id: 1, title: 'Ghost of Tsushima', platform: 'PS5', rank: 1, cover_image: '' }];

function render({ games = STORED, tab = 'games', popular = POPULAR, entries = ENTRIES } = {}) {
  const catalog = view.buildPublicCatalog({ games, siteGames: SITE, entries, slugFor });
  const byYear = { 2026: ENTRIES };
  const html = ejs.render(fs.readFileSync(VIEW, 'utf8'), {
    settings: { title: 'PlayStation Hub', favicon_path: '/favicon.svg', logo_path: '/logo.png' },
    assetV: 'test', announcement: null, announcements: [],
    byYear, years: ['2026'], popular, prices: { nt_price_7d: 120, nt_price_30d: 350, tr_price_7d: 150, tr_price_30d: 450 },
    slots: { nt_slots: 2, tr_slots: 1, ps4_slots: 0 }, psplusGameId: 17, psplusSlug: 'ps-plus-deluxe',
    catalog, activeTab: tab, fromWeekly: 120,
    reviews: [], reviewStats: null, recommend: null, reviewBadge: null, reviewDisplayName: null
  }, { filename: VIEW });
  return { html, catalog };
}
function panelOpen(html, name) {
  const m = new RegExp('data-panel="' + name + '" id="ppc-panel-' + name + '" role="tabpanel"( hidden)?>').exec(html);
  assert.ok(m, name + ' panel present');
  return !m[1];
}

console.log('\ntabs');

ok('three tabs, All Games open by default', () => {
  const { html } = render();
  assert.ok(html.includes('data-tab="games"') && html.includes('data-tab="monthly"') && html.includes('data-tab="pricing"'));
  assert.deepStrictEqual([panelOpen(html, 'games'), panelOpen(html, 'monthly'), panelOpen(html, 'pricing')], [true, false, false]);
  assert.ok(/class="ppc-tab on" data-tab="games"/.test(html));
});

ok('?tab= opens the tab it names', () => {
  const { html } = render({ tab: 'pricing' });
  assert.deepStrictEqual([panelOpen(html, 'games'), panelOpen(html, 'monthly'), panelOpen(html, 'pricing')], [false, false, true]);
  assert.ok(/class="ppc-tab on" data-tab="pricing"/.test(html));
});

ok('each panel holds what it should', () => {
  const { html } = render();
  const games = html.indexOf('id="ppc-panel-games"'), monthly = html.indexOf('id="ppc-panel-monthly"'), pricing = html.indexOf('id="ppc-panel-pricing"');
  assert.ok(html.indexOf('id="pricing"') > pricing && html.indexOf('id="pricing"') < games, 'price cards in Pricing');
  assert.ok(html.indexOf('id="ppcMostPlayed"') > games && html.indexOf('id="ppcGrid"') > games && html.indexOf('id="ppcGrid"') < monthly, 'Most Played and the grid in All Games');
  assert.ok(html.indexOf('psplus-month-card') > monthly, 'month cards in Monthly');
});

console.log('\nhero');

ok('the game count, the weekly price and free slots, with one Rent button', () => {
  const { html, catalog } = render();
  assert.ok(html.includes('<b>' + catalog.counts.all + '</b><span>Games</span>'));
  assert.ok(html.includes('<b>₱120</b><span>/ week</span>'));
  assert.ok(html.includes('<b>● 3</b><span>Slots free</span>'));
  assert.ok(html.includes('<a href="/ps-plus/rent" class="ppc-cta">Rent PS Plus Deluxe →</a>'));
});

ok('the old playstation.com button and "PM us for the list" note are gone', () => {
  const { html } = render();
  assert.ok(!html.includes('Browse All PS Plus Games'));
  assert.ok(!html.includes('www.playstation.com/en-id/ps-plus/games'));
  assert.ok(!html.includes('PM us for full list'));
});

console.log('\nAll Games');

ok('515 PlayStation games plus the monthly-only tile, with chip counts', () => {
  const { html, catalog } = render();
  assert.strictEqual(catalog.counts.all, 517, '515 + the test game + 1 monthly-only tile');
  assert.ok(html.includes('data-f="catalog" aria-pressed="false">Game Catalog <i>' + catalog.counts.catalog + '</i>'));
  assert.ok(html.includes('data-f="classics" aria-pressed="false">Classics <i>149</i>'));
  assert.ok(html.includes('data-f="ubisoft" aria-pressed="false">Ubisoft+ <i>66</i>'));
  assert.ok(html.includes('data-f="monthly" aria-pressed="false">Monthly <i>2</i>'));
  assert.ok(html.includes('data-f="rent" aria-pressed="false">🟢 Also for rent <i>1</i>'));
  assert.ok(html.includes('🎮 All 517 games'));
});

ok('the game list is embedded as JSON a title can never break out of', () => {
  const { html, catalog } = render();
  const m = /<script type="application\/json" id="ppcData">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m);
  assert.ok(!m[1].includes('</script'));
  const items = JSON.parse(m[1]);
  assert.strictEqual(items.length, catalog.counts.all);
  assert.ok(items.some(i => i.n === '</script><b>x</b>'));
  const gow = items.find(i => i.n === 'God of War Ragnarök');
  assert.deepStrictEqual([gow.m, gow.rent.u], ['SEP 2026', '/game/god-of-war-ragnar-k']);
});

ok('the sheet rents PS Plus Deluxe and quotes the weekly price', () => {
  const { html } = render();
  assert.ok(html.includes('<a class="ppc-sheet-rent" href="/ps-plus/rent">Rent PS Plus Deluxe · from ₱120/week</a>'));
  assert.ok(html.includes('id="ppcSheet" hidden'));
});

ok('no Most Played row when there is none', () => {
  assert.ok(!render({ popular: [] }).html.includes('id="ppcMostPlayed"'));
});

ok('before the first refresh: "coming soon", and the other tabs still work', () => {
  const { html } = render({ games: [], entries: [] });
  assert.ok(html.includes('The full game list is coming soon.'));
  assert.ok(!html.includes('id="ppcGrid"'));
  assert.ok(!html.includes('<span>Games</span>'), 'no game count in the hero');
  assert.ok(html.includes('psplus-month-card'));
});

console.log('\nwiring');

ok('/ps-plus builds the catalog and picks the tab', () => {
  const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const i = SRC.indexOf("app.get('/ps-plus', (req, res) => {");
  const route = SRC.slice(i, SRC.indexOf('\napp.', i + 10));
  assert.ok(route.includes('psplusCatalogView.buildPublicCatalog({'));
  assert.ok(route.includes("(req.query.month ? 'monthly' : 'games')"));
  assert.ok(route.includes('slots, catalog, activeTab, fromWeekly,'));
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-psplus-page.js`
Expected: FAIL on the first check, `three tabs, All Games open by default`.

- [ ] **Step 3: The stylesheet**

Create `public/css/psplus-catalog.css`:

```css
/* /ps-plus — hero, tabs and the All Games grid (views/partials/psplus-catalog-grid.ejs).
   Its own file so the page can load it without touching the site-wide sheet. */

.ppc-hero { background: radial-gradient(ellipse at 15% 0%, #3a2e00 0%, transparent 55%), #0a0a0a; border-bottom: 1px solid #1a1a1a; }
.ppc-hero-inner { max-width: 1400px; margin: 0 auto; padding: 1.75rem 2rem 1.4rem; display: flex; align-items: flex-end; justify-content: space-between; gap: 1.25rem; flex-wrap: wrap; }
.ppc-eyebrow { font-size: 0.72rem; font-weight: 800; color: #a88d00; letter-spacing: 0.12em; text-transform: uppercase; }
.ppc-title { margin: 0.15rem 0 0.3rem; font-size: 2rem; font-weight: 900; letter-spacing: 0.02em; color: #fff; }
.ppc-title span { color: #FFD700; }
.ppc-lead { margin: 0; color: #aaa; font-size: 0.92rem; }
.ppc-hero-side { display: flex; align-items: center; gap: 0.9rem; flex-wrap: wrap; }
.ppc-stats { display: flex; gap: 0.5rem; }
.ppc-stat { background: #141414; border: 1px solid #262626; border-radius: 12px; padding: 0.45rem 0.8rem; text-align: center; min-width: 70px; }
.ppc-stat b { display: block; font-size: 1.1rem; color: #FFD700; }
.ppc-stat span { font-size: 0.62rem; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.ppc-stat-free { border-color: #1f5130; }
.ppc-stat-free b { color: #22c55e; }
.ppc-stat-full b { color: #ef4444; }
.ppc-cta { background: #FFD700; color: #000; font-weight: 800; border-radius: 50px; padding: 0.75rem 1.3rem; font-size: 0.9rem; text-decoration: none; white-space: nowrap; }
.ppc-cta:hover { filter: brightness(1.08); }
.ppc-cta-block { display: inline-block; margin-top: 1.5rem; }

.ppc-tabs { max-width: 1400px; margin: 0 auto; padding: 0.75rem 2rem 0; display: flex; gap: 0.35rem; border-bottom: 1px solid #1f1f1f; overflow-x: auto; scrollbar-width: none; }
.ppc-tabs::-webkit-scrollbar { display: none; }
.ppc-tab { background: none; border: 0; padding: 0.65rem 1.1rem; font-size: 0.9rem; font-weight: 700; color: #888; border-radius: 10px 10px 0 0; cursor: pointer; font-family: inherit; white-space: nowrap; }
.ppc-tab:hover { color: #ddd; }
.ppc-tab.on { background: #FFD700; color: #000; }
.ppc-tab-n { font-size: 0.72rem; opacity: 0.7; margin-left: 0.15rem; }
.ppc-panel[hidden] { display: none; }

.ppc-mostplayed { padding: 1.5rem 2rem 0.5rem; max-width: 1400px; margin: 0 auto; }
.ppc-mostplayed[hidden] { display: none; }

.ppc-games { max-width: 1400px; margin: 0 auto; padding: 1.25rem 2rem 3rem; }
.ppc-toolbar { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; }
.ppc-search { flex: 1 1 260px; min-width: 0; background: #141414; border: 1px solid #2a2a2a; border-radius: 50px; padding: 0.7rem 1.1rem; font-size: 0.9rem; color: #eee; font-family: inherit; }
.ppc-search:focus { outline: none; border-color: #FFD700; }
.ppc-select { background: #141414; border: 1px solid #2a2a2a; border-radius: 50px; padding: 0.65rem 0.9rem; font-size: 0.82rem; color: #ccc; font-weight: 600; font-family: inherit; }
.ppc-chips { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 1rem; }
.ppc-chip { font-size: 0.82rem; font-weight: 700; padding: 0.4rem 0.85rem; border-radius: 50px; border: 1px solid #2e2e2e; color: #aaa; background: none; cursor: pointer; font-family: inherit; white-space: nowrap; }
.ppc-chip i { font-style: normal; color: #666; font-weight: 600; margin-left: 0.15rem; }
.ppc-chip.on { background: #fff; color: #000; border-color: #fff; }
.ppc-chip.on i { color: #555; }
.ppc-heading { font-size: 1rem; font-weight: 800; margin: 0.25rem 0 0.8rem; color: #fff; }
.ppc-heading small { color: #666; font-weight: 600; font-size: 0.8rem; }
.ppc-empty { color: #888; text-align: center; padding: 2rem 1rem; }
.ppc-empty a { color: #FFD700; }
.ppc-soon { text-align: center; color: #ddd; font-weight: 700; padding: 3rem 1rem; }
.ppc-soon span { display: block; color: #777; font-weight: 400; font-size: 0.88rem; margin-top: 0.4rem; }

.ppc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.75rem; }
.ppc-card { position: relative; aspect-ratio: 1 / 1; border-radius: 12px; overflow: hidden; background: #161616; border: 0; padding: 0; cursor: pointer; text-align: left; color: #fff; font-family: inherit; }
.ppc-card:focus-visible { outline: 2px solid #FFD700; outline-offset: 2px; }
.ppc-card:hover .ppc-cover { transform: scale(1.04); }
.ppc-cover { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.25s ease; }
.ppc-scrim { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.35) 42%, transparent 62%); }
.ppc-card-noimg { background: linear-gradient(160deg, #1e2a44, #0d1220); }
.ppc-card-tile { background: radial-gradient(circle at 30% 15%, #3b1a5c, #130a1f 75%); border: 1px solid #33204d; }
.ppc-tags { position: absolute; top: 7px; left: 7px; right: 7px; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; }
.ppc-tag { font-size: 0.6rem; font-weight: 900; letter-spacing: 0.03em; padding: 2px 6px; border-radius: 4px; }
.ppc-tag-catalog { background: #FFD700; color: #000; }
.ppc-tag-classics { background: #38bdf8; color: #00111a; }
.ppc-tag-ubisoft { background: #e2e8f0; color: #0f172a; }
.ppc-tag-monthly { background: #a855f7; color: #fff; }
.ppc-body { position: absolute; left: 9px; right: 9px; bottom: 8px; }
.ppc-rentbadge { display: inline-block; font-size: 0.56rem; font-weight: 900; padding: 2px 6px; border-radius: 4px; background: #22c55e; color: #00150a; margin-bottom: 4px; }
.ppc-plat { font-size: 0.64rem; color: #bbb; font-weight: 700; letter-spacing: 0.02em; }
.ppc-name { font-size: 0.82rem; font-weight: 800; line-height: 1.2; margin-top: 1px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ppc-tile-name { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 2rem 0.9rem 0.9rem; font-weight: 900; font-size: 0.92rem; color: #ead9ff; line-height: 1.2; }

.ppc-sheet-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.72); display: flex; align-items: center; justify-content: center; padding: 1rem; }
.ppc-sheet-overlay[hidden] { display: none; }
.ppc-sheet { background: #141414; border: 1px solid #2a2a2a; border-radius: 18px; width: 100%; max-width: 440px; max-height: 92vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.6); }
.ppc-sheet-cover { position: relative; height: 200px; background: #0a0a0a; }
.ppc-sheet-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ppc-sheet-cover-tile { background: radial-gradient(circle at 30% 15%, #3b1a5c, #130a1f 75%); }
.ppc-sheet-x { position: absolute; top: 10px; right: 12px; width: 32px; height: 32px; border-radius: 50%; border: 0; background: rgba(0,0,0,0.6); color: #fff; font-size: 0.95rem; cursor: pointer; }
.ppc-sheet-body { padding: 1rem 1.25rem 1.35rem; }
.ppc-sheet-body h3 { margin: 0; font-size: 1.2rem; font-weight: 900; color: #fff; }
.ppc-sheet-sub { font-size: 0.82rem; color: #999; margin: 0.2rem 0 0.7rem; }
.ppc-sheet-ok { display: inline-block; font-size: 0.75rem; font-weight: 800; color: #FFD700; background: rgba(255,215,0,0.1); border: 1px solid rgba(255,215,0,0.3); border-radius: 50px; padding: 0.25rem 0.7rem; }
.ppc-sheet-rent { display: block; text-align: center; background: #FFD700; color: #000; font-weight: 900; border-radius: 50px; padding: 0.8rem; font-size: 0.92rem; margin-top: 0.9rem; text-decoration: none; }
.ppc-sheet-alt { display: block; margin-top: 0.65rem; font-size: 0.82rem; background: #0f1f14; border: 1px solid #14532d; color: #86efac; border-radius: 10px; padding: 0.6rem 0.8rem; text-decoration: none; }
.ppc-sheet-alt[hidden], .ppc-sheet-store[hidden] { display: none; }
.ppc-sheet-store { display: block; text-align: center; margin-top: 0.75rem; font-size: 0.75rem; color: #777; }

@media (max-width: 600px) {
  .ppc-hero-inner { padding: 1.1rem 1rem 1rem; }
  .ppc-title { font-size: 1.5rem; }
  .ppc-lead { font-size: 0.82rem; }
  .ppc-hero-side { width: 100%; justify-content: space-between; }
  .ppc-stat { padding: 0.35rem 0.55rem; min-width: 0; }
  .ppc-stat b { font-size: 0.95rem; }
  .ppc-cta { padding: 0.6rem 1rem; font-size: 0.82rem; }
  .ppc-tabs { padding: 0.5rem 0.75rem 0; gap: 0.2rem; }
  .ppc-tab { padding: 0.55rem 0.65rem; font-size: 0.8rem; }
  .ppc-tab-n { display: none; }
  .ppc-mostplayed { padding: 1rem 1rem 0.25rem; }
  .ppc-games { padding: 1rem 1rem 2.5rem; }
  .ppc-toolbar { flex-wrap: nowrap; }
  .ppc-search { flex: 1 1 auto; padding: 0.6rem 0.9rem; font-size: 0.85rem; }
  .ppc-select { padding: 0.55rem 0.5rem; font-size: 0.72rem; max-width: 96px; }
  .ppc-chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
  .ppc-chips::-webkit-scrollbar { display: none; }
  .ppc-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.4rem; }
  .ppc-card { border-radius: 9px; }
  .ppc-tags { top: 4px; left: 4px; right: 4px; gap: 2px; }
  .ppc-tag { font-size: 0.5rem; padding: 1px 4px; }
  .ppc-body { left: 6px; right: 6px; bottom: 5px; }
  .ppc-rentbadge { font-size: 0.48rem; padding: 1px 4px; margin-bottom: 2px; }
  .ppc-plat { font-size: 0.55rem; }
  .ppc-name { font-size: 0.68rem; }
  .ppc-tile-name { font-size: 0.72rem; padding: 1.6rem 0.4rem 0.5rem; }
  .ppc-sheet-overlay { align-items: flex-end; padding: 0; }
  .ppc-sheet { max-width: none; border-radius: 18px 18px 0 0; border-bottom: 0; }
  .ppc-sheet-cover { height: 170px; }
}
```

- [ ] **Step 4: The All Games grid and sheet**

Create `views/partials/psplus-catalog-grid.ejs`:

```ejs
<%#
  /ps-plus → All Games tab: every game in PS Plus Deluxe (Game Catalog,
  Classics, Ubisoft+ Classics) plus the owner's monthly games, from
  lib/psplus-catalog-view.js buildPublicCatalog(). The list travels as JSON
  and the script below draws it 48 cards at a time as the customer scrolls;
  search, filters and sort run on that list in the browser. Tapping a card
  opens the quick-view sheet. ?game=<key> opens a game's sheet on load (site
  search links here).

  Locals: catalog { items, counts }, fromWeekly.
%>
<section class="ppc-games" id="ppcGames">
<% if (!catalog.counts.all) { %>
  <div class="ppc-soon">🎮 The full game list is coming soon.<span>Meanwhile, see this month's games in the Monthly tab, or message us to ask about a game.</span></div>
<% } else { %>
  <div class="ppc-toolbar">
    <input type="search" id="ppcSearch" class="ppc-search" placeholder="Search <%= catalog.counts.all %> games — e.g. God of War" aria-label="Search PS Plus Deluxe games" autocomplete="off">
    <select id="ppcSort" class="ppc-select" aria-label="Sort games">
      <option value="az">Sort: A–Z</option>
      <option value="new">Newest added</option>
      <option value="release">Release date</option>
    </select>
    <select id="ppcPlat" class="ppc-select" aria-label="Platform">
      <option value="">PS5 · PS4</option>
      <option value="PS5">PS5 only</option>
      <option value="PS4">PS4 only</option>
    </select>
  </div>
  <div class="ppc-chips" id="ppcChips" role="group" aria-label="Filter games">
    <% [['all', 'All', catalog.counts.all], ['catalog', 'Game Catalog', catalog.counts.catalog], ['classics', 'Classics', catalog.counts.classics],
        ['ubisoft', 'Ubisoft+', catalog.counts.ubisoft], ['monthly', 'Monthly', catalog.counts.monthly], ['rent', '🟢 Also for rent', catalog.counts.rent]]
        .filter(c => c[0] === 'all' || c[2] > 0).forEach(c => { %>
    <button type="button" class="ppc-chip<%= c[0] === 'all' ? ' on' : '' %>" data-f="<%= c[0] %>" aria-pressed="<%= c[0] === 'all' %>"><%= c[1] %> <i><%= c[2] %></i></button>
    <% }) %>
  </div>
  <h2 class="ppc-heading" id="ppcHeading">🎮 All <%= catalog.counts.all %> games <small>· A–Z</small></h2>
  <div class="ppc-grid" id="ppcGrid"></div>
  <div id="ppcSentinel" aria-hidden="true"></div>
  <p class="ppc-empty" id="ppcEmpty" hidden>No games match that. Try another name, or <a href="http://m.me/PlaystationHub00" target="_blank" rel="noopener">ask us</a>.</p>
<% } %>
</section>

<div class="ppc-sheet-overlay" id="ppcSheet" hidden>
  <div class="ppc-sheet" role="dialog" aria-modal="true" aria-labelledby="ppcSheetTitle">
    <div class="ppc-sheet-cover" id="ppcSheetCover">
      <img id="ppcSheetImg" alt="">
      <button type="button" class="ppc-sheet-x" id="ppcSheetClose" aria-label="Close">✕</button>
    </div>
    <div class="ppc-sheet-body">
      <h3 id="ppcSheetTitle"></h3>
      <div class="ppc-sheet-sub" id="ppcSheetSub"></div>
      <span class="ppc-sheet-ok" id="ppcSheetOk"></span>
      <a class="ppc-sheet-rent" href="/ps-plus/rent">Rent PS Plus Deluxe<%= fromWeekly ? ' · from ₱' + fromWeekly + '/week' : '' %></a>
      <a class="ppc-sheet-alt" id="ppcSheetAlt" hidden></a>
      <a class="ppc-sheet-store" id="ppcSheetStore" target="_blank" rel="noopener" hidden>View on PlayStation Store ↗</a>
    </div>
  </div>
</div>

<script type="application/json" id="ppcData"><%- JSON.stringify(catalog.items).replace(/</g, '\\u003c') %></script>
<script>
(function () {
  var dataEl = document.getElementById('ppcData');
  var grid = document.getElementById('ppcGrid');
  var ALL = JSON.parse((dataEl && dataEl.textContent) || '[]');
  var TAGS = { catalog: 'CATALOG', classics: 'CLASSIC', ubisoft: 'UBISOFT+' };
  var LISTS = { catalog: 'Game Catalog', classics: 'Classics', ubisoft: 'Ubisoft+ Classics' };
  var SORTS = { az: 'A–Z', 'new': 'newest added', release: 'by release date' };
  var BATCH = 48;
  var state = { q: '', f: 'all', sort: 'az', plat: '' };
  var view = [], shown = 0, lastFocus = null;
  var byKey = {};

  function norm(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function cover(g, w) { return g.c || (g.i ? g.i + '?w=' + w : ''); }
  ALL.forEach(function (g) { g._q = norm(g.n); byKey[g.k] = g; });

  // ── Sheet ───────────────────────────────────────────────────────────
  var sheet = document.getElementById('ppcSheet');
  function openSheet(g) {
    lastFocus = document.activeElement;
    var img = document.getElementById('ppcSheetImg');
    var coverBox = document.getElementById('ppcSheetCover');
    var src = cover(g, 600);
    coverBox.classList.toggle('ppc-sheet-cover-tile', !src);
    if (src) { img.src = src; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
    document.getElementById('ppcSheetTitle').textContent = g.n;
    document.getElementById('ppcSheetSub').textContent = [g.p.join(' · '), g.g].filter(Boolean).join(' · ') || 'PS Plus Deluxe';
    var where = g.tile ? 'Monthly game · ' + g.m : LISTS[g.t] + (g.m ? ' · Monthly ' + g.m : '');
    document.getElementById('ppcSheetOk').textContent = '✓ Included in PS Plus Deluxe · ' + where;
    var alt = document.getElementById('ppcSheetAlt');
    if (g.rent) { alt.href = g.rent.u; alt.textContent = '🎮 We also rent this game on its own → see price'; alt.hidden = false; } else alt.hidden = true;
    var store = document.getElementById('ppcSheetStore');
    if (g.s) { store.href = g.s; store.hidden = false; } else store.hidden = true;
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    document.getElementById('ppcSheetClose').focus();
  }
  function closeSheet() {
    sheet.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.getElementById('ppcSheetClose').addEventListener('click', closeSheet);
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

  var deep = new URLSearchParams(location.search).get('game');
  if (deep && byKey[deep]) openSheet(byKey[deep]);

  if (!grid) return;

  // ── Grid ────────────────────────────────────────────────────────────
  function card(g) {
    var b = el('button', 'ppc-card' + (g.tile ? ' ppc-card-tile' : ''));
    b.type = 'button';
    b.dataset.k = g.k;
    b.setAttribute('aria-label', g.n);
    var src = cover(g, 240);
    if (src) {
      var img = el('img', 'ppc-cover');
      img.src = src; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      img.addEventListener('error', function () { img.remove(); b.classList.add('ppc-card-noimg'); });
      b.appendChild(img);
      b.appendChild(el('div', 'ppc-scrim'));
    } else if (!g.tile) {
      b.classList.add('ppc-card-noimg');
    }
    var tags = el('div', 'ppc-tags');
    if (!g.tile) tags.appendChild(el('span', 'ppc-tag ppc-tag-' + g.t, TAGS[g.t]));
    if (g.m) tags.appendChild(el('span', 'ppc-tag ppc-tag-monthly', 'MONTHLY · ' + g.m));
    b.appendChild(tags);
    if (g.tile) {
      b.appendChild(el('div', 'ppc-tile-name', g.n));
      return b;
    }
    var body = el('div', 'ppc-body');
    if (g.rent) body.appendChild(el('span', 'ppc-rentbadge', 'ALSO FOR RENT'));
    if (g.p.length) body.appendChild(el('div', 'ppc-plat', g.p.join(' · ')));
    body.appendChild(el('div', 'ppc-name', g.n));
    b.appendChild(body);
    return b;
  }
  grid.addEventListener('click', function (e) {
    var b = e.target.closest('.ppc-card');
    if (b && byKey[b.dataset.k]) openSheet(byKey[b.dataset.k]);
  });

  function matches(g) {
    if (state.f === 'rent' && !g.rent) return false;
    if (state.f === 'monthly' && !g.m) return false;
    if (LISTS[state.f] && g.l.indexOf(state.f) < 0) return false;
    if (state.plat && g.p.indexOf(state.plat) < 0) return false;
    return !state.q || g._q.indexOf(state.q) >= 0;
  }
  function sorter(a, b) {
    var byName = a.n.localeCompare(b.n, 'en', { sensitivity: 'base' });
    if (state.sort === 'new') return (b.f || '').localeCompare(a.f || '') || byName;
    if (state.sort === 'release') return (b.r || '').localeCompare(a.r || '') || byName;
    return byName;
  }
  function more() {
    var frag = document.createDocumentFragment();
    view.slice(shown, shown + BATCH).forEach(function (g) { frag.appendChild(card(g)); });
    grid.appendChild(frag);
    shown = Math.min(view.length, shown + BATCH);
  }
  var heading = document.getElementById('ppcHeading');
  var empty = document.getElementById('ppcEmpty');
  var mostPlayed = document.getElementById('ppcMostPlayed');
  function apply() {
    view = ALL.filter(matches).sort(sorter);
    grid.textContent = '';
    shown = 0;
    more();
    var filtered = state.q || state.f !== 'all' || state.plat;
    heading.textContent = '';
    heading.appendChild(document.createTextNode(filtered ? '🎮 ' + view.length + ' of ' + ALL.length + ' games ' : '🎮 All ' + ALL.length + ' games '));
    heading.appendChild(el('small', null, '· ' + SORTS[state.sort]));
    empty.hidden = view.length > 0;
    if (mostPlayed) mostPlayed.hidden = !!(filtered || state.sort !== 'az');
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && shown < view.length) more();
    }, { rootMargin: '800px 0px' }).observe(document.getElementById('ppcSentinel'));
  } else {
    BATCH = 100000;
  }

  var search = document.getElementById('ppcSearch'), timer = null;
  search.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { state.q = norm(search.value); apply(); }, 120);
  });
  document.getElementById('ppcSort').addEventListener('change', function () { state.sort = this.value; apply(); });
  document.getElementById('ppcPlat').addEventListener('change', function () { state.plat = this.value; apply(); });
  document.getElementById('ppcChips').addEventListener('click', function (e) {
    var c = e.target.closest('.ppc-chip');
    if (!c) return;
    state.f = c.dataset.f;
    this.querySelectorAll('.ppc-chip').forEach(function (x) {
      x.classList.toggle('on', x === c);
      x.setAttribute('aria-pressed', String(x === c));
    });
    apply();
  });
  apply();
})();
</script>
```

- [ ] **Step 5: Restructure `views/ps-plus.ejs`** (Edit tool; six edits)

5a. Replace:

```ejs
  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
```

with:

```ejs
  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
  <link rel="stylesheet" href="/css/psplus-catalog.css?v=<%= assetV %>">
```

5b. The hero and tabs. Replace:

```ejs
<!-- HERO BANNER -->
<section class="psplus-hero">
  <div class="psplus-hero-bg"></div>
  <div class="psplus-hero-content">
    <div class="psplus-logo-row">
      <div class="psplus-ps-icon">
        <svg viewBox="0 0 100 100" fill="none">
          <path d="M50 15 L70 35 L50 35 Z" fill="#FFD700"/>
          <path d="M50 15 L30 35 L50 35 Z" fill="#FFD700" opacity="0.6"/>
          <path d="M35 40 L50 85 L65 40 Z" fill="#FFD700"/>
        </svg>
      </div>
      <div>
        <div class="psplus-eyebrow">Playstation Hub</div>
        <h1 class="psplus-title">PS PLUS <span>DELUXE</span></h1>
        <p class="psplus-subtitle">Monthly Games — Unlimited Access</p>
      </div>
    </div>
    <p class="psplus-desc">Access hundreds of games through our PS Plus Deluxe accounts. Enjoy monthly free games and a massive catalog — Trophy or Non-Trophy, your choice.</p>
    <div class="psplus-hero-actions">
      <a href="http://m.me/PlaystationHub00" target="_blank" rel="noopener" class="btn btn-primary" style="background:#FFD700;color:#000;">📘 Message Us to Rent</a>
      <a href="#pricing" class="btn btn-outline">View Pricing ↓</a>
      <a href="https://www.playstation.com/en-id/ps-plus/games/?smcid=store%3Aen-us%3Apages-latest%3Aprimary%20nav%3Amsg-ps-plus%3Aall-games" target="_blank" rel="noopener" class="btn btn-outline">🎮 Browse All PS Plus Games</a>
    </div>
  </div>
</section>

<!-- PRICING TABLE -->
```

with:

```ejs
<!-- HERO -->
<%
  const heroSlots = ((slots || {}).nt_slots || 0) + ((slots || {}).tr_slots || 0) + ((slots || {}).ps4_slots || 0);
%>
<section class="ppc-hero">
  <div class="ppc-hero-inner">
    <div>
      <div class="ppc-eyebrow">PlayStation Hub</div>
      <h1 class="ppc-title">PS PLUS <span>DELUXE</span></h1>
      <p class="ppc-lead">One rental, every game below. Trophy or Non-Trophy, weekly or monthly.</p>
    </div>
    <div class="ppc-hero-side">
      <div class="ppc-stats">
        <% if (catalog.counts.all) { %><div class="ppc-stat"><b><%= catalog.counts.all %></b><span>Games</span></div><% } %>
        <% if (fromWeekly) { %><div class="ppc-stat"><b>₱<%= fromWeekly %></b><span>/ week</span></div><% } %>
        <div class="ppc-stat <%= heroSlots > 0 ? 'ppc-stat-free' : 'ppc-stat-full' %>"><b>● <%= heroSlots %></b><span><%= heroSlots === 1 ? 'Slot free' : 'Slots free' %></span></div>
      </div>
      <a href="/ps-plus/rent" class="ppc-cta">Rent PS Plus Deluxe →</a>
    </div>
  </div>
</section>

<!-- TABS: All Games (default) · Monthly · Pricing & Rent. ?tab= picks one. -->
<div class="ppc-tabs" role="tablist" aria-label="PS Plus Deluxe">
  <button type="button" role="tab" class="ppc-tab<%= activeTab === 'games' ? ' on' : '' %>" data-tab="games" aria-controls="ppc-panel-games" aria-selected="<%= activeTab === 'games' %>">🎮 All Games<% if (catalog.counts.all) { %> <span class="ppc-tab-n"><%= catalog.counts.all %></span><% } %></button>
  <button type="button" role="tab" class="ppc-tab<%= activeTab === 'monthly' ? ' on' : '' %>" data-tab="monthly" aria-controls="ppc-panel-monthly" aria-selected="<%= activeTab === 'monthly' %>">📅 Monthly</button>
  <button type="button" role="tab" class="ppc-tab<%= activeTab === 'pricing' ? ' on' : '' %>" data-tab="pricing" aria-controls="ppc-panel-pricing" aria-selected="<%= activeTab === 'pricing' %>">💰 Pricing &amp; Rent</button>
</div>

<div class="ppc-panel" data-panel="pricing" id="ppc-panel-pricing" role="tabpanel"<%= activeTab === 'pricing' ? '' : ' hidden' %>>
<!-- PRICING TABLE -->
```

5c. Replace:

```ejs
    <div class="psplus-notes">
      <span>📩 PM us for full list of games available</span>
      <span>🔒 ₱100 security deposit for Trophy account</span>
      <span>🔄 Unlimited game changes, subject to slot availability</span>
    </div>
  </div>
</section>

<!-- MOST PLAYED GAMES -->
<% if (popular.length > 0) { %>
<section style="padding:3rem 2rem 2rem;max-width:1400px;margin:0 auto;">
```

with:

```ejs
    <div class="psplus-notes">
      <span>🔒 ₱100 security deposit for Trophy account</span>
      <span>🔄 Unlimited game changes, subject to slot availability</span>
    </div>
    <a href="/ps-plus/rent" class="ppc-cta ppc-cta-block">Rent PS Plus Deluxe →</a>
  </div>
</section>
</div>

<div class="ppc-panel" data-panel="games" id="ppc-panel-games" role="tabpanel"<%= activeTab === 'games' ? '' : ' hidden' %>>
<!-- MOST PLAYED GAMES — hidden by the grid script while searching or filtering -->
<% if (popular.length > 0) { %>
<section class="ppc-mostplayed" id="ppcMostPlayed">
```

5d. Replace:

```ejs
<% } %>

<!-- MONTHLY GAMES BY YEAR -->
```

with:

```ejs
<% } %>

<%- include('partials/psplus-catalog-grid') %>
</div>

<div class="ppc-panel" data-panel="monthly" id="ppc-panel-monthly" role="tabpanel"<%= activeTab === 'monthly' ? '' : ' hidden' %>>
<!-- MONTHLY GAMES BY YEAR -->
```

5e. Replace:

```ejs
<% }) %>

<section style="padding:0 2rem 3rem;max-width:1400px;margin:0 auto;">
```

with:

```ejs
<% }) %>
</div>

<section style="padding:0 2rem 3rem;max-width:1400px;margin:0 auto;">
```

5f. Replace:

```ejs
<script>
function openPsplusModal(dataStr) {
```

with:

```ejs
<script>
// Tabs. The server already rendered the right panel open (?tab=, or Monthly
// for a ?month= deep link), so this only handles clicks — and keeps ?tab= in
// the address so a refresh or a shared link lands on the same tab.
(function () {
  var tabs = document.querySelectorAll('.ppc-tab');
  var panels = document.querySelectorAll('.ppc-panel');
  function show(name) {
    panels.forEach(function (p) { p.hidden = p.dataset.panel !== name; });
    tabs.forEach(function (t) {
      var on = t.dataset.tab === name;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', String(on));
    });
    var u = new URL(location.href);
    u.searchParams.set('tab', name);
    u.searchParams.delete('game');
    u.searchParams.delete('month');
    history.replaceState(null, '', u);
  }
  tabs.forEach(function (t) { t.addEventListener('click', function () { show(t.dataset.tab); }); });
})();

function openPsplusModal(dataStr) {
```

- [ ] **Step 6: Feed the page — `server.js`** (Edit tool)

Replace:

```js
  const psplusSlug = psplusGame ? gameSlug(psplusGame.title) : null;
  // PS Plus has one real catalog entry behind it, so a review naming it floats.
  res.render('ps-plus', Object.assign({ byYear, years, popular, prices: getPsplusPrices(), slots,
```

with:

```js
  const psplusSlug = psplusGame ? gameSlug(psplusGame.title) : null;
  // All Games tab: every PS Plus Deluxe game with the owner's monthly games
  // folded in (lib/psplus-catalog-view.js). Opens on that tab unless ?tab=
  // says otherwise, or a ?month= deep link needs the Monthly tab.
  const catalog = psplusCatalogView.buildPublicCatalog({
    games: psplusCatalogStore.all(), siteGames: getGames(), entries, slugFor: gameSlug
  });
  const activeTab = ['games', 'monthly', 'pricing'].includes(req.query.tab) ? req.query.tab : (req.query.month ? 'monthly' : 'games');
  const weeklyPrices = [(getPsplusPrices() || {}).nt_price_7d, (getPsplusPrices() || {}).tr_price_7d].map(Number).filter(n => n > 0);
  const fromWeekly = weeklyPrices.length ? Math.min(...weeklyPrices) : 0;
  // PS Plus has one real catalog entry behind it, so a review naming it floats.
  res.render('ps-plus', Object.assign({ byYear, years, popular, prices: getPsplusPrices(), slots, catalog, activeTab, fromWeekly,
```

- [ ] **Step 7: Verify**

```bash
node --check server.js
node scripts/test-psplus-page.js
node scripts/test-psplus-admin-catalog.js
file server.js views/ps-plus.ejs
```

Expected:
- `node --check` prints nothing.
- `test-psplus-page.js` ends `11 assertions passed`, and `test-psplus-admin-catalog.js` still ends `16 assertions passed`.
- Both files are still `UTF-8 (with BOM)` with CRLF.

- [ ] **Step 8: Commit**

```bash
git add public/css/psplus-catalog.css views/partials/psplus-catalog-grid.ejs views/ps-plus.ejs server.js scripts/test-psplus-page.js
git commit -m "$(cat <<'EOF'
PS Plus page: every Deluxe game, searchable, in an All Games tab

/ps-plus opens on All Games (search, sort, platform and list filters,
PlayStation covers, a quick-view sheet with the Rent button), with the
month cards and pricing on their own tabs. The link out to
playstation.com and the "PM us for the list" note are gone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: PS Plus in the menu and in site search

**Files:**
- Modify: `views/partials/nav.ejs` (CRLF, **Edit tool only**)
- Modify: `server.js` (CRLF + BOM, **Edit tool only**)
- Test: `scripts/test-psplus-routes.js`

**Interfaces:**
- Consumes:
  - Task 2 `matchKey`;
  - Task 3 `coverUrl`;
  - Task 4 `all()` / `_reset()`;
  - Task 6 `/ps-plus` (`?game=` deep link, panel ids).
- Produces:
  - `/api/search-index` entries `{ t, p: 'Included in PS Plus Deluxe', u: '/ps-plus?game=<encoded key>', y: 'psplus', img }` for every visible catalog game.
  - A nav `PS Plus` link (`navActive === 'psplus'`) in both menus.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-psplus-routes.js`:

```js
// Run: node scripts/test-psplus-routes.js
//
// Boots the real server in-process (the pattern of
// scripts/test-order-routes-error-handling.js), puts a few games in the PS
// Plus catalog store's in-memory copy, and checks the two public routes that
// read it: GET /ps-plus opens the right tab and lists the games, and GET
// /api/search-index offers them as "Included in PS Plus Deluxe". Both are
// public GETs — no admin login. Also checks the nav links PS Plus in both
// menus.
//
// The server runs against a throwaway DATA_DIR (a fresh games.json it creates
// itself, deleted afterwards) and with MONGODB_URI blanked, so neither the
// project's games.json nor any database is ever touched.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4591;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'psplus-routes-'));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path: p, timeout: 8000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
  });
}

async function main() {
  require('../server.js');
  const store = require('../lib/psplus-catalog-store');
  const { OWNER_DEFAULTS } = require('../lib/psplus-catalog');
  const game = (id, name, extra) => Object.assign({}, OWNER_DEFAULTS, {
    key: 'c:' + id, source: 'feed', concept_id: String(id), name, name_raw: name, lists: ['catalog'],
    image_url: 'https://image.api.playstation.com/' + id + '.png', platforms: ['PS5'], genres: ['ACTION'],
    release_date: '2020-01-01', store_url: 'https://store.playstation.com/en-id/concept/' + id, first_seen_at: '2026-09-27T00:00:00.000Z'
  }, extra || {});

  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await get('/ps-plus'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');
  store._reset([
    game(900001, 'Zzyzx Test Quest'),
    game(900002, 'Zzyzx Hidden Game', { hidden: true })
  ]);

  console.log('\nGET /ps-plus');

  await okAsync('opens on All Games, with the games in its list', async () => {
    const r = await get('/ps-plus');
    assert.strictEqual(r.status, 200);
    assert.ok(/data-panel="games" id="ppc-panel-games" role="tabpanel">/.test(r.body), 'All Games open');
    assert.ok(r.body.includes('"n":"Zzyzx Test Quest"'));
    assert.ok(!r.body.includes('Zzyzx Hidden Game'), 'a hidden game is not on the page');
    assert.ok(r.body.includes('/css/psplus-catalog.css'));
  });

  await okAsync('?tab=pricing and a ?month= deep link open their tabs', async () => {
    assert.ok(/data-panel="pricing" id="ppc-panel-pricing" role="tabpanel">/.test((await get('/ps-plus?tab=pricing')).body));
    assert.ok(/data-panel="monthly" id="ppc-panel-monthly" role="tabpanel">/.test((await get('/ps-plus?month=1')).body));
    assert.ok(/data-panel="games" id="ppc-panel-games" role="tabpanel">/.test((await get('/ps-plus?tab=nonsense')).body));
  });

  await okAsync('the nav shows PS Plus, marked as the current page', async () => {
    const r = await get('/ps-plus');
    assert.strictEqual((r.body.match(/<a href="\/ps-plus" class="active">PS Plus<\/a>/g) || []).length, 2, 'desktop menu and phone drawer');
  });

  console.log('\nGET /api/search-index');

  await okAsync('offers visible catalog games as included in PS Plus Deluxe', async () => {
    const r = await get('/api/search-index');
    assert.strictEqual(r.status, 200);
    const index = JSON.parse(r.body);
    const hit = index.find(x => x.t === 'Zzyzx Test Quest');
    assert.deepStrictEqual(hit, {
      t: 'Zzyzx Test Quest', p: 'Included in PS Plus Deluxe', u: '/ps-plus?game=c%3A900001',
      y: 'psplus', img: 'https://image.api.playstation.com/900001.png?w=120'
    });
    assert.ok(!index.some(x => x.t === 'Zzyzx Hidden Game'));
  });

  console.log('\nnav source');

  await okAsync('both menus link PS Plus between Buy and Requests', async () => {
    const nav = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'nav.ejs'), 'utf8');
    assert.strictEqual((nav.match(/>Buy<\/a>\r?\n\s*<a href="\/ps-plus" class="<%= navActive === 'psplus' \? 'active' : '' %>">PS Plus<\/a>\r?\n\s*<a href="\/requests"/g) || []).length, 2);
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-psplus-routes.js`
Expected: the two `/ps-plus` checks pass (Task 6), then FAIL at `the nav shows PS Plus, marked as the current page`.

- [ ] **Step 3: The menu — `views/partials/nav.ejs`** (Edit tool)

3a. The desktop menu (four-space indent). Replace:

```ejs
    <a href="/buy" class="<%= navActive === 'buy' ? 'active' : '' %>">Buy</a>
    <a href="/requests"
```

with:

```ejs
    <a href="/buy" class="<%= navActive === 'buy' ? 'active' : '' %>">Buy</a>
    <a href="/ps-plus" class="<%= navActive === 'psplus' ? 'active' : '' %>">PS Plus</a>
    <a href="/requests"
```

3b. The phone drawer (two-space indent). Replace:

```ejs
  <a href="/buy" class="<%= navActive === 'buy' ? 'active' : '' %>">Buy</a>
  <a href="/requests"
```

with:

```ejs
  <a href="/buy" class="<%= navActive === 'buy' ? 'active' : '' %>">Buy</a>
  <a href="/ps-plus" class="<%= navActive === 'psplus' ? 'active' : '' %>">PS Plus</a>
  <a href="/requests"
```

- [ ] **Step 4: Site search — `server.js`** (Edit tool; three edits in `app.get('/api/search-index', …)`)

4a. Replace:

```js
  const seenTitles = new Set(psplus.map(x => x.t.toLowerCase()));
```

with:

```js
  // Every visible PS Plus Deluxe game, labelled as included, opening its
  // quick-view sheet on /ps-plus. A monthly line that is also a catalog game
  // is left to this richer entry.
  const psplusCatalogEntries = psplusCatalogStore.all().filter(g => !g.hidden).map(g => ({
    t: g.name || g.name_raw, p: 'Included in PS Plus Deluxe', u: '/ps-plus?game=' + encodeURIComponent(g.key),
    y: 'psplus', img: psplusCatalogView.coverUrl(g, 120)
  }));
  const catalogKeys = new Set(psplusCatalogEntries.map(x => psplusCatalog.matchKey(x.t)));
  const seenTitles = new Set(psplus.map(x => x.t.toLowerCase()));
```

4b. Replace:

```js
      if (seenTitles.has(key)) return;
      seenTitles.add(key);
```

with:

```js
      if (seenTitles.has(key)) return;
      if (catalogKeys.has(psplusCatalog.matchKey(title))) return;
      seenTitles.add(key);
```

4c. Replace:

```js
  res.json([...available, ...soon, ...psplus, ...psplusMonthly, ...requested]);
```

with:

```js
  res.json([...available, ...soon, ...psplus, ...psplusCatalogEntries, ...psplusMonthly, ...requested]);
```

- [ ] **Step 5: Verify**

```bash
node --check server.js
sha1sum games.json > "$SCRATCH/games.sha1"
node scripts/test-psplus-routes.js
sha1sum -c "$SCRATCH/games.sha1"
node scripts/test-psplus-page.js
file server.js views/partials/nav.ejs
```

Expected:
- `node --check` prints nothing.
- `test-psplus-routes.js` ends `5 assertions passed`.
- `sha1sum -c` prints `games.json: OK`. The test ran the server on its own throwaway data folder.
- `test-psplus-page.js` still ends `11 assertions passed`.
- `server.js` is still BOM + CRLF, and `nav.ejs` is still CRLF.

- [ ] **Step 6: Commit**

```bash
git add views/partials/nav.ejs server.js scripts/test-psplus-routes.js
git commit -m "$(cat <<'EOF'
PS Plus in the top menu, and catalog games in site search

The menu gets a PS Plus item (desktop and phone). Searching a game that
is in PS Plus Deluxe shows it as "Included in PS Plus Deluxe" and opens
its quick-view sheet on /ps-plus.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Browser check with fixtures, and full regression

No repo changes unless a defect is found. If one is, fix it, re-run the affected tests, and commit separately. **Nothing here touches the live admin, a database or production data.** The pages are rendered to static HTML from the saved feed.

**Files (scratch only; `$SCRATCH` = the session scratchpad):**
- `$SCRATCH/psplus-check/build.js`
- `$SCRATCH/psplus-check/serve.js`

- [ ] **Step 1: Build and serve the two fixture pages**

Create `$SCRATCH/psplus-check/build.js`:

```js
// Renders the real /ps-plus page and the real admin PS Plus tab to static
// HTML from the saved PlayStation feed — no server, no database, no login.
// Usage: node build.js <repo root>
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(process.argv[2] || '.');
const ejs = require(path.join(REPO, 'node_modules', 'ejs'));
const feed = require(path.join(REPO, 'lib', 'psplus-feed'));
const cat = require(path.join(REPO, 'lib', 'psplus-catalog'));
const view = require(path.join(REPO, 'lib', 'psplus-catalog-view'));

const FIX = path.join(REPO, 'scripts', 'fixtures', 'psplus-feed');
const list = n => ({ ok: true, games: feed.parseFeed(JSON.parse(fs.readFileSync(path.join(FIX, n + '.json'), 'utf8'))), reason: '' });
const results = { catalog: list('catalog'), classics: list('classics'), ubisoft: list('ubisoft'), monthly: list('monthly') };
const slugFor = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Stored = a first refresh of the saved feed, then a few owner choices.
const stored = cat.applyPlan([], cat.mergeFeed(results), ['catalog', 'classics', 'ubisoft'], '2026-09-20T05:00:00.000Z').upserts;
stored.slice(0, 40).forEach((g, i) => { g.first_seen_at = '2026-09-27T05:00:00.000Z'; });
const hide = stored.find(g => g.name === 'ARMORED CORE');
if (hide) Object.assign(hide, { hidden: true, hidden_note: 'not on our region' });
const SITE = [{ id: 8, title: 'God of War Ragnarök' }, { id: 9, title: 'The Last of Us Part I' }, { id: 10, title: 'Tekken 8' }];
const ENTRIES = [
  { id: 1, year: 2026, month: 9, month_name: 'September', games_list: 'Returnal\nSuicide Squad: Kill the Justice League', cover_image: '', notes: '' },
  { id: 2, year: 2026, month: 8, month_name: 'August', games_list: 'Stray\nMadden NFL 26', cover_image: '', notes: '' }
];
const POPULAR = [{ id: 1, title: 'Ghost of Tsushima', platform: 'PS5', genre: 'Action', rank: 1, cover_image: '' },
  { id: 2, title: "Marvel's Spider-Man Remastered", platform: 'PS5', genre: 'Action', rank: 2, cover_image: '' }];

// Customer page.
const VIEW = path.join(REPO, 'views', 'ps-plus.ejs');
const catalog = view.buildPublicCatalog({ games: stored, siteGames: SITE, entries: ENTRIES, slugFor });
const page = ejs.render(fs.readFileSync(VIEW, 'utf8'), {
  settings: { title: 'PlayStation Hub', favicon_path: '/favicon.svg', logo_path: '/logo.png' },
  assetV: 'check', announcement: null, announcements: [],
  byYear: { 2026: ENTRIES.slice().sort((a, b) => a.month - b.month) }, years: ['2026'], popular: POPULAR,
  prices: { nt_price_7d: 120, nt_price_30d: 350, tr_price_7d: 150, tr_price_30d: 450 },
  slots: { nt_slots: 2, tr_slots: 1, ps4_slots: 0 }, psplusGameId: 17, psplusSlug: 'ps-plus-deluxe',
  catalog, activeTab: 'games', fromWeekly: 120,
  reviews: [], reviewStats: null, recommend: null, reviewBadge: null, reviewDisplayName: null
}, { filename: VIEW });
fs.writeFileSync(path.join(__dirname, 'ps-plus.html'), page);

// Admin PS Plus tab, with a Refresh preview open: 9 games "new", 5 "leaving",
// Classics held back as empty, and next month's suggestion.
const SHELL = path.join(REPO, 'views', 'partials', 'admin', 'psplus.ejs');
const before = stored.filter((g, i) => i % 50 !== 0);                        // pretend 9-ish are new
const leaving = cat.applyPlan([], cat.mergeFeed({ catalog: { ok: true, games: [
  { concept_id: '1', name_raw: 'Old Game One', image_url: '', platforms: ['PS4'], genres: [], release_date: '', store_url: '' }] } }), ['catalog'], 'x').upserts;
const storedForPreview = before.concat(leaving);
const previewResults = Object.assign({}, results, { classics: { ok: true, games: [], reason: '' } });
const preview = cat.buildPreview(storedForPreview, previewResults);
const admin = ejs.render(fs.readFileSync(SHELL, 'utf8'), {
  psplusCatalog: Object.assign(view.buildAdminCatalog({ games: stored, siteGames: SITE, entries: ENTRIES,
    meta: { last_refreshed_at: '2026-09-24T02:00:00.000Z' }, now: new Date('2026-09-27T05:00:00.000Z') }), {
    preview: view.previewView(preview, POPULAR.map(p => p.title), 12), previewToken: 'check-token', previewExpired: false,
    monthSuggestion: view.monthSuggestion(preview.monthlyNames, ENTRIES, '2026-10-02'), siteGames: SITE
  }),
  psplus: ENTRIES, psplusPopular: POPULAR, psplusPrices: { nt_price_7d: 120, nt_price_30d: 350, tr_price_7d: 150, tr_price_30d: 450 }
}, { filename: SHELL });
fs.writeFileSync(path.join(__dirname, 'admin.html'), '<!DOCTYPE html><html><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css">'
  + '<style>body{background:#0a0a0a;color:#eee;padding:16px;font-family:system-ui,sans-serif}.tab-panel{display:block!important}</style>'
  + '</head><body>' + admin
  + '<script>document.addEventListener("submit",function(e){e.preventDefault();window.__submitted=(window.__submitted||[]).concat([e.target.getAttribute("action")]);},true);'
  + 'HTMLFormElement.prototype.submit=function(){window.__submitted=(window.__submitted||[]).concat([this.getAttribute("action")+" "+new URLSearchParams(new FormData(this)).toString()]);};</script>'
  + '</body></html>');
console.log('wrote ps-plus.html (' + catalog.counts.all + ' games) and admin.html');
```

Create `$SCRATCH/psplus-check/serve.js`:

```js
// Serves the two fixture pages from build.js plus the repo's real CSS.
// Usage: node serve.js <repo root>   → http://localhost:4596/ps-plus.html, /admin.html
const http = require('http');
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(process.argv[2] || '.');
const TYPES = { '.html': 'text/html', '.css': 'text/css' };
http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  let file = null;
  if (p === '/ps-plus.html' || p === '/admin.html') file = path.join(__dirname, p.slice(1));
  else if (/^\/css\/[a-z0-9-]+\.css$/.test(p)) file = path.join(REPO, 'public', p);
  if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] + '; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
}).listen(4596, () => console.log('fixture pages on http://localhost:4596'));
```

```bash
REPO="C:/Users/michael/Desktop/claude code/playstation-hub"
cd "$SCRATCH/psplus-check" && node build.js "$REPO" && (node serve.js "$REPO" > serve.log 2>&1 &) ; sleep 1; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4596/ps-plus.html
```

Expected: `wrote ps-plus.html (517 games) and admin.html`, then `200`.

- [ ] **Step 2: Check `http://localhost:4596/ps-plus.html` (Browser pane, desktop)**

1. **Menu and top section.**
   - The menu shows **PS Plus**, underlined as the current page.
   - The hero shows `517 GAMES`, `₱120 / WEEK`, `● 3 SLOTS FREE` and **Rent PS Plus Deluxe →**.
   - The tabs read All Games 517 · Monthly · Pricing & Rent.
2. **The grid.**
   - It shows PlayStation's covers with gold CATALOG, blue CLASSIC and grey UBISOFT+ tags.
   - 48 cards show at first, and more load when you scroll to the bottom.
3. **Controls.** Run these with `javascript_tool`:
   - search `god of war` gives 3 cards, the heading reads `🎮 3 of 517 games · A–Z`, and Most Played is hidden;
   - the Classics chip shows only CLASSIC cards;
   - the Monthly chip shows Returnal plus the Stray, Madden NFL 26 and Suicide Squad tiles;
   - the Also for rent chip shows God of War Ragnarök and The Last of Us Part I;
   - sort by Release date hides Most Played, and sorting back to A–Z brings it back;
   - PS4 only reduces the count.
4. **The sheet.** Click God of War Ragnarök. It shows:
   - `PS5 · PS4 · Action`;
   - `✓ Included in PS Plus Deluxe · Game Catalog`;
   - `Rent PS Plus Deluxe · from ₱120/week`;
   - the green link to `/game/god-of-war-ragnar-k`;
   - the store link.

   Focus sits on ✕, and Escape closes it.
5. **Tabs.** Clicking Monthly shows the month cards and sets `?tab=monthly`. Clicking back to All Games works.
6. **Console.** `read_console_messages` with `onlyErrors: true` shows nothing but 404s for the logo and favicon, which this static server doesn't serve.

- [ ] **Step 3: Phone (375×812, `resize_window`), then reset to `desktop`**

- On `/ps-plus.html`, `document.documentElement.scrollWidth === innerWidth` (no sideways scroll), and the grid has 3 columns.
- All three tabs fit: the last tab's right edge is ≤ 375.
- `/ps-plus.html?game=c%3A10001850` opens God of War Ragnarök's sheet, sitting at the bottom of the screen.

- [ ] **Step 4: Check `http://localhost:4596/admin.html`**

The page catches form posts and records them in `window.__submitted`.

1. The card sits at the top.
   - Header: "last refreshed Sep 24, 2026 (3 days ago)".
   - The preview shows the red "Classics came back with 0 games" note, pills with `+ … new / − 1 leaving`, New and Leaving columns, the October suggestion, and **Apply the 2 lists that look OK**.
2. **The table.**
   - It shows 50 rows with "Show more (… left)", and Show more gives 100.
   - Searching `armored` shows ARMORED CORE as hidden, with its note.
   - Clicking its switch records `…/c%3A10010252/visibility hidden=0`.
   - With `window.prompt` stubbed, hiding Returnal records `hidden=1&note=…`.
   - Changing its "Also for rent" select records `…/rent-link … rent=<id>`.
3. **Chips.** Hidden shows ARMORED CORE, and Also for rent shows the two linked games.
4. **Month suggestion.** Clicking "Create Oct 2026 entry from these" fills the Add Monthly form below: year 2026, month 10, and six games, one per line.
5. **Phone width.** `scrollWidth === innerWidth` at 375.

- [ ] **Step 5: Clean up**

```bash
for pid in $(netstat -ano | grep ':4596' | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //F //PID "$pid"; done
rm -rf "$SCRATCH/psplus-check"
cd "C:/Users/michael/Desktop/claude code/playstation-hub" && git status --short
```

Expected: nothing from this task. Only the long-standing untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` remains.

- [ ] **Step 6: Full regression run**

```bash
cd "C:/Users/michael/Desktop/claude code/playstation-hub"
for f in scripts/test-*.js; do timeout 120 node "$f" > "$SCRATCH/out.txt" 2>&1 || { echo "FAILED: $f"; tail -20 "$SCRATCH/out.txt"; }; done
git status --short
```

Expected:
- No `FAILED:` line except `scripts/test-requests-page.js`. That one already failed before this work and is out of scope, so report it rather than fixing it.
- `git status` shows nothing new.
