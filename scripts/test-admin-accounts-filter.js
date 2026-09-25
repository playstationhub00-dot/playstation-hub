// Run: node scripts/test-admin-accounts-filter.js
//
// The Accounts tab filters run in the browser. This loads the real
// public/js/admin-accounts.js into a sandbox with no DOM (its DOM wiring is
// skipped when there is no document) and checks the filter rules it exposes.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const FILE = path.join(__dirname, '..', 'public', 'js', 'admin-accounts.js');

function load() {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox);
  assert.ok(sandbox.__accFilter, 'admin-accounts.js exposes window.__accFilter');
  return sandbox.__accFilter;
}

const F = load();
// Objects made inside the sandbox have another realm's prototypes, so compare
// plain JSON copies rather than the objects themselves.
const plain = o => JSON.parse(JSON.stringify(o));
const state = over => F.normalizeState(Object.assign({}, over));
function item(status, due, type, gameIds, search) {
  return { status, due: due || '', type, gameIds: gameIds || [], search: search || '', disabled: false };
}

console.log('\nnormalizeState()');

ok('defaults to the Slots view with nothing filtered', () => {
  assert.deepStrictEqual(plain(F.normalizeState(null)), { view: 'slots', q: '', status: 'all', type: 'all', game: '' });
});

ok('falls back to the remembered view only when the session has none', () => {
  assert.strictEqual(F.normalizeState({}, 'accounts').view, 'accounts');
  assert.strictEqual(F.normalizeState({ view: 'slots' }, 'accounts').view, 'slots');
});

ok('throws away values it does not recognise', () => {
  const s = F.normalizeState({ view: 'grid', status: 'lost', type: 'ps6', game: '12; drop', q: 5 }, 'nope');
  assert.deepStrictEqual(plain(s), { view: 'slots', q: '', status: 'all', type: 'all', game: '' });
});

ok('keeps valid values, game as a string', () => {
  const s = F.normalizeState({ view: 'accounts', status: 'overdue', type: 'trophy', game: 12, q: 'nba' });
  assert.deepStrictEqual(plain(s), { view: 'accounts', q: 'nba', status: 'overdue', type: 'trophy', game: '12' });
});

console.log('\nslotMatches() — status');

ok('Rented matches every rented slot, including ending and overdue', () => {
  const f = state({ status: 'rented' });
  assert.ok(F.slotMatches(item('rented', '', 'trophy'), f));
  assert.ok(F.slotMatches(item('rented', 'ending', 'trophy'), f));
  assert.ok(F.slotMatches(item('rented', 'overdue', 'trophy'), f));
  assert.ok(!F.slotMatches(item('open', '', 'trophy'), f));
});

ok('Ending and Overdue are the narrow subsets and never overlap', () => {
  assert.ok(F.slotMatches(item('rented', 'ending', 'trophy'), state({ status: 'ending' })));
  assert.ok(!F.slotMatches(item('rented', 'overdue', 'trophy'), state({ status: 'ending' })));
  assert.ok(F.slotMatches(item('rented', 'overdue', 'trophy'), state({ status: 'overdue' })));
  assert.ok(!F.slotMatches(item('rented', '', 'trophy'), state({ status: 'overdue' })));
});

ok('every plain status matches only itself', () => {
  ['open', 'buyed', 'maintenance', 'na'].forEach(st => {
    assert.ok(F.slotMatches(item(st, '', 'trophy'), state({ status: st })), st);
    assert.ok(!F.slotMatches(item('rented', '', 'trophy'), state({ status: st })), st + ' vs rented');
  });
});

console.log('\nslotMatches() — type, game, search');

ok('type narrows to one slot type', () => {
  assert.ok(F.slotMatches(item('open', '', 'trophy'), state({ type: 'trophy' })));
  assert.ok(!F.slotMatches(item('open', '', 'non_trophy'), state({ type: 'trophy' })));
});

ok('game matches any account that contains it', () => {
  assert.ok(F.slotMatches(item('open', '', 'trophy', ['3', '12']), state({ game: '12' })));
  assert.ok(!F.slotMatches(item('open', '', 'trophy', ['3']), state({ game: '12' })));
});

ok('search is case-insensitive and ignores surrounding spaces', () => {
  const s = item('rented', '', 'trophy', [], 'pshub nba pack ana cruz nba 2k27');
  assert.ok(F.slotMatches(s, state({ q: '  Ana CRUZ ' })));
  assert.ok(!F.slotMatches(s, state({ q: 'tekken' })));
});

ok('all filters together: an open Trophy slot for game 12', () => {
  const f = state({ status: 'open', type: 'trophy', game: '12' });
  assert.ok(F.slotMatches(item('open', '', 'trophy', ['12']), f));
  assert.ok(!F.slotMatches(item('open', '', 'non_trophy', ['12']), f));
  assert.ok(!F.slotMatches(item('rented', '', 'trophy', ['12']), f));
  assert.ok(!F.slotMatches(item('open', '', 'trophy', ['7']), f));
});

console.log('\naccountMatches() — Accounts view');

const acct = { gameIds: ['12'], search: 'pshub nba pack' };
const chips = [
  { status: 'open', due: '', type: 'trophy', disabled: false },
  { status: 'rented', due: 'ending', type: 'non_trophy', disabled: false },
  { status: 'open', due: '', type: 'ps4_primary', disabled: true }
];

ok('with no status or type filter every account shows, even one with only disabled slots', () => {
  assert.ok(F.accountMatches(acct, chips, state({})));
  assert.ok(F.accountMatches(acct, [{ status: 'open', due: '', type: 'trophy', disabled: true }], state({})));
});

ok('shows when ANY enabled slot matches status and type together', () => {
  assert.ok(F.accountMatches(acct, chips, state({ status: 'ending' })));
  assert.ok(F.accountMatches(acct, chips, state({ status: 'open', type: 'trophy' })));
  assert.ok(!F.accountMatches(acct, chips, state({ status: 'open', type: 'non_trophy' })),
    'open and non-trophy are true of different slots');
});

ok('a disabled slot never counts as a match', () => {
  assert.ok(!F.accountMatches(acct, chips, state({ type: 'ps4_primary' })));
});

ok('game and search apply to the account as a whole', () => {
  assert.ok(!F.accountMatches(acct, chips, state({ game: '7' })));
  assert.ok(!F.accountMatches(acct, chips, state({ q: 'tekken' })));
  assert.ok(F.accountMatches(acct, chips, state({ q: 'NBA', status: 'open' })));
});

console.log('\ncounts');

ok('Filters (n) counts status, type and game but not search', () => {
  assert.strictEqual(F.activeFilterCount(state({ q: 'nba' })), 0);
  assert.strictEqual(F.activeFilterCount(state({ status: 'open', type: 'trophy', game: '3' })), 3);
});

ok('isFiltering is true for a search alone, false for whitespace', () => {
  assert.strictEqual(F.isFiltering(state({ q: 'nba' })), true);
  assert.strictEqual(F.isFiltering(state({ q: '   ' })), false);
  assert.strictEqual(F.isFiltering(state({})), false);
});

ok('plural', () => {
  assert.strictEqual(F.plural(1, 'slot'), '1 slot');
  assert.strictEqual(F.plural(0, 'account'), '0 accounts');
});

console.log('\n' + passed + ' assertions passed\n');
