# Coming soon — "Update from PlayStation" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A button on Admin → Games → Coming soon that lists PlayStation's announced, dated PS5/PS4 games the site doesn't have yet (plus Coming soon games whose date moved), lets the owner tick which to add with one shared set of prices and slots, and adds them with PlayStation's cover, description and screenshots.

**Architecture:** Three small libraries: `lib/upcoming-psn.js` (the rules, with no network or disk of its own), `lib/upcoming-psn-feed.js` (one read of PlayStation's public site-search index) and `lib/remote-image.js` (saves a PlayStation image as a WebP in the uploads folder). `server.js` gains three routes (refresh, apply, cancel) that keep each check's list in memory for 30 minutes under a random token, the same pattern as the PS Plus catalog refresh. The admin page gains one partial (`psn-update.ejs`) at the top of the Coming soon sub-tab, a tiny browser script for the live tick count, toasts and styles.

**Tech Stack:** Node 24 (global `fetch`), Express, EJS, lowdb (`db.get('upcoming')`), sharp. Tests are plain `node scripts/test-*.js` files.

Spec: `docs/superpowers/specs/2026-10-10-upcoming-from-playstation-design.md`.

Every file in this plan was dry-run in a scratch copy of the repo: all five new test files pass, and the full suite stays green apart from the known `scripts/test-requests-page.js`. The panel was also checked in a browser on a throwaway instance (computer and 375px phone widths, dark and light mode, a real apply), with no console or server errors.

## Global Constraints

- Work directly on `main`; **push only when the owner says "push"**.
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Line endings: `server.js` is CRLF + UTF-8 BOM; `public/css/style.css` is CRLF; `views/admin.ejs`, `views/partials/admin/games/coming-soon.ejs` and `public/js/admin-games.js` are LF. The edit scripts (via `.superpowers/tmp-edits/rep.js`) keep each file's endings and BOM; check with `file` after each edit. New files are LF.
- Tests never reach PlayStation, a database or the real admin: temp `DATA_DIR`, blank `MONGODB_URI`, the in-memory session store, a made-up admin password, and stubbed `fetch` / stubbed module functions. Never write the project's `games.json`.
- PlayStation source: the Algolia site-search index `crawler_en-us`, using the constants already exported by `lib/psplus-title-search.js`. No PlayStation account, login or session anywhere.
- Images are downloaded only from `https://image.api.playstation.com/`: at most 10 MB, 15 s timeout, saved as WebP (max 900 px, quality 82) in the uploads folder.
- Lists live in memory for 30 minutes; one apply at a time; 3 games built at a time; at most 6 screenshots per game; the skipped list is `site_settings.upcoming_psn_skipped`, newest 200 kept.
- Messages (`?msg=`): `psn_upcoming_preview`, `psn_upcoming_applied`, `psn_upcoming_partial`, `psn_upcoming_expired`, `psn_upcoming_unreachable`, `psn_upcoming_nothing`, `psn_upcoming_busy`, `psn_upcoming_cancelled`.
- Known unrelated failure: `scripts/test-requests-page.js`. Report it, do not fix it.
- Edit scripts live in `.superpowers/tmp-edits/` (git-ignored); never commit them; Task 5 removes the folder.
- Always `git add` explicit paths: the untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` must never be committed.

## Files

| File | Task | Job |
|---|---|---|
| `lib/upcoming-psn.js` (new) | 1 | Title clean-up and matching, preview, form reading, apply plan, record building |
| `scripts/test-upcoming-psn.js` (new) | 1 | Unit test of the rules |
| `lib/upcoming-psn-feed.js` (new) | 2 | The one PlayStation index query; never throws |
| `scripts/test-upcoming-psn-feed.js` (new) | 2 | Query and parsing, stubbed fetch |
| `lib/remote-image.js` (new) | 3 | Save one PlayStation image as a WebP upload; never throws |
| `scripts/test-remote-image.js` (new) | 3 | Host check, limits, real WebP output in a temp folder |
| `server.js` | 4 | Requires, three routes, the list handed to the admin page |
| `scripts/test-admin-upcoming-psn.js` (new) | 4 | Routes on a throwaway instance |
| `views/partials/admin/games/psn-update.ejs` (new) | 5 | Button and panel |
| `views/partials/admin/games/coming-soon.ejs` | 5 | Includes the panel at the top |
| `views/admin.ejs` | 5 | Tab mapping, toasts with counts, loading-overlay words, script tag |
| `public/js/admin-games.js` | 5 | Opens Coming soon for every `psn_upcoming_*` message |
| `public/js/admin-upcoming-psn.js` (new) | 5 | Live tick count on the gold button |
| `public/css/style.css` | 5 | `.gmp-*` panel styles, phone and light mode |
| `scripts/test-admin-upcoming-psn-page.js` (new) | 5 | What the admin page shows |

---

### Task 1: The rules (`lib/upcoming-psn.js`)

**Files:**
- Create: `lib/upcoming-psn.js`
- Test: `scripts/test-upcoming-psn.js`

**Interfaces:**
- Consumes: `titleCandidates(title)` from `lib/psn-game.js` (existing; returns `[title]` or `[title, titleWithoutEditionSuffix]`).
- Produces (all exported from `lib/upcoming-psn.js`):
  - `PRICE_FIELDS` = `['nt_price_7d', 'nt_price_30d', 'tr_price_7d', 'tr_price_30d', 'non_trophy_slots', 'trophy_slots']`, `MAX_SCREENSHOTS` = 6, `MAX_SKIPPED` = 200
  - `cleanTitle(s) → string`, `matchKey(s) → string`, `mapGenre(genres[]) → string`, `manilaDate(ms) → 'YYYY-MM-DD'`, `platformOf(platforms[]) → 'PS5' | 'PS4' | 'PS4/PS5' | ''`, `dateLabel(ymd) → 'Oct 15, 2026' | 'TBA' | '—'`, `applyLabel(adds, dates) → string`
  - `buildPreview({ upcoming, games, feedGames, skipped }) → { fresh, skippedBefore, dateChanges, already, defaults, defaultsFrom }`. `fresh` and `skippedBefore` are feed games with an added `genre`. `dateChanges` items are `{ id, title, from, to, concept_id }`. `already` is the site's titles. `defaults` is keyed by `PRICE_FIELDS`. `defaultsFrom` is a title or `''`.
  - `previewView(preview, { token, checkedAt }) → { token, checkedLabel, fresh, skippedBefore, dateChanges, already, defaults, defaultsFrom, upToDate, applyText }`. Rows gain `dateLabel`, and changes gain `fromLabel` and `toLabel`.
  - `readForm(body) → { add: string[], dates: number[], titles: { [conceptId]: string }, prices: { [PRICE_FIELD]: number } }`
  - `planApply({ preview, form, upcoming, games, skipped }) → { adds, prices, dateUpdates: [{ id, release_date, concept_id }], skipped: string[] }`
  - `newUpcomingRecord(game, { prices, description, genre, cover_image, gallery, nowIso }) → record without id`
  - `buildRecord(game, { prices, nowIso, fetchInfo, saveImage }) → Promise<{ record, complete }>`. `fetchInfo(conceptId)` returns `{ ok, psn }` and `saveImage(url)` returns `'/uploads/…'` or `''`.
  - `mapLimit(items, limit, fn) → Promise<results[]>` (order kept)
- A feed game, as produced in Task 2, is `{ concept_id, title, raw_title, release_date, platform, genres, publisher, image_url }`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-upcoming-psn.js`:

````js
// Run: node scripts/test-upcoming-psn.js
//
// The rules behind Coming soon → "Update from PlayStation" (lib/upcoming-psn.js):
// title clean-up and matching, the preview's four groups, the apply form and
// plan, and the record a ticked game becomes. Pure — no network, disk or server.
const assert = require('assert');
const u = require('../lib/upcoming-psn');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const feed = (id, title, release_date, extra) => Object.assign({
  concept_id: String(id), title, raw_title: title, release_date, platform: 'PS5',
  genres: ['Action'], publisher: 'Pub', image_url: 'https://image.api.playstation.com/' + id + '.png'
}, extra || {});

async function main() {
  console.log('\ntitles');
  ok('cleanTitle drops marks and a trailing Standard Edition, keeps other editions', () => {
    assert.strictEqual(u.cleanTitle('Call of Duty®: Modern Warfare® 4'), 'Call of Duty: Modern Warfare 4');
    assert.strictEqual(u.cleanTitle('God of War Laufey™'), 'God of War Laufey');
    assert.strictEqual(u.cleanTitle('Fable Standard Edition'), 'Fable');
    assert.strictEqual(u.cleanTitle('Grand Theft Auto VI: Ultimate Edition'), 'Grand Theft Auto VI: Ultimate Edition');
    assert.strictEqual(u.cleanTitle('  Two   Spaces  '), 'Two Spaces');
  });
  ok('matchKey treats punctuation, marks, accents and edition words as the same game', () => {
    assert.strictEqual(u.matchKey('Grand Theft Auto VI: Ultimate Edition'), u.matchKey('Grand Theft Auto VI Ultimate Edition'));
    assert.strictEqual(u.matchKey('Grand Theft Auto VI Ultimate Edition'), u.matchKey('Grand Theft Auto VI'));
    assert.strictEqual(u.matchKey('Fable Standard Edition'), u.matchKey('Fable'));
    assert.strictEqual(u.matchKey('Marvel’s Wolverine'), u.matchKey("Marvel's Wolverine"));
    assert.strictEqual(u.matchKey('MARVEL Tōkon'), u.matchKey('Marvel Tokon'));
    assert.strictEqual(u.matchKey('Call of Duty®: Modern Warfare® 4'), 'callofdutymodernwarfare4');
    assert.notStrictEqual(u.matchKey('Madden NFL 26'), u.matchKey('College Football 26'));
    assert.strictEqual(u.matchKey(''), '');
  });
  ok('genre map, platform, Manila date, date label, button words', () => {
    assert.strictEqual(u.mapGenre(['Role Playing Games', 'Action']), 'RPG');
    assert.strictEqual(u.mapGenre(['Role Playing Game (RPG)']), 'RPG');
    assert.strictEqual(u.mapGenre(['Role-Playing Games']), 'RPG');
    assert.strictEqual(u.mapGenre(['Sport']), 'Sports');
    assert.strictEqual(u.mapGenre(['', 'Horror']), 'Horror');
    assert.strictEqual(u.mapGenre([]), '');
    assert.strictEqual(u.platformOf(['PS4', 'PS5']), 'PS4/PS5');
    assert.strictEqual(u.platformOf(['PS5']), 'PS5');
    assert.strictEqual(u.platformOf(['PS4', 'PS VR2']), 'PS4');
    assert.strictEqual(u.platformOf(['PS VR2']), '');
    assert.strictEqual(u.manilaDate(Date.UTC(2026, 9, 14, 15, 59)), '2026-10-14', '23:59 in Manila');
    assert.strictEqual(u.manilaDate(Date.UTC(2026, 9, 14, 16, 0)), '2026-10-15', 'midnight in Manila');
    assert.strictEqual(u.dateLabel('2026-10-15'), 'Oct 15, 2026');
    assert.strictEqual(u.dateLabel('TBA'), 'TBA');
    assert.strictEqual(u.dateLabel(''), '—');
    assert.strictEqual(u.applyLabel(3, 1), 'Add 3 games · update 1 date');
    assert.strictEqual(u.applyLabel(1, 0), 'Add 1 game');
    assert.strictEqual(u.applyLabel(0, 2), 'Update 2 dates');
    assert.strictEqual(u.applyLabel(0, 0), 'Add selected');
  });

  console.log('\npreview');
  const upcoming = [
    { id: 1, title: 'Grand Theft Auto VI Ultimate Edition', release_date: '2026-11-19', created_at: '2026-09-01T00:00:00.000Z', nt_price_7d: 349, nt_price_30d: 1099, tr_price_7d: 449, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1 },
    { id: 2, title: 'Phantom Blade Zero', release_date: '2026-10-29', created_at: '2026-08-01T00:00:00.000Z', nt_price_7d: 1 },
    { id: 3, title: "Dragon's Dogma 2: Dark Arisen", release_date: 'TBA', created_at: '2026-07-01T00:00:00.000Z' },
    { id: 4, title: 'Renamed By Owner', psn_concept_id: '500', release_date: '2027-01-01', created_at: '2026-06-01T00:00:00.000Z' }
  ];
  const games = [
    { id: 10, title: 'Fable' },
    { id: 11, title: 'Old Game With Psn', psn: { concept_id: '700' } }
  ];
  const feedGames = [
    feed(100, 'Grand Theft Auto VI: Ultimate Edition', '2026-11-19'),
    feed(101, 'Phantom Blade Zero', '2026-11-12'),
    feed(102, "Dragon's Dogma 2: Dark Arisen", '2027-03-01'),
    feed(500, 'PlayStation Name', '2027-01-01'),
    feed(103, 'Fable Standard Edition', '2027-02-23'),
    feed(700, 'Something Else Entirely', '2027-02-01'),
    feed(104, 'Castlevania: Belmont\'s Curse', '2026-10-15', { genres: ['Role Playing Games'] }),
    feed(105, 'Wandering Sword', '2027-01-21'),
    feed(104, 'Castlevania: Belmont\'s Curse', '2026-10-15'),
    feed(106, 'Castlevania: Belmont’s Curse', '2026-10-15')
  ];
  const preview = u.buildPreview({ upcoming, games, feedGames, skipped: ['105'] });
  ok('new games are the ones matching nothing; skipped ones are kept apart', () => {
    assert.deepStrictEqual(preview.fresh.map(g => g.concept_id), ['104']);
    assert.strictEqual(preview.fresh[0].genre, 'RPG');
    assert.deepStrictEqual(preview.skippedBefore.map(g => g.concept_id), ['105']);
  });
  ok('a repeated concept id or the same game under another id is listed once', () => {
    const all = preview.fresh.concat(preview.skippedBefore).map(g => g.concept_id);
    assert.ok(!all.includes('106'));
    assert.strictEqual(all.filter(id => id === '104').length, 1);
  });
  ok('date changes: moved and TBA → date; same date and concept-id match without change are not', () => {
    assert.deepStrictEqual(preview.dateChanges, [
      { id: 2, title: 'Phantom Blade Zero', from: '2026-10-29', to: '2026-11-12', concept_id: '101' },
      { id: 3, title: "Dragon's Dogma 2: Dark Arisen", from: 'TBA', to: '2027-03-01', concept_id: '102' }
    ]);
  });
  ok('already on the site: Coming soon (by key or concept id) and the catalogue (by key or psn concept id), site titles', () => {
    assert.deepStrictEqual(preview.already, ['Grand Theft Auto VI Ultimate Edition', 'Phantom Blade Zero', "Dragon's Dogma 2: Dark Arisen", 'Renamed By Owner', 'Fable', 'Old Game With Psn']);
  });
  ok('defaults come from the newest upcoming game', () => {
    assert.deepStrictEqual(preview.defaults, { nt_price_7d: 349, nt_price_30d: 1099, tr_price_7d: 449, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1 });
    assert.strictEqual(preview.defaultsFrom, 'Grand Theft Auto VI Ultimate Edition');
    const empty = u.buildPreview({ upcoming: [], games: [], feedGames: [], skipped: [] });
    assert.deepStrictEqual(empty.defaults, { nt_price_7d: 0, nt_price_30d: 0, tr_price_7d: 0, tr_price_30d: 0, non_trophy_slots: 0, trophy_slots: 0 });
    assert.strictEqual(empty.defaultsFrom, '');
  });
  ok('previewView adds labels, the up-to-date flag and the button words', () => {
    const v = u.previewView(preview, { token: 'abc', checkedAt: '2026-10-10T13:41:00.000Z' });
    assert.strictEqual(v.token, 'abc');
    assert.strictEqual(v.checkedLabel, '9:41 PM');
    assert.strictEqual(v.fresh[0].dateLabel, 'Oct 15, 2026');
    assert.strictEqual(v.dateChanges[1].fromLabel, 'TBA');
    assert.strictEqual(v.dateChanges[1].toLabel, 'Mar 1, 2027');
    assert.strictEqual(v.upToDate, false);
    assert.strictEqual(v.applyText, 'Add 1 game · update 2 dates');
    const none = u.previewView(u.buildPreview({ upcoming, games, feedGames: [], skipped: [] }), { token: 't', checkedAt: 'x' });
    assert.strictEqual(none.upToDate, true);
    assert.strictEqual(none.checkedLabel, '');
  });

  console.log('\napply');
  ok('readForm keeps digit concept ids, whole-number ids, trimmed titles and safe numbers', () => {
    const f = u.readForm({
      add: ['104', '105', '104', 'x1', '../2'], date: ['2', '3', 'zz', '-1'],
      title_104: '  Castlevania:   Belmont\'s Curse ', title_105: '   ',
      nt_price_7d: '349', nt_price_30d: '-5', tr_price_7d: 'abc', tr_price_30d: '1299.9', non_trophy_slots: '3', trophy_slots: '99999999'
    });
    assert.deepStrictEqual(f.add, ['104', '105']);
    assert.deepStrictEqual(f.dates, [2, 3]);
    assert.deepStrictEqual(f.titles, { 104: "Castlevania: Belmont's Curse" });
    assert.deepStrictEqual(f.prices, { nt_price_7d: 349, nt_price_30d: 0, tr_price_7d: 0, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1000000 });
    const single = u.readForm({ add: '104', date: '2' });
    assert.deepStrictEqual([single.add, single.dates], [['104'], [2]]);
    assert.deepStrictEqual(u.readForm(undefined).add, []);
  });
  ok('planApply adds ticked games with the owner\'s title, applies ticked date changes, remembers unticked ones', () => {
    const form = u.readForm({ add: ['105'], date: ['2'], title_105: 'Wandering Sword (PS5)' });
    const plan = u.planApply({ preview, form, upcoming, games, skipped: ['105', '900'] });
    assert.deepStrictEqual(plan.adds.map(g => [g.concept_id, g.title]), [['105', 'Wandering Sword (PS5)']]);
    assert.deepStrictEqual(plan.dateUpdates, [{ id: 2, release_date: '2026-11-12', concept_id: '101' }]);
    assert.deepStrictEqual(plan.skipped, ['900', '104'], 'ticked 105 leaves the list; unticked 104 joins it');
  });
  ok('planApply re-checks against what is stored now', () => {
    const form = u.readForm({ add: ['104', '105', '999'], date: ['3', '4'] });
    const nowUpcoming = upcoming.filter(x => x.id !== 3).concat([{ id: 9, title: 'Castlevania Belmonts Curse', release_date: '2026-10-15' }]);
    const plan = u.planApply({ preview, form, upcoming: nowUpcoming, games, skipped: [] });
    assert.deepStrictEqual(plan.adds.map(g => g.concept_id), ['105'], '104 was added by hand meanwhile; 999 was never offered');
    assert.deepStrictEqual(plan.dateUpdates, [], 'game 3 was deleted meanwhile; game 4 had no change offered');
  });
  ok('planApply never adds the same game twice in one batch, and keeps the newest 200 skipped ids', () => {
    const twin = { fresh: [feed(1, 'Same Game', '2027-01-01'), feed(2, 'Same Game: Deluxe Edition', '2027-01-01')], skippedBefore: [], dateChanges: [] };
    const plan = u.planApply({ preview: twin, form: u.readForm({ add: ['1', '2'] }), upcoming: [], games: [], skipped: [] });
    assert.deepStrictEqual(plan.adds.map(g => g.concept_id), ['1']);
    const many = Array.from({ length: 250 }, (_, i) => String(1000 + i));
    const kept = u.planApply({ preview: { fresh: [feed(5, 'X', '2027-01-01')], skippedBefore: [], dateChanges: [] }, form: u.readForm({}), upcoming: [], games: [], skipped: many }).skipped;
    assert.strictEqual(kept.length, 200);
    assert.strictEqual(kept[kept.length - 1], '5');
    assert.strictEqual(kept[0], '1051');
  });

  console.log('\nrecords');
  const prices = { nt_price_7d: 349, nt_price_30d: 1099, tr_price_7d: 449, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1 };
  ok('newUpcomingRecord has the add form\'s fields plus psn_concept_id', () => {
    const r = u.newUpcomingRecord(feed(104, 'Castlevania', '2026-10-15', { platform: 'PS4/PS5' }), { prices, description: 'D', genre: 'RPG', cover_image: '/uploads/c.webp', gallery: ['/uploads/s1.webp'], nowIso: '2026-10-10T00:00:00.000Z' });
    assert.deepStrictEqual(r, {
      title: 'Castlevania', platform: 'PS4/PS5', genre: 'RPG', release_date: '2026-10-15', description: 'D',
      cover_image: '/uploads/c.webp', gallery: ['/uploads/s1.webp'], rank: 0, non_trophy_slots: 3, trophy_slots: 1,
      nt_price_7d: 349, nt_price_30d: 1099, tr_price_7d: 449, tr_price_30d: 1299, buy_nt_price: 0, buy_tr_price: 0,
      psn_concept_id: '104', created_at: '2026-10-10T00:00:00.000Z'
    });
  });
  await okAsync('buildRecord: store page description and genre, cover, first 6 screenshots in order', async () => {
    const saved = [];
    const shots = Array.from({ length: 9 }, (_, i) => 'https://image.api.playstation.com/s' + i + '.jpg');
    const { record, complete } = await u.buildRecord(feed(104, 'Castlevania', '2026-10-15'), {
      prices, nowIso: 'now',
      fetchInfo: async id => ({ ok: true, psn: { description: 'Whip it. (' + id + ')', genres: ['Role Playing Games'], screenshots: shots } }),
      saveImage: async url => { saved.push(url); return '/uploads/' + url.split('/').pop() + '.webp'; }
    });
    assert.strictEqual(complete, true);
    assert.strictEqual(record.description, 'Whip it. (104)');
    assert.strictEqual(record.genre, 'RPG');
    assert.strictEqual(record.cover_image, '/uploads/104.png.webp');
    assert.deepStrictEqual(record.gallery, ['s0', 's1', 's2', 's3', 's4', 's5'].map(s => '/uploads/' + s + '.jpg.webp'));
    assert.strictEqual(saved.length, 7);
  });
  await okAsync('buildRecord: a failed page, a thrown error or failed images leave pieces out, never the game', async () => {
    const a = await u.buildRecord(feed(1, 'A', '2027-01-01'), { prices, nowIso: 'now', fetchInfo: async () => ({ ok: false, reason: 'timeout' }), saveImage: async () => '' });
    assert.strictEqual(a.complete, false);
    assert.strictEqual(a.record.description, '');
    assert.strictEqual(a.record.genre, 'Action', 'falls back to the index genre');
    assert.strictEqual(a.record.cover_image, '');
    const b = await u.buildRecord(feed(2, 'B', '2027-01-01'), {
      prices, nowIso: 'now',
      fetchInfo: async () => { throw new Error('boom'); },
      saveImage: async () => { throw new Error('boom'); }
    });
    assert.strictEqual(b.complete, false);
    assert.deepStrictEqual(b.record.gallery, []);
    const c = await u.buildRecord(feed(3, 'C', '2027-01-01', { image_url: '' }), { prices, nowIso: 'now', fetchInfo: async () => ({ ok: true, psn: { description: 'x', screenshots: [] } }), saveImage: async () => '/uploads/x.webp' });
    assert.strictEqual(c.complete, false, 'no cover');
  });
  await okAsync('mapLimit keeps order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const out = await u.mapLimit([5, 1, 4, 2, 3], 2, async n => {
      running++; peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, n * 3));
      running--;
      return n * 10;
    });
    assert.deepStrictEqual(out, [50, 10, 40, 20, 30]);
    assert.strictEqual(peak, 2);
    assert.deepStrictEqual(await u.mapLimit([], 3, async n => n), []);
  });

  console.log('\n' + passed + ' assertions passed\n');
}

