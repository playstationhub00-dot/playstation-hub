# Coming soon — PlayStation pictures and game info — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coming soon pages show PlayStation's trailer, screenshots, rating, "About this game" and "Game info" exactly like released game pages. The admin "Update from PlayStation" list gets a "Get PlayStation info" section that fills this in for Coming soon games already on the site. New games keep their full info, and Release carries it over.

**Architecture:** Coming soon records gain the same `psn` object released games already store (from `lib/psn-game.js` `fetchGameInfo`). `lib/upcoming-psn.js` decides which Coming soon games are due info and plans the apply. The apply route in `server.js` fetches and stores it. `views/upcoming-detail.ejs` renders it through the existing `lib/game-psn-view.js` and `partials/game-psn-*` used by `views/game-detail.ejs`. `lib/release.js` copies `psn` to the released game.

**Tech Stack:** Node 24, Express, EJS, lowdb. Tests are plain `node scripts/test-*.js` files.

Spec: `docs/superpowers/specs/2026-10-10-coming-soon-psn-info-design.md`. It builds on `docs/superpowers/specs/2026-10-10-upcoming-from-playstation-design.md`, which is already shipped.

Every file in this plan was dry-run in a scratch copy of the current `main`. Each new test fails first, then passes. The full suite stays green apart from the known `scripts/test-requests-page.js`. A browser check on a throwaway instance with fake data covered both the admin list and the page, at phone and computer widths. It used saved real PlayStation data for Castlevania and Call of Duty MW4, and showed no console or server errors.

## Global Constraints

