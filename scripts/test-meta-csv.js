// Run: node scripts/test-meta-csv.js
//
// The Facebook catalog feed (/feed/meta.csv) must quote each live game's
// Non-Trophy 7-day list price, its own page, and a short price summary.
// Prices come from the game's price category when it has one. Coming-soon
// and unreleased games stay out. Nothing here touches the real database.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4793;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-csv-'));
const TODAY = '2026-11-23';

const CATEGORIES = [
  { id: 1, name: 'New Games', nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 },
  { id: 2, name: 'Deluxe', nt_price_7d: 299, nt_price_30d: 599, tr_price_7d: 349, tr_price_30d: 699 },
  { id: 3, name: 'Special', nt_price_7d: 249, nt_price_30d: 549, tr_price_7d: 299, tr_price_30d: 599 },
  { id: 4, name: 'Regular', nt_price_7d: 199, nt_price_30d: 499, tr_price_7d: 249, tr_price_30d: 549 }
];

// Stale per-game prices and the old price_7 field must not win over the category.
const game = (id, title, extra) => Object.assign({
  id, title, platform: 'PS5',
  cover_image: '/uploads/' + id + '.webp',
  description: 'Old blurb that must not be the catalog description.',
  price_7: 0, price_14: 0, price_30: 0,
  nt_price_7d: 1, nt_price_30d: 2, tr_price_7d: 3, tr_price_30d: 4,
  non_trophy_slots: 0, trophy_slots: 0, ps4_primary_slots: 0
}, extra || {});

const GAMES = [
  game(19, 'Zzyzx New', { platform: 'PS4/PS5', price_category_id: 1 }),
  game(4, 'Zzyzx Regular', { price_category_id: 4 }),
  game(17, 'PS Plus Deluxe', {
    platform: 'PS4/PS5', price_category_id: 1,
    cover_image: 'https://playstation-hub.com/uploads/plus.webp'
  }),
  game(88, 'Zzyzx GTA VI', {
    platform: 'PS5', price_category_id: null,
    nt_price_7d: 449, nt_price_30d: 899, tr_price_7d: 499, tr_price_30d: 999,
    cover_image: '/uploads/gta.webp'
  }),
  game(3, 'Zzyzx Special', { platform: 'PS4', price_category_id: 3, release_date: 'TBA' }),
  game(2, 'Zzyzx Deluxe', { platform: 'PS4/PS5', price_category_id: 2, release_date: '2026-11-23' }),
  game(95, 'Zzyzx "Quoted", Game', { price_category_id: 2 }),
  game(94, 'Zzyzx Trophy Only', {
    price_category_id: null, nt_price_7d: 0, nt_price_30d: 0, tr_price_7d: 249, tr_price_30d: 549
  }),
  game(96, 'Zzyzx External', {
    price_category_id: 4, cover_image: 'https://image.api.playstation.com/cover.png'
  }),
  game(97, 'Zzyzx No Cover', { price_category_id: 4, cover_image: '' }),
  game(90, 'Zzyzx Soon', { upcoming: true, price_category_id: 1, release_date: '2020-01-01' }),
  game(91, 'Zzyzx Unreleased', { price_category_id: 1, release_date: '2027-03-01' }),
  game(93, 'Zzyzx No Weekly', {
    price_category_id: null, nt_price_7d: 0, tr_price_7d: 0, nt_price_30d: 499, tr_price_30d: 549
  }),
  game(9, 'Zzyzx Zero', { price_category_id: null, nt_price_7d: 0, nt_price_30d: 0, tr_price_7d: 0, tr_price_30d: 0 })
];