main().catch(e => { console.error(e); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-upcoming-psn.js` → FAIL `Error: Cannot find module '../lib/upcoming-psn'`.

- [ ] **Step 3: Write the rules**

Create `lib/upcoming-psn.js`:

````js
// Coming soon → "Update from PlayStation": the rules. Which of PlayStation's
// announced games are new to the site, which Coming soon dates moved, what a
// ticked game becomes as an upcoming record, and what the owner's ticks mean.
// lib/upcoming-psn-feed.js reads PlayStation; server.js wires the routes.
// Nothing here touches the network, the disk or the database — buildRecord's
// downloads are functions handed in by the caller.
// See docs/superpowers/specs/2026-10-10-upcoming-from-playstation-design.md.
const { titleCandidates } = require('./psn-game');

const MAX_TITLE = 150;
const MAX_SKIPPED = 200;
const MAX_SCREENSHOTS = 6;
const MAX_NUMBER = 1000000;
const PRICE_FIELDS = Object.freeze(['nt_price_7d', 'nt_price_30d', 'tr_price_7d', 'tr_price_30d', 'non_trophy_slots', 'trophy_slots']);
// PlayStation's genre words → the site's, where they differ. The store page
// says "Role Playing Games", the search index "Role Playing Game (RPG)".
const GENRE_MAP = Object.freeze({ sport: 'Sports', sports: 'Sports' });
const RPG = /^role[\s-]*playing game/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MANILA_OFFSET_MS = 8 * 3600 * 1000; // UTC+8 all year, no daylight saving

// "Call of Duty®: Modern Warfare® 4" → "Call of Duty: Modern Warfare 4";
// "Fable Standard Edition" → "Fable". Other edition names stay.
function cleanTitle(s) {
  return String(s == null ? '' : s)
    .replace(/[®™©]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[-–:]?\s*standard edition$/i, '')
    .trim();
}

// The same game under slightly different names gets the same key:
// "Grand Theft Auto VI: Ultimate Edition" = "Grand Theft Auto VI Ultimate Edition"
// = "Grand Theft Auto VI". '' for a blank title, which never matches.
function matchKey(s) {
  const candidates = titleCandidates(cleanTitle(s));
  return candidates[candidates.length - 1]
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function mapGenre(genres) {
  const first = (Array.isArray(genres) ? genres : [])
    .map(g => String(g == null ? '' : g).trim())
    .find(Boolean);
  if (!first) return '';
  if (RPG.test(first)) return 'RPG';
  return GENRE_MAP[first.toLowerCase()] || first;
}

// A release timestamp (ms) → the Philippine calendar date, 'YYYY-MM-DD'.
function manilaDate(ms) {
  return new Date(Number(ms) + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

// ['PS5', 'PS4'] → 'PS4/PS5' — the three values the add form uses — or ''.
function platformOf(platforms) {
  const list = Array.isArray(platforms) ? platforms : [];
  const ps5 = list.includes('PS5');
  const ps4 = list.includes('PS4');
  if (ps5 && ps4) return 'PS4/PS5';
  return ps5 ? 'PS5' : ps4 ? 'PS4' : '';
}

// '2026-10-15' → 'Oct 15, 2026'; 'TBA' and blanks stay readable.
function dateLabel(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return ymd === 'TBA' ? 'TBA' : '—';
  return MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
}

function plural(n, one) {
  return n + ' ' + one + (n === 1 ? '' : 's');
}

// The gold button's words. public/js/admin-upcoming-psn.js has the same rule
// for live updates; scripts/test-upcoming-psn.js checks the two agree.
function applyLabel(adds, dates) {
  if (adds && dates) return 'Add ' + plural(adds, 'game') + ' · update ' + plural(dates, 'date');
  if (adds) return 'Add ' + plural(adds, 'game');
  if (dates) return 'Update ' + plural(dates, 'date');
  return 'Add selected';
}

function wholeNumber(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_NUMBER) : 0;
}

function sameConcept(a, b) {
  return a != null && b != null && String(a) !== '' && String(a) === String(b);
}

// The upcoming game added last (newest created_at, then highest id) lends its
// prices and slots to the next batch; all 0 when there is none.
function defaultsFrom(upcoming) {
  const list = (upcoming || []).filter(Boolean);
  const newest = list.slice().sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || '')) || (Number(b.id) || 0) - (Number(a.id) || 0))[0];
  const values = {};
  PRICE_FIELDS.forEach(k => { values[k] = newest ? wholeNumber(newest[k]) : 0; });
  return { values, fromTitle: newest ? String(newest.title || '') : '' };
}

// feedGames: lib/upcoming-psn-feed.js games. Returns
// { fresh, skippedBefore, dateChanges, already, defaults, defaultsFrom } —
// fresh/skippedBefore hold feed games (plus `genre`), dateChanges hold
// { id, title, from, to, concept_id } and already holds the site's titles.
function buildPreview({ upcoming, games, feedGames, skipped }) {
  const ups = (upcoming || []).filter(Boolean);
  const site = (games || []).filter(Boolean);
  const skippedSet = new Set((skipped || []).map(String));
  const seen = new Set();
  const fresh = [];
  const skippedBefore = [];
  const dateChanges = [];
  const already = [];
  (feedGames || []).forEach(g => {
    if (!g || !g.concept_id) return;
    const key = matchKey(g.title);
    if (seen.has('c' + g.concept_id) || (key && seen.has('k' + key))) return;
    seen.add('c' + g.concept_id);
    if (key) seen.add('k' + key);
    const up = ups.find(u => sameConcept(u.psn_concept_id, g.concept_id) || (key && matchKey(u.title) === key));
    if (up) {
      already.push(String(up.title || ''));
      if (up.release_date !== g.release_date) {
        dateChanges.push({ id: up.id, title: String(up.title || ''), from: up.release_date || '', to: g.release_date, concept_id: g.concept_id });
      }
      return;
    }
    const own = site.find(s => sameConcept(s.psn_concept_id, g.concept_id) || sameConcept(s.psn && s.psn.concept_id, g.concept_id) || (key && matchKey(s.title) === key));
    if (own) { already.push(String(own.title || '')); return; }
    const row = Object.assign({}, g, { genre: mapGenre(g.genres) });
    (skippedSet.has(String(g.concept_id)) ? skippedBefore : fresh).push(row);
  });
  const d = defaultsFrom(ups);
  return { fresh, skippedBefore, dateChanges, already, defaults: d.values, defaultsFrom: d.fromTitle };
}

// What the panel template shows: the preview plus labels.
function previewView(preview, { token, checkedAt }) {
  const p = preview || {};
  const withLabel = g => Object.assign({}, g, { dateLabel: dateLabel(g.release_date) });
  const fresh = (p.fresh || []).map(withLabel);
  const skippedBefore = (p.skippedBefore || []).map(withLabel);
  const dateChanges = (p.dateChanges || []).map(c => Object.assign({}, c, { fromLabel: dateLabel(c.from), toLabel: dateLabel(c.to) }));
  const checked = new Date(checkedAt);
  return {
    token,
    checkedLabel: isNaN(checked) ? '' : checked.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }),
    fresh,
    skippedBefore,
    dateChanges,
    already: (p.already || []).slice(),
    defaults: Object.assign({}, p.defaults),
    defaultsFrom: p.defaultsFrom || '',
    upToDate: !fresh.length && !skippedBefore.length && !dateChanges.length,
    applyText: applyLabel(fresh.length, dateChanges.length)
  };
}

function asList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// The apply form's body → { add, dates, titles, prices }. Concept ids are
// digits; upcoming ids are positive whole numbers; anything else is dropped.
function readForm(body) {
  const b = body || {};
  const add = [...new Set(asList(b.add).map(v => String(v).trim()).filter(v => /^\d+$/.test(v)))];
  const dates = [...new Set(asList(b.date).map(v => parseInt(v, 10)).filter(n => Number.isInteger(n) && n > 0))];
  const titles = {};
  add.forEach(id => {
    const t = String(b['title_' + id] == null ? '' : b['title_' + id]).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    if (t) titles[id] = t;
  });
  const prices = {};
  PRICE_FIELDS.forEach(k => { prices[k] = wholeNumber(b[k]); });
  return { add, dates, titles, prices };
}

// Re-planned against what is stored now, not when the preview was made: a
// ticked game that matches a Coming soon or catalogue game added since is
// skipped, and a date change for a game deleted since is dropped.
// Returns { adds, prices, dateUpdates, skipped }.
function planApply({ preview, form, upcoming, games, skipped }) {
  const p = preview || {};
  const f = form || { add: [], dates: [], titles: {}, prices: {} };
  const ups = (upcoming || []).filter(Boolean);
  const site = (games || []).filter(Boolean);
  const offered = (p.fresh || []).concat(p.skippedBefore || []);
  const ticked = new Set(f.add);
  const taken = new Set();
  const adds = [];
  offered.forEach(g => {
    if (!ticked.has(String(g.concept_id))) return;
    const title = f.titles[g.concept_id] || g.title;
    const keys = [matchKey(title), matchKey(g.title)].filter(Boolean);
    const clash = x => x && (sameConcept(x.psn_concept_id, g.concept_id) || sameConcept(x.psn && x.psn.concept_id, g.concept_id) || keys.includes(matchKey(x.title)));
    if (ups.some(clash) || site.some(clash) || keys.some(k => taken.has(k))) return;
    keys.forEach(k => taken.add(k));
    adds.push(Object.assign({}, g, { title }));
  });
  const dateUpdates = [];
  f.dates.forEach(id => {
    const change = (p.dateChanges || []).find(c => c.id === id);
    const up = ups.find(u => u.id === id);
    if (change && up && up.release_date !== change.to) dateUpdates.push({ id, release_date: change.to, concept_id: change.concept_id });
  });
  const unticked = offered.map(g => String(g.concept_id)).filter(id => !ticked.has(id));
  const keep = (skipped || []).map(String).filter(id => !ticked.has(id));
  unticked.forEach(id => { if (!keep.includes(id)) keep.push(id); });
  return { adds, prices: Object.assign({}, f.prices), dateUpdates, skipped: keep.slice(-MAX_SKIPPED) };
}

// One ticked game → an upcoming record (no id; server.js assigns it), with the
// same fields as /admin/upcoming/add plus psn_concept_id.
function newUpcomingRecord(game, { prices, description, genre, cover_image, gallery, nowIso }) {
  const pr = prices || {};
  return {
    title: game.title,
    platform: game.platform || 'PS5',
    genre: genre || '',
    release_date: game.release_date,
    description: description || '',
    cover_image: cover_image || '',
    gallery: Array.isArray(gallery) ? gallery.slice() : [],
    rank: 0,
    non_trophy_slots: wholeNumber(pr.non_trophy_slots),
    trophy_slots: wholeNumber(pr.trophy_slots),
    nt_price_7d: wholeNumber(pr.nt_price_7d),
    nt_price_30d: wholeNumber(pr.nt_price_30d),
    tr_price_7d: wholeNumber(pr.tr_price_7d),
    tr_price_30d: wholeNumber(pr.tr_price_30d),
    buy_nt_price: 0,
    buy_tr_price: 0,
    psn_concept_id: String(game.concept_id),
    created_at: nowIso
  };
}

// Fetches one game's store page and images through the functions handed in.
// fetchInfo(conceptId) → lib/psn-game fetchGameInfo's { ok, psn };
// saveImage(url) → '/uploads/…' or ''. A failure only leaves that piece out.
// Returns { record, complete } — complete when it got a cover and a description.
async function buildRecord(game, { prices, nowIso, fetchInfo, saveImage }) {
  let info = null;
  try {
    const r = await fetchInfo(game.concept_id);
    if (r && r.ok && r.psn) info = r.psn;
  } catch (e) {
    info = null;
  }
  const save = async url => {
    try { return (await saveImage(url)) || ''; } catch (e) { return ''; }
  };
  const shots = info && Array.isArray(info.screenshots) ? info.screenshots.slice(0, MAX_SCREENSHOTS) : [];
  const [cover, ...gallery] = await Promise.all([game.image_url ? save(game.image_url) : Promise.resolve('')].concat(shots.map(save)));
  const description = info && info.description ? String(info.description) : '';
  const genre = mapGenre(info && Array.isArray(info.genres) && info.genres.length ? info.genres : game.genres);
  const record = newUpcomingRecord(game, { prices, description, genre, cover_image: cover, gallery: gallery.filter(Boolean), nowIso });
  return { record, complete: !!(cover && description) };
}

// fn over items, at most `limit` at a time; results keep the items' order.
async function mapLimit(items, limit, fn) {
  const list = items || [];
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.max(1, Math.min(limit, list.length)); w++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

module.exports = {
  PRICE_FIELDS, MAX_SCREENSHOTS, MAX_SKIPPED,
  cleanTitle, matchKey, mapGenre, manilaDate, platformOf, dateLabel, applyLabel,
  buildPreview, previewView, readForm, planApply, newUpcomingRecord, buildRecord, mapLimit
};
````

- [ ] **Step 4: Run the test and watch it pass**

Run: `node scripts/test-upcoming-psn.js` → `17 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/upcoming-psn.js scripts/test-upcoming-psn.js
git commit -m "Coming soon from PlayStation: matching, preview and apply rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: PlayStation's upcoming list (`lib/upcoming-psn-feed.js`)

**Files:**
- Create: `lib/upcoming-psn-feed.js`
- Test: `scripts/test-upcoming-psn-feed.js`

**Interfaces:**
- Consumes: `ALGOLIA_URL`, `ALGOLIA_APP`, `ALGOLIA_KEY`, `ALGOLIA_INDEX` from `lib/psplus-title-search.js` (existing exports); `cleanTitle`, `manilaDate`, `platformOf` from Task 1.
- Produces:
  - `queryBody(nowMs) → JSON string`
  - `parseHits(json, nowMs) → game[] | null`, where each game is `{ concept_id, title, raw_title, release_date, platform, genres, publisher, image_url }`, sorted by date then title
  - `fetchUpcoming({ fetchImpl, now, timeoutMs }) → Promise<{ ok: true, games } | { ok: false, games: [], reason }>`. It never throws. Reasons: `timeout`, `network`, `http_<status>`, `bad_json`, `bad_shape`. Task 4's server calls `upcomingPsnFeed.fetchUpcoming()` as a property, so tests can stub it.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-upcoming-psn-feed.js`:

````js
// Run: node scripts/test-upcoming-psn-feed.js
//
// PlayStation's upcoming games list (lib/upcoming-psn-feed.js): the query it
// sends and what it keeps from the reply. fetch is a stub — nothing here
// reaches PlayStation.
const assert = require('assert');
const feed = require('../lib/upcoming-psn-feed');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const NOW = Date.UTC(2026, 9, 10, 4, 0);
const DAY = 86400000;
const hit = (id, name, ts, extra) => Object.assign({
  conceptId: id, productName: name, releaseDateTimestamp: ts, platforms: ['PS5'], genre: ['Action'],
  publisher: ' Pub ', image: ['https://image.api.playstation.com/vulcan/' + id + '.png'], productType: 'FULL_GAME'
}, extra || {});
const reply = hits => ({ results: [{ hits }] });

async function main() {
  console.log('\nquery');
  ok('asks for game pages released after now, 200 at a time, only the fields it uses', () => {
    const body = JSON.parse(feed.queryBody(NOW));
    assert.strictEqual(body.requests[0].indexName, 'crawler_en-us');
    const params = new URLSearchParams(body.requests[0].params);
    assert.strictEqual(params.get('query'), '');
    assert.strictEqual(params.get('hitsPerPage'), '200');
    assert.strictEqual(params.get('filters'), 'pageType:game AND releaseDateTimestamp > ' + NOW);
    assert.strictEqual(params.get('attributesToRetrieve'), 'productName,releaseDateTimestamp,platforms,genre,conceptId,publisher,image,productType');
  });

  console.log('\nparse');
  const games = feed.parseHits(reply([
    hit(30, 'Late Game™', NOW + 90 * DAY),
    hit(10, 'Call of Duty®: Modern Warfare® 4', NOW + 13 * DAY, { productType: 'GAME_BUNDLE', platforms: ['PS4', 'PS5'] }),
    hit('20', 'Fable Standard Edition', NOW + 5 * DAY, { platforms: ['PS4'], image: ['https://evil.example/x.png'] }),
    hit(40, 'Already Out', NOW - DAY),
    hit(41, 'Out Right Now', NOW),
    hit(42, 'No Date', undefined),
    hit(43, 'An Add-on', NOW + DAY, { productType: 'ADD_ON' }),
    hit(44, 'VR Only', NOW + DAY, { platforms: ['PS VR2'] }),
    hit('', 'No Concept', NOW + DAY),
    hit('12ab', 'Odd Concept', NOW + DAY),
    hit(45, '   ', NOW + DAY),
    null
  ]), NOW);
  ok('keeps future full games and bundles on PS5/PS4, sorted by date', () => {
    assert.deepStrictEqual(games.map(g => g.concept_id), ['20', '10', '30']);
  });
  ok('each game: clean title, raw title, Manila date, platform, genres, publisher, PlayStation-hosted image', () => {
    assert.deepStrictEqual(games[1], {
      concept_id: '10', title: 'Call of Duty: Modern Warfare 4', raw_title: 'Call of Duty®: Modern Warfare® 4',
      release_date: '2026-10-23', platform: 'PS4/PS5', genres: ['Action'], publisher: 'Pub',
      image_url: 'https://image.api.playstation.com/vulcan/10.png'
    });
    assert.strictEqual(games[0].title, 'Fable');
    assert.strictEqual(games[0].platform, 'PS4');
    assert.strictEqual(games[0].image_url, '', 'an image from anywhere else is dropped');
  });
  ok('a reply of another shape is null; an empty one is an empty list', () => {
    assert.strictEqual(feed.parseHits({ message: 'Invalid key' }, NOW), null);
    assert.strictEqual(feed.parseHits(null, NOW), null);
    assert.deepStrictEqual(feed.parseHits(reply([]), NOW), []);
  });

  console.log('\nfetch');
  await okAsync('posts the query with the search-only key and returns the games', async () => {
    let seen = null;
    const r = await feed.fetchUpcoming({
      now: () => NOW,
      fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => reply([hit(10, 'A', NOW + DAY)]) }; }
    });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.games.map(g => g.concept_id), ['10']);
    assert.strictEqual(seen.url, 'https://uls2j1qb99-dsn.algolia.net/1/indexes/*/queries');
    assert.strictEqual(seen.init.method, 'POST');
    assert.strictEqual(seen.init.headers['X-Algolia-Application-Id'], 'ULS2J1QB99');
    assert.strictEqual(seen.init.body, feed.queryBody(NOW));
  });
  await okAsync('failures come back as reasons, never thrown', async () => {
    const bad = async impl => (await feed.fetchUpcoming({ now: () => NOW, fetchImpl: impl, timeoutMs: 30 })).reason;
    assert.strictEqual(await bad(async () => ({ ok: false, status: 403 })), 'http_403');
    assert.strictEqual(await bad(async () => ({ ok: true, json: async () => { throw new Error('x'); } })), 'bad_json');
    assert.strictEqual(await bad(async () => ({ ok: true, json: async () => ({ nope: 1 }) })), 'bad_shape');
    assert.strictEqual(await bad(async () => { throw new Error('ECONNRESET'); }), 'network');
    assert.strictEqual(await bad((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    })), 'timeout');
  });

  console.log('\n' + passed + ' assertions passed\n');
}

