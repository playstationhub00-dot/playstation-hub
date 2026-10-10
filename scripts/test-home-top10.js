// Run: node scripts/test-home-top10.js
//
// The homepage's "Top rented this month" box beside the banner (computers):
// #1–#10, each with a small cover picture, and "View all games ›" to Browse;
// the banner grows to the box's height. On phones the Top rented shelf gets
// the same View all as New releases. Boots a throwaway instance (temp
// DATA_DIR, blank MONGODB_URI, in-memory sessions, a made-up admin password);
// nothing touches the project's games.json or a database.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4625;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'home-top10-'));
// Twelve games, renters 12 down to 1, so the all-time fill-up ranks them in id order.
const games = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1, title: 'Zzyzx Game ' + String(i + 1).padStart(2, '0'), platform: 'PS5', genre: 'Action',
  cover_image: i + 1 === 3 ? '' : '/uploads/g' + (i + 1) + '.png', renters: 12 - i,
  nt_price_7d: 349, nt_price_30d: 999, tr_price_7d: 449, tr_price_30d: 1199, non_trophy_slots: 1, trophy_slots: 1,
  created_at: '2020-01-01T00:00:00.000Z'
}));
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-' + Math.random().toString(36).slice(2), games, upcoming: [], customers: []
}));
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
function slice(html, from, to) {
  const i = html.indexOf(from);
  assert.ok(i >= 0, from + ' found');
  const j = html.indexOf(to, i + from.length);
  return html.slice(i, j < 0 ? html.length : j);
}
// The body of the first `sel { … }` rule in `text`.
const rule = (text, sel) => {
  const m = new RegExp('(?:^|[\\n{])\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}').exec(text);
  assert.ok(m, sel + ' rule found');
  return m[1];
};

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
  let ready = false;
  while (Date.now() < deadline) {
    try { await get('/admin/login'); ready = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(ready, 'server did not come up within 15s');
  const home = (await get('/')).body;
  const aside = slice(home, '<aside class="hm-aside"', '</aside>');
  const rows = [...aside.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);

  console.log('\nTop rented box (computers)');
  ok('ten games, most rented first, ranked 1 to 10', () => {
    assert.strictEqual(rows.length, 10);
    assert.deepStrictEqual(rows.map(r => (/class="hm-board-title">([^<]+)</.exec(r) || [])[1]), games.slice(0, 10).map(g => g.title));
    rows.forEach((r, i) => assert.ok(r.includes('<span class="hm-rk hm-rk-' + (i + 1) + '">' + (i + 1) + '</span>'), 'rank ' + (i + 1)));
  });
  ok('each row has its cover picture, and a plain square when there is none', () => {
    assert.ok(rows[0].includes('<img src="/uploads/g1.png" alt="" class="hm-board-cover" loading="lazy" decoding="async">'));
    assert.ok(rows[9].includes('src="/uploads/g10.png"'));
    assert.ok(rows[2].includes('<span class="hm-board-cover" aria-hidden="true"></span>') && !rows[2].includes('<img'), 'game 3 has no cover');
    rows.forEach((r, i) => assert.ok(r.indexOf('hm-board-cover') > r.indexOf('hm-rk') && r.indexOf('hm-board-cover') < r.indexOf('hm-board-title'), 'picture between rank and title, row ' + (i + 1)));
  });
  ok('the weekly price stays on every row', () => {
    rows.forEach(r => assert.ok(r.includes('<span class="hm-board-price">₱349</span>')));
  });
  ok('"View all games ›" opens Browse', () => {
    assert.ok(aside.includes('<a class="hm-board-all" href="/browse">View all games ›</a>'));
  });

  console.log('\nTop rented shelf (phones)');
  ok('its heading has View all, like New releases', () => {
    const head = slice(home, 'id="topRented"', '</h2>');
    assert.ok(head.includes('<a class="hm-viewall" href="/browse">View all ›</a>'));
  });

  console.log('\nstyles');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'home.css'), 'utf8').replace(/\r\n/g, '\n');
  ok('on computers the banner fills its row (at least 340px) instead of a fixed 340px', () => {
    const desktop = css.slice(css.indexOf('@media (min-width: 900px) { .hm-slide'));
    const slide = rule(desktop, '.hm-slide');
    assert.ok(/min-height:\s*340px/.test(slide), slide);
    assert.ok(!/(^|;)\s*height:\s*340px/.test(slide), 'no fixed height: ' + slide);
  });
  ok('the box stacks its list and View all; pictures are 30px squares', () => {
    const desktopAside = css.slice(css.indexOf('@media (min-width: 900px) { .hm-aside'));
    assert.ok(/display:\s*flex/.test(rule(desktopAside, '.hm-aside')) && /flex-direction:\s*column/.test(rule(desktopAside, '.hm-aside')));
    const cover = rule(css, '.hm-board-cover');
    ['width: 30px', 'height: 30px', 'object-fit: cover'].forEach(d => assert.ok(cover.includes(d), d));
    assert.ok(/margin-top:\s*auto/.test(rule(css, '.hm-board-all')), 'View all sits at the bottom');
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
