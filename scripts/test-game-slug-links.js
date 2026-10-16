// Run: node scripts/test-game-slug-links.js
//
// Card hrefs are gameSlug(title). /game/:slug used to 301 that href through
// redirectSlug before looking the title up, so a title the rename script had
// not changed (NBA2K27 → slug nba2k27) was sent to /game/nba-2k27 and then
// 302'd to /browse. Every catalogue game's card href must finish on that
// game's page. The other spelling still resolves, and a missing slug still
// ends on /browse.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const fixes = require('../lib/title-fixes');

const PORT = 4780;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'game-slugs-'));
const prices = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899, non_trophy_slots: 2, trophy_slots: 1 };
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5', genre: 'Action', cover_image: '', renters: 1, created_at: '2020-01-01T00:00:00.000Z'
}, prices, extra || {});

// The titles whose current slug redirectSlug rewrites. These are the ones the
// old route could not open. Digit titles (Tekken 8, WWE 2K25, F1 24) are here
// on purpose: gameSlug does not split letters from digits, and neither should
// lookup, except for the nba2k27 alias.
const GAMES = [
  game(80, 'NBA2K27', { renters: 100 }),
  game(2, 'Resident Evil Remake Trilogy'),
  game(3, 'Khazan The First Berseker'),
  game(4, 'Assasins Creed Shadows'),
  game(5, 'Assasins Creed Shadows w/ DLC'),
  game(6, 'Silent Hill f'),
  game(7, 'Tekken 8'),
  game(8, "Dragon's Dogma 2: Dark Arisen"),
  game(9, 'WWE 2K25'),
  game(10, 'F1 24'),
  game(11, 'Marvel Tōkon: Fighting Souls'),
  game(15, 'Battlefield 6'),
  game(16, 'Final Fantasy 7 Rebirth'),
  game(17, 'Resident Evil 2 Deluxe Edition'),
  game(18, 'Call of Duty Black Ops 6')
];
const UPCOMING = [
  { id: 12, title: 'Khazan The First Berseker', platform: 'PS5', genre: 'RPG', release_date: 'TBA', non_trophy_slots: 2, trophy_slots: 1 },
  { id: 13, title: 'Silent Hill TownFall', platform: 'PS5', genre: 'Horror', release_date: 'TBA', non_trophy_slots: 2, trophy_slots: 1 },
  { id: 14, title: 'Resident Evil Remake Triology', platform: 'PS5', genre: 'Horror', release_date: 'TBA', non_trophy_slots: 2, trophy_slots: 1 }
];

function cardSlug(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  games: GAMES,
  upcoming: UPCOMING,
  nextId: 19,
  nextUpcomingId: 15,
  customers: [],
  migrations: ['genre-by-slug-2026-10-14']
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function call(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path: p, timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0 test' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out: ' + p)); });
  });
}

