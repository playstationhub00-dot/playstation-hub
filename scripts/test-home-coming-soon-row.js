// Run: node scripts/test-home-coming-soon-row.js
//
// The homepage's Coming soon games sit still, like New releases: one shelf
// (.hm-row) of at most 6 cards, owner-ranked first then soonest release, no
// arrows and no drifting. Browse keeps its own slider, and both pages draw the
// same card (views/partials/upcoming-card.ejs). Boots a throwaway instance
// (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a made-up admin
// password); nothing touches the project's games.json or a database.
const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4624;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'home-coming-soon-'));
// A local calendar date d days from today — the card counts days in local time.
const daysAhead = d => {
  const t = new Date(Date.now() + d * 86400000);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
};
const up = (id, title, release_date, extra) => Object.assign({
  id, title, platform: 'PS5', release_date, cover_image: '/uploads/up' + id + '.png',
  non_trophy_slots: 2, trophy_slots: 1, nt_price_7d: 349, nt_price_30d: 1099
}, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-' + Math.random().toString(36).slice(2),
  games: [{ id: 1, title: 'Zzyzx Released', platform: 'PS5', cover_image: '/uploads/g1.png', nt_price_7d: 349, non_trophy_slots: 1, trophy_slots: 1 }],
  upcoming: [
    up(1, 'Zzyzx Ranked Late', daysAhead(200), { rank: 1 }),
    up(2, 'Zzyzx Soon A', daysAhead(5)),
    up(3, 'Zzyzx Soon B', daysAhead(12)),
    up(4, 'Zzyzx Date Tba', 'TBA'),
    up(5, 'Zzyzx Soon C', daysAhead(20), { non_trophy_slots: 0, trophy_slots: 0 }),
    up(6, 'Zzyzx Soon D', daysAhead(30)),
    up(7, 'Zzyzx Soon E', daysAhead(40))
  ]
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
const upcomingIds = html => [...html.matchAll(/href="\/upcoming\/[a-z0-9-]+-(\d+)" class="game-card upcoming-card/g)].map(m => Number(m[1]));
// One card's HTML, by its upcoming id, with whitespace runs folded so the two pages compare.
function card(html, id) {
  const re = new RegExp('<a href="/upcoming/[a-z0-9-]+-' + id + '" class="game-card upcoming-card[\\s\\S]*?</a>');
  const m = re.exec(html);
  assert.ok(m, 'card ' + id + ' found');
  return m[0].replace(/\s+/g, ' ');
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
  let ready = false;
  while (Date.now() < deadline) {
    try { await get('/admin/login'); ready = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(ready, 'server did not come up within 15s');

  const home = (await get('/')).body;
  const browse = (await get('/browse')).body;

  console.log('\nhomepage');
  const soon = slice(home, '<section class="hm-wrap hm-sec" id="comingSoon">', '</section>');
  ok('a still shelf like New releases, with the Coming soon heading and View all', () => {
    assert.ok(soon.includes('<h2 class="hm-title"><span aria-hidden="true" class="hm-mark hm-sq">□</span>Coming soon <span class="hm-sub">reserve a slot</span><a class="hm-viewall" href="/browse#comingSoon">View all ›</a></h2>'));
    assert.ok(soon.includes('<div class="hm-row">'));
    assert.strictEqual((soon.match(/<div class="hm-cell">\s*<a href="\/upcoming\//g) || []).length, 6);
  });
  ok('six games: the ranked one first, then soonest release; TBA and the 7th left out', () => {
    assert.deepStrictEqual(upcomingIds(soon), [1, 2, 3, 5, 6, 7]);
  });
  ok('no arrows, no slider, nothing to drift', () => {
    ['upcomingSlider', 'upcoming-slider', 'slider-arrow', 'slideUpcoming', 'upcomingBody'].forEach(t => assert.ok(!soon.includes(t), t));
    assert.ok(!home.includes('id="upcomingSlider"'));
  });
  ok('the page script no longer drifts Coming soon', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'index-4.js'), 'utf8');
    assert.ok(!/autoDrift\('upcomingSlider'/.test(js));
  });

  console.log('\nBrowse and the shared card');
  ok('Browse keeps its Coming soon slider with arrows and every game', () => {
    const b = slice(browse, 'id="upcomingSlider"', 'slider-arrow-right');
    assert.ok(browse.includes('onclick="slideUpcoming(-1)"'));
    const head = slice(browse, 'id="comingSoon"', '</h2>');
    assert.ok(head.includes('Open for Reservation') && head.includes('class="section-toggle-btn"'), "Browse's own heading and collapse button");
    assert.ok(browse.includes('<div class="collapsible-body" id="upcomingBody">'));
    assert.deepStrictEqual(upcomingIds(b), [1, 2, 3, 5, 6, 7, 4]);
  });
  ok('both pages draw the same card', () => {
    [2, 5].forEach(id => assert.strictEqual(card(home, id), card(browse, id), 'card ' + id));
    assert.ok(card(home, 5).includes('cs-full') && card(home, 5).includes('<div class="card-ribbon">Full</div>'));
    assert.ok(card(home, 2).includes('<span class="cs-cd-n">5</span><span class="cs-cd-u">days</span>'));
  });
  ok('no Coming soon games → no homepage section', () => {
    const file = path.join(__dirname, '..', 'views', 'partials', 'home', 'upcoming-row.ejs');
    assert.strictEqual(ejs.render(fs.readFileSync(file, 'utf8'), { upcoming: [] }, { filename: file }).trim(), '');
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
