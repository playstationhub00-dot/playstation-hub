// Run: node scripts/test-account-coming-soon-link.js
//
// Add Account's linked-game list must include Coming soon titles. Saving that
// link shows the title on Accounts & slots and groups the account under
// Coming soon. The same number as a released game's id must not attach the
// released game, because the two lists number themselves separately.
//
// Throwaway only: temp DATA_DIR, no Mongo, in-memory sessions, a made-up
// admin password, and made-up titles. No real customer data.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 47394;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'account-coming-soon-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const price = { nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 };

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  games: [Object.assign({ id: 15, title: 'Zzyzx Released', platform: 'PS5' }, price)],
  upcoming: [Object.assign({
    id: 15, title: 'Zzyzx Auto VI', platform: 'PS5', release_date: '2026-11-19',
    cover_image: '', non_trophy_slots: 2, trophy_slots: 2
  }, price)],
  nextId: 16,
  nextUpcomingId: 16,
  customers: [],
  accounts: [],
  nextAccountId: 1
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.SESSION_SECRET = 'account-coming-soon-test';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method,
      headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, headers),
      timeout: 20000
    }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
const ledger = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

(async () => {
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
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  const login = await call('POST', '/admin/login', {
    headers: FORM,
    body: new URLSearchParams({ password: TEST_PASSWORD }).toString()
  });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in');
  const auth = extra => Object.assign({ Cookie: cookie }, extra || {});

  function accountBody(fields, gameIds) {
    const params = new URLSearchParams(fields);
    (gameIds || []).forEach(id => params.append('game_ids', id));
    return params.toString();
  }
  async function post(p, fields, gameIds) {
    const r = await call('POST', p, { headers: auth(FORM), body: accountBody(fields, gameIds) });
    assert.strictEqual(r.status, 302, r.body.slice(0, 300));
    return r.headers.location || '';
  }

  try {
    console.log('\nComing soon games in Add Account');
    let html = '';
    await ok('the link list includes the coming soon game and still lists released games', async () => {
      const r = await call('GET', '/admin?tab=accounts', { headers: auth() });
      assert.strictEqual(r.status, 200, r.body.slice(0, 400));
      html = r.body;
      assert.ok(html.includes('name="game_ids" value="upcoming_15"'), 'coming soon checkbox');
      assert.ok(html.includes('data-title="Zzyzx Auto VI"'), 'coming soon title');
      assert.ok(html.includes('name="game_ids" value="15"'), 'released game stays listed');
      assert.ok(html.includes('Coming soon'), 'picker labels the group');
    });

    await ok('saving that checkbox links the coming soon game and not the released game with the same id', async () => {
      const loc = await post('/admin/accounts/add', {
        label: 'Zzyzx Auto 5',
        games_text: '',
        note: '',
        email: '',
        price_permanent_tr: '5000',
        price_permanent_nt: '4500',
        enable_trophy: 'on',
        enable_non_trophy: 'on'
      }, ['upcoming_15']);
      assert.ok(/msg=account_added/.test(loc), loc);
      const acc = ledger().accounts.find(a => a.label === 'Zzyzx Auto 5');
      assert.ok(acc, 'account saved');
      assert.deepStrictEqual(acc.upcoming_ids, [15]);
      assert.deepStrictEqual(acc.game_ids, []);
      const page = await call('GET', '/admin?tab=accounts', { headers: auth() });
      assert.strictEqual(page.status, 200);
      assert.ok(page.body.includes('Coming soon <span class="acc-group-count">(1)</span>'), 'grouped under Coming soon');
      assert.ok(!page.body.includes('Uncategorized <span class="acc-group-count">'), 'the account is not left Uncategorized');
      assert.ok(page.body.includes('Zzyzx Auto VI'), 'title on the account');
      assert.ok(page.body.includes('data-game-ids="upcoming_15"'), 'game filter can see the link');
      const data = JSON.parse(page.body.match(/<script type="application\/json" id="accData">([\s\S]*?)<\/script>/)[1]);
      assert.ok(data.accounts[String(acc.id)].game_ids.map(String).includes('upcoming_15'), 'edit modal can re-check it');
    });

    await ok('editing the account can keep the coming soon game and add a released one', async () => {
      const id = ledger().accounts.find(a => a.label === 'Zzyzx Auto 5').id;
      const loc = await post('/admin/accounts/edit/' + id, {
        label: 'Zzyzx Auto 5',
        games_text: '',
        note: '',
        email: '',
        email_keep: '0',
        public_name: '',
        psplus_expires: '',
        price_permanent_tr: '5000',
        price_permanent_nt: '4500',
        enable_trophy: 'on',
        enable_non_trophy: 'on'
      }, ['15', 'upcoming_15']);
      assert.ok(/msg=account_updated/.test(loc), loc);
      const acc = ledger().accounts.find(a => a.id === id);
      assert.deepStrictEqual(acc.game_ids, [15]);
      assert.deepStrictEqual(acc.upcoming_ids, [15]);
    });

    await ok('deleting the coming soon game drops the link and leaves the released game', async () => {
      const loc = await post('/admin/upcoming/delete/15', {});
      assert.ok(/msg=upcoming_deleted/.test(loc), loc);
      const acc = ledger().accounts.find(a => a.label === 'Zzyzx Auto 5');
      assert.deepStrictEqual(acc.upcoming_ids, []);
      assert.deepStrictEqual(acc.game_ids, [15]);
    });

    console.log('\n' + passed + ' assertions passed\n');
  } catch (e) {
    console.error(e);
    cleanup();
    process.exit(1);
  }
  cleanup();
  process.exit(0);
})();