// Follow 301/302 ourselves so a hop that lands on /browse is a failure, and a
// loop is a failure, rather than a client treating the redirect as success.
async function follow(start) {
  const seen = new Set();
  let current = start;
  const hops = [];
  for (let i = 0; i < 6; i++) {
    const pathOnly = current.split('?')[0];
    if (seen.has(pathOnly)) throw new Error('redirect loop at ' + current + ' from ' + start);
    seen.add(pathOnly);
    const res = await call(current);
    hops.push({ url: current, status: res.status, location: res.headers.location || null });
    if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
      if (!res.headers.location) throw new Error('redirect without location from ' + current);
      current = res.headers.location;
      continue;
    }
    return { status: res.status, path: pathOnly, body: res.body, hops };
  }
  throw new Error('too many redirects from ' + start);
}

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  require('../server.js');
  const deadline = Date.now() + 20000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('/browse'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 20s');

  const brokenBeforeFix = GAMES.filter(g => fixes.redirectSlug(cardSlug(g.title)));
  console.log('\ntitles whose card slug redirectSlug rewrites (broken before this fix):');
  brokenBeforeFix.forEach(g => {
    console.log('  ' + g.title + '  /game/' + cardSlug(g.title) + '  →  /game/' + fixes.redirectSlug(cardSlug(g.title)));
  });

  const browse = await call('/browse');
  const home = await call('/');
  assert.strictEqual(browse.status, 200);
  assert.strictEqual(home.status, 200);
  const browseCards = [...browse.body.matchAll(/href="(\/game\/[a-z0-9-]+)" class="game-card/g)].map(m => m[1]);
  const homeGameLinks = [...home.body.matchAll(/href="(\/game\/[a-z0-9-]+)"/g)].map(m => m[1]);

  console.log('\nevery catalogue card');
  await okAsync('browse renders one card href per game, and that href is gameSlug(title)', async () => {
    assert.strictEqual(browseCards.length, GAMES.length);
    GAMES.forEach(g => {
      assert.ok(browseCards.includes('/game/' + cardSlug(g.title)), g.title);
    });
  });
  await okAsync('the homepage links NBA2K27 to /game/nba2k27', async () => {
    assert.ok(homeGameLinks.includes('/game/nba2k27'));
  });

  for (const g of GAMES) {
    const href = '/game/' + cardSlug(g.title);
    await okAsync(g.title + ' card ' + href + ' ends on that game', async () => {
      const final = await follow(href);
      assert.strictEqual(final.status, 200, JSON.stringify(final.hops));
      assert.strictEqual(final.path, href, 'canonical drifted from the card: ' + JSON.stringify(final.hops));
      assert.ok(final.body.includes('class="usd-title"'), 'not the game page');
      assert.ok(final.body.includes('name="game_id" value="' + g.id + '"'), 'wrong game');
      assert.ok(!final.path.startsWith('/browse'));
      assert.strictEqual(final.hops.length, 1, 'card href should not redirect');
    });
  }

  console.log('\nhomepage links');
  const homeUnique = [...new Set(homeGameLinks)];
  await okAsync('every homepage /game/ link ends on a game page', async () => {
    assert.ok(homeUnique.length > 0);
    for (const href of homeUnique) {
      const final = await follow(href);
      assert.strictEqual(final.status, 200, href + ' ' + JSON.stringify(final.hops));
      assert.strictEqual(final.path, href);
      assert.ok(final.body.includes('class="usd-title"'));
      assert.ok(!final.path.startsWith('/browse'));
    }
  });

  console.log('\neither spelling, and old links');
  await okAsync('/game/nba-2k27 and /game/80 both end on NBA2K27, keeping a query string', async () => {
    const alt = await follow('/game/nba-2k27?mode=buy');
    assert.strictEqual(alt.status, 200);
    assert.strictEqual(alt.path, '/game/nba2k27');
    assert.ok(alt.hops.some(h => h.status === 301 && h.location === '/game/nba2k27?mode=buy'));
    assert.ok(alt.body.includes('name="game_id" value="80"'));
    const byId = await follow('/game/80');
    assert.strictEqual(byId.status, 200);
    assert.strictEqual(byId.path, '/game/nba2k27');
    assert.ok(byId.body.includes('name="game_id" value="80"'));
  });
  await okAsync('a renamed title still answers the old typo slug', async () => {
    const old = await follow('/game/resident-evil-remake-triology');
    assert.strictEqual(old.status, 200);
    assert.strictEqual(old.path, '/game/resident-evil-remake-trilogy');
    assert.ok(old.hops.some(h => h.status === 301 && h.location === '/game/resident-evil-remake-trilogy'));
    assert.ok(old.body.includes('name="game_id" value="2"'));
  });
  await okAsync('the other typo titles answer their corrected slug and stay on the card slug', async () => {
    const cases = [
      ['/game/khazan-the-first-berserker', '/game/khazan-the-first-berseker', '3'],
      ['/game/assassin-s-creed-shadows', '/game/assasins-creed-shadows', '4'],
      ['/game/assassin-s-creed-shadows-w-dlc', '/game/assasins-creed-shadows-w-dlc', '5']
    ];
    for (const [from, to, id] of cases) {
      const final = await follow(from);
      assert.strictEqual(final.status, 200, from);
      assert.strictEqual(final.path, to);
      assert.ok(final.body.includes('name="game_id" value="' + id + '"'));
    }
  });
  await okAsync('a slug that names no game still ends on /browse', async () => {
    const missing = await follow('/game/not-a-real-game');
    assert.strictEqual(missing.status, 200);
    assert.strictEqual(missing.path, '/browse');
    assert.ok(missing.hops.some(h => h.status === 302 && h.location === '/browse'));
  });
  await okAsync('digit titles are not rewritten into a second spelling', async () => {
    for (const title of ['Tekken 8', 'WWE 2K25', 'F1 24', 'Battlefield 6', 'Resident Evil 2 Deluxe Edition']) {
      assert.strictEqual(fixes.redirectSlug(cardSlug(title)), null, title);
    }
  });

  console.log('\ncoming soon cards');
  const soonCards = [...browse.body.matchAll(/href="(\/upcoming\/[a-z0-9-]+)" class="game-card upcoming-card/g)].map(m => m[1]);
  await okAsync('every coming soon card href ends on that coming soon page', async () => {
    assert.strictEqual(soonCards.length, UPCOMING.length);
    for (const u of UPCOMING) {
      const href = '/upcoming/' + cardSlug(u.title) + '-' + u.id;
      assert.ok(soonCards.includes(href), u.title);
      const final = await follow(href);
      assert.strictEqual(final.status, 200, JSON.stringify(final.hops));
      assert.strictEqual(final.path, href);
      assert.strictEqual(final.hops.length, 1);
      assert.ok(final.body.includes('class="usd-title"'));
      assert.ok(final.body.includes('name="game_id" value="' + u.id + '"'));
    }
  });
  await okAsync('a corrected coming soon slug 301s back to the live title slug', async () => {
    const final = await follow('/upcoming/khazan-the-first-berserker-12');
    assert.strictEqual(final.status, 200);
    assert.strictEqual(final.path, '/upcoming/khazan-the-first-berseker-12');
    assert.ok(final.body.includes('name="game_id" value="12"'));
    const tri = await follow('/upcoming/resident-evil-remake-trilogy-14');
    assert.strictEqual(tri.path, '/upcoming/resident-evil-remake-triology-14');
    assert.ok(tri.body.includes('name="game_id" value="14"'));
  });

  assert.deepStrictEqual(brokenBeforeFix.map(g => g.title).sort(), [
    'Assasins Creed Shadows',
    'Assasins Creed Shadows w/ DLC',
    'Khazan The First Berseker',
    'NBA2K27'
  ]);

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