- Work directly on `main`; **push only when the owner says "push"**.
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Line endings: `server.js` is CRLF + UTF-8 BOM. Everything else this plan touches is LF: `lib/upcoming-psn.js`, `lib/release.js`, `views/upcoming-detail.ejs`, `views/admin.ejs`, `views/partials/admin/games/psn-update.ejs`, `public/js/admin-upcoming-psn.js` and the test files. The edit scripts (via `.superpowers/tmp-edits/rep.js`) keep each file's endings; check `server.js` with `file` after each edit.
- Tests never reach PlayStation, a database or the real admin: temp `DATA_DIR`, blank `MONGODB_URI`, the in-memory session store, a made-up admin password, and stubbed module functions. Never write the project's `games.json`.
- The owner's own description and gallery win over PlayStation's (`lib/game-psn-view.js` rule, unchanged). The trailer, rating, publisher, voices and age rating come from PlayStation.
- An info update changes only `psn` (plus `psn_concept_id` when the record had none). Prices, slots, cover, description, gallery and reservations are never touched.
- Info is due when `psn` is missing, has no `fetched_at`, or `fetched_at` is older than 7 days or unreadable (same 7 days as `PSN_FRESH_MS` in `server.js`).
- Redirect after apply: `psn_upcoming_applied` | `psn_upcoming_partial` with `&added=X&dates=Y&info=Z&missing=M`.
- Known unrelated failure: `scripts/test-requests-page.js`. Report it, do not fix it.
- Edit scripts live in `.superpowers/tmp-edits/` (git-ignored); never commit them; Task 5 removes the folder.
- Always `git add` explicit paths: the untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` must never be committed.

## Files

| File | Task | Change |
|---|---|---|
| `lib/upcoming-psn.js` | 1 | `infoUpdates` in the preview, `info` in the form and plan, `infoPatch`, `storeLink`, `infoDue`, three-count `applyLabel`, new records keep `psn` |
| `scripts/test-upcoming-psn.js` | 1 | Rules test (whole file replaced) |
| `scripts/test-admin-upcoming-psn-page.js` | 1, 4 | Task 1: fixture games get fresh info. Task 4: whole file replaced |
| `lib/release.js`, `scripts/test-release.js` | 2 | Release copies `psn` and `psn_concept_id` |
| `server.js` | 3, 5 | Task 3: apply fills info, redirect counts. Task 5: the page route passes `psnView` |
| `scripts/test-admin-upcoming-psn.js` | 3 | Route test (whole file replaced) |
| `views/partials/admin/games/psn-update.ejs`, `views/admin.ejs` | 4 | "Get PlayStation info" section; toast summary |
| `public/js/admin-upcoming-psn.js` | 4 | Button words count info ticks (whole file replaced) |
| `views/upcoming-detail.ejs` | 5 | PlayStation blocks |
| `scripts/test-upcoming-psn-page-public.js` (new) | 5 | The public Coming soon page |

---

### Task 1: The rules (`lib/upcoming-psn.js`)

**Files:**
- Modify (whole file replaced): `lib/upcoming-psn.js`
- Test (whole file replaced): `scripts/test-upcoming-psn.js`
- Modify (edit script): `scripts/test-admin-upcoming-psn-page.js`, fixture only

**Interfaces:**
- Consumes: `titleCandidates` from `lib/psn-game.js` (unchanged).
- Produces, used by Tasks 3 and 4:
  - `INFO_FRESH_MS` = 7 days in ms
  - `storeLink(conceptId) → 'https://store.playstation.com/en-us/concept/<digits>' | ''`
  - `infoDue(upcomingRecord, nowMs) → boolean`
  - `applyLabel(adds, dates, infos) → string`, e.g. "Add 2 games · update 1 date · get info for 4 games", "Get info for 1 game", "Add selected"
  - `buildPreview({ upcoming, games, feedGames, skipped, now = Date.now() })` also returns `infoUpdates: [{ id, title, concept_id }]`, where `concept_id` is `''` when the game will be searched by name
  - `previewView(...)` also returns `infoUpdates` (each with `matched: boolean`). Its `upToDate` and `applyText` count them.
  - `readForm(body)` also returns `info: number[]` (from repeated `info` fields)
  - `planApply(...)` also returns `infoUpdates: [{ id, title, concept_id }]` (offered and still existing; title as stored now)
  - `infoPatch(currentRecord, fetchGameInfoResult) → { psn, psn_concept_id? } | null`
  - `newUpcomingRecord(game, { ..., psn })` adds `psn` when given; `buildRecord` passes the fetched `psn`

- [ ] **Step 1: Write the failing test**

Replace the whole of `scripts/test-upcoming-psn.js` with:

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
    assert.strictEqual(u.applyLabel(2, 1, 4), 'Add 2 games · update 1 date · get info for 4 games');
    assert.strictEqual(u.applyLabel(0, 0, 1), 'Get info for 1 game');
    assert.strictEqual(u.applyLabel(0, 3, 2), 'Update 3 dates · get info for 2 games');
    assert.strictEqual(u.applyLabel(1, 0, 0), 'Add 1 game');
  });
  ok('storeLink builds a store page only from a digit concept id', () => {
    assert.strictEqual(u.storeLink('10018186'), 'https://store.playstation.com/en-us/concept/10018186');
    assert.strictEqual(u.storeLink(42), 'https://store.playstation.com/en-us/concept/42');
    assert.strictEqual(u.storeLink(''), '');
    assert.strictEqual(u.storeLink('12ab'), '');
    assert.strictEqual(u.storeLink(null), '');
  });
  ok('infoDue: no info, no date, an unreadable date or older than 7 days', () => {
    const NOW = Date.UTC(2026, 9, 10);
    const ago = days => new Date(NOW - days * 86400000).toISOString();
    assert.strictEqual(u.infoDue({}, NOW), true);
    assert.strictEqual(u.infoDue({ psn: {} }, NOW), true);
    assert.strictEqual(u.infoDue({ psn: { fetched_at: 'garbage' } }, NOW), true);
    assert.strictEqual(u.infoDue({ psn: { fetched_at: ago(8) } }, NOW), true);
    assert.strictEqual(u.infoDue({ psn: { fetched_at: ago(6) } }, NOW), false);
    assert.strictEqual(u.INFO_FRESH_MS, 7 * 24 * 60 * 60 * 1000);
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
    assert.strictEqual(v.applyText, 'Add 1 game · update 2 dates · get info for 4 games', 'none of the 4 Coming soon games has PlayStation info');
    const NOW = Date.parse('2026-10-10T00:00:00.000Z');
    const withInfo = upcoming.map(x => Object.assign({}, x, { psn: { fetched_at: '2026-10-09T00:00:00.000Z' } }));
    const none = u.previewView(u.buildPreview({ upcoming: withInfo, games, feedGames: [], skipped: [], now: NOW }), { token: 't', checkedAt: 'x' });
    assert.strictEqual(none.upToDate, true);
    assert.strictEqual(none.checkedLabel, '');
    const infoOnly = u.previewView(u.buildPreview({ upcoming, games, feedGames: [], skipped: [], now: NOW }), { token: 't', checkedAt: 'x' });
    assert.strictEqual(infoOnly.upToDate, false, 'info updates alone are something to do');
    assert.strictEqual(infoOnly.applyText, 'Get info for 4 games');
  });
  ok('info updates: no info, stale or unreadable info; concept id from this run, then stored, else name search', () => {
    const NOW = Date.UTC(2026, 9, 10);
    const ago = days => new Date(NOW - days * 86400000).toISOString();
    const ups = [
      { id: 1, title: 'No Info Yet', release_date: 'TBA' },
      { id: 2, title: 'Stale Info', psn_concept_id: '222', psn: { fetched_at: ago(8) } },
      { id: 3, title: 'Fresh Info', psn: { fetched_at: ago(1), concept_id: '333' } },
      { id: 4, title: 'Bad Date', psn: { fetched_at: 'garbage', concept_id: '444' } },
      { id: 5, title: 'Matched In Feed', release_date: '2027-01-01', psn_concept_id: '999' },
      { id: 6, title: 'Odd Stored Id', psn_concept_id: 'x9' }
    ];
    const p = u.buildPreview({ upcoming: ups, games: [], feedGames: [feed(555, 'Matched In Feed', '2027-01-01')], skipped: [], now: NOW });
    assert.deepStrictEqual(p.infoUpdates, [
      { id: 1, title: 'No Info Yet', concept_id: '' },
      { id: 2, title: 'Stale Info', concept_id: '222' },
      { id: 4, title: 'Bad Date', concept_id: '444' },
      { id: 5, title: 'Matched In Feed', concept_id: '555' },
      { id: 6, title: 'Odd Stored Id', concept_id: '' }
    ]);
    const v = u.previewView(p, { token: 't', checkedAt: 'x' });
    assert.deepStrictEqual(v.infoUpdates.map(i => i.matched), [false, true, true, true, false]);
  });

  console.log('\napply');
  ok('readForm keeps digit concept ids, whole-number ids, trimmed titles and safe numbers', () => {
    const f = u.readForm({
      add: ['104', '105', '104', 'x1', '../2'], date: ['2', '3', 'zz', '-1'], info: ['4', '4', 'x', '0', '7'],
      title_104: '  Castlevania:   Belmont\'s Curse ', title_105: '   ',
      nt_price_7d: '349', nt_price_30d: '-5', tr_price_7d: 'abc', tr_price_30d: '1299.9', non_trophy_slots: '3', trophy_slots: '99999999'
    });
    assert.deepStrictEqual(f.add, ['104', '105']);
    assert.deepStrictEqual(f.dates, [2, 3]);
    assert.deepStrictEqual(f.info, [4, 7]);
    assert.deepStrictEqual(f.titles, { 104: "Castlevania: Belmont's Curse" });
    assert.deepStrictEqual(f.prices, { nt_price_7d: 349, nt_price_30d: 0, tr_price_7d: 0, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1000000 });
    const single = u.readForm({ add: '104', date: '2', info: '3' });
    assert.deepStrictEqual([single.add, single.dates, single.info], [['104'], [2], [3]]);
    assert.deepStrictEqual(u.readForm(undefined).add, []);
    assert.deepStrictEqual(u.readForm(undefined).info, []);
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
  ok('planApply info updates: only offered games that still exist, with the title as stored now', () => {
    const p = { fresh: [], skippedBefore: [], dateChanges: [], infoUpdates: [{ id: 1, title: 'Old Name', concept_id: '' }, { id: 5, title: 'Five', concept_id: '555' }, { id: 6, title: 'Gone', concept_id: '' }] };
    const nowUpcoming = [{ id: 1, title: 'New Name' }, { id: 5, title: 'Five' }, { id: 7, title: 'Never offered' }];
    const plan = u.planApply({ preview: p, form: u.readForm({ info: ['1', '5', '6', '7'] }), upcoming: nowUpcoming, games: [], skipped: [] });
    assert.deepStrictEqual(plan.infoUpdates, [{ id: 1, title: 'New Name', concept_id: '' }, { id: 5, title: 'Five', concept_id: '555' }]);
    assert.deepStrictEqual(u.planApply({ preview: p, form: u.readForm({}), upcoming: nowUpcoming, games: [], skipped: [] }).infoUpdates, []);
    assert.deepStrictEqual(u.planApply({ preview: {}, form: undefined, upcoming: [], games: [], skipped: [] }).infoUpdates, [], 'no form at all');
  });
  ok('infoPatch stores what PlayStation gave, adds the concept id only when there was none', () => {
    const psn = { concept_id: '555', description: 'D', fetched_at: 'now' };
    assert.deepStrictEqual(u.infoPatch({ id: 1 }, { ok: true, psn }), { psn, psn_concept_id: '555' });
    assert.deepStrictEqual(u.infoPatch({ id: 1, psn_concept_id: '111' }, { ok: true, psn }), { psn });
    assert.deepStrictEqual(u.infoPatch({ id: 1 }, { ok: true, psn: { description: 'no id' } }), { psn: { description: 'no id' } });
    assert.strictEqual(u.infoPatch({ id: 1 }, { ok: false, reason: 'no_match' }), null);
    assert.strictEqual(u.infoPatch({ id: 1 }, null), null);
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
    const psn = { description: 'D', fetched_at: 'now' };
    const withPsn = u.newUpcomingRecord(feed(104, 'Castlevania', '2026-10-15'), { prices, nowIso: 'now', psn });
    assert.deepStrictEqual(withPsn.psn, psn, 'PlayStation info kept when there is some');
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
    assert.strictEqual(record.psn.description, 'Whip it. (104)', 'the full store info is kept for the page');
    assert.strictEqual(record.psn.screenshots.length, 9);
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

Run: `node scripts/test-upcoming-psn.js` → FAIL `AssertionError … actual: 'Add 2 games · update 1 date', expected: 'Add 2 games · update 1 date · get info for 4 games'`.

- [ ] **Step 3: Write the rules**

Replace the whole of `lib/upcoming-psn.js` with:

````js
// Coming soon → "Update from PlayStation": the rules. Which of PlayStation's
// announced games are new to the site, which Coming soon dates moved, what a
// ticked game becomes as an upcoming record, and what the owner's ticks mean.
// lib/upcoming-psn-feed.js reads PlayStation; server.js wires the routes.
// Nothing here touches the network, the disk or the database — buildRecord's
// downloads are functions handed in by the caller.
// See docs/superpowers/specs/2026-10-10-upcoming-from-playstation-design.md and
// docs/superpowers/specs/2026-10-10-coming-soon-psn-info-design.md.
const { titleCandidates } = require('./psn-game');

// Same 7 days as released games' PSN_FRESH_MS in server.js: PlayStation info
// older than this is offered for a refresh.
const INFO_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
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
// for live updates; scripts/test-admin-upcoming-psn-page.js checks the two agree.
function applyLabel(adds, dates, infos) {
  const parts = [];
  if (adds) parts.push('Add ' + plural(adds, 'game'));
  if (dates) parts.push((parts.length ? 'update ' : 'Update ') + plural(dates, 'date'));
  if (infos) parts.push((parts.length ? 'get info for ' : 'Get info for ') + plural(infos, 'game'));
  return parts.length ? parts.join(' · ') : 'Add selected';
}

// The store page fetchGameInfo reads for a known PlayStation game, or ''.
function storeLink(conceptId) {
  const id = String(conceptId == null ? '' : conceptId);
  return /^\d+$/.test(id) ? 'https://store.playstation.com/en-us/concept/' + id : '';
}

// A Coming soon game is due PlayStation info when it has none, or it is older
// than INFO_FRESH_MS (or its date does not parse).
function infoDue(up, nowMs) {
  const psn = up && up.psn;
  if (!psn || typeof psn !== 'object' || !psn.fetched_at) return true;
  return !(nowMs - Date.parse(psn.fetched_at) <= INFO_FRESH_MS);
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
// { fresh, skippedBefore, dateChanges, already, infoUpdates, defaults, defaultsFrom } —
// fresh/skippedBefore hold feed games (plus `genre`), dateChanges hold
// { id, title, from, to, concept_id }, already holds the site's titles and
// infoUpdates holds { id, title, concept_id } for every Coming soon game due
// PlayStation info (concept_id '' when it will be searched by name).
function buildPreview({ upcoming, games, feedGames, skipped, now = Date.now() }) {
  const ups = (upcoming || []).filter(Boolean);
  const site = (games || []).filter(Boolean);
  const skippedSet = new Set((skipped || []).map(String));
  const seen = new Set();
  const fresh = [];
  const skippedBefore = [];
  const dateChanges = [];
  const already = [];
  const matched = new Map(); // upcoming id → the PlayStation game it matched this run
  (feedGames || []).forEach(g => {
    if (!g || !g.concept_id) return;
    const key = matchKey(g.title);
    if (seen.has('c' + g.concept_id) || (key && seen.has('k' + key))) return;
    seen.add('c' + g.concept_id);
    if (key) seen.add('k' + key);
    const up = ups.find(u => sameConcept(u.psn_concept_id, g.concept_id) || (key && matchKey(u.title) === key));
    if (up) {
      already.push(String(up.title || ''));
      matched.set(up.id, g.concept_id);
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
  const infoUpdates = ups.filter(u => infoDue(u, now)).map(u => {
    const known = [matched.get(u.id), u.psn_concept_id, u.psn && u.psn.concept_id].map(c => String(c == null ? '' : c));
    return { id: u.id, title: String(u.title || ''), concept_id: known.find(c => /^\d+$/.test(c)) || '' };
  });
  const d = defaultsFrom(ups);
  return { fresh, skippedBefore, dateChanges, already, infoUpdates, defaults: d.values, defaultsFrom: d.fromTitle };
}

// What the panel template shows: the preview plus labels.
function previewView(preview, { token, checkedAt }) {
  const p = preview || {};
  const withLabel = g => Object.assign({}, g, { dateLabel: dateLabel(g.release_date) });
  const fresh = (p.fresh || []).map(withLabel);
  const skippedBefore = (p.skippedBefore || []).map(withLabel);
  const dateChanges = (p.dateChanges || []).map(c => Object.assign({}, c, { fromLabel: dateLabel(c.from), toLabel: dateLabel(c.to) }));
  const infoUpdates = (p.infoUpdates || []).map(i => Object.assign({}, i, { matched: !!i.concept_id }));
  const checked = new Date(checkedAt);
  return {
    token,
    checkedLabel: isNaN(checked) ? '' : checked.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }),
    fresh,
    skippedBefore,
    dateChanges,
    infoUpdates,
    already: (p.already || []).slice(),
    defaults: Object.assign({}, p.defaults),
    defaultsFrom: p.defaultsFrom || '',
    upToDate: !fresh.length && !skippedBefore.length && !dateChanges.length && !infoUpdates.length,
    applyText: applyLabel(fresh.length, dateChanges.length, infoUpdates.length)
  };
}

function asList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function idList(v) {
  return [...new Set(asList(v).map(x => parseInt(x, 10)).filter(n => Number.isInteger(n) && n > 0))];
}

// The apply form's body → { add, dates, info, titles, prices }. Concept ids are
// digits; upcoming ids are positive whole numbers; anything else is dropped.
function readForm(body) {
  const b = body || {};
  const add = [...new Set(asList(b.add).map(v => String(v).trim()).filter(v => /^\d+$/.test(v)))];
  const dates = idList(b.date);
  const info = idList(b.info);
  const titles = {};
  add.forEach(id => {
    const t = String(b['title_' + id] == null ? '' : b['title_' + id]).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    if (t) titles[id] = t;
  });
  const prices = {};
  PRICE_FIELDS.forEach(k => { prices[k] = wholeNumber(b[k]); });
  return { add, dates, info, titles, prices };
}

// Re-planned against what is stored now, not when the preview was made: a
// ticked game that matches a Coming soon or catalogue game added since is
// skipped, and a date change or info update for a game deleted since is dropped.
// Returns { adds, prices, dateUpdates, infoUpdates, skipped } — infoUpdates are
// { id, title, concept_id }, with the title as stored now (the name search uses it).
function planApply({ preview, form, upcoming, games, skipped }) {
  const p = preview || {};
  const f = Object.assign({ add: [], dates: [], info: [], titles: {}, prices: {} }, form);
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
  const infoUpdates = [];
  f.info.forEach(id => {
    const offeredInfo = (p.infoUpdates || []).find(i => i.id === id);
    const up = ups.find(u => u.id === id);
    if (offeredInfo && up) infoUpdates.push({ id, title: String(up.title || ''), concept_id: offeredInfo.concept_id });
  });
  const unticked = offered.map(g => String(g.concept_id)).filter(id => !ticked.has(id));
  const keep = (skipped || []).map(String).filter(id => !ticked.has(id));
  unticked.forEach(id => { if (!keep.includes(id)) keep.push(id); });
  return { adds, prices: Object.assign({}, f.prices), dateUpdates, infoUpdates, skipped: keep.slice(-MAX_SKIPPED) };
}

// fetchGameInfo's result for an info update → what to store on the Coming
// soon record ({ psn } plus psn_concept_id when it had none), or null when
// PlayStation gave nothing — the record is then left as it is.
function infoPatch(current, result) {
  if (!result || !result.ok || !result.psn || typeof result.psn !== 'object') return null;
  const patch = { psn: result.psn };
  const conceptId = String(result.psn.concept_id || '');
  if (!(current && current.psn_concept_id) && /^\d+$/.test(conceptId)) patch.psn_concept_id = conceptId;
  return patch;
}

// One ticked game → an upcoming record (no id; server.js assigns it), with the
// same fields as /admin/upcoming/add plus psn_concept_id, and `psn` (the store
// page as fetchGameInfo returned it) when there is one.
function newUpcomingRecord(game, { prices, description, genre, cover_image, gallery, nowIso, psn }) {
  const pr = prices || {};
  const record = {
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
  if (psn && typeof psn === 'object') record.psn = psn;
  return record;
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
  const record = newUpcomingRecord(game, { prices, description, genre, cover_image: cover, gallery: gallery.filter(Boolean), nowIso, psn: info });
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
  PRICE_FIELDS, MAX_SCREENSHOTS, MAX_SKIPPED, INFO_FRESH_MS,
  cleanTitle, matchKey, mapGenre, manilaDate, platformOf, dateLabel, applyLabel, storeLink, infoDue,
  buildPreview, previewView, readForm, planApply, infoPatch, newUpcomingRecord, buildRecord, mapLimit
};
````

- [ ] **Step 4: Keep the admin page test's fixture meaning the same**

Its two Coming soon games would otherwise become "due PlayStation info", which would change that test's button words and its "up to date" case. Task 4 rewrites the test for the new section.

Create `.superpowers/tmp-edits/rep.js`. It keeps the BOM and CRLF and fails loudly on a missing or repeated anchor; later tasks reuse it:

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

Create `.superpowers/tmp-edits/edit-info-page-fixture.js`:

````js
// Task 1: the admin page test's two Coming soon games already have fresh
// PlayStation info, so the info-update rules added in this task do not change
// what that test checks (Task 4 rewrites the test for the new section).
// Run from the repo root: node .superpowers/tmp-edits/edit-info-page-fixture.js
const rep = require('./rep');
const F = 'scripts/test-admin-upcoming-psn-page.js';

rep(F,
`const upcoming = [
  { id: 1, title: 'Zzyzx Moved Game', platform: 'PS5', release_date: '2026-10-29', created_at: '2026-09-01T00:00:00.000Z', nt_price_7d: 349, nt_price_30d: 1099, tr_price_7d: 449, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1 },
  { id: 2, title: 'Zzyzx Tba Game', platform: 'PS5', release_date: 'TBA', created_at: '2026-08-01T00:00:00.000Z' }
];`,
`// Both already have fresh PlayStation info, so neither is offered for an info update.
const FRESH_PSN = { fetched_at: new Date().toISOString() };
const upcoming = [
  { id: 1, title: 'Zzyzx Moved Game', platform: 'PS5', release_date: '2026-10-29', created_at: '2026-09-01T00:00:00.000Z', nt_price_7d: 349, nt_price_30d: 1099, tr_price_7d: 449, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1, psn: FRESH_PSN },
  { id: 2, title: 'Zzyzx Tba Game', platform: 'PS5', release_date: 'TBA', created_at: '2026-08-01T00:00:00.000Z', psn: FRESH_PSN }
];`);

console.log('edited ' + F);
````

Run from the repo root: `node .superpowers/tmp-edits/edit-info-page-fixture.js` → `edited scripts/test-admin-upcoming-psn-page.js`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node scripts/test-upcoming-psn.js` → `22 assertions passed`.
Run: `node scripts/test-admin-upcoming-psn.js && node scripts/test-admin-upcoming-psn-page.js` → `13 assertions passed`, `11 assertions passed`.

