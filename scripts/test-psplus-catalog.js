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
    'Ghost of Tsushima DIRECTOR\'S CUT (PlayStation Plus)': 'Ghost of Tsushima DIRECTOR\'S CUT',
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
  assert.strictEqual(cat.matchKey('Ghost of Tsushima DIRECTOR\'S CUT (PlayStation Plus)'), cat.matchKey("Ghost of Tsushima Director's Cut"));
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