main().catch(e => { console.error(e); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-upcoming-psn-feed.js` → FAIL `Error: Cannot find module '../lib/upcoming-psn-feed'`.

- [ ] **Step 3: Write the feed reader**

Create `lib/upcoming-psn-feed.js`:

````js
// PlayStation's announced, dated games for Coming soon → "Update from
// PlayStation". One query to PlayStation's own site-search index (Algolia —
// the same public search-only key and index as lib/psplus-title-search.js):
// every game page whose release date is still ahead. Games with no announced
// date are not in it. Read only when the owner presses the button; no
// PlayStation account or session involved. Never throws.
const { ALGOLIA_URL, ALGOLIA_APP, ALGOLIA_KEY, ALGOLIA_INDEX } = require('./psplus-title-search');
const { cleanTitle, manilaDate, platformOf } = require('./upcoming-psn');

const IMAGE_HOST = /^https:\/\/image\.api\.playstation\.com\//;
const PRODUCT_TYPES = Object.freeze(['FULL_GAME', 'GAME_BUNDLE']);
const FIELDS = 'productName,releaseDateTimestamp,platforms,genre,conceptId,publisher,image,productType';
const HITS = 200;

function queryBody(nowMs) {
  const params = [
    'query=',
    'hitsPerPage=' + HITS,
    'attributesToRetrieve=' + encodeURIComponent(FIELDS),
    'filters=' + encodeURIComponent('pageType:game AND releaseDateTimestamp > ' + Math.floor(nowMs))
  ].join('&');
  return JSON.stringify({ requests: [{ indexName: ALGOLIA_INDEX, params }] });
}

// Pure. The index reply → games sorted by date then title, or null when the
// reply is not the expected shape (so a changed index reads as a failure,
// not as "nothing upcoming"). Each game:
// { concept_id, title, raw_title, release_date, platform, genres, publisher, image_url }
function parseHits(json, nowMs) {
  const hits = json && Array.isArray(json.results) && json.results[0] && json.results[0].hits;
  if (!Array.isArray(hits)) return null;
  const games = [];
  hits.forEach(h => {
    if (!h) return;
    const conceptId = String(h.conceptId == null ? '' : h.conceptId);
    if (!/^\d+$/.test(conceptId)) return;
    if (!PRODUCT_TYPES.includes(h.productType)) return;
    const ts = Number(h.releaseDateTimestamp);
    if (!Number.isFinite(ts) || ts <= nowMs) return;
    const platform = platformOf(h.platforms);
    if (!platform) return;
    const rawTitle = String(h.productName || '').trim();
    const title = cleanTitle(rawTitle);
    if (!title) return;
    const image = (Array.isArray(h.image) ? h.image : [h.image]).map(String).find(x => IMAGE_HOST.test(x)) || '';
    games.push({
      concept_id: conceptId,
      title,
      raw_title: rawTitle,
      release_date: manilaDate(ts),
      platform,
      genres: Array.isArray(h.genre) ? h.genre.map(String) : [],
      publisher: String(h.publisher || '').trim(),
      image_url: image
    });
  });
  return games.sort((a, b) => a.release_date.localeCompare(b.release_date) || a.title.localeCompare(b.title));
}

// { ok: true, games } or { ok: false, games: [], reason } — reasons: timeout,
// network, http_<status>, bad_json, bad_shape.
async function fetchUpcoming({ fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 10000 } = {}) {
  const nowMs = now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(ALGOLIA_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Algolia-API-Key': ALGOLIA_KEY, 'X-Algolia-Application-Id': ALGOLIA_APP },
      body: queryBody(nowMs)
    });
    if (!res || !res.ok) return { ok: false, games: [], reason: 'http_' + (res ? res.status : 0) };
    let json;
    try { json = await res.json(); } catch (e) { return { ok: false, games: [], reason: 'bad_json' }; }
    const games = parseHits(json, nowMs);
    if (!games) return { ok: false, games: [], reason: 'bad_shape' };
    return { ok: true, games };
  } catch (e) {
    return { ok: false, games: [], reason: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { queryBody, parseHits, fetchUpcoming };
````

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-upcoming-psn-feed.js` → `6 assertions passed`.
Run: `node scripts/test-upcoming-psn.js` → `17 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/upcoming-psn-feed.js scripts/test-upcoming-psn-feed.js
git commit -m "Coming soon from PlayStation: read PlayStation's announced, dated games

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Saving PlayStation images (`lib/remote-image.js`)

**Files:**
- Create: `lib/remote-image.js`
- Test: `scripts/test-remote-image.js`

**Interfaces:**
- Consumes: `sharp` (already a dependency).
- Produces: `saveRemoteImage(url, { uploadsDir, fetchImpl, maxDim = 900, timeoutMs = 15000 }) → Promise<'/uploads/psn-<ms>-<8 hex>.webp' | ''>`, plus `MAX_BYTES` (10 MB). It never throws. Task 4's server calls `remoteImage.saveRemoteImage(url, { uploadsDir })` as a property, so tests can stub it.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-remote-image.js`:

````js
// Run: node scripts/test-remote-image.js
//
// Saving a PlayStation image into the uploads folder (lib/remote-image.js).
// fetch is a stub serving a PNG made here; files go to a temp folder that is
// removed at the end. Nothing reaches PlayStation.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { saveRemoteImage, MAX_BYTES } = require('../lib/remote-image');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-image-'));
function cleanup() { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const URL_OK = 'https://image.api.playstation.com/vulcan/ap/rnd/cover.png';
const respond = (buf, headers) => async () => ({
  ok: true, status: 200,
  headers: { get: k => (headers || {})[k.toLowerCase()] || null },
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)
});

async function main() {
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#f0a500' } }).png().toBuffer();

  console.log('\nsaveRemoteImage');
  await okAsync('a PlayStation PNG becomes a WebP of at most 900px in the uploads folder', async () => {
    const seen = [];
    const out = await saveRemoteImage(URL_OK, { uploadsDir: DIR, fetchImpl: async (u, init) => { seen.push(u); return respond(png)(u, init); } });
    assert.ok(/^\/uploads\/psn-\d+-[0-9a-f]{8}\.webp$/.test(out), out);
    const meta = await sharp(path.join(DIR, path.basename(out))).metadata();
    assert.deepStrictEqual([meta.format, meta.width, meta.height], ['webp', 900, 900]);
    assert.deepStrictEqual(seen, [URL_OK]);
  });
  await okAsync('two saves never share a file name', async () => {
    const a = await saveRemoteImage(URL_OK, { uploadsDir: DIR, fetchImpl: respond(png) });
    const b = await saveRemoteImage(URL_OK, { uploadsDir: DIR, fetchImpl: respond(png) });
    assert.ok(a && b && a !== b);
  });
  await okAsync('any other host is refused without fetching', async () => {
    let called = false;
    const spy = async () => { called = true; return respond(png)(); };
    for (const u of ['https://evil.example/x.png', 'http://image.api.playstation.com/x.png', 'https://image.api.playstation.com.evil.example/x.png', '', null]) {
      assert.strictEqual(await saveRemoteImage(u, { uploadsDir: DIR, fetchImpl: spy }), '');
    }
    assert.strictEqual(called, false);
  });
  await okAsync('too big, failed, not an image, thrown or timed out → empty, nothing saved', async () => {
    const before = fs.readdirSync(DIR).length;
    const big = { uploadsDir: DIR, fetchImpl: respond(png, { 'content-length': String(MAX_BYTES + 1) }) };
    assert.strictEqual(await saveRemoteImage(URL_OK, big), '');
    assert.strictEqual(await saveRemoteImage(URL_OK, { uploadsDir: DIR, fetchImpl: async () => ({ ok: false, status: 404 }) }), '');
    assert.strictEqual(await saveRemoteImage(URL_OK, { uploadsDir: DIR, fetchImpl: respond(Buffer.from('<html>blocked</html>')) }), '');
    assert.strictEqual(await saveRemoteImage(URL_OK, { uploadsDir: DIR, fetchImpl: async () => { throw new Error('ECONNRESET'); } }), '');
    const hang = (u, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    });
    assert.strictEqual(await saveRemoteImage(URL_OK, { uploadsDir: DIR, fetchImpl: hang, timeoutMs: 30 }), '');
    assert.strictEqual(await saveRemoteImage(URL_OK, { fetchImpl: respond(png) }), '', 'no uploads folder');
    assert.strictEqual(fs.readdirSync(DIR).length, before);
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-remote-image.js` → FAIL `Error: Cannot find module '../lib/remote-image'`.

- [ ] **Step 3: Write the image saver**

Create `lib/remote-image.js`:

````js
// Downloads one PlayStation image and saves it into the uploads folder as a
// WebP, the way server.js's processUploadedImage saves an owner's upload — so
// the picture is the site's own file from then on and survives a Release.
// Only PlayStation's image CDN is fetched. Never throws: any failure (wrong
// host, too big, timeout, not an image) comes back as ''.
const crypto = require('crypto');
const path = require('path');
const sharp = require('sharp');

const ALLOWED = /^https:\/\/image\.api\.playstation\.com\//;
const MAX_BYTES = 10 * 1024 * 1024;

async function saveRemoteImage(url, { uploadsDir, fetchImpl = globalThis.fetch, maxDim = 900, timeoutMs = 15000 } = {}) {
  if (!ALLOWED.test(String(url || '')) || !uploadsDir) return '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res || !res.ok) return '';
    if (Number(res.headers && res.headers.get && res.headers.get('content-length')) > MAX_BYTES) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return '';
    const name = 'psn-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.webp';
    await sharp(buf)
      .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(path.join(uploadsDir, name));
    return '/uploads/' + name;
  } catch (e) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { saveRemoteImage, MAX_BYTES };
````

- [ ] **Step 4: Run the test and watch it pass**

Run: `node scripts/test-remote-image.js` → `4 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/remote-image.js scripts/test-remote-image.js
git commit -m "Save a PlayStation image into uploads as WebP (host-checked, size-capped)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Refresh, apply and cancel routes (`server.js`)

**Files:**
- Modify (via the edit script): `server.js`, in three places:
  - after `const psplusCatalogStore = require('./lib/psplus-catalog-store');` (around line 30)
  - the `const gamesView = {…}` block in `GET /admin` (around line 5285)
  - just above `app.post('/admin/upcoming/add', requireAuth,` (around line 5365)
- Test: `scripts/test-admin-upcoming-psn.js`

**Interfaces:**
- Consumes: Task 1 (`buildPreview`, `previewView`, `readForm`, `planApply`, `buildRecord`, `mapLimit`), Task 2 (`fetchUpcoming`), Task 3 (`saveRemoteImage`). From existing `server.js`: `requireAuth`, `asyncRoute`, `getUpcoming()`, `getGames()`, `getUpcomingGame(id)`, `newUpcomingId()`, `getSiteSettings()`, `db`, `uploadsDir`, `psnGame` (= `require('./lib/psn-game')`, whose `fetchGameInfo({ psn_link })` returns `{ ok, psn: { description, genres, screenshots } }`).
- Produces:
  - `POST /admin/upcoming/psn/refresh` → `/admin?tab=games&msg=psn_upcoming_preview&psn_upcoming=<24 hex>`, or `…msg=psn_upcoming_unreachable`
  - `POST /admin/upcoming/psn/apply`. The body has `token`, repeated `add` (concept ids), `title_<conceptId>`, the six `PRICE_FIELDS`, and repeated `date` (upcoming ids). It redirects with `psn_upcoming_applied` or `psn_upcoming_partial` plus `&added=X&dates=Y`, or with `psn_upcoming_expired`, `psn_upcoming_nothing` (`&psn_upcoming=<token>`, list kept) or `psn_upcoming_busy`.
  - `POST /admin/upcoming/psn/cancel` → `…msg=psn_upcoming_cancelled`
  - `GET /admin`: `gamesView.psnUpdate` (the `previewView` result, or `null`) and `gamesView.psnUpdateExpired` (boolean), both read in Task 5's partial.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-admin-upcoming-psn.js`:

````js
// Run: node scripts/test-admin-upcoming-psn.js
//
// Coming soon → "Update from PlayStation": the refresh, apply and cancel
// routes. Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI,
// in-memory sessions, a made-up admin password) with PlayStation's list, the
// store-page reader and the image saver replaced by stubs, so nothing reaches
// PlayStation, a database, or the real admin.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4621;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-upcoming-psn-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const upcoming = [
  { id: 1, title: 'Zzyzx Moved Game', platform: 'PS5', release_date: '2026-10-29', created_at: '2026-09-01T00:00:00.000Z', nt_price_7d: 349, nt_price_30d: 1099, tr_price_7d: 449, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1, cover_image: '/uploads/keep.webp' },
  { id: 2, title: 'Zzyzx Tba Game', platform: 'PS5', release_date: 'TBA', created_at: '2026-08-01T00:00:00.000Z' },
  { id: 3, title: 'Zzyzx Same Date', platform: 'PS5', release_date: '2026-12-03', created_at: '2026-07-01T00:00:00.000Z' }
];
const games = [{ id: 50, title: 'Zzyzx Out Already', platform: 'PS5', nt_price_7d: 100 }];
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({ admin_password: TEST_PASSWORD, games, upcoming, nextUpcomingId: 10 }));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

const readDb = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const upcomingById = id => readDb().upcoming.find(x => x.id === id);

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
// Arrays become repeated fields, like ticked checkboxes.
const form = o => Object.entries(o).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map(x => encodeURIComponent(k) + '=' + encodeURIComponent(x))).join('&');
const tokenOf = r => (/psn_upcoming=([0-9a-f]+)/.exec(r.headers.location || '') || [])[1];

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const feedGame = (id, title, release_date, extra) => Object.assign({
  concept_id: String(id), title, raw_title: title, release_date, platform: 'PS5', genres: ['Action'],
  publisher: 'Pub', image_url: 'https://image.api.playstation.com/' + id + '.png'
}, extra || {});

async function main() {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  // Stub PlayStation. knob.feed is what the next refresh sees.
  const knob = { feedOk: true, delay: 0 };
  knob.feed = [
    feedGame(101, 'Zzyzx New One', '2026-10-15', { genres: ['Role Playing Game (RPG)'] }),
    feedGame(102, 'Zzyzx New Two', '2026-11-01', { platform: 'PS4/PS5' }),
    feedGame(103, 'Zzyzx Broken Images', '2026-12-01'),
    feedGame(104, 'Zzyzx Moved Game', '2026-11-12'),
    feedGame(105, 'Zzyzx Tba Game', '2027-01-15'),
    feedGame(106, 'Zzyzx Same Date', '2026-12-03'),
    feedGame(107, 'Zzyzx Out Already', '2027-02-01')
  ];
  const feedLib = require('../lib/upcoming-psn-feed');
  feedLib.fetchUpcoming = async () => (knob.feedOk ? { ok: true, games: knob.feed.slice() } : { ok: false, games: [], reason: 'timeout' });
  const infoCalls = [];
  require('../lib/psn-game').fetchGameInfo = async game => {
    infoCalls.push(game.psn_link);
    if (knob.delay) await new Promise(r => setTimeout(r, knob.delay));
    const id = game.psn_link.split('/').pop();
    if (id === '103') return { ok: false, reason: 'timeout' };
    return { ok: true, psn: { description: 'About ' + id, genres: [], screenshots: ['https://image.api.playstation.com/s1-' + id + '.jpg', 'https://image.api.playstation.com/s2-' + id + '.jpg'] } };
  };
  const saved = [];
  require('../lib/remote-image').saveRemoteImage = async (url, opts) => {
    saved.push({ url, uploadsDir: opts && opts.uploadsDir });
    return url.includes('103') ? '' : '/uploads/psn-' + url.split('/').pop() + '.webp';
  };
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  console.log('\naccess');
  await okAsync('all three routes need the admin login', async () => {
    for (const p of ['refresh', 'apply', 'cancel']) {
      const r = await call('POST', '/admin/upcoming/psn/' + p, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: '' });
      assert.strictEqual(r.status, 302, p);
      assert.ok(r.headers.location.includes('/admin/login'), p);
    }
  });

  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in to the throwaway instance');
  const post = (p, o) => call('POST', p, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form(o || {}) });
  const refresh = () => post('/admin/upcoming/psn/refresh');
  const prices = { nt_price_7d: '299', nt_price_30d: '999', tr_price_7d: '399', tr_price_30d: '1199', non_trophy_slots: '2', trophy_slots: '1' };

  console.log('\nrefresh');
  await okAsync('PlayStation unreachable → message, nothing stored', async () => {
    knob.feedOk = false;
    const r = await refresh();
    knob.feedOk = true;
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_unreachable');
    assert.strictEqual(readDb().upcoming.length, 3);
  });
  let token;
  await okAsync('a check opens the list on the Games tab under a token', async () => {
    const r = await refresh();
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.startsWith('/admin?tab=games&msg=psn_upcoming_preview&psn_upcoming='));
    token = tokenOf(r);
    assert.ok(/^[0-9a-f]{24}$/.test(token));
    assert.strictEqual(readDb().upcoming.length, 3, 'nothing saved by a check');
  });

  console.log('\napply');
  await okAsync('nothing ticked → message, the list stays open', async () => {
    const r = await post('/admin/upcoming/psn/apply', Object.assign({ token }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_nothing&psn_upcoming=' + token);
  });
  await okAsync('an unknown token → expired, nothing added', async () => {
    const r = await post('/admin/upcoming/psn/apply', Object.assign({ token: 'deadbeef', add: ['101'] }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_expired');
    assert.strictEqual(readDb().upcoming.length, 3);
  });
  await okAsync('apply adds the ticked games with the typed prices, PlayStation details and saved images', async () => {
    const r = await post('/admin/upcoming/psn/apply', Object.assign({
      token, add: ['101', '103'], title_101: 'Zzyzx New One (Owner Title)', date: ['1', '2']
    }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_partial&added=2&dates=2', 'game 103 has no cover or description');
    const added = readDb().upcoming.filter(x => x.id >= 10);
    assert.deepStrictEqual(added.map(x => [x.id, x.title, x.psn_concept_id]), [[10, 'Zzyzx New One (Owner Title)', '101'], [11, 'Zzyzx Broken Images', '103']]);
    const one = added[0];
    assert.strictEqual(one.release_date, '2026-10-15');
    assert.strictEqual(one.platform, 'PS5');
    assert.strictEqual(one.genre, 'RPG');
    assert.strictEqual(one.description, 'About 101');
    assert.strictEqual(one.cover_image, '/uploads/psn-101.png.webp');
    assert.deepStrictEqual(one.gallery, ['/uploads/psn-s1-101.jpg.webp', '/uploads/psn-s2-101.jpg.webp']);
    assert.deepStrictEqual([one.nt_price_7d, one.nt_price_30d, one.tr_price_7d, one.tr_price_30d, one.non_trophy_slots, one.trophy_slots, one.rank, one.buy_nt_price], [299, 999, 399, 1199, 2, 1, 0, 0]);
    assert.strictEqual(added[1].description, '');
    assert.strictEqual(added[1].cover_image, '');
    assert.strictEqual(added[1].genre, 'Action', 'index genre when the store page failed');
    assert.ok(infoCalls.includes('https://store.playstation.com/en-us/concept/101'));
    assert.ok(saved.length && saved.every(s => s.uploadsDir === path.join(DATA_DIR, 'uploads')), 'images go to the uploads folder');
  });
  await okAsync('ticked date changes update only the date (and link the PlayStation id)', async () => {
    const moved = upcomingById(1);
    assert.strictEqual(moved.release_date, '2026-11-12');
    assert.strictEqual(moved.psn_concept_id, '104');
    assert.deepStrictEqual([moved.nt_price_7d, moved.cover_image, moved.title], [349, '/uploads/keep.webp', 'Zzyzx Moved Game']);
    assert.strictEqual(upcomingById(2).release_date, '2027-01-15');
    assert.strictEqual(upcomingById(3).release_date, '2026-12-03');
  });
  await okAsync('unticked games are remembered as skipped', async () => {
    assert.deepStrictEqual(readDb().site_settings.upcoming_psn_skipped, ['102']);
  });
  await okAsync('the same token again adds nothing', async () => {
    const r = await post('/admin/upcoming/psn/apply', Object.assign({ token, add: ['101', '102'] }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_expired');
    assert.strictEqual(readDb().upcoming.length, 5);
  });
  await okAsync('the next check offers only what is still new; ticking a skipped game adds it and un-skips it', async () => {
    const t2 = tokenOf(await refresh());
    const r = await post('/admin/upcoming/psn/apply', Object.assign({ token: t2, add: ['102'] }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_applied&added=1&dates=0');
    assert.deepStrictEqual(readDb().upcoming.filter(x => x.id >= 10).map(x => x.psn_concept_id), ['101', '103', '102']);
    assert.strictEqual(readDb().upcoming.find(x => x.psn_concept_id === '102').platform, 'PS4/PS5');
    assert.deepStrictEqual(readDb().site_settings.upcoming_psn_skipped, []);
  });
  await okAsync('a game added by hand after the check is not added again', async () => {
    knob.feed.push(feedGame(108, 'Zzyzx Hand Added', '2027-03-01'));
    const t3 = tokenOf(await refresh());
    await post('/admin/upcoming/add', { title: 'Zzyzx Hand Added', platform: 'PS5', release_date: '2027-03-01' });
    const before = readDb().upcoming.length;
    const r = await post('/admin/upcoming/psn/apply', Object.assign({ token: t3, add: ['108'] }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_applied&added=0&dates=0');
    assert.strictEqual(readDb().upcoming.length, before);
  });
  await okAsync('one apply at a time: a second while the first downloads is told it is busy', async () => {
    knob.feed.push(feedGame(109, 'Zzyzx Slow One', '2027-03-02'), feedGame(110, 'Zzyzx Slow Two', '2027-03-03'));
    const ta = tokenOf(await refresh());
    const tb = tokenOf(await refresh());
    knob.delay = 300;
    const first = post('/admin/upcoming/psn/apply', Object.assign({ token: ta, add: ['109'] }, prices));
    await new Promise(r => setTimeout(r, 100));
    const second = await post('/admin/upcoming/psn/apply', Object.assign({ token: tb, add: ['110'] }, prices));
    assert.strictEqual(second.headers.location, '/admin?tab=games&msg=psn_upcoming_busy');
    const r1 = await first;
    knob.delay = 0;
    assert.ok(r1.headers.location.includes('msg=psn_upcoming_applied&added=1'));
    const after = await post('/admin/upcoming/psn/apply', Object.assign({ token: tb, add: ['110'] }, prices));
    assert.ok(after.headers.location.includes('msg=psn_upcoming_applied&added=1'), 'flag cleared afterwards');
  });

  console.log('\ncancel');
  await okAsync('cancel drops the list', async () => {
    const t = tokenOf(await refresh());
    const r = await post('/admin/upcoming/psn/cancel', { token: t });
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_cancelled');
    const again = await post('/admin/upcoming/psn/apply', Object.assign({ token: t, add: ['101'] }, prices));
    assert.strictEqual(again.headers.location, '/admin?tab=games&msg=psn_upcoming_expired');
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-admin-upcoming-psn.js` → FAIL `AssertionError … refresh`, with `actual: 404`, `expected: 302` (the routes don't exist yet).

- [ ] **Step 3: Write the edit helper**

Create `.superpowers/tmp-edits/rep.js`. It keeps the BOM and CRLF and fails loudly on a missing or repeated anchor; Task 5 reuses it:

````js
// Exact-text edit helper for this plan's edit scripts. Keeps a file's UTF-8
// BOM and CRLF line endings; anchors are written with \n. Throws when an
// anchor is missing or appears more than once, so nothing is half-applied
// silently. Run edit scripts from the repo root.
const fs = require('fs');

function load(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const crlf = body.includes('\r\n');
  return { bom, crlf, text: crlf ? body.replace(/\r\n/g, '\n') : body };
}

function save(file, f, text) {
  const out = f.crlf ? text.replace(/\n/g, '\r\n') : text;
  fs.writeFileSync(file, (f.bom ? '﻿' : '') + out);
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

// Replaces the one occurrence of `from` with `to`.
function rep(file, from, to) {
  const f = load(file);
  const n = count(f.text, from);
  if (n !== 1) throw new Error(file + ': expected 1 match, found ' + n + ' for: ' + from.slice(0, 80));
  save(file, f, f.text.replace(from, () => to));
}

module.exports = rep;
````

- [ ] **Step 4: Apply the server edits**

Create `.superpowers/tmp-edits/edit-upcoming-psn-server.js`:

````js
// Task 4: server.js wiring for Coming soon → "Update from PlayStation".
// Run from the repo root: node .superpowers/tmp-edits/edit-upcoming-psn-server.js
const rep = require('./rep');
const F = 'server.js';

// 1. The three new modules, beside the PS Plus catalog ones.
rep(F,
`const psplusCatalogStore = require('./lib/psplus-catalog-store');
`,
`const psplusCatalogStore = require('./lib/psplus-catalog-store');
const upcomingPsn = require('./lib/upcoming-psn');
const upcomingPsnFeed = require('./lib/upcoming-psn-feed');
const remoteImage = require('./lib/remote-image');
`);

// 2. The admin page hands the Coming soon tab its open list, if any.
rep(F,
`  const gamesViewRows = gamesViewLib.gameRows(games, customers, buildAccountSummaryMap(), new Date());
  const gamesView = {
    rows: gamesViewRows,
    counts: gamesViewLib.chipCounts(gamesViewRows),
    upcoming: gamesViewLib.upcomingRows(upcoming, upcomingReservedCount, todayManila),
    requests: gamesViewLib.requestSummary(gameRequestRows)
  };
`,
`  const gamesViewRows = gamesViewLib.gameRows(games, customers, buildAccountSummaryMap(), new Date());
  // Coming soon → "Update from PlayStation": ?psn_upcoming=<token> shows that
  // check's list until it is applied, cancelled or expires.
  const psnUpcomingToken = String(req.query.psn_upcoming || '');
  const psnUpcomingEntry = psnUpcomingToken ? getUpcomingPsnPreview(psnUpcomingToken) : null;
  const gamesView = {
    rows: gamesViewRows,
    counts: gamesViewLib.chipCounts(gamesViewRows),
    upcoming: gamesViewLib.upcomingRows(upcoming, upcomingReservedCount, todayManila),
    requests: gamesViewLib.requestSummary(gameRequestRows),
    psnUpdate: psnUpcomingEntry ? upcomingPsn.previewView(psnUpcomingEntry.preview, { token: psnUpcomingToken, checkedAt: psnUpcomingEntry.checkedAt }) : null,
    psnUpdateExpired: !!psnUpcomingToken && !psnUpcomingEntry
  };
`);

// 3. The routes, just above the hand-made "Add upcoming game" route.
rep(F,
`app.post('/admin/upcoming/add', requireAuth,`,
`// ── Coming soon: "Update from PlayStation" ─────────────────────────────────
// PlayStation's announced, dated games (lib/upcoming-psn-feed.js) checked
// against Coming soon and the catalogue (lib/upcoming-psn.js). Refresh only
// builds a list; Apply adds the ticked games and date changes. See
// docs/superpowers/specs/2026-10-10-upcoming-from-playstation-design.md.

// Lists waiting for Apply, by random token. In memory on purpose, like the PS
// Plus catalog previews: a list older than 30 minutes — or lost to a restart —
// must be checked again rather than applied stale.
const upcomingPsnPreviews = new Map();
const UPCOMING_PSN_PREVIEW_MS = 30 * 60 * 1000;
const UPCOMING_PSN_BACK = '/admin?tab=games&msg=';
// One Apply at a time: it downloads for up to a minute, and a second one
// running alongside could add the same game twice.
let upcomingPsnApplying = false;

function getUpcomingPsnPreview(token) {
  const now = Date.now();
  for (const [t, p] of upcomingPsnPreviews) {
    if (now - p.createdAt > UPCOMING_PSN_PREVIEW_MS) upcomingPsnPreviews.delete(t);
  }
  return upcomingPsnPreviews.get(String(token || '')) || null;
}

app.post('/admin/upcoming/psn/refresh', requireAuth, asyncRoute(async (req, res) => {
  const feed = await upcomingPsnFeed.fetchUpcoming();
  if (!feed.ok) {
    console.error('[upcoming-psn] refresh', feed.reason);
    return res.redirect(UPCOMING_PSN_BACK + 'psn_upcoming_unreachable');
  }
  const preview = upcomingPsn.buildPreview({
    upcoming: getUpcoming(), games: getGames(), feedGames: feed.games,
    skipped: getSiteSettings().upcoming_psn_skipped
  });
  const token = require('crypto').randomBytes(12).toString('hex');
  getUpcomingPsnPreview(''); // drops expired lists before adding another
  upcomingPsnPreviews.set(token, { createdAt: Date.now(), checkedAt: new Date().toISOString(), preview });
  res.redirect(UPCOMING_PSN_BACK + 'psn_upcoming_preview&psn_upcoming=' + token);
}));

app.post('/admin/upcoming/psn/apply', requireAuth, asyncRoute(async (req, res) => {
  if (upcomingPsnApplying) return res.redirect(UPCOMING_PSN_BACK + 'psn_upcoming_busy');
  const token = String(req.body.token || '');
  const entry = getUpcomingPsnPreview(token);
  if (!entry) return res.redirect(UPCOMING_PSN_BACK + 'psn_upcoming_expired');
  const form = upcomingPsn.readForm(req.body);
  if (!form.add.length && !form.dates.length) {
    return res.redirect(UPCOMING_PSN_BACK + 'psn_upcoming_nothing&psn_upcoming=' + token);
  }
  // Gone before the first await, so a double press finds no list to apply.
  upcomingPsnPreviews.delete(token);
  upcomingPsnApplying = true;
  try {
    const plan = upcomingPsn.planApply({
      preview: entry.preview, form, upcoming: getUpcoming(), games: getGames(),
      skipped: getSiteSettings().upcoming_psn_skipped
    });
    const nowIso = new Date().toISOString();
    const built = await upcomingPsn.mapLimit(plan.adds, 3, g => upcomingPsn.buildRecord(g, {
      prices: plan.prices,
      nowIso,
      fetchInfo: conceptId => psnGame.fetchGameInfo({ psn_link: 'https://store.playstation.com/en-us/concept/' + conceptId }),
      saveImage: url => remoteImage.saveRemoteImage(url, { uploadsDir })
    }));
    built.forEach(b => db.get('upcoming').push(Object.assign({ id: newUpcomingId() }, b.record)).write());
    plan.dateUpdates.forEach(d => {
      const current = getUpcomingGame(d.id);
      if (!current) return;
      const patch = { release_date: d.release_date };
      if (!current.psn_concept_id && d.concept_id) patch.psn_concept_id = d.concept_id;
      db.get('upcoming').find({ id: d.id }).assign(patch).write();
    });
    db.set('site_settings.upcoming_psn_skipped', plan.skipped).write();
    const partial = built.some(b => !b.complete);
    res.redirect(UPCOMING_PSN_BACK + (partial ? 'psn_upcoming_partial' : 'psn_upcoming_applied')
      + '&added=' + built.length + '&dates=' + plan.dateUpdates.length);
  } finally {
    upcomingPsnApplying = false;
  }
}));

app.post('/admin/upcoming/psn/cancel', requireAuth, (req, res) => {
  upcomingPsnPreviews.delete(String(req.body.token || ''));
  res.redirect(UPCOMING_PSN_BACK + 'psn_upcoming_cancelled');
});

app.post('/admin/upcoming/add', requireAuth,`);

console.log('edited server.js');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-upcoming-psn-server.js` → `edited server.js`.
Then: `file server.js` → still `UTF-8 (with BOM) text … with CRLF line terminators`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node scripts/test-admin-upcoming-psn.js` → `13 assertions passed`. The log line `[upcoming-psn] refresh timeout` is expected; it comes from the "unreachable" check.
Run: `node scripts/test-upcoming-psn.js && node scripts/test-upcoming-psn-feed.js && node scripts/test-remote-image.js` → `17`, `6`, `4 assertions passed`.
Run: `node scripts/test-admin-psn.js` → `16 assertions passed` (the neighbouring PlayStation admin routes are unaffected).

- [ ] **Step 6: Commit**

```bash
git add server.js scripts/test-admin-upcoming-psn.js
git commit -m "Coming soon: Update from PlayStation routes (check, apply, cancel)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The admin panel

**Files:**
- Create: `views/partials/admin/games/psn-update.ejs`
- Create: `public/js/admin-upcoming-psn.js`
- Modify (via the edit script): `views/partials/admin/games/coming-soon.ejs` (include at the top), `views/admin.ejs` (tab mapping, toasts, the toast's count filling, loading-overlay words, script tag), `public/js/admin-games.js` (`subtabForMessage`), `public/css/style.css` (styles after `body.light-mode .gm-earned { color: #15803d; }`)
- Test: `scripts/test-admin-upcoming-psn-page.js`

**Interfaces:**
- Consumes: `gamesView.psnUpdate` / `gamesView.psnUpdateExpired` (Task 4); `applyLabel` (Task 1); the routes from Task 4. From the existing admin page: `params` (the `URLSearchParams` at the top of the tab script in `views/admin.ejs`), the loading overlay's `messages` (keyed by form action) and its `data-no-loading` opt-out, and `window.__gamesFilter.subtabForMessage` in `public/js/admin-games.js`.
- Produces: `window.__gmpApplyLabel(adds, dates)` from `public/js/admin-upcoming-psn.js`, with the same words as `applyLabel`. The `.gmp-*` classes.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-admin-upcoming-psn-page.js`:

````js
// Run: node scripts/test-admin-upcoming-psn-page.js
//
// Coming soon → "Update from PlayStation": what the admin page shows — the
// button, the list to tick, the expired and up-to-date states, the toasts —
// and that the gold button's browser script agrees with the server's words.
// Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI, in-memory
// sessions, a made-up admin password) with PlayStation's list stubbed, so
// nothing reaches PlayStation, a database, or the real admin.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');

const PORT = 4622;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-upcoming-psn-page-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const upcoming = [
  { id: 1, title: 'Zzyzx Moved Game', platform: 'PS5', release_date: '2026-10-29', created_at: '2026-09-01T00:00:00.000Z', nt_price_7d: 349, nt_price_30d: 1099, tr_price_7d: 449, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1 },
  { id: 2, title: 'Zzyzx Tba Game', platform: 'PS5', release_date: 'TBA', created_at: '2026-08-01T00:00:00.000Z' }
];
const games = [{ id: 50, title: 'Zzyzx Out Already', platform: 'PS5', nt_price_7d: 100 }];
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD, games, upcoming, nextUpcomingId: 10,
  site_settings: { upcoming_psn_skipped: ['103'] }
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

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
const tokenOf = r => (/psn_upcoming=([0-9a-f]+)/.exec(r.headers.location || '') || [])[1];
// The Coming soon sub-tab's own markup, so matches elsewhere on the page don't count.
const soonPanel = html => {
  const start = html.indexOf('data-gm-panel="soon"');
  assert.ok(start !== -1, 'Coming soon panel present');
  return html.slice(start, html.indexOf('data-gm-panel="requests"', start));
};

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const feedGame = (id, title, release_date, extra) => Object.assign({
  concept_id: String(id), title, raw_title: title, release_date, platform: 'PS5', genres: ['Action'],
  publisher: 'Zzyzx Pub', image_url: 'https://image.api.playstation.com/' + id + '.png'
}, extra || {});

async function main() {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  const knob = {
    feed: [
      feedGame(101, 'Zzyzx New One', '2026-10-15', { genres: ['Role Playing Game (RPG)'] }),
      feedGame(102, 'Zzyzx <b>Bold</b> Name', '2026-11-01', { platform: 'PS4/PS5', image_url: '' }),
      feedGame(103, 'Zzyzx Skipped One', '2026-12-01'),
      feedGame(104, 'Zzyzx Moved Game', '2026-11-12'),
      feedGame(105, 'Zzyzx Tba Game', '2027-01-15'),
      feedGame(106, 'Zzyzx Out Already', '2027-02-01')
    ]
  };
  require('../lib/upcoming-psn-feed').fetchUpcoming = async () => ({ ok: true, games: knob.feed.slice() });
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  const login = await call('POST', '/admin/login', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in to the throwaway instance');
  const get = p => call('GET', p, { headers: { Cookie: cookie } });
  const refresh = () => call('POST', '/admin/upcoming/psn/refresh', { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: '' });

  console.log('\nbutton');
  await okAsync('Coming soon has the Update button, and no list until a check', async () => {
    const soon = soonPanel((await get('/admin?tab=games')).body);
    assert.ok(soon.includes('action="/admin/upcoming/psn/refresh"'));
    assert.ok(soon.includes('🔄 Update from PlayStation'));
    assert.ok(!soon.includes('id="gmpForm"'));
  });

  const token = tokenOf(await refresh());
  const page = (await get('/admin?tab=games&psn_upcoming=' + token)).body;
  const soon = soonPanel(page);
  console.log('\nthe list');
  ok('new games ticked, skipped ones unticked and last, each with an editable title, date and platform', () => {
    assert.ok(soon.includes('New on PlayStation (3)'));
    assert.ok(/name="add" value="101"[^>]*data-gmp-add checked/.test(soon));
    assert.ok(/name="add" value="102"[^>]*data-gmp-add checked/.test(soon));
    assert.ok(/name="add" value="103"[^>]*data-gmp-add aria-label/.test(soon), '103 unticked');
    assert.ok(soon.indexOf('value="102"') < soon.indexOf('value="103"'), 'skipped last');
    assert.ok(soon.includes('Skipped before · Zzyzx Pub · Action'));
    assert.ok(soon.includes('name="title_101" value="Zzyzx New One"'));
    assert.ok(soon.includes('Zzyzx Pub · RPG'));
    assert.ok(soon.includes('Oct 15, 2026') && soon.includes('PS4/PS5'));
    assert.ok(soon.includes('src="https://image.api.playstation.com/101.png"'));
  });
  ok('titles from PlayStation are escaped', () => {
    assert.ok(soon.includes('Zzyzx &lt;b&gt;Bold&lt;/b&gt; Name'));
    assert.ok(!soon.includes('<b>Bold</b>'));
  });
  ok('prices and slots are pre-filled from the last upcoming game added, and say so', () => {
    for (const [k, v] of [['nt_price_7d', 349], ['nt_price_30d', 1099], ['tr_price_7d', 449], ['tr_price_30d', 1299], ['non_trophy_slots', 3], ['trophy_slots', 1]]) {
      assert.ok(soon.includes('name="' + k + '" min="0" step="1" value="' + v + '"'), k);
    }
    assert.ok(soon.includes('Filled in from Zzyzx Moved Game, the last upcoming game you added.'));
  });
  ok('date changes, ticked, old → new', () => {
    assert.ok(soon.includes('Release date changed (2)'));
    assert.ok(/name="date" value="1"[^>]*checked/.test(soon));
    assert.ok(soon.includes('Oct 29, 2026 →') && soon.includes('Nov 12, 2026'));
    assert.ok(soon.includes('TBA →') && soon.includes('Jan 15, 2027'));
  });
  ok('already on the site, the gold button\'s words and the cancel form', () => {
    assert.ok(soon.includes('Already on your site (3)</b> · Zzyzx Moved Game, Zzyzx Tba Game, Zzyzx Out Already'));
    assert.ok(soon.includes('data-gmp-apply>Add 2 games · update 2 dates</button>'));
    assert.ok(soon.includes('name="token" value="' + token + '"'));
    assert.ok(soon.includes('action="/admin/upcoming/psn/cancel" id="gmpCancel" data-no-loading="1"'));
  });

  console.log('\nother states');
  await okAsync('an expired or unknown list says so and offers the button again', async () => {
    const s = soonPanel((await get('/admin?tab=games&psn_upcoming=deadbeef')).body);
    assert.ok(s.includes('That list expired'));
    assert.ok(!s.includes('id="gmpForm"'));
  });
  await okAsync('nothing new → up to date, no gold button', async () => {
    knob.feed = [feedGame(104, 'Zzyzx Moved Game', '2026-10-29')];
    const s = soonPanel((await get('/admin?tab=games&psn_upcoming=' + tokenOf(await refresh()))).body);
    assert.ok(s.includes("You're up to date — nothing new on PlayStation."));
    assert.ok(!s.includes('data-gmp-apply'));
    assert.ok(s.includes('>Close</button>'));
  });
  ok('the page carries the toasts, the loading words and the script', () => {
    assert.ok(page.includes("psn_upcoming_applied:'✅ Added {added} · updated {dates}'"));
    assert.ok(page.includes("psn_upcoming_preview:'games'"));
    assert.ok(page.includes("'/admin/upcoming/psn/apply':'⏳ Adding games from PlayStation — this can take a minute...'"));
    assert.ok(page.includes('<script src="/js/admin-upcoming-psn.js?v='));
  });

  console.log('\nbrowser scripts');
  ok('admin-upcoming-psn.js words match lib/upcoming-psn.js for every count', () => {
    const sandbox = { console };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin-upcoming-psn.js'), 'utf8'), sandbox);
    const { applyLabel } = require('../lib/upcoming-psn');
    for (let a = 0; a < 4; a++) for (let d = 0; d < 4; d++) assert.strictEqual(sandbox.__gmpApplyLabel(a, d), applyLabel(a, d), a + '/' + d);
  });
  ok('admin-games.js opens Coming soon for every psn_upcoming_ message', () => {
    const sandbox = { console };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin-games.js'), 'utf8'), sandbox);
    for (const m of ['psn_upcoming_preview', 'psn_upcoming_applied', 'psn_upcoming_partial', 'psn_upcoming_nothing', 'psn_upcoming_cancelled']) {
      assert.strictEqual(sandbox.__gamesFilter.subtabForMessage(m), 'soon', m);
    }
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-admin-upcoming-psn-page.js` → FAIL `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value` in the first check, because there's no Update button yet.

- [ ] **Step 3: Create the panel**

Create `views/partials/admin/games/psn-update.ejs`:

````ejs
<%#
  Coming soon → "Update from PlayStation": the button, and — after a check —
  the list to tick (gamesView.psnUpdate, built by lib/upcoming-psn.js
  previewView). Nothing is saved until the gold button. The gold button's
  counts follow the ticks via public/js/admin-upcoming-psn.js.
%>
<%
  const pu = gamesView.psnUpdate;
  const puFields = [
    ['nt_price_7d', 'Non-trophy weekly', '₱'], ['nt_price_30d', 'Non-trophy monthly', '₱'],
    ['tr_price_7d', 'Trophy weekly', '₱'], ['tr_price_30d', 'Trophy monthly', '₱'],
    ['non_trophy_slots', 'Non-trophy slots', ''], ['trophy_slots', 'Trophy slots', '']
  ];
%>
<div class="gmp-bar">
  <form method="POST" action="/admin/upcoming/psn/refresh">
    <button type="submit" class="gm-btn gmp-check">🔄 Update from PlayStation</button>
  </form>
  <span class="gmp-hint">Finds PlayStation's announced games — you tick which ones to add.</span>
</div>
<% if (gamesView.psnUpdateExpired) { %>
<div class="gmp-warn">⏳ That list expired (they last 30 minutes) — press <b>Update from PlayStation</b> again.</div>
<% } %>
<% if (pu) { %>
<form method="POST" action="/admin/upcoming/psn/apply" class="gmp" id="gmpForm">
  <input type="hidden" name="token" value="<%= pu.token %>">
  <% if (pu.upToDate) { %>
  <div class="gmp-card"><div class="gmp-h">✅ You're up to date — nothing new on PlayStation.</div></div>
  <% } %>
  <% const puNew = pu.fresh.map(g => ({ g, on: true })).concat(pu.skippedBefore.map(g => ({ g, on: false }))); %>
  <% if (puNew.length) { %>
  <div class="gmp-card">
    <div class="gmp-h">New on PlayStation (<%= puNew.length %>)<span class="gmp-meta"><%= pu.checkedLabel ? ' · checked ' + pu.checkedLabel : '' %> · tick the ones to add</span></div>
    <% puNew.forEach(({ g, on }) => { %>
    <div class="gmp-row">
      <input type="checkbox" name="add" value="<%= g.concept_id %>" class="gmp-tick" data-gmp-add<%= on ? ' checked' : '' %> aria-label="Add <%= g.title %>">
      <% if (g.image_url) { %><img src="<%= g.image_url %>" class="gmp-cover" alt="" loading="lazy"><% } else { %><span class="gmp-cover"></span><% } %>
      <div class="gmp-name">
        <input type="text" name="title_<%= g.concept_id %>" value="<%= g.title %>" maxlength="150" class="gmp-title" aria-label="Title for <%= g.title %>">
        <div class="gmp-sub"><%= [on ? '' : 'Skipped before', g.publisher, g.genre].filter(Boolean).join(' · ') %></div>
      </div>
      <div class="gmp-date"><%= g.dateLabel %></div>
      <div class="gmp-plat"><%= g.platform %></div>
    </div>
    <% }) %>
    <div class="gmp-h gmp-h2">Prices and slots for the games you add</div>
    <div class="gmp-prices">
      <% puFields.forEach(([key, label, unit]) => { %>
      <label class="gmp-f"><span><%= label %><%= unit ? ' (' + unit + ')' : '' %></span><input type="number" name="<%= key %>" min="0" step="1" value="<%= pu.defaults[key] %>"></label>
      <% }) %>
    </div>
    <div class="gmp-note"><%= pu.defaultsFrom ? 'Filled in from ' + pu.defaultsFrom + ', the last upcoming game you added. ' : '' %>Cover, description and up to 6 screenshots come from PlayStation.</div>
  </div>
  <% } %>
  <% if (pu.dateChanges.length) { %>
  <div class="gmp-card">
    <div class="gmp-h">Release date changed (<%= pu.dateChanges.length %>)</div>
    <% pu.dateChanges.forEach(c => { %>
    <label class="gmp-chg">
      <input type="checkbox" name="date" value="<%= c.id %>" class="gmp-tick" data-gmp-date checked>
      <span class="gmp-chg-title"><%= c.title %></span>
      <span class="gmp-chg-from"><%= c.fromLabel %> →</span>
      <span class="gmp-chg-to"><%= c.toLabel %></span>
    </label>
    <% }) %>
    <div class="gmp-note">Only the date changes. Prices, slots, cover and reservations stay.</div>
  </div>
  <% } %>
  <% if (pu.already.length) { %>
  <div class="gmp-card gmp-already"><b>Already on your site (<%= pu.already.length %>)</b> · <%= pu.already.join(', ') %></div>
  <% } %>
  <div class="gmp-go">
    <button type="submit" form="gmpCancel" class="gm-btn"><%= pu.upToDate ? 'Close' : 'Cancel' %></button>
    <% if (!pu.upToDate) { %><button type="submit" class="gmp-apply" data-gmp-apply><%= pu.applyText %></button><% } %>
  </div>
</form>
<form method="POST" action="/admin/upcoming/psn/cancel" id="gmpCancel" data-no-loading="1">
  <input type="hidden" name="token" value="<%= pu.token %>">
</form>
<% } %>
````

- [ ] **Step 4: Create the tick-count script**

Create `public/js/admin-upcoming-psn.js`:

````js
// Admin → Games → Coming soon → "Update from PlayStation" list: keeps the gold
// button's words ("Add 3 games · update 1 date") in step with the ticks.
// Saves nothing. The same rule renders the first label on the server
// (lib/upcoming-psn.js applyLabel); scripts/test-admin-upcoming-psn.js checks
// the two agree. Page wiring is skipped when there is no document (tests).
(function () {
  'use strict';

  function plural(n, one) { return n + ' ' + one + (n === 1 ? '' : 's'); }

  function applyLabel(adds, dates) {
    if (adds && dates) return 'Add ' + plural(adds, 'game') + ' · update ' + plural(dates, 'date');
    if (adds) return 'Add ' + plural(adds, 'game');
    if (dates) return 'Update ' + plural(dates, 'date');
    return 'Add selected';
  }

  if (typeof window !== 'undefined') window.__gmpApplyLabel = applyLabel;
  if (typeof document === 'undefined' || !document.getElementById) return;

  function init() {
    var form = document.getElementById('gmpForm');
    var button = form && form.querySelector('[data-gmp-apply]');
    if (!button) return;
    function update() {
      button.textContent = applyLabel(
        form.querySelectorAll('[data-gmp-add]:checked').length,
        form.querySelectorAll('[data-gmp-date]:checked').length
      );
    }
    form.addEventListener('change', update);
    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
````

- [ ] **Step 5: Apply the page edits**

Create `.superpowers/tmp-edits/upcoming-psn.css`. These are the panel styles the edit script inserts into `public/css/style.css`; the leading blank line is intended:

````css

/* Coming soon → "Update from PlayStation" (views/partials/admin/games/psn-update.ejs). */
.gmp-bar { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.9rem; }
.gmp-bar form { margin: 0; }
.gmp-check { border-color: rgba(240,165,0,0.45); color: var(--ps-blue); }
.gmp-check:hover { border-color: var(--ps-blue); color: var(--ps-blue); }
.gmp-hint { font-size: 0.74rem; color: #666; }
.gmp-warn { background: rgba(240,165,0,0.08); border: 1px solid rgba(240,165,0,0.3); color: #f5c451; border-radius: 10px; padding: 0.65rem 0.9rem; font-size: 0.82rem; margin-bottom: 0.9rem; }
.gmp { margin-bottom: 1.25rem; }
.gmp-card { background: #0d0d0d; border: 1px solid #222; border-radius: 12px; padding: 0.85rem 1rem; margin-bottom: 0.6rem; }
.gmp-h { font-weight: 800; color: #fff; font-size: 0.9rem; margin-bottom: 0.45rem; }
.gmp-h2 { margin-top: 0.9rem; }
.gmp-meta { font-weight: 400; color: #777; font-size: 0.78rem; }
.gmp-row { display: grid; grid-template-columns: 20px 44px minmax(0, 1fr) 100px 64px; gap: 0.75rem; align-items: center; padding: 0.5rem 0; border-top: 1px solid #1c1c1c; }
.gmp-tick { width: 18px; height: 18px; margin: 0; accent-color: var(--ps-blue); cursor: pointer; }
.gmp-cover { display: block; width: 44px; height: 44px; border-radius: 6px; object-fit: cover; background: #151515; }
.gmp-name { min-width: 0; }
.gmp-title { width: 100%; box-sizing: border-box; background: #111; border: 1px solid #262626; border-radius: 7px; color: #fff; font-weight: 700; font-size: 0.85rem; padding: 0.35rem 0.5rem; font-family: inherit; }
.gmp-title:focus, .gmp-f input:focus { outline: none; border-color: var(--ps-blue); }
.gmp-sub { font-size: 0.72rem; color: #777; margin-top: 0.2rem; }
.gmp-date { font-size: 0.8rem; color: #ccc; }
.gmp-plat { font-size: 0.75rem; color: #888; font-weight: 700; }
.gmp-prices { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.55rem; }
.gmp-f { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.72rem; color: #888; }
.gmp-f input { width: 100%; box-sizing: border-box; background: #111; border: 1px solid #262626; border-radius: 7px; color: #fff; font-size: 0.85rem; padding: 0.4rem 0.5rem; font-family: inherit; }
.gmp-note { font-size: 0.72rem; color: #666; margin-top: 0.6rem; }
.gmp-chg { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0; border-top: 1px solid #1c1c1c; font-size: 0.85rem; cursor: pointer; }
.gmp-chg-title { flex: 1; min-width: 0; color: #fff; font-weight: 700; }
.gmp-chg-from { color: #777; }
.gmp-chg-to { color: var(--ps-blue); font-weight: 800; }
.gmp-already { font-size: 0.8rem; color: #888; }
.gmp-already b { color: #ccc; }
.gmp-go { display: flex; justify-content: flex-end; gap: 0.6rem; flex-wrap: wrap; }
.gmp-apply { background: var(--ps-blue); color: #000; border: 0; border-radius: 50px; padding: 0.6rem 1.3rem; font-weight: 800; font-size: 0.85rem; cursor: pointer; font-family: inherit; }
.gmp-apply:hover { filter: brightness(1.08); }
@media (max-width: 640px) {
  .gmp-row { grid-template-columns: 20px 44px minmax(0, 1fr); grid-template-areas: "tick cover name" "tick cover when"; row-gap: 0.3rem; }
  .gmp-tick { grid-area: tick; }
  .gmp-cover { grid-area: cover; }
  .gmp-name { grid-area: name; }
  .gmp-date { grid-area: when; }
  .gmp-plat { grid-area: when; justify-self: end; }
  .gmp-chg { flex-wrap: wrap; }
  .gmp-chg-title { flex-basis: calc(100% - 2rem); }
  .gmp-go { justify-content: stretch; }
  .gmp-go > * { flex: 1; justify-content: center; }
}
body.light-mode .gmp-card { background: #fff; border-color: #ddd; }
body.light-mode .gmp-h,
body.light-mode .gmp-chg-title { color: #111; }
body.light-mode .gmp-row,
body.light-mode .gmp-chg { border-top-color: #eee; }
body.light-mode .gmp-title,
body.light-mode .gmp-f input { background: #f8f9fa; border-color: #ccc; color: #111; }
body.light-mode .gmp-date,
body.light-mode .gmp-already b { color: #333; }
body.light-mode .gmp-check,
body.light-mode .gmp-chg-to { color: #b45309; }
body.light-mode .gmp-check { border-color: rgba(180,83,9,0.45); }
body.light-mode .gmp-warn { color: #92400e; }
````

Create `.superpowers/tmp-edits/edit-upcoming-psn-ui.js`:

````js
// Task 5: the admin page side of Coming soon → "Update from PlayStation".
// Run from the repo root: node .superpowers/tmp-edits/edit-upcoming-psn-ui.js
const fs = require('fs');
const path = require('path');
const rep = require('./rep');

// 1. The panel sits at the top of the Coming soon sub-tab.
rep('views/partials/admin/games/coming-soon.ejs',
`<%
  const csRows = gamesView.upcoming;`,
`<%- include('psn-update') %>
<%
  const csRows = gamesView.upcoming;`);

// 2. Every psn_upcoming_* message lands on the Games tab…
rep('views/admin.ejs',
`    upcoming_added:'games', upcoming_updated:'games', upcoming_deleted:'games',
`,
`    upcoming_added:'games', upcoming_updated:'games', upcoming_deleted:'games',
    psn_upcoming_preview:'games', psn_upcoming_applied:'games', psn_upcoming_partial:'games', psn_upcoming_expired:'games',
    psn_upcoming_unreachable:'games', psn_upcoming_nothing:'games', psn_upcoming_busy:'games', psn_upcoming_cancelled:'games',
`);

// …with these toasts ({added} and {dates} are filled in from the URL)…
rep('views/admin.ejs',
`upcoming_deleted:'🗑 Upcoming game deleted!', `,
`upcoming_deleted:'🗑 Upcoming game deleted!', psn_upcoming_applied:'✅ Added {added} · updated {dates}', psn_upcoming_partial:'⚠ Added {added} · updated {dates} — some covers or descriptions couldn\\'t be downloaded; add them in Edit.', psn_upcoming_expired:'⏳ That list expired — press Update from PlayStation again.', psn_upcoming_unreachable:'❌ Couldn\\'t reach PlayStation — nothing changed.', psn_upcoming_nothing:'⛔ Nothing ticked — tick a game or a date first.', psn_upcoming_busy:'⏳ Already adding games — wait a minute.', `);

rep('views/admin.ejs',
`    const text = messages[msg];
`,
`    // "Update from PlayStation" toasts carry their counts in the URL.
    const countOf = (key, one) => { const n = parseInt(params.get(key), 10) || 0; return n + ' ' + one + (n === 1 ? '' : 's'); };
    const text = (messages[msg] || '').replace('{added}', countOf('added', 'game')).replace('{dates}', countOf('dates', 'date'));
`);

// …and the loading overlay says what is happening while it waits.
rep('views/admin.ejs',
`'/admin/upcoming/add':'🔜 Adding upcoming game...', `,
`'/admin/upcoming/add':'🔜 Adding upcoming game...', '/admin/upcoming/psn/refresh':'🔄 Checking PlayStation...', '/admin/upcoming/psn/apply':'⏳ Adding games from PlayStation — this can take a minute...', `);

rep('views/admin.ejs',
`<script src="/js/admin-games.js?v=<%= assetV %>"></script>
`,
`<script src="/js/admin-games.js?v=<%= assetV %>"></script>
<script src="/js/admin-upcoming-psn.js?v=<%= assetV %>"></script>
`);

// 3. …and opens the Coming soon sub-tab.
rep('public/js/admin-games.js',
`    if (/^(request|voter)_/.test(msg)) return 'requests';
`,
`    if (/^(request|voter)_/.test(msg)) return 'requests';
    // Every "Update from PlayStation" outcome.
    if (/^psn_upcoming_/.test(msg)) return 'soon';
`);

// 4. Panel styles, after the Games tab's light-mode rules.
rep('public/css/style.css',
`body.light-mode .gm-earned { color: #15803d; }
`,
`body.light-mode .gm-earned { color: #15803d; }
` + fs.readFileSync(path.join(__dirname, 'upcoming-psn.css'), 'utf8'));

console.log('edited coming-soon.ejs, admin.ejs, admin-games.js, style.css');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-upcoming-psn-ui.js` → `edited coming-soon.ejs, admin.ejs, admin-games.js, style.css`.
Then: `file public/css/style.css views/admin.ejs views/partials/admin/games/coming-soon.ejs public/js/admin-games.js` → `style.css` still `with CRLF line terminators`; the other three have no CRLF.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `node scripts/test-admin-upcoming-psn-page.js` → `11 assertions passed`.
Run: `node scripts/test-admin-upcoming-psn.js && node scripts/test-admin-games-filter.js` → `13 assertions passed`, `17 assertions passed`.
Run the whole suite: `fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail"` → only `FAIL scripts/test-requests-page.js`, `failed: 1`.

- [ ] **Step 7: Commit and clean up**

```bash
git add views/partials/admin/games/psn-update.ejs public/js/admin-upcoming-psn.js views/partials/admin/games/coming-soon.ejs views/admin.ejs public/js/admin-games.js public/css/style.css scripts/test-admin-upcoming-psn-page.js
git commit -m "Coming soon: Update from PlayStation panel (tick to add, shared prices, date changes)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
rm -rf .superpowers/tmp-edits && git status --short
```
Expected `git status`: nothing except the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.
