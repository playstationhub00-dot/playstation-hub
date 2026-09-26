// Run: node scripts/test-admin-games-filter.js
//
// The Games tab's filters and sub-tab memory run in the browser. This loads
// the real public/js/admin-games.js into a sandbox with no DOM (its page
// wiring is skipped when there is no document) and checks the rules it
// exposes on window.__gamesFilter.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const FILE = path.join(__dirname, '..', 'public', 'js', 'admin-games.js');

function load() {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox);
  assert.ok(sandbox.__gamesFilter, 'admin-games.js exposes window.__gamesFilter');
  return sandbox.__gamesFilter;
}

const F = load();
// Objects made inside the sandbox have another realm's prototypes, so compare
// plain JSON copies rather than the objects themselves.
const plain = o => JSON.parse(JSON.stringify(o));
const st = over => F.normalizeState(Object.assign({}, over));
const row = (chips, platform, s) => ({ chips, platform, s: s || '' });
const DEFAULTS = { chip: 'all', platform: 'all', sort: 'newest', q: '' };

console.log('\nnormalizeState()');

ok('defaults to every game, every platform, newest first, no search', () => {
  assert.deepStrictEqual(plain(F.normalizeState(null)), DEFAULTS);
});

ok('throws away values it does not recognise', () => {
  assert.deepStrictEqual(plain(st({ chip: 'x', platform: 'PS3', sort: 'random', q: 5 })), DEFAULTS);
  assert.deepStrictEqual(plain(F.normalizeState('not an object')), DEFAULTS);
});

ok('keeps valid values and caps the search at 100 characters', () => {
  const s = st({ chip: 'never', platform: 'PS4/PS5', sort: 'earned', q: 'x'.repeat(150) });
  assert.strictEqual(s.chip, 'never');
  assert.strictEqual(s.platform, 'PS4/PS5');
  assert.strictEqual(s.sort, 'earned');
  assert.strictEqual(s.q.length, 100);
});

console.log('\nrowMatches()');

ok('the All chip matches every row', () => {
  assert.strictEqual(F.rowMatches(row([], 'PS5'), st({})), true);
});

ok('each chip matches only rows carrying it', () => {
  ['new', 'soldout', 'never', 'bundle'].forEach(chip => {
    const others = ['new', 'soldout', 'never', 'bundle'].filter(c => c !== chip);
    assert.strictEqual(F.rowMatches(row([chip], 'PS5'), st({ chip })), true, chip);
    assert.strictEqual(F.rowMatches(row(others, 'PS5'), st({ chip })), false, chip);
  });
});

ok('platform matches exactly — PS4 does not match PS4/PS5', () => {
  assert.strictEqual(F.rowMatches(row([], 'PS4/PS5'), st({ platform: 'PS4/PS5' })), true);
  assert.strictEqual(F.rowMatches(row([], 'PS4/PS5'), st({ platform: 'PS4' })), false);
});

ok('search is case-insensitive and ignores surrounding spaces', () => {
  assert.strictEqual(F.rowMatches(row([], 'PS5', 'ghost of yotei action'), st({ q: '  YOTEI ' })), true);
  assert.strictEqual(F.rowMatches(row([], 'PS5', 'ghost of yotei action'), st({ q: 'tekken' })), false);
});

ok('chip, platform and search combine', () => {
  const r = row(['never'], 'PS4', 'hogwarts legacy');
  assert.strictEqual(F.rowMatches(r, st({ chip: 'never', platform: 'PS4', q: 'hog' })), true);
  assert.strictEqual(F.rowMatches(r, st({ chip: 'never', platform: 'PS5', q: 'hog' })), false);
  assert.strictEqual(F.rowMatches(r, st({ chip: 'new', platform: 'PS4', q: 'hog' })), false);
});

ok('isFiltering: chip, platform or search count; sort alone does not', () => {
  assert.strictEqual(F.isFiltering(st({})), false);
  assert.strictEqual(F.isFiltering(st({ sort: 'az' })), false);
  assert.strictEqual(F.isFiltering(st({ q: '   ' })), false);
  assert.strictEqual(F.isFiltering(st({ chip: 'new' })), true);
  assert.strictEqual(F.isFiltering(st({ platform: 'PS5' })), true);
  assert.strictEqual(F.isFiltering(st({ q: 'x' })), true);
});

console.log('\ncompareRows()');

const A = { id: 1, title: 'Tekken 8', earned: 500, slots: 2 };
const B = { id: 2, title: 'Astro Bot', earned: 900, slots: 0 };
const C = { id: 3, title: 'Zelda', earned: 500, slots: 2 };
const order = sort => [A, B, C].slice().sort((a, b) => F.compareRows(a, b, sort)).map(r => r.id);

ok('newest: highest id first', () => {
  assert.deepStrictEqual(order('newest'), [3, 2, 1]);
});

ok('A–Z: by title', () => {
  assert.deepStrictEqual(order('az'), [2, 1, 3]);
});

ok('most earned: highest first, ties newest first', () => {
  assert.deepStrictEqual(order('earned'), [2, 3, 1]);
});

ok('fewest slots: lowest first, ties by title', () => {
  assert.deepStrictEqual(order('slots'), [2, 1, 3]);
});

console.log('\nsub-tabs');

ok('normalizeSubtab keeps the four keys and falls back to all', () => {
  ['all', 'soon', 'requests', 'categories'].forEach(k => assert.strictEqual(F.normalizeSubtab(k), k));
  assert.strictEqual(F.normalizeSubtab('orders'), 'all');
  assert.strictEqual(F.normalizeSubtab(null), 'all');
});

ok('each save message opens the sub-tab it belongs to', () => {
  const cases = {
    added: 'all', updated: 'all', deleted: 'all',
    upcoming_added: 'soon', upcoming_updated: 'soon', upcoming_deleted: 'soon', release_failed: 'soon', release_in_progress: 'soon',
    request_approved: 'requests', request_rejected: 'requests', request_stocked: 'requests', request_deleted: 'requests', request_image: 'requests',
    voter_renamed: 'requests', voter_removed: 'requests', voter_dupe: 'requests', voter_empty: 'requests', voter_error: 'requests',
    cat_added: 'categories', cat_updated: 'categories', cat_deleted: 'categories'
  };
  Object.keys(cases).forEach(m => assert.strictEqual(F.subtabForMessage(m), cases[m], m));
});

ok('messages that belong elsewhere, or none, leave the remembered sub-tab alone', () => {
  ['game_released', 'release_partial', 'customer_added', 'file_too_large', '', null, undefined].forEach(m => {
    assert.strictEqual(F.subtabForMessage(m), null, String(m));
  });
});

console.log('\nwiring');

ok('admin.ejs loads admin-games.js with a cache-busting ?v=', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
  assert.ok(admin.includes('<script src="/js/admin-games.js?v=<%= assetV %>"></script>'));
});

console.log('\n' + passed + ' assertions passed\n');