- [ ] **Step 6: Commit**

```bash
git add lib/upcoming-psn.js scripts/test-upcoming-psn.js scripts/test-admin-upcoming-psn-page.js
git commit -m "Coming soon from PlayStation: rules for filling PlayStation info on existing games

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Release carries the info (`lib/release.js`)

**Files:**
- Modify (edit scripts): `scripts/test-release.js` (two checks after "does not share the gallery array…"), `lib/release.js` (`releasedGameRecord`)

**Interfaces:**
- Consumes: `.superpowers/tmp-edits/rep.js` (Task 1).
- Produces: `releasedGameRecord(upcoming, id, nowIso)` includes `psn` (same object) and `psn_concept_id` (string) when the Coming soon record has them, and neither key otherwise.

- [ ] **Step 1: Write the failing test**

Create `.superpowers/tmp-edits/edit-release-test.js`:

````js
// Task 2, step 1: the Release test gains two checks for PlayStation info.
// Run from the repo root: node .superpowers/tmp-edits/edit-release-test.js
const rep = require('./rep');

rep('scripts/test-release.js',
`    assert.strictEqual(UPCOMING.gallery.length, 1);
  });

  console.log('\\npartitionReleaseOrders()');
`,
`    assert.strictEqual(UPCOMING.gallery.length, 1);
  });

  await ok('carries the PlayStation info and its concept id over to the released game', () => {
    const psn = { concept_id: '10018186', description: 'From PlayStation', screenshots: ['https://image.api.playstation.com/s1.jpg'], fetched_at: NOW };
    const g = rel.releasedGameRecord(Object.assign({}, UPCOMING, { psn, psn_concept_id: '10018186' }), 77, NOW);
    assert.deepStrictEqual(g.psn, psn);
    assert.strictEqual(g.psn_concept_id, '10018186');
  });

  await ok('a Coming Soon game without PlayStation info releases without those fields', () => {
    const g = rel.releasedGameRecord(UPCOMING, 77, NOW);
    assert.strictEqual('psn' in g, false);
    assert.strictEqual('psn_concept_id' in g, false);
  });

  console.log('\\npartitionReleaseOrders()');
