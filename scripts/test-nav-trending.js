// Run: node scripts/test-nav-trending.js
const assert = require('assert');
const trending = require('../lib/trending');
const navMenu = require('../lib/nav-menu');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const NOW = new Date('2026-11-23T12:00:00.000Z');
const games = [
  { id: 1, title: 'Quiet', renters: 9, created_at: '2026-01-01' },
  { id: 2, title: 'Busy', renters: 1, created_at: '2026-02-01' },
  { id: 3, title: 'Fresh', renters: 0, created_at: '2026-11-01' }
];

ok('a rental outranks a view, and a cancelled order does not count', () => {
  const result = trending.rank(games, {
    now: NOW,
    customers: [{ game_id: 2, start_date: '2026-11-20' }],
    orders: [
      { game_id: 3, state: 'cancelled', created_at: '2026-11-22T00:00:00.000Z' },
      { game_id: 3, state: 'awaiting_payment', created_at: '2026-11-22T00:00:00.000Z' }
    ],
    views: [{ game_id: 2, at: '2026-11-21' }, { game_id: 1, at: '2026-10-01' }],
    requests: [{ game_id: 3, at: '2026-11-22T00:00:00.000Z' }]
  });
  assert.strictEqual(result.fallback, false);
  assert.deepStrictEqual(result.games.map(g => g.id), [2, 3]);
  assert.strictEqual(result.scores[0].score, trending.WEIGHT.rental + trending.WEIGHT.view);
  assert.strictEqual(result.scores[1].score, trending.WEIGHT.order + trending.WEIGHT.request);
});

ok('an empty week falls back to the most rented games', () => {
  const result = trending.rank(games, { now: NOW, customers: [], orders: [], views: [], requests: [] });
  assert.strictEqual(result.fallback, true);
  assert.deepStrictEqual(result.games.map(g => g.id), [1, 2]);
});

ok('category links use the live browse filters and counts', () => {
  const menu = navMenu.build({
    games: [
      { title: 'A', genres: ['Action'], types: ['nt', 'tr'], ps5: true, ps4: false, avail: true, rank: 1, released: '2026-11-01', buy: false, bundle: false, tier: '4' },
      { title: 'B', genres: ['Action', 'RPG'], types: ['nt', 'tr', 'ps4'], ps5: true, ps4: true, avail: false, rank: null, released: null, buy: true, bundle: true, tier: '1' }
    ],
    tiers: [
      { id: 1, name: 'New Games' },
      { id: 2, name: 'Deluxe' },
      { id: 3, name: 'Special' },
      { id: 4, name: 'Regular' }
    ],
    soonCount: 3,
    psplusCount: 8,
    trendingCount: 2,
    featured: [{ title: 'A' }]
  });
  assert.strictEqual(menu.browse[0].count, 2);
  assert.strictEqual(menu.browse[1].href, '/browse?tab=new');
  assert.strictEqual(menu.browse[3].href, '/trending');
  assert.strictEqual(menu.browse[3].count, 2);
  assert.strictEqual(menu.category.genres[0].href, '/browse?genre=Action');
  assert.strictEqual(menu.category.genres[0].count, 2);
  assert.strictEqual(menu.category.accounts.find(a => a.key === 'ps4').count, 1);
  assert.strictEqual(menu.category.availability[1].label, 'Full — join the line');
  assert.strictEqual(menu.category.availability[1].href, '/browse?stock=full');
  assert.strictEqual(menu.category.shortcuts[1].href, '/browse?tier=1');
  assert.strictEqual(menu.category.shortcuts[2].href, '/browse?tier=2,3,4');
  assert.strictEqual(menu.chips.find(c => c.label === 'PS Plus Deluxe').count, 8);
});

console.log('\n' + passed + ' assertions passed\n');
