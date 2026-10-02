// Run: node scripts/test-visitor-funnel.js
const assert = require('assert');
const f = require('../lib/visitor-funnel');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const row = (sid, path, date) => ({ session_id: sid, path, date: date || '2026-10-02', page: path });
const NONE = new Set();

console.log('\nbuildSessionSummaries');

ok('system paths are ignored and a session left with no rows disappears', () => {
  const s = f.buildSessionSummaries({
    visitors: [row('a', '/'), row('a', '/api/search-index'), row('hook', '/webhooks/paymongo'), row('hook2', '/webhook')],
    taps: [], orderedSessionIds: NONE, paidSessionIds: NONE
  });
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].exitPath, '/', 'the /api row is not the exit page');
});

ok('viewedGame / messaged / browsed come from rows and taps', () => {
  const s = f.buildSessionSummaries({
    visitors: [row('a', '/'), row('a', '/browse'), row('b', '/'), row('c', '/'), row('d', '/game/x')],
    taps: [{ session_id: 'b', game: 'x', page: '/game/x' }, { session_id: 'c', game: null, page: '/' }],
    orderedSessionIds: NONE, paidSessionIds: NONE
  });
  const by = Object.fromEntries(s.map(x => [x.rows[0].session_id, x]));
  assert.strictEqual(by.a.browsed, true);
  assert.strictEqual(by.a.viewedGame, false);
  assert.strictEqual(by.b.viewedGame, true, 'a tap with a game implies the game was viewed');
  assert.strictEqual(by.b.messaged, true);
  assert.strictEqual(by.c.messaged, true);
  assert.strictEqual(by.c.viewedGame, false, 'a homepage tap does not');
  assert.strictEqual(by.d.viewedGame, true);
  assert.strictEqual(by.d.messaged, false);
});

ok('an ordering session counts as having viewed a game, and paid follows the paid set', () => {
  const s = f.buildSessionSummaries({
    visitors: [row('o', '/')], taps: [], orderedSessionIds: new Set(['o']), paidSessionIds: new Set(['o'])
  });
  assert.deepStrictEqual([s[0].viewedGame, s[0].ordered, s[0].paid], [true, true, true]);
});

console.log('\nwindowMetrics');

ok('five funnel rows; viewed / messaged / ordered are shares of Landed, paid of ordered', () => {
  const mk = o => Object.assign({ startDate: '2026-10-02', browsed: false, viewedGame: false, messaged: false, ordered: false, paid: false, exitPath: '/' }, o);
  const sessions = [mk({}), mk({}), mk({ viewedGame: true }), mk({ viewedGame: true, messaged: true }),
    mk({ viewedGame: true, ordered: true, paid: true }), mk({ viewedGame: true, ordered: true })];
  const m = f.windowMetrics(sessions, 7);
  assert.deepStrictEqual(m.funnel.map(x => x.label), ['Landed', 'Viewed a game', 'Messaged us', 'Ordered on website', 'Paid']);
  assert.deepStrictEqual(m.funnel.map(x => x.count), [6, 4, 1, 2, 1]);
  assert.deepStrictEqual(m.funnel.map(x => x.pctOfPrev), [null, 67, 17, 33, 50]);
  assert.strictEqual(m.skipped, 7);
});

ok('an empty window has null percentages, not NaN', () => {
  const m = f.windowMetrics([], 0);
  assert.strictEqual(m.funnel[0].count, 0);
  assert.ok(m.funnel.slice(1).every(x => x.pctOfPrev === null));
});

console.log('\naskedForWindow / missesForWindow / skippedForWindow');

ok('asked: top games with live info, deleted games and no-game taps counted as other', () => {
  const taps = [
    { date: '2026-10-02', game: 'a' }, { date: '2026-10-02', game: 'a' }, { date: '2026-10-02', game: 'b' },
    { date: '2026-10-02', game: null }, { date: '2026-10-02', game: 'gone' }, { date: '2026-09-01', game: 'b' }
  ];
  const info = { a: { title: 'Game A', cover: '/a.png', slots: 2 }, b: { title: 'Game B', cover: '', slots: 0 } };
  const r = f.askedForWindow(taps, d => d === '2026-10-02', slug => info[slug] || null);
  assert.deepStrictEqual(r.games, [
    { slug: 'a', title: 'Game A', cover: '/a.png', slots: 2, count: 2 },
    { slug: 'b', title: 'Game B', cover: '', slots: 0, count: 1 }
  ]);
  assert.strictEqual(r.other, 2);
});

ok('asked keeps only the top five', () => {
  const taps = 'abcdefg'.split('').map(g => ({ date: 'd', game: g }));
  const r = f.askedForWindow(taps, () => true, s => ({ title: s, cover: '', slots: 0 }));
  assert.strictEqual(r.games.length, 5);
});

ok('misses are counted by phrase, most first, inside the window', () => {
  const m = [{ date: 'd1', q: 'elden ring' }, { date: 'd1', q: 'elden ring' }, { date: 'd1', q: 'hades' }, { date: 'd0', q: 'old' }];
  assert.deepStrictEqual(f.missesForWindow(m, d => d === 'd1'), [{ q: 'elden ring', count: 2 }, { q: 'hades', count: 1 }]);
});

ok('skipped sums the days inside the window', () => {
  assert.strictEqual(f.skippedForWindow({ '2026-10-01': 5, '2026-10-02': 3, '2026-09-01': 100 }, d => d >= '2026-10-01'), 8);
  assert.strictEqual(f.skippedForWindow(undefined, () => true), 0);
});

console.log('\nbuildWindow');

ok('sessions, taps, misses and skips are all cut to the same window', () => {
  const summaries = f.buildSessionSummaries({
    visitors: [row('a', '/game/x', '2026-10-02'), row('b', '/', '2026-09-01')],
    taps: [{ session_id: 'a', game: 'x', date: '2026-10-02' }], orderedSessionIds: NONE, paidSessionIds: NONE
  });
  const w = f.buildWindow({
    summaries, taps: [{ session_id: 'a', game: 'x', date: '2026-10-02' }], misses: [{ date: '2026-10-02', q: 'zelda' }],
    skips: { '2026-10-02': 4, '2026-09-01': 9 }, inWindow: d => d === '2026-10-02',
    resolveGame: () => ({ title: 'X', cover: '', slots: 1 })
  });
  assert.strictEqual(w.funnel[0].count, 1);
  assert.strictEqual(w.funnel[2].count, 1);
  assert.strictEqual(w.skipped, 4);
  assert.strictEqual(w.asked.games[0].slug, 'x');
  assert.deepStrictEqual(w.misses, [{ q: 'zelda', count: 1 }]);
});

console.log('\n' + passed + ' assertions passed\n');