`);

console.log('edited scripts/test-release.js');
````

Run: `node .superpowers/tmp-edits/edit-release-test.js` → `edited scripts/test-release.js`.

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-release.js` → FAIL `AssertionError … Expected values to be strictly deep-equal … actual: undefined`.

- [ ] **Step 3: Carry the info over**

Create `.superpowers/tmp-edits/edit-release-psn.js`:

````js
// Task 2, step 3: releasing a Coming soon game carries its PlayStation info over.
// Run from the repo root: node .superpowers/tmp-edits/edit-release-psn.js
const rep = require('./rep');

rep('lib/release.js',
`function releasedGameRecord(upcoming, newGameId, nowIso) {
  const u = upcoming || {};
  return {
    id: newGameId,`,
`function releasedGameRecord(upcoming, newGameId, nowIso) {
  const u = upcoming || {};
  const record = {
    id: newGameId,`);

rep('lib/release.js',
`    released_from_upcoming_id: u.id,
    created_at: nowIso
  };
}`,
`    released_from_upcoming_id: u.id,
    created_at: nowIso
  };
  // PlayStation info gathered while it was Coming soon (trailer, screenshots,
  // game info) carries over, so the released game's page shows the same blocks.
  if (u.psn && typeof u.psn === 'object') record.psn = u.psn;
  if (u.psn_concept_id) record.psn_concept_id = String(u.psn_concept_id);
  return record;
}`);

console.log('edited lib/release.js');
````

Run: `node .superpowers/tmp-edits/edit-release-psn.js` → `edited lib/release.js`.

- [ ] **Step 4: Run the test and watch it pass**

