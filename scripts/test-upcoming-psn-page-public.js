// Run: node scripts/test-upcoming-psn-page-public.js
//
// A Coming soon page (/upcoming/<slug>) with PlayStation info shows the same
// blocks as a released game's page — trailer + screenshots in place of the
// cover, tagline and rating under the title, "About this game" and "Game
// info" — with the owner's own description and pictures winning. Without
// PlayStation info the page is unchanged. Boots a throwaway instance (temp
// DATA_DIR, blank MONGODB_URI, in-memory sessions); nothing reaches
// PlayStation or a database.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4623;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'upcoming-psn-public-'));
const PSN = {
  concept_id: '900001', source: 'auto', fetched_at: '2026-10-10T00:00:00.000Z',
  description: 'First paragraph from PlayStation.\n\nSecond paragraph from PlayStation.',
  tagline: 'Zzyzx tagline', genres: ['Action'], publisher: 'Zzyzx Publisher',
  voices: ['English', 'Japanese'], age_rating: 'ESRB Teen', rating: { avg: 4.6, count: 1200 },
  screenshots: ['https://image.api.playstation.com/shot1.jpg', 'https://image.api.playstation.com/shot2.jpg'],
  videos: ['https://vulcan.dl.playstation.net/trailer.mp4']
};
const base = { platform: 'PS5', release_date: '2026-12-01', nt_price_7d: 349, nt_price_30d: 1099, non_trophy_slots: 2, trophy_slots: 1, tr_price_7d: 449, tr_price_30d: 1299 };
const upcoming = [
  Object.assign({ id: 1, title: 'Zzyzx With Info', cover_image: '/uploads/cover1.webp', psn: PSN }, base),
  Object.assign({ id: 2, title: 'Zzyzx Own Words', cover_image: '/uploads/cover2.webp', description: 'The owner wrote this.', gallery: ['/uploads/own1.webp', '/uploads/own2.webp'], psn: PSN }, base),
  Object.assign({ id: 3, title: 'Zzyzx Plain', cover_image: '/uploads/cover3.webp', description: 'Plain owner text.', gallery: ['/uploads/plain1.webp', '/uploads/plain2.webp'] }, base)
];
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({ admin_password: 'throwaway-' + Math.random().toString(36).slice(2), games: [], upcoming, nextUpcomingId: 10 }));
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
  let up = false;
  while (Date.now() < deadline) {
    try { await get('/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  const withInfo = await get('/upcoming/zzyzx-with-info-1');
  const own = await get('/upcoming/zzyzx-own-words-2');
  const plain = await get('/upcoming/zzyzx-plain-3');
  assert.deepStrictEqual([withInfo.status, own.status, plain.status], [200, 200, 200]);

  console.log('\nwith PlayStation info');
  ok('the trailer and screenshots replace the cover, with their styles and script', () => {
    const b = withInfo.body;
    assert.ok(b.includes('id="gpMedia" data-count="3"'));
    assert.ok(b.includes('<source src="https://vulcan.dl.playstation.net/trailer.mp4" type="video/mp4">'));
    assert.ok(b.includes('src="https://image.api.playstation.com/shot1.jpg"') && b.includes('src="https://image.api.playstation.com/shot2.jpg"'));
    assert.ok(!b.includes('class="gd-cover gdh-poster"'), 'no static cover');
    assert.ok(b.includes('/css/game-psn.css?v='));
    assert.ok(b.includes('<script src="/js/game-media.js?v='));
  });
  ok('tagline and rating under the title', () => {
    assert.ok(withInfo.body.includes('<div class="gpa-tagline">Zzyzx tagline</div>'));
    assert.ok(withInfo.body.includes('<b>★ 4.6</b> on PlayStation Store'));
  });
  ok('About this game in paragraphs, and Game info, instead of the description under the poster', () => {
    const b = withInfo.body;
    assert.ok(b.includes('About this game'));
    assert.ok(b.includes('<p>First paragraph from PlayStation.</p><p>Second paragraph from PlayStation.</p>'));
    assert.ok(b.includes('Game info'));
    for (const cell of ['<td>Release date</td><td>Dec 1, 2026</td>', '<td>Publisher</td><td>Zzyzx Publisher</td>', '<td>Platform</td><td>PS5</td>', '<td>Voice</td><td>English, Japanese</td>', '<td>Age rating</td><td>ESRB Teen</td>']) {
      assert.ok(b.includes(cell), cell);
    }
    assert.ok(!b.includes('gdh-poster-desc'), 'no second copy under the poster');
  });

  console.log("\nthe owner's own words and pictures");
  ok("the owner's description and gallery win, and the bottom gallery is not repeated", () => {
    const b = own.body;
    assert.ok(b.includes('<p>The owner wrote this.</p>'));
    assert.ok(!b.includes('First paragraph from PlayStation.'));
    assert.ok(b.includes('id="gpMedia" data-count="3"'), 'trailer + 2 own pictures');
    assert.ok(b.includes('src="/uploads/own1.webp"'));
    assert.ok(!b.includes('src="https://image.api.playstation.com/shot1.jpg"'));
    assert.ok(!b.includes('rsv-gallery-section'));
    assert.ok(b.includes('const gpSlideCount = 0;'));
  });

  console.log('\nwithout PlayStation info');
  ok('the page is as before: cover, description under it, Gameplay gallery at the bottom', () => {
    const b = plain.body;
    assert.ok(b.includes('<img src="/uploads/cover3.webp" alt="Zzyzx Plain" class="gd-cover gdh-poster">'));
    assert.ok(b.includes('<p class="gd-desc gdh-poster-desc">Plain owner text.</p>'));
    assert.ok(b.includes('rsv-gallery-section') && b.includes('const gpSlideCount = 2;'));
    assert.ok(!b.includes('id="gpMedia"') && !b.includes('About this game') && !b.includes('gpa-headline'));
    assert.ok(!b.includes('/js/game-media.js'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