function cleanup() {
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const NEW_DESC = 'Non-Trophy: ₱349/week, ₱699/month. Trophy & PS4 Primary: ₱399/week, ₱799/month (₱100 refundable deposit). Free 3-hour trial on Non-Trophy. Rent at www.playstation-hub.com or message us on Messenger.';
const PS5_DESC = 'Non-Trophy: ₱199/week, ₱499/month. Trophy: ₱249/week, ₱549/month (₱100 refundable deposit). Free 3-hour trial on Non-Trophy. Rent at www.playstation-hub.com or message us on Messenger.';

async function main() {
  const metaCsv = require('../lib/meta-csv');
  const input = { games: GAMES, categories: CATEGORIES, deposit: 100, today: TODAY };
  const records = metaCsv.records(input);
  const byId = id => records.find(r => r.id === String(id));
  const csv = metaCsv.csv(input);
  const parsed = parseCsv(csv);

  console.log('\nprices and links');
  ok('a category price replaces a stale 0 and the old price_7 field', () => {
    const row = byId(19);
    assert.ok(row, 'row present');
    assert.strictEqual(row.price, '349 PHP');
    assert.strictEqual(row.link, 'https://www.playstation-hub.com/game/zzyzx-new');
    assert.strictEqual(row.image_link, 'https://www.playstation-hub.com/uploads/jpg/19.jpg');
    assert.strictEqual(row.description, NEW_DESC);
    assert.strictEqual(row.availability, 'in stock');
    assert.strictEqual(row.condition, 'new');
    assert.strictEqual(row.brand, 'PlayStation Hub');
    assert.strictEqual(row.google_product_category, '1249');
    assert.ok(row.description.length < 300, row.description.length);
  });
  ok('a PS5-only game says Trophy and leaves PS4 Primary out', () => {
    const row = byId(4);
    assert.strictEqual(row.price, '199 PHP');
    assert.strictEqual(row.description, PS5_DESC);
    assert.ok(!row.description.includes('PS4 Primary'));
  });
  ok('PS Plus Deluxe keeps its numeric id and links to /ps-plus', () => {
    const row = byId(17);
    assert.strictEqual(row.id, '17');
    assert.strictEqual(row.price, '349 PHP');
    assert.strictEqual(row.link, 'https://www.playstation-hub.com/ps-plus');
    assert.strictEqual(row.image_link, 'https://www.playstation-hub.com/uploads/jpg/plus.jpg');
    assert.ok(row.description.includes('Trophy & PS4 Primary: ₱399/week, ₱799/month'));
  });
  ok('a game with no category uses its own Non-Trophy weekly price', () => {
    const row = byId(88);
    assert.strictEqual(row.price, '449 PHP');
    assert.ok(row.description.startsWith('Non-Trophy: ₱449/week, ₱899/month. Trophy: ₱499/week, ₱999/month'));
  });
  ok('Special, Deluxe, and a same-day release use their tier list prices', () => {
    assert.strictEqual(byId(3).price, '249 PHP');
    assert.ok(byId(3).description.includes('Trophy & PS4 Primary: ₱299/week, ₱599/month'));
    assert.strictEqual(byId(2).price, '299 PHP');
    assert.ok(byId(2).description.includes('Non-Trophy: ₱299/week, ₱599/month'));
  });
  ok('a missing Non-Trophy weekly price falls back to Trophy and skips a 0', () => {
    const row = byId(94);
    assert.strictEqual(row.price, '249 PHP');
    assert.ok(row.description.startsWith('Trophy: ₱249/week, ₱549/month'));
    assert.ok(!row.description.includes('Non-Trophy'));
    assert.ok(!row.description.includes('3-hour'));
    assert.ok(!csv.includes('0 PHP'));
  });

  console.log('\nexclusions');
  ok('coming-soon, unreleased, and unpriced games are left out', () => {
    [90, 91, 93, 9].forEach(id => assert.strictEqual(byId(id), undefined, 'id ' + id));
    assert.ok(!csv.includes('Zzyzx Soon'));
    assert.ok(!csv.includes('Zzyzx Unreleased'));
    assert.ok(!csv.includes('Zzyzx No Weekly'));
    assert.ok(!csv.includes('Zzyzx Zero'));
  });
  ok('ids stay the numeric catalog ids, in the same order', () => {
    assert.deepStrictEqual(records.map(r => r.id), ['19', '4', '17', '88', '3', '2', '95', '94', '96', '97']);
  });

  console.log('\ncsv');
  ok('quoting keeps commas, quotes, and the peso sign', () => {
    assert.deepStrictEqual(parsed[0], metaCsv.HEADERS);
    const quoted = parsed.find(r => r[1] === 'Zzyzx "Quoted", Game');
    assert.ok(quoted, 'quoted title parsed');
    assert.strictEqual(quoted[5], '299 PHP');
    assert.ok(quoted[2].includes('₱299/week'));
    assert.ok(csv.includes('₱'));
    assert.ok(csv.endsWith('\n'));
    const file = Buffer.from(csv, 'utf8');
    assert.ok(file.includes(Buffer.from('₱', 'utf8')));
    assert.notStrictEqual(file[0], 0xEF, 'no BOM');
  });
  ok('an external cover stays put, and a missing cover is an empty image link', () => {
    assert.strictEqual(byId(96).image_link, 'https://image.api.playstation.com/cover.png');
    assert.strictEqual(byId(97).image_link, '');
    assert.strictEqual(byId(97).price, '199 PHP');
  });
  ok('a zero deposit does not advertise ₱0', () => {
    const row = metaCsv.records({ games: [GAMES[0]], categories: CATEGORIES, deposit: 0, today: TODAY })[0];
    assert.ok(!row.description.includes('deposit'));
    assert.ok(row.description.includes('Trophy & PS4 Primary: ₱399/week, ₱799/month.'));
  });

  console.log('\nroute');
  fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
    admin_password: 'throwaway',
    site_settings: { promo: { deposit: 100 } },
    price_categories: CATEGORIES,
    games: GAMES
  }));
  process.env.PORT = String(PORT);
  process.env.DATA_DIR = DATA_DIR;
  process.env.MONGODB_URI = '';
  process.env.SITE_URL = 'https://playstation-hub.com';
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  require('../server.js');
  const deadline = Date.now() + 15000;
  let body = '';
  let headers = {};
  let status = 0;
  while (Date.now() < deadline) {
    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.get({ host: 'localhost', port: PORT, path: '/feed/meta.csv', timeout: 5000 }, r => {
          const chunks = [];
          r.on('data', c => chunks.push(c));
          r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
      status = res.status;
      headers = res.headers;
      body = res.body.toString('utf8');
      break;
    } catch (e) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  ok('GET /feed/meta.csv serves the same rows with a UTF-8 csv type', () => {
    assert.strictEqual(status, 200, 'feed did not come up');
    const type = String(headers['content-type'] || '');
    assert.ok(type.includes('text/csv'), type);
    assert.ok(/charset=utf-8/i.test(type), type);
    assert.strictEqual(body, metaCsv.csv({ games: GAMES, categories: CATEGORIES, deposit: 100, today: new Date().toISOString().slice(0, 10) }));
    assert.ok(!body.includes('0 PHP'));
    assert.ok(!body.includes('/browse'));
    assert.ok(body.includes('https://www.playstation-hub.com/game/zzyzx-new'));
    assert.ok(!body.includes('https://playstation-hub.com/'));
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
