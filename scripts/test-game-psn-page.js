// Run: node scripts/test-game-psn-page.js
//
// Boots the real server against a throwaway DATA_DIR (blank MONGODB_URI) and
// checks the public game page: with stored PlayStation data it shows the
// trailer / screenshots block, rating, About and Game info; the owner's own
// entries win; a game with no PlayStation data renders as before.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4596;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'game-psn-page-'));
const base = { platform: 'PS5', nt_price_7d: 399, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 799, non_trophy_slots: 2, trophy_slots: 1, cover_image: '/uploads/cover.png' };
const PSN = {
  concept_id: '900001', source: 'auto', fetched_at: '2026-10-02T10:00:00.000Z', store_url: 'https://store.playstation.com/en-us/concept/900001',
  description: 'A new era of digging begins.\n\nExplore every cave & tunnel.', tagline: 'Dig deep. Dig far.', genres: ['Action', 'Adventure'],
  release_date: '2026-02-27', publisher: 'Zzyzx Games', voices: ['English', 'Japanese'], age_rating: 'ESRB Mature', rating: { avg: 4.88, count: 103548 },
  screenshots: ['https://image.api.playstation.com/s1.jpg', 'https://image.api.playstation.com/s2.jpg'], videos: ['https://vulcan.dl.playstation.net/t1.mp4']
};
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  games: [
    Object.assign({ id: 1, title: 'Zzyzx Known', size_gb: 54.3, psn: PSN }, base),
    Object.assign({ id: 2, title: 'Zzyzx Owner Wins', description: 'My own words.', genre: 'RPG', gallery: ['/uploads/g1.png', '/uploads/g2.png'], psn: PSN }, base),
    Object.assign({ id: 3, title: 'Zzyzx Plain', description: 'Plain description.', gallery: ['/uploads/p1.png'] }, base)
  ]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path: p, timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone) Safari' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
  });
}

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await get('/browse'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  console.log('\na game with PlayStation data');
  const known = await get('/game/zzyzx-known');
  await okAsync('the trailer block replaces the poster: trailer first, screenshots after, thumbnails', async () => {
    assert.strictEqual(known.status, 200);
    assert.ok(known.body.includes('id="gpMedia"') && known.body.includes('data-count="3"'));
    assert.ok(/<video controls playsinline preload="none" poster="https:\/\/image\.api\.playstation\.com\/s1\.jpg"><source src="https:\/\/vulcan\.dl\.playstation\.net\/t1\.mp4" type="video\/mp4">/.test(known.body));
    assert.ok(known.body.includes('▶ TRAILER') && known.body.includes('1 / 3'));
    assert.strictEqual((known.body.match(/class="gpm-thumb[ "]/g) || []).length, 3);
    assert.ok(!known.body.includes('gdh-poster'), 'the static poster is not drawn');
  });
  await okAsync('tagline, rating, About and Game info show; Size appears because the owner typed it', async () => {
    assert.ok(known.body.includes('Dig deep. Dig far.'));
    assert.ok(known.body.includes('★ 4.9') && known.body.includes('103,548 ratings'));
    assert.ok(known.body.includes('About this game') && known.body.includes('<p>A new era of digging begins.</p>') && known.body.includes('<p>Explore every cave &amp; tunnel.</p>'));
    assert.ok(/<tr><td>Release date<\/td><td>Feb 27, 2026<\/td><\/tr>/.test(known.body));
    assert.ok(/<tr><td>Size<\/td><td>54\.3 GB<\/td><\/tr>/.test(known.body));
    assert.ok(/<tr><td>Voice<\/td><td>English, Japanese<\/td><\/tr>/.test(known.body));
    assert.ok(/<tr><td>Age rating<\/td><td>ESRB Mature<\/td><\/tr>/.test(known.body));
    assert.ok(known.body.includes('>Action<') && known.body.includes('>Adventure<'), 'genre chips use PlayStation genres');
  });
  await okAsync('the rent box and the Messenger button are still there', async () => {
    assert.ok(known.body.includes('id="ctaMsgPrimary"') && known.body.includes('id="rentPanel"'));
    assert.ok(known.body.includes('/js/game-media.js?v=') && known.body.includes('/css/game-psn.css?v='));
  });

  console.log('\nthe owner wins');
  const own = await get('/game/zzyzx-owner-wins');
  await okAsync("the owner's description and genre show, PlayStation's overview does not", async () => {
    assert.ok(own.body.includes('<p>My own words.</p>'));
    assert.ok(!own.body.includes('A new era of digging begins.'));
    assert.ok(own.body.includes('>RPG<'));
    assert.ok(/<tr><td>Genre<\/td><td>RPG<\/td><\/tr>/.test(own.body));
  });
  await okAsync("the owner's gallery is used in the media block and the separate Gameplay section is skipped", async () => {
    assert.ok(own.body.includes('src="/uploads/g1.png"') && own.body.includes('src="/uploads/g2.png"'));
    assert.ok(!own.body.includes('class="rsv-gallery-section"'));
    assert.ok(!own.body.includes('https://image.api.playstation.com/s1.jpg"'), "PlayStation's screenshots are not mixed in");
  });

  console.log('\na game with no PlayStation data');
  const plain = await get('/game/zzyzx-plain');
  await okAsync('renders as before: poster, description under it, Gameplay gallery, no new blocks', async () => {
    assert.ok(plain.body.includes('gdh-poster') && plain.body.includes('Plain description.'));
    assert.ok(plain.body.includes('class="rsv-gallery-section"'));
    assert.ok(!plain.body.includes('id="gpMedia"') && !plain.body.includes('id="gpAbout"') && !plain.body.includes('gpa-headline'));
    assert.ok(!plain.body.includes('/js/game-media.js'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
