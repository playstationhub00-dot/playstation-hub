// Run: node scripts/test-tracking.js
const assert = require('assert');
const t = require('../lib/tracking');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

console.log('\ncleanSource');
ok('allowed values pass, anything else becomes other', () => {
  assert.strictEqual(t.cleanSource('game'), 'game');
  assert.strictEqual(t.cleanSource('search-empty'), 'search-empty');
  assert.strictEqual(t.cleanSource('<script>'), 'other');
  assert.strictEqual(t.cleanSource(undefined), 'other');
});

console.log('\ncleanPage');
ok('keeps a site path and drops query / hash', () => {
  assert.strictEqual(t.cleanPage('/game/god-of-war?x=1#top'), '/game/god-of-war');
  assert.strictEqual(t.cleanPage('/'), '/');
});
ok('rejects non-paths, protocol-relative urls and long values', () => {
  assert.strictEqual(t.cleanPage('https://evil.test/'), null);
  assert.strictEqual(t.cleanPage('//evil.test/'), null);
  assert.strictEqual(t.cleanPage(42), null);
  assert.strictEqual(t.cleanPage('/' + 'a'.repeat(200)), null);
});

console.log('\ngameSlugFromPage');
ok('extracts the slug of a game page only', () => {
  assert.strictEqual(t.gameSlugFromPage('/game/resident-evil-requiem'), 'resident-evil-requiem');
  assert.strictEqual(t.gameSlugFromPage('/game/resident-evil-requiem/'), 'resident-evil-requiem');
  assert.strictEqual(t.gameSlugFromPage('/browse'), null);
  assert.strictEqual(t.gameSlugFromPage('/game/'), null);
  assert.strictEqual(t.gameSlugFromPage('/upcoming/foo-3'), null);
});

console.log('\ncleanQuery');
ok('normalizes, limits and rejects short queries', () => {
  assert.strictEqual(t.cleanQuery('  God   OF\tWar '), 'god of war');
  assert.strictEqual(t.cleanQuery('ab'), '');
  assert.strictEqual(t.cleanQuery(7), '');
  assert.strictEqual(t.cleanQuery('x'.repeat(100)).length, 60);
});

console.log('\nrecentDuplicate');
ok('same key inside the window is a duplicate; outside or different is not', () => {
  const now = Date.parse('2026-10-02T10:00:00.000Z');
  const rows = [
    { time: '2026-10-02T09:58:00.000Z', session_id: 's1', game: 'a', source: 'game' },
    { time: '2026-10-02T09:59:40.000Z', session_id: 's1', game: 'b', source: 'game' }
  ];
  assert.strictEqual(t.recentDuplicate(rows, { session_id: 's1', game: 'b', source: 'game' }, now, 60000), true);
  assert.strictEqual(t.recentDuplicate(rows, { session_id: 's1', game: 'a', source: 'game' }, now, 60000), false, 'older than the window');
  assert.strictEqual(t.recentDuplicate(rows, { session_id: 's2', game: 'b', source: 'game' }, now, 60000), false, 'other session');
  assert.strictEqual(t.recentDuplicate([], { session_id: 's1' }, now, 60000), false);
});

console.log('\n' + passed + ' assertions passed\n');