Run: `node scripts/test-release.js` → `25 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/release.js scripts/test-release.js
git commit -m "Release: carry a Coming soon game's PlayStation info to the released game

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Apply fills PlayStation info (`server.js`)

**Files:**
- Modify (edit script): `server.js`, inside `app.post('/admin/upcoming/psn/apply', …)` only
- Test (whole file replaced): `scripts/test-admin-upcoming-psn.js`

**Interfaces:**
- Consumes: Task 1's `readForm(...).info`, `planApply(...).infoUpdates`, `storeLink`, `infoPatch`, `mapLimit`, and `buildRecord`, whose records now carry `psn`. From existing `server.js`: `psnGame.fetchGameInfo({ title, psn_link })`, where an empty `psn_link` means a title search; `getUpcomingGame(id)`; `db`.
- Produces: the apply redirect `…msg=psn_upcoming_applied|psn_upcoming_partial&added=X&dates=Y&info=Z&missing=M`, read by Task 4's toast. Info alone counts as something to apply. Not-found games are logged as `[upcoming-psn] no info for <title> <reason>`.

- [ ] **Step 1: Write the failing test**

Replace the whole of `scripts/test-admin-upcoming-psn.js` with:

````js
// Run: node scripts/test-admin-upcoming-psn.js
//
// Coming soon → "Update from PlayStation": the refresh, apply and cancel
// routes, including filling PlayStation info on existing Coming soon games. Boots a throwaway instance (temp DATA_DIR, blank MONGODB_URI,
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
  { id: 3, title: 'Zzyzx Same Date', platform: 'PS5', release_date: '2026-12-03', created_at: '2026-07-01T00:00:00.000Z' },
  // Not in PlayStation's dated list: one it finds by name, one it doesn't know.
  { id: 4, title: 'Zzyzx Not In Feed', platform: 'PS5', release_date: 'TBA', description: 'Owner wrote this.' },
  { id: 5, title: 'Zzyzx Unknown Game', platform: 'PS5', release_date: 'TBA' }
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
  // With a store link: that game's page. Without: a search by title, which
  // knows "Not In Feed" (as concept 777) and nothing called "Unknown".
  require('../lib/psn-game').fetchGameInfo = async game => {
    infoCalls.push(game.psn_link || 'title:' + game.title);
    if (knob.delay) await new Promise(r => setTimeout(r, knob.delay));
    const id = game.psn_link ? game.psn_link.split('/').pop() : '';
    if (!id) {
      if (/Unknown/.test(game.title)) return { ok: false, reason: 'no_match' };
      return { ok: true, psn: { concept_id: '777', description: 'Found by name: ' + game.title, genres: [], screenshots: [], fetched_at: new Date().toISOString() } };
    }
    if (id === '103') return { ok: false, reason: 'timeout' };
    return { ok: true, psn: { concept_id: id, description: 'About ' + id, genres: [], screenshots: ['https://image.api.playstation.com/s1-' + id + '.jpg', 'https://image.api.playstation.com/s2-' + id + '.jpg'], fetched_at: new Date().toISOString() } };
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
    assert.strictEqual(readDb().upcoming.length, 5);
  });
  let token;
  await okAsync('a check opens the list on the Games tab under a token', async () => {
    const r = await refresh();
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.location.startsWith('/admin?tab=games&msg=psn_upcoming_preview&psn_upcoming='));
    token = tokenOf(r);
    assert.ok(/^[0-9a-f]{24}$/.test(token));
    assert.strictEqual(readDb().upcoming.length, 5, 'nothing saved by a check');
  });

  console.log('\napply');
  await okAsync('nothing ticked → message, the list stays open', async () => {
    const r = await post('/admin/upcoming/psn/apply', Object.assign({ token }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_nothing&psn_upcoming=' + token);
  });
  await okAsync('an unknown token → expired, nothing added', async () => {
    const r = await post('/admin/upcoming/psn/apply', Object.assign({ token: 'deadbeef', add: ['101'] }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_expired');
    assert.strictEqual(readDb().upcoming.length, 5);
  });
  await okAsync('apply adds the ticked games with the typed prices, PlayStation details and saved images', async () => {
    const r = await post('/admin/upcoming/psn/apply', Object.assign({
      token, add: ['101', '103'], title_101: 'Zzyzx New One (Owner Title)', date: ['1', '2']
    }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_partial&added=2&dates=2&info=0&missing=0', 'game 103 has no cover or description');
    const added = readDb().upcoming.filter(x => x.id >= 10);
    assert.deepStrictEqual(added.map(x => [x.id, x.title, x.psn_concept_id]), [[10, 'Zzyzx New One (Owner Title)', '101'], [11, 'Zzyzx Broken Images', '103']]);
    const one = added[0];
    assert.strictEqual(one.release_date, '2026-10-15');
    assert.strictEqual(one.platform, 'PS5');
    assert.strictEqual(one.genre, 'RPG');
    assert.strictEqual(one.description, 'About 101');
    assert.strictEqual(one.psn.description, 'About 101', 'new games keep the full PlayStation info');
    assert.strictEqual(one.psn.screenshots.length, 2);
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
    assert.strictEqual(readDb().upcoming.length, 7);
  });
  await okAsync('the next check offers only what is still new; ticking a skipped game adds it and un-skips it', async () => {
    const t2 = tokenOf(await refresh());
    const r = await post('/admin/upcoming/psn/apply', Object.assign({ token: t2, add: ['102'] }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_applied&added=1&dates=0&info=0&missing=0');
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
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_applied&added=0&dates=0&info=0&missing=0');
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
  await okAsync('info only: matched games read by store link, others by name; only the info changes; not found is counted', async () => {
    const t = tokenOf(await refresh());
    infoCalls.length = 0;
    const r = await post('/admin/upcoming/psn/apply', Object.assign({ token: t, info: ['1', '4', '5'] }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_partial&added=0&dates=0&info=2&missing=1');
    assert.ok(infoCalls.includes('https://store.playstation.com/en-us/concept/104'), 'matched game read from its store page');
    assert.ok(infoCalls.includes('title:Zzyzx Not In Feed') && infoCalls.includes('title:Zzyzx Unknown Game'), 'the others searched by name');
    const moved = upcomingById(1);
    assert.strictEqual(moved.psn.description, 'About 104');
    assert.deepStrictEqual([moved.nt_price_7d, moved.cover_image, moved.title, moved.release_date, moved.psn_concept_id], [349, '/uploads/keep.webp', 'Zzyzx Moved Game', '2026-11-12', '104']);
    const byName = upcomingById(4);
    assert.strictEqual(byName.psn.description, 'Found by name: Zzyzx Not In Feed');
    assert.strictEqual(byName.psn_concept_id, '777', 'linked to the game it found');
    assert.strictEqual(byName.description, 'Owner wrote this.', "the owner's own description stays");
    assert.strictEqual(upcomingById(5).psn, undefined, 'not found: left as it was');
    assert.strictEqual(upcomingById(3).psn, undefined, 'not ticked: left as it was');
  });
  await okAsync('games with fresh info are not offered again; the one not found is', async () => {
    const t = tokenOf(await refresh());
    infoCalls.length = 0;
    const r = await post('/admin/upcoming/psn/apply', Object.assign({ token: t, info: ['1', '4', '5'] }, prices));
    assert.strictEqual(r.headers.location, '/admin?tab=games&msg=psn_upcoming_partial&added=0&dates=0&info=0&missing=1');
    assert.deepStrictEqual(infoCalls, ['title:Zzyzx Unknown Game'], 'games 1 and 4 have fresh info now, so only 5 was offered');
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

Run: `node scripts/test-admin-upcoming-psn.js` → FAIL `AssertionError [ERR_ASSERTION]: game 103 has no cover or description`, with `actual: '/admin?tab=games&msg=psn_upcoming_partial&added=2&dates=2'` (no info counts yet).

- [ ] **Step 3: Apply the server edit**

Create `.superpowers/tmp-edits/edit-info-server.js`:

````js
// Task 3: the apply route also fills PlayStation info on ticked Coming soon
// games, and new games keep theirs (lib/upcoming-psn.js buildRecord, Task 1).
// Run from the repo root: node .superpowers/tmp-edits/edit-info-server.js
const rep = require('./rep');
const F = 'server.js';

// 1. Info ticks alone are something to apply.
rep(F,
`  const form = upcomingPsn.readForm(req.body);
  if (!form.add.length && !form.dates.length) {`,
`  const form = upcomingPsn.readForm(req.body);
  if (!form.add.length && !form.dates.length && !form.info.length) {`);

// 2. Fetch new games and info updates side by side; write adds, dates, then info.
rep(F,
`    const nowIso = new Date().toISOString();
    const built = await upcomingPsn.mapLimit(plan.adds, 3, g => upcomingPsn.buildRecord(g, {
      prices: plan.prices,
      nowIso,
      fetchInfo: conceptId => psnGame.fetchGameInfo({ psn_link: 'https://store.playstation.com/en-us/concept/' + conceptId }),
      saveImage: url => remoteImage.saveRemoteImage(url, { uploadsDir })
    }));
    built.forEach(b => db.get('upcoming').push(Object.assign({ id: newUpcomingId() }, b.record)).write());`,
`    const nowIso = new Date().toISOString();
    const [built, infoResults] = await Promise.all([
      upcomingPsn.mapLimit(plan.adds, 3, g => upcomingPsn.buildRecord(g, {
        prices: plan.prices,
        nowIso,
        fetchInfo: conceptId => psnGame.fetchGameInfo({ psn_link: upcomingPsn.storeLink(conceptId) }),
        saveImage: url => remoteImage.saveRemoteImage(url, { uploadsDir })
      })),
      // A game PlayStation's list matched is read from its store page; any other
      // is found by its title, the way released games' "Update all" does.
      upcomingPsn.mapLimit(plan.infoUpdates, 3, async item => {
        try {
          return await psnGame.fetchGameInfo({ title: item.title, psn_link: upcomingPsn.storeLink(item.concept_id) });
        } catch (e) {
          return { ok: false, reason: 'error' };
        }
      })
    ]);
    built.forEach(b => db.get('upcoming').push(Object.assign({ id: newUpcomingId() }, b.record)).write());`);

rep(F,
`    db.set('site_settings.upcoming_psn_skipped', plan.skipped).write();
    const partial = built.some(b => !b.complete);
    res.redirect(UPCOMING_PSN_BACK + (partial ? 'psn_upcoming_partial' : 'psn_upcoming_applied')
      + '&added=' + built.length + '&dates=' + plan.dateUpdates.length);`,
`    let infoDone = 0;
    plan.infoUpdates.forEach((item, i) => {
      const current = getUpcomingGame(item.id);
      const patch = current ? upcomingPsn.infoPatch(current, infoResults[i]) : null;
      if (!patch) {
        console.error('[upcoming-psn] no info for', item.title, (infoResults[i] && infoResults[i].reason) || 'gone');
        return;
      }
      db.get('upcoming').find({ id: item.id }).assign(patch).write();
      infoDone++;
    });
    db.set('site_settings.upcoming_psn_skipped', plan.skipped).write();
    const missing = plan.infoUpdates.length - infoDone;
    const partial = built.some(b => !b.complete) || missing > 0;
    res.redirect(UPCOMING_PSN_BACK + (partial ? 'psn_upcoming_partial' : 'psn_upcoming_applied')
      + '&added=' + built.length + '&dates=' + plan.dateUpdates.length + '&info=' + infoDone + '&missing=' + missing);`);

console.log('edited server.js');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-info-server.js` → `edited server.js`.
Then: `file server.js` → still `UTF-8 (with BOM) text … with CRLF line terminators`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-admin-upcoming-psn.js` → `15 assertions passed`. The log lines `[upcoming-psn] refresh timeout` and `[upcoming-psn] no info for Zzyzx Unknown Game no_match` are expected.
Run: `node scripts/test-upcoming-psn.js && node scripts/test-admin-upcoming-psn-page.js` → `22 assertions passed`, `11 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add server.js scripts/test-admin-upcoming-psn.js
git commit -m "Update from PlayStation: fill PlayStation info on ticked Coming soon games

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The admin list's "Get PlayStation info" section

**Files:**
- Modify (edit script): `views/partials/admin/games/psn-update.ejs` (a section after "Release date changed"), `views/admin.ejs` (the two `psn_upcoming_applied` / `psn_upcoming_partial` toast strings and the line that fills them)
- Modify (whole file replaced): `public/js/admin-upcoming-psn.js`
- Test (whole file replaced): `scripts/test-admin-upcoming-psn-page.js`

**Interfaces:**
- Consumes: `gamesView.psnUpdate.infoUpdates` (each `{ id, title, concept_id, matched }`), `applyText` and `upToDate` from Task 1's `previewView`; Task 3's redirect counts; `params` (the `URLSearchParams` at the top of the tab script in `views/admin.ejs`).
- Produces: checkbox fields `name="info" value="<upcoming id>" data-gmp-info`; `window.__gmpApplyLabel(adds, dates, infos)`, which matches `applyLabel`; toasts like "✅ Got info for 2 games" or "⚠ Added 3 games · updated 1 date · got info for 1 game — some covers, descriptions or game info couldn't be found; check those games in Edit.", or "✅ Nothing changed".

- [ ] **Step 1: Write the failing test**

Replace the whole of `scripts/test-admin-upcoming-psn-page.js` with:

````js
// Run: node scripts/test-admin-upcoming-psn-page.js
//
// Coming soon → "Update from PlayStation": what the admin page shows — the
// button, the list to tick (including "Get PlayStation info"), the expired and
// up-to-date states, the toasts —
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
// Games 1 and 2 already have fresh PlayStation info; 3 (none) and 4 (older
// than 7 days, PlayStation id known) are offered under "Get PlayStation info".
const FRESH_PSN = { fetched_at: new Date().toISOString() };
const upcoming = [
  { id: 1, title: 'Zzyzx Moved Game', platform: 'PS5', release_date: '2026-10-29', created_at: '2026-09-01T00:00:00.000Z', nt_price_7d: 349, nt_price_30d: 1099, tr_price_7d: 449, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1, psn: FRESH_PSN },
  { id: 2, title: 'Zzyzx Tba Game', platform: 'PS5', release_date: 'TBA', created_at: '2026-08-01T00:00:00.000Z', psn: FRESH_PSN },
  { id: 3, title: 'Zzyzx Needs Info', platform: 'PS5', release_date: 'TBA' },
  { id: 4, title: 'Zzyzx Old Info', platform: 'PS5', release_date: 'TBA', psn_concept_id: '444', psn: { fetched_at: '2026-01-01T00:00:00.000Z' } }
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
  require('../lib/psn-game').fetchGameInfo = async () => ({ ok: true, psn: { description: 'Stub', screenshots: [], fetched_at: new Date().toISOString() } });
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
  const post = (p, body) => call('POST', p, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body });

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
  ok('get PlayStation info: games with none or old info, ticked, matched or searched by name', () => {
    assert.ok(soon.includes('Get PlayStation info (2)'));
    assert.ok(/name="info" value="3"[^>]*data-gmp-info checked/.test(soon));
    assert.ok(/name="info" value="4"[^>]*data-gmp-info checked/.test(soon));
    assert.ok(!/name="info" value="1"/.test(soon) && !/name="info" value="2"/.test(soon), 'fresh info is not offered');
    const three = soon.slice(soon.indexOf('name="info" value="3"'), soon.indexOf('name="info" value="4"'));
    assert.ok(three.includes('Zzyzx Needs Info') && three.includes('Will search by name'));
    assert.ok(soon.slice(soon.indexOf('name="info" value="4"')).includes('Matched on PlayStation'));
    assert.ok(soon.includes('Trailer, screenshots, rating and game info from PlayStation. Your own description and pictures stay.'));
  });
  ok('already on the site, the gold button\'s words and the cancel form', () => {
    assert.ok(soon.includes('Already on your site (3)</b> · Zzyzx Moved Game, Zzyzx Tba Game, Zzyzx Out Already'));
    assert.ok(soon.includes('data-gmp-apply>Add 2 games · update 2 dates · get info for 2 games</button>'));
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
    // Games 3 and 4 get their info first, so nothing at all is left to do.
    const filled = await post('/admin/upcoming/psn/apply', form({ token: tokenOf(await refresh()), info: '3' }) + '&info=4');
    assert.ok(filled.headers.location.includes('msg=psn_upcoming_applied&added=0&dates=0&info=2&missing=0'));
    const s = soonPanel((await get('/admin?tab=games&psn_upcoming=' + tokenOf(await refresh()))).body);
    assert.ok(s.includes("You're up to date — nothing new on PlayStation."));
    assert.ok(!s.includes('data-gmp-apply'));
    assert.ok(s.includes('>Close</button>'));
  });
  ok('the page carries the toasts, the loading words and the script', () => {
    assert.ok(page.includes("psn_upcoming_applied:'✅ {summary}'"));
    assert.ok(page.includes("psnCount('info') ? 'got info for ' + psnPlural(psnCount('info'), 'game') : ''"));
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
    for (let a = 0; a < 4; a++) for (let d = 0; d < 4; d++) for (let i = 0; i < 4; i++) {
      assert.strictEqual(sandbox.__gmpApplyLabel(a, d, i), applyLabel(a, d, i), a + '/' + d + '/' + i);
    }
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

Run: `node scripts/test-admin-upcoming-psn-page.js` → FAIL `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value` in "get PlayStation info…" (no section yet).

- [ ] **Step 3: Update the button script**

Replace the whole of `public/js/admin-upcoming-psn.js` with:

````js
// Admin → Games → Coming soon → "Update from PlayStation" list: keeps the gold
// button's words ("Add 3 games · update 1 date · get info for 2 games") in
// step with the ticks. Saves nothing. The same rule renders the first label on
// the server (lib/upcoming-psn.js applyLabel); scripts/test-admin-upcoming-psn-page.js
// checks the two agree. Page wiring is skipped when there is no document (tests).
(function () {
  'use strict';

  function plural(n, one) { return n + ' ' + one + (n === 1 ? '' : 's'); }

  function applyLabel(adds, dates, infos) {
    var parts = [];
    if (adds) parts.push('Add ' + plural(adds, 'game'));
    if (dates) parts.push((parts.length ? 'update ' : 'Update ') + plural(dates, 'date'));
    if (infos) parts.push((parts.length ? 'get info for ' : 'Get info for ') + plural(infos, 'game'));
    return parts.length ? parts.join(' · ') : 'Add selected';
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
        form.querySelectorAll('[data-gmp-date]:checked').length,
        form.querySelectorAll('[data-gmp-info]:checked').length
      );
    }
    form.addEventListener('change', update);
    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
````

- [ ] **Step 4: Apply the view edits**

Create `.superpowers/tmp-edits/edit-info-ui.js`:

````js
// Task 4: the admin list's "Get PlayStation info" section and its toasts.
// Run from the repo root: node .superpowers/tmp-edits/edit-info-ui.js
const rep = require('./rep');

// 1. The section, after "Release date changed".
rep('views/partials/admin/games/psn-update.ejs',
`    <div class="gmp-note">Only the date changes. Prices, slots, cover and reservations stay.</div>
  </div>
  <% } %>
`,
`    <div class="gmp-note">Only the date changes. Prices, slots, cover and reservations stay.</div>
  </div>
  <% } %>
  <% if (pu.infoUpdates.length) { %>
  <div class="gmp-card">
    <div class="gmp-h">Get PlayStation info (<%= pu.infoUpdates.length %>)</div>
    <% pu.infoUpdates.forEach(i => { %>
    <label class="gmp-chg">
      <input type="checkbox" name="info" value="<%= i.id %>" class="gmp-tick" data-gmp-info checked>
      <span class="gmp-chg-title"><%= i.title %></span>
      <span class="gmp-chg-from"><%= i.matched ? 'Matched on PlayStation' : 'Will search by name' %></span>
    </label>
    <% }) %>
    <div class="gmp-note">Trailer, screenshots, rating and game info from PlayStation. Your own description and pictures stay.</div>
  </div>
  <% } %>
`);

// 2. Toasts: one summary of what happened, zero counts left out
//    ("✅ Got info for 2 games", "✅ Added 3 games · updated 1 date").
rep('views/admin.ejs',
`psn_upcoming_applied:'✅ Added {added} · updated {dates}', psn_upcoming_partial:'⚠ Added {added} · updated {dates} — some covers or descriptions couldn\\'t be downloaded; add them in Edit.', `,
`psn_upcoming_applied:'✅ {summary}', psn_upcoming_partial:'⚠ {summary} — some covers, descriptions or game info couldn\\'t be found; check those games in Edit.', `);

rep('views/admin.ejs',
`    // "Update from PlayStation" toasts carry their counts in the URL.
    const countOf = (key, one) => { const n = parseInt(params.get(key), 10) || 0; return n + ' ' + one + (n === 1 ? '' : 's'); };
    const text = (messages[msg] || '').replace('{added}', countOf('added', 'game')).replace('{dates}', countOf('dates', 'date'));`,
`    // "Update from PlayStation" toasts carry their counts in the URL; zero counts are left out.
    const psnCount = key => parseInt(params.get(key), 10) || 0;
    const psnPlural = (n, one) => n + ' ' + one + (n === 1 ? '' : 's');
    const psnSummary = [
      psnCount('added') ? 'added ' + psnPlural(psnCount('added'), 'game') : '',
      psnCount('dates') ? 'updated ' + psnPlural(psnCount('dates'), 'date') : '',
      psnCount('info') ? 'got info for ' + psnPlural(psnCount('info'), 'game') : ''
    ].filter(Boolean).join(' · ') || 'nothing changed';
    const text = (messages[msg] || '').replace('{summary}', psnSummary.charAt(0).toUpperCase() + psnSummary.slice(1));`);

console.log('edited psn-update.ejs, admin.ejs');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-info-ui.js` → `edited psn-update.ejs, admin.ejs`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node scripts/test-admin-upcoming-psn-page.js` → `12 assertions passed`.
Run: `node scripts/test-admin-upcoming-psn.js && node scripts/test-admin-games-filter.js` → `15 assertions passed`, `17 assertions passed`.

- [ ] **Step 6: Commit**

```bash
git add views/partials/admin/games/psn-update.ejs views/admin.ejs public/js/admin-upcoming-psn.js scripts/test-admin-upcoming-psn-page.js
git commit -m "Update from PlayStation: Get PlayStation info section; toasts name what happened

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The Coming soon page (`views/upcoming-detail.ejs`)

**Files:**
- Modify (edit script): `server.js` (the `res.render('upcoming-detail', …)` call in `app.get('/upcoming/:slug', …)`) and `views/upcoming-detail.ejs` (head, top `<% %>` block, title, poster column, gallery, scripts)
- Create: `scripts/test-upcoming-psn-page-public.js`

**Interfaces:**
- Consumes:
  - `gamePsnView.buildGamePsnView(game)`, already required in `server.js` as `gamePsnView`. It returns `{ hasPsn, media, hideGallery, tagline, rating, about, aboutParas, readMore, info, genre }`.
  - The partials `partials/game-psn-headline` (locals `psnView`), `partials/game-psn-media` (`items`, `title`) and `partials/game-psn-about` (`psnView`).
  - `/css/game-psn.css` and `/js/game-media.js`. All of these are unchanged.
- Produces: the page described in the spec. A game without `psn` renders as before.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-upcoming-psn-page-public.js`:

````js
// Run: node scripts/test-upcoming-psn-page-public.js
//
// A Coming soon page (/upcoming/<slug>) with PlayStation info shows the same
// blocks as a released game's page — trailer + screenshots in place of the
// cover, tagline and rating under the title, "About this game" and "Game
// info" — with the owner's own description and pictures winning. Without
// PlayStation info the page is unchanged. Boots a throwaway instance (temp
// DATA_DIR, blank MONGODB_URI, in-memory sessions); nothing reaches
// PlayStation or a database.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4623;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'upcoming-psn-public-'));
const PSN = {
  concept_id: '900001', source: 'auto', fetched_at: '2026-10-10T00:00:00.000Z',
  description: 'First paragraph from PlayStation.\n\nSecond paragraph from PlayStation.',
  tagline: 'Zzyzx tagline', genres: ['Action'], publisher: 'Zzyzx Publisher',
  voices: ['English', 'Japanese'], age_rating: 'ESRB Teen', rating: { avg: 4.6, count: 1200 },
  screenshots: ['https://image.api.playstation.com/shot1.jpg', 'https://image.api.playstation.com/shot2.jpg'],
  videos: ['https://vulcan.dl.playstation.net/trailer.mp4']
};
const base = { platform: 'PS5', release_date: '2026-12-01', nt_price_7d: 349, nt_price_30d: 1099, non_trophy_slots: 2, trophy_slots: 1, tr_price_7d: 449, tr_price_30d: 1299 };
const upcoming = [
  Object.assign({ id: 1, title: 'Zzyzx With Info', cover_image: '/uploads/cover1.webp', psn: PSN }, base),
  Object.assign({ id: 2, title: 'Zzyzx Own Words', cover_image: '/uploads/cover2.webp', description: 'The owner wrote this.', gallery: ['/uploads/own1.webp', '/uploads/own2.webp'], psn: PSN }, base),
  Object.assign({ id: 3, title: 'Zzyzx Plain', cover_image: '/uploads/cover3.webp', description: 'Plain owner text.', gallery: ['/uploads/plain1.webp', '/uploads/plain2.webp'] }, base)
];
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({ admin_password: 'throwaway-' + Math.random().toString(36).slice(2), games: [], upcoming, nextUpcomingId: 10 }));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: p, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, timeout: 20000 }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    req.end();
  });
}

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await get('/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  const withInfo = await get('/upcoming/zzyzx-with-info-1');
  const own = await get('/upcoming/zzyzx-own-words-2');
  const plain = await get('/upcoming/zzyzx-plain-3');
  assert.deepStrictEqual([withInfo.status, own.status, plain.status], [200, 200, 200]);

  console.log('\nwith PlayStation info');
  ok('the trailer and screenshots replace the cover, with their styles and script', () => {
    const b = withInfo.body;
    assert.ok(b.includes('id="gpMedia" data-count="3"'));
    assert.ok(b.includes('<source src="https://vulcan.dl.playstation.net/trailer.mp4" type="video/mp4">'));
    assert.ok(b.includes('src="https://image.api.playstation.com/shot1.jpg"') && b.includes('src="https://image.api.playstation.com/shot2.jpg"'));
    assert.ok(!b.includes('class="gd-cover gdh-poster"'), 'no static cover');
    assert.ok(b.includes('/css/game-psn.css?v='));
    assert.ok(b.includes('<script src="/js/game-media.js?v='));
  });
  ok('tagline and rating under the title', () => {
    assert.ok(withInfo.body.includes('<div class="gpa-tagline">Zzyzx tagline</div>'));
    assert.ok(withInfo.body.includes('<b>★ 4.6</b> on PlayStation Store'));
  });
  ok('About this game in paragraphs, and Game info, instead of the description under the poster', () => {
    const b = withInfo.body;
    assert.ok(b.includes('About this game'));
    assert.ok(b.includes('<p>First paragraph from PlayStation.</p><p>Second paragraph from PlayStation.</p>'));
    assert.ok(b.includes('Game info'));
    for (const cell of ['<td>Release date</td><td>Dec 1, 2026</td>', '<td>Publisher</td><td>Zzyzx Publisher</td>', '<td>Platform</td><td>PS5</td>', '<td>Voice</td><td>English, Japanese</td>', '<td>Age rating</td><td>ESRB Teen</td>']) {
      assert.ok(b.includes(cell), cell);
    }
    assert.ok(!b.includes('gdh-poster-desc'), 'no second copy under the poster');
  });

  console.log("\nthe owner's own words and pictures");
  ok("the owner's description and gallery win, and the bottom gallery is not repeated", () => {
    const b = own.body;
    assert.ok(b.includes('<p>The owner wrote this.</p>'));
    assert.ok(!b.includes('First paragraph from PlayStation.'));
    assert.ok(b.includes('id="gpMedia" data-count="3"'), 'trailer + 2 own pictures');
    assert.ok(b.includes('src="/uploads/own1.webp"'));
    assert.ok(!b.includes('src="https://image.api.playstation.com/shot1.jpg"'));
    assert.ok(!b.includes('rsv-gallery-section'));
    assert.ok(b.includes('const gpSlideCount = 0;'));
  });

  console.log('\nwithout PlayStation info');
  ok('the page is as before: cover, description under it, Gameplay gallery at the bottom', () => {
    const b = plain.body;
    assert.ok(b.includes('<img src="/uploads/cover3.webp" alt="Zzyzx Plain" class="gd-cover gdh-poster">'));
    assert.ok(b.includes('<p class="gd-desc gdh-poster-desc">Plain owner text.</p>'));
    assert.ok(b.includes('rsv-gallery-section') && b.includes('const gpSlideCount = 2;'));
    assert.ok(!b.includes('id="gpMedia"') && !b.includes('About this game') && !b.includes('gpa-headline'));
    assert.ok(!b.includes('/js/game-media.js'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-upcoming-psn-page-public.js` → FAIL `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value` in the first check (no trailer and screenshots block yet).

- [ ] **Step 3: Apply the page edits**

Create `.superpowers/tmp-edits/edit-upcoming-page.js`:

````js
// Task 5: Coming soon pages show PlayStation's blocks, like released games.
// Run from the repo root: node .superpowers/tmp-edits/edit-upcoming-page.js
const rep = require('./rep');
const V = 'views/upcoming-detail.ejs';

// 1. The route hands the page the same PlayStation view as a game page.
rep('server.js',
`  res.render('upcoming-detail', Object.assign({ game: resolvedGame, `,
`  res.render('upcoming-detail', Object.assign({ game: resolvedGame, psnView: gamePsnView.buildGamePsnView(resolvedGame), `);

// 2. Styles for the PlayStation blocks.
rep(V,
`  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
`,
`  <link rel="stylesheet" href="/css/style.css?v=<%= assetV %>">
  <link rel="stylesheet" href="/css/game-psn.css?v=<%= assetV %>">
`);

// 3. The view, or "no PlayStation info" when there is none.
rep(V,
`  const hasNt = !!(game.nt_price_7d || game.nt_price_30d);
`,
`  // PlayStation's trailer, screenshots and game info (lib/game-psn-view.js),
  // exactly as on a released game's page; hasPsn:false leaves the page as it was.
  const udPsn = typeof psnView !== 'undefined' && psnView ? psnView : { hasPsn: false, media: [], hideGallery: false, about: '', info: [] };
  const hasNt = !!(game.nt_price_7d || game.nt_price_30d);
`);

// 4. Tagline and rating under the title.
rep(V,
`      <h1 class="usd-title"><%= game.title %></h1>
`,
`      <h1 class="usd-title"><%= game.title %></h1>
      <% if (udPsn.hasPsn) { %><%- include('partials/game-psn-headline', { psnView: udPsn }) %><% } %>
`);

// 5. Trailer + screenshots in place of the cover.
rep(V,
`        <% if (game.cover_image) { %>
          <img src="<%= game.cover_image %>" alt="<%= game.title %>" class="gd-cover gdh-poster">
        <% } %>`,
`        <% if (udPsn.media.length) { %>
          <%- include('partials/game-psn-media', { items: udPsn.media, title: game.title }) %>
        <% } else if (game.cover_image) { %>
          <img src="<%= game.cover_image %>" alt="<%= game.title %>" class="gd-cover gdh-poster">
        <% } %>`);

// 6. About + Game info replace the description under the poster.
rep(V,
`        <% if (game.description) { %>
          <p class="gd-desc gdh-poster-desc"><%= game.description %></p>
        <% } %>`,
`        <% if (game.description && !udPsn.hasPsn) { %>
          <p class="gd-desc gdh-poster-desc"><%= game.description %></p>
        <% } %>
        <%- include('partials/game-psn-about', { psnView: udPsn }) %>`);

// 7. The bottom gallery is not repeated when the slider already shows it.
rep(V,
`    <% const gpGallery = (game.gallery || []).filter(Boolean); %>`,
`    <% const gpGallery = udPsn.hideGallery ? [] : (game.gallery || []).filter(Boolean); %>`);

// 8. The slider's script, only when there is something for it.
rep(V,
`<script src="/js/upcoming-detail.js?v=<%= assetV %>"></script>
`,
`<script src="/js/upcoming-detail.js?v=<%= assetV %>"></script>
<% if (udPsn.media.length || udPsn.about) { %><script src="/js/game-media.js?v=<%= assetV %>" defer></script><% } %>
`);

console.log('edited server.js, ' + V);
````

Run from the repo root: `node .superpowers/tmp-edits/edit-upcoming-page.js` → `edited server.js, views/upcoming-detail.ejs`.
Then: `file server.js views/upcoming-detail.ejs` → `server.js` still `UTF-8 (with BOM) … CRLF`; `upcoming-detail.ejs` has no CRLF.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-upcoming-psn-page-public.js` → `5 assertions passed`.
Run the whole suite: `fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail"` → only `FAIL scripts/test-requests-page.js`, `failed: 1`.

- [ ] **Step 5: Commit and clean up**

```bash
git add server.js views/upcoming-detail.ejs scripts/test-upcoming-psn-page-public.js
git commit -m "Coming soon pages: PlayStation trailer, screenshots, rating, About and Game info

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
rm -rf .superpowers/tmp-edits && git status --short
```
Expected `git status`: nothing except the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.
