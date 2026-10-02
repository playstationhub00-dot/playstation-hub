// Run: node scripts/test-home-search-core.js
const assert = require('assert');
const c = require('../public/js/home-search-core.js');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const INDEX = [
  { t: 'God of War Ragnarök', p: 'PS5', y: 'now', s: 2, pr: 249, u: '/game/god-of-war-ragnarok', img: '/a.png' },
  { t: 'God of War (2018)', p: 'PS4', y: 'now', s: 0, pr: 199, u: '/game/god-of-war-2018', img: '' },
  { t: 'God of War III Remastered', p: 'Included in PS Plus Deluxe', y: 'psplus', u: '/ps-plus?game=c%3A1', img: '' },
  { t: 'Marvel’s Spider-Man', p: 'PS5', y: 'now', s: 1, pr: 299, u: '/game/spider-man', img: '' },
  { t: 'Silent Hill Townfall', p: 'PS5', y: 'soon', d: '2026-11-01', u: '/upcoming/silent-hill-townfall-3', img: '' },
  { t: 'Hades II', y: 'requested', v: 1, u: '/requests#req-hades-ii', img: '' },
  { t: 'PS Hub Main Account', p: 'PS5', y: 'now', s: 3, pr: 500, k: 'Hogwarts Legacy Elden Ring', u: '/game/ps-hub-main-account', img: '' }
];

console.log('\nnorm');
ok('lower-cases, strips accents and punctuation', () => {
  assert.strictEqual(c.norm('  God of War: Ragnarök! '), 'god of war ragnarok');
  assert.strictEqual(c.norm(null), '');
});

console.log('\nsearch');
ok('matches every typed word, title-first', () => {
  const r = c.search(INDEX, 'god of');
  assert.deepStrictEqual(r.map(x => x.t), ['God of War Ragnarök', 'God of War (2018)', 'God of War III Remastered']);
});
ok('rentable games rank ahead of other kinds when equally good', () => {
  const r = c.search(INDEX, 'war');
  // The bundle account matches only through its hidden keywords (Hogwarts), so it comes last.
  assert.deepStrictEqual(r.map(x => x.y), ['now', 'now', 'psplus', 'now']);
  assert.strictEqual(r[3].t, 'PS Hub Main Account');
});
ok('a phrase inside the title ranks below one that starts it', () => {
  const idx = [{ t: 'The God of War', y: 'now', s: 1 }, { t: 'God of War', y: 'now', s: 1 }];
  assert.deepStrictEqual(c.search(idx, 'god of war').map(x => x.t), ['God of War', 'The God of War']);
});
ok('punctuation and accents in the query do not matter', () => {
  assert.strictEqual(c.search(INDEX, 'ragnarok')[0].t, 'God of War Ragnarök');
  assert.strictEqual(c.search(INDEX, 'spider man')[0].u, '/game/spider-man');
});
ok('hidden bundle keywords find the bundle account', () => {
  assert.strictEqual(c.search(INDEX, 'elden ring')[0].t, 'PS Hub Main Account');
});
ok('empty query, no match and the limit', () => {
  assert.deepStrictEqual(c.search(INDEX, '   '), []);
  assert.deepStrictEqual(c.search(INDEX, 'zzzz'), []);
  assert.strictEqual(c.search(INDEX, 'god', 2).length, 2);
  assert.deepStrictEqual(c.search(undefined, 'god'), []);
});

console.log('\nstatusOf');
ok('rentable with slots, singular and plural', () => {
  assert.deepStrictEqual(c.statusOf(INDEX[0]), { kind: 'free', text: '● 2 slots free', price: 'from ₱249' });
  assert.strictEqual(c.statusOf(INDEX[3]).text, '● 1 slot free');
});
ok('fully booked', () => {
  assert.deepStrictEqual(c.statusOf(INDEX[1]), { kind: 'booked', text: '● Fully booked · Fall in line free', price: 'from ₱199' });
});
ok('coming soon, PS Plus and requested', () => {
  assert.deepStrictEqual(c.statusOf(INDEX[4]), { kind: 'soon', text: 'Coming soon · 2026-11-01', price: '' });
  assert.deepStrictEqual(c.statusOf(INDEX[2]), { kind: 'psplus', text: '★ Included in PS Plus Deluxe', price: 'Play via PS Plus' });
  assert.strictEqual(c.statusOf(INDEX[5]).text, 'Requested · 1 vote');
  assert.strictEqual(c.statusOf({ y: 'soon' }).text, 'Coming soon · TBA');
});

console.log('\nlinks');
ok('request and Messenger links carry what was typed', () => {
  assert.strictEqual(c.requestHref(' Elden Ring '), '/requests?title=Elden%20Ring');
  assert.strictEqual(c.messengerHref('Elden Ring'), 'http://m.me/PlaystationHub00?text=' + encodeURIComponent('Hi! Do you have Elden Ring? 🎮'));
});

console.log('\n' + passed + ' assertions passed\n');
