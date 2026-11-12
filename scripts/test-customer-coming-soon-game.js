// Run: node scripts/test-customer-coming-soon-game.js
//
// Edit Customer → Game Rented is a searchable list. Coming soon titles used
// to be in that list only while Status was Reservation, so a Bought or
// Renting customer could not pick one (the search said "No matches").
// Bought permanent access and a rental must be able to pick one too.
//
// Saving that pick stores upcoming_<id>, never the released game that happens
// to use the same number. The account slot picked on the form is the slot
// the Accounts dashboard shows as taken, and the Coming soon page counts
// that slot as taken. Stored slot totals stay what the owner configured.
// Add Customer (/admin/customers/add) follows the same rules.
//
// Throwaway only: a temp DATA_DIR, no Mongo, an in-memory session store,
// a made-up admin password, and made-up names. No real customer data.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');

const PORT = 47421;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'customer-coming-soon-game-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const off = { enabled: false, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };
const open = { enabled: true, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };
const price = { nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 };

function account(id, label) {
  return {
    id, label, games_text: '', game_ids: [], upcoming_ids: [15], email: '',
    slots: {
      trophy: Object.assign({}, open),
      non_trophy: Object.assign({}, open),
      ps4_primary: Object.assign({}, off)
    }
  };
}

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  games: [
    Object.assign({ id: 6, title: 'Zzyzx Racer', platform: 'PS5', trophy_slots: 1, non_trophy_slots: 1, available_slots: 2 }, price),
    Object.assign({ id: 8, title: 'Zzyzx Catalogue', platform: 'PS5', trophy_slots: 3, non_trophy_slots: 3, available_slots: 6 }, price),
    Object.assign({ id: 15, title: 'Zzyzx Released', platform: 'PS5', trophy_slots: 2, non_trophy_slots: 2, available_slots: 4 }, price)
  ],
  upcoming: [Object.assign({
    id: 15, title: 'Zzyzx Auto VI', platform: 'PS5', release_date: '2026-11-19',
    non_trophy_slots: 2, trophy_slots: 2
  }, price)],
  customers: [
    {
      id: 40, customer_name: 'Zzyzx Buyer', game_id: '', game_title: '',
      days: 0, account_type: 'tr', start_date: '', end_date: '', price: 2500,
      status: 'bought', notes: 'sample permanent access',
      created_at: '2026-11-01T00:00:00.000Z', payments: []
    },
    {
      id: 41, customer_name: 'Zzyzx Holder', game_id: 6, game_title: 'Zzyzx Racer',
      days: 30, account_type: 'tr', start_date: '2026-11-01', end_date: '2026-12-01', price: 799,
      status: 'renting', notes: '',
      created_at: '2026-11-01T00:00:00.000Z', payments: []
    }
  ],
  nextCustomerId: 50,
  accounts: [account(2, 'Zzyzx Auto 2'), account(3, 'Zzyzx Auto 3'), account(4, 'Zzyzx Auto 4')],
  nextAccountId: 5,
  nextId: 16,
  nextUpcomingId: 16
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.SESSION_SECRET = 'customer-coming-soon-game-test';
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
const form = o => new URLSearchParams(o).toString();
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
const ledger = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const slotOf = (accountId, type) => ledger().accounts.find(a => a.id === accountId).slots[type || 'trophy'];
const customer = id => ledger().customers.find(c => c.id === id);
const gameRow = id => ledger().games.find(g => g.id === id);
const upcomingRow = () => ledger().upcoming.find(g => g.id === 15);

// Same rule as public/js/admin-searchable-select.js: a group with
// display:none is not searched, which is why the field says "No matches".
function gameSelect(html) {
  const m = html.match(/<select[^>]*id="cust_game"[^>]*>[\s\S]*?<\/select>/);
  assert.ok(m, 'Game Rented select missing');
  return m[0];
}
function groups(selectHtml) {
  const out = [];
  const re = /<optgroup([^>]*)>([\s\S]*?)<\/optgroup>/g;
  let m;
  while ((m = re.exec(selectHtml))) {
    const options = [];
    const ore = /<option([^>]*)>([\s\S]*?)<\/option>/g;
    let o;
    while ((o = ore.exec(m[2]))) {
      const value = (o[1].match(/value="([^"]*)"/) || [])[1] || '';
      options.push({ value, text: o[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), selected: /\bselected\b/.test(o[1]) });
    }
    out.push({
      hidden: /display\s*:\s*none/i.test(m[1]),
      label: (m[1].match(/label="([^"]*)"/) || [])[1] || '',
      id: (m[1].match(/id="([^"]*)"/) || [])[1] || '',
      options
    });
  }
  return out;
}
function searchGames(html, query) {
  const q = String(query || '').trim().toLowerCase();
  const hits = [];
  groups(gameSelect(html)).forEach(g => {
    if (g.hidden) return;
    g.options.forEach(o => {
      if (!q || o.text.toLowerCase().includes(q)) hits.push(o);
    });
  });
  return hits;
}
function chip(html, accountId, type) {
  const re = new RegExp('<button[^>]*class="acc-chip[^"]*"[^>]*data-acc-slot="' + accountId + ':' + type + '"[^>]*>[\\s\\S]*?<\\/button>');
  const m = html.match(re);
  assert.ok(m, 'missing accounts chip ' + accountId + ':' + type);
  return m[0];
}
function trophyCard(html) {
  const m = html.match(/id="typeCard-tr"[\s\S]*?<\/label>/);
  assert.ok(m, 'upcoming page trophy card missing');
  return m[0];
}

// The status dropdown runs this function from the edit page. Stub only the
// elements it touches, then call the function the page actually shipped.
function statusToggle(html) {
  const m = /<script>\s*(const CUST_ORIGINAL_GAME_ID[\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'edit page script missing');
  const els = {};
  const mk = (id, extra) => (els[id] = Object.assign({
    id, value: '', hidden: false, textContent: '', innerHTML: '', readOnly: false,
    style: {}, dataset: {},
    setAttribute(name) { if (name === 'hidden') this.hidden = true; },
    removeAttribute(name) { if (name === 'hidden') this.hidden = false; },
    focus() {}
  }, extra || {}));
  mk('cust_custom_days');
  mk('cust_days_group');
  mk('cust_game_label', { textContent: 'Game Rented *' });
  mk('cust_optgroup_regular', { style: { display: 'none' } });
  mk('cust_optgroup_upcoming', { style: { display: '' } });
  mk('cust_game', {
    value: 'upcoming_15',
    options: [{ value: 'upcoming_15', textContent: 'Zzyzx Auto VI', dataset: {} }],
    get selectedIndex() { return 0; }
  });
  mk('cust_price', { value: '2500' });
  mk('cust_swap_charge', { value: '0' });
  mk('cust_swap_panel', { hidden: true });
  mk('cust_status', { value: 'reservation' });
  mk('cust_type', { value: 'tr' });
  mk('cust_days', { value: '30' });
  mk('cust_start', { value: '' });
  mk('cust_end');
  mk('cust_swap_from');
  mk('cust_swap_to');
  mk('cust_swap_result');
  const ctx = vm.createContext({ console, document: { getElementById: id => els[id] || null } });
  vm.runInContext(m[1], ctx);
  return {
    els,
    setStatus(status) { vm.runInContext('toggleCustStatus(' + JSON.stringify(status) + ')', ctx); }
  };
}

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

  const login = await call('POST', '/admin/login', { headers: FORM, body: form({ password: TEST_PASSWORD }) });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'logged in');
  const auth = extra => Object.assign({ Cookie: cookie }, extra || {});

  async function post(p, fields) {
    const r = await call('POST', p, { headers: auth(FORM), body: form(fields) });
    assert.strictEqual(r.status, 302, r.body.slice(0, 300));
    return r.headers.location || '';
  }
  async function editHtml(id) {
    const r = await call('GET', '/admin/customers/edit/' + id, { headers: auth() });
    assert.strictEqual(r.status, 200, r.body.slice(0, 400));
    return r.body;
  }
  async function accountsHtml() {
    const r = await call('GET', '/admin?tab=accounts', { headers: auth() });
    assert.strictEqual(r.status, 200, r.body.slice(0, 400));
    return r.body;
  }
  async function upcomingHtml() {
    const r = await call('GET', '/upcoming/zzyzx-auto-vi-15');
    assert.strictEqual(r.status, 200, r.body.slice(0, 300));
    return r.body;
  }
  function boughtFields(patch) {
    return Object.assign({
      customer_name: 'Zzyzx Buyer', game_id: 'upcoming_15', days: '30', account_type: 'tr',
      status: 'bought', start_date: '', end_date: '', price: '2500',
      notes: 'sample permanent access', account_assign: '2:trophy'
    }, patch);
  }
  function availability() {
    const released = gameRow(15);
    const soon = upcomingRow();
    return {
      releasedTrophy: released.trophy_slots,
      releasedNt: released.non_trophy_slots,
      releasedAvailable: released.available_slots,
      soonTrophy: soon.trophy_slots,
      soonNt: soon.non_trophy_slots
    };
  }

  try {
    const before = availability();
    const soonBefore = trophyCard(await upcomingHtml());
    assert.ok(soonBefore.includes('2 slots left'), soonBefore);
    assert.ok(soonBefore.includes('Available'), soonBefore);
    const releasedBeforeRes = await call('GET', '/game/zzyzx-released');
    assert.strictEqual(releasedBeforeRes.status, 200, releasedBeforeRes.body.slice(0, 200));
    const releasedCard = html => {
      const m = html.match(/id="label-tr"[\s\S]*?<\/label>/);
      assert.ok(m, 'released game trophy card missing');
      return m[0];
    };
    const releasedBefore = releasedCard(releasedBeforeRes.body);

    console.log('\nEdit Customer — Game Rented can find a Coming soon title');
    let boughtPage = '';
    await ok('a Bought customer can search a Coming soon title without hitting the released game that shares its number', async () => {
      boughtPage = await editHtml(40);
      const hits = searchGames(boughtPage, 'auto');
      assert.ok(hits.length, 'typing the Coming soon title shows No matches');
      assert.strictEqual(hits.length, 1);
      assert.strictEqual(hits[0].value, 'upcoming_15');
      assert.ok(hits[0].text.includes('Zzyzx Auto VI'), hits[0].text);
      assert.ok(!hits.some(h => h.value === '15'), 'the released game with id 15 matched the search');
      const releasedHits = searchGames(boughtPage, 'released');
      assert.ok(releasedHits.some(h => h.value === '15' && h.text.includes('Zzyzx Released')), 'released games stay selectable');
      const upcoming = groups(gameSelect(boughtPage)).find(g => g.id === 'cust_optgroup_upcoming');
      assert.ok(upcoming && !upcoming.hidden, 'Coming soon group is hidden for Bought');
    });

    await ok('a Renting customer can search that same Coming soon title', async () => {
      const page = await editHtml(41);
      const hits = searchGames(page, 'auto');
      assert.ok(hits.length, 'typing the Coming soon title shows No matches');
      assert.strictEqual(hits[0].value, 'upcoming_15');
      const racer = searchGames(page, 'racer');
      assert.ok(racer.some(h => h.value === '6'), 'the released game they already have stays listed');
    });

    await ok('changing Status to Bought or Renting keeps a Coming soon game that was already picked', async () => {
      const ui = statusToggle(boughtPage);
      ui.setStatus('bought');
      assert.strictEqual(ui.els.cust_game.value, 'upcoming_15');
      assert.notStrictEqual(ui.els.cust_optgroup_upcoming.style.display, 'none');
      ui.setStatus('renting');
      assert.strictEqual(ui.els.cust_game.value, 'upcoming_15');
      assert.notStrictEqual(ui.els.cust_optgroup_upcoming.style.display, 'none');
      assert.strictEqual(ui.els.cust_optgroup_regular.style.display, '');
    });

    await ok('Done still drops a Coming soon pick, and Reservation still shows only Coming soon titles', async () => {
      const ui = statusToggle(boughtPage);
      ui.setStatus('done');
      assert.strictEqual(ui.els.cust_game.value, '');
      assert.strictEqual(ui.els.cust_optgroup_upcoming.style.display, 'none');
      ui.els.cust_game.value = '6';
      ui.setStatus('reservation');
      assert.strictEqual(ui.els.cust_game.value, '');
      assert.strictEqual(ui.els.cust_optgroup_regular.style.display, 'none');
      assert.notStrictEqual(ui.els.cust_optgroup_upcoming.style.display, 'none');
    });

    console.log('\nSaving a Bought Coming soon game');
    await ok('the customer points at the Coming soon game, and the Trophy slot shows Bought by them', async () => {
      const loc = await post('/admin/customers/edit/40', boughtFields());
      assert.ok(/msg=customer_updated/.test(loc), loc);
      const saved = customer(40);
      assert.strictEqual(saved.game_id, 'upcoming_15');
      assert.notStrictEqual(saved.game_id, 15);
      assert.notStrictEqual(saved.game_id, '15');
      assert.strictEqual(saved.game_title, 'Zzyzx Auto VI');
      assert.strictEqual(saved.status, 'bought');
      assert.strictEqual(saved.customer_name, 'Zzyzx Buyer');
      assert.strictEqual(saved.price, 2500);
      const trophy = slotOf(2);
      assert.strictEqual(trophy.status, 'buyed', 'slot stayed ' + trophy.status);
      assert.strictEqual(trophy.renter_id, 40);
      assert.strictEqual(trophy.renter_name, 'Zzyzx Buyer');
      assert.strictEqual(trophy.end, '');
      assert.strictEqual(slotOf(2, 'non_trophy').status, 'open');
      const acc = ledger().accounts.find(a => a.id === 2);
      assert.deepStrictEqual(acc.game_ids, []);
      assert.deepStrictEqual(acc.upcoming_ids, [15]);
      const html = await accountsHtml();
      const taken = chip(html, 2, 'trophy');
      assert.ok(taken.includes('data-status="buyed"'), taken);
      assert.ok(taken.includes('BOUGHT'), taken);
      assert.ok(taken.includes('Zzyzx Buyer'), taken);
      assert.ok(html.includes('<span class="acc-s-renter">Zzyzx Buyer</span>'), 'slots list names them');
      assert.ok(html.includes('data-game-ids="upcoming_15"'));
      assert.ok(!html.includes('data-game-ids="15"'), 'the account was linked to the released game');
    });

    await ok('saving again keeps that game and that slot', async () => {
      const loc = await post('/admin/customers/edit/40', boughtFields({ notes: 'sample permanent access kept' }));
      assert.ok(/msg=customer_updated/.test(loc), loc);
      const saved = customer(40);
      assert.strictEqual(saved.game_id, 'upcoming_15');
      assert.strictEqual(saved.game_title, 'Zzyzx Auto VI');
      assert.strictEqual(saved.notes, 'sample permanent access kept');
      assert.strictEqual(slotOf(2).status, 'buyed');
      assert.strictEqual(slotOf(2).renter_id, 40);
      const again = await editHtml(40);
      const picked = groups(gameSelect(again)).find(g => g.id === 'cust_optgroup_upcoming');
      assert.ok(picked && !picked.hidden);
      assert.ok(picked.options.some(o => o.value === 'upcoming_15' && o.selected), 'the Coming soon game stays selected');
    });

    console.log('\nSaving a Renting Coming soon game');
    await ok('a rental can move onto the Coming soon game without taking the released game that shares its id', async () => {
      const loc = await post('/admin/customers/edit/41', {
        customer_name: 'Zzyzx Holder', game_id: 'upcoming_15', days: '30', account_type: 'tr',
        status: 'renting', start_date: '2026-11-01', end_date: '2026-12-01', price: '799',
        notes: '', account_assign: '4:trophy'
      });
      assert.ok(/msg=customer_updated/.test(loc), loc);
      const saved = customer(41);
      assert.strictEqual(saved.game_id, 'upcoming_15');
      assert.strictEqual(saved.game_title, 'Zzyzx Auto VI');
      assert.strictEqual(saved.status, 'renting');
      const trophy = slotOf(4);
      assert.strictEqual(trophy.status, 'rented');
      assert.strictEqual(trophy.renter_id, 41);
      assert.strictEqual(trophy.renter_name, 'Zzyzx Holder');
      const left = gameRow(6);
      assert.strictEqual(left.trophy_slots, 2, 'leaving Zzyzx Racer gives its Trophy slot back');
      assert.strictEqual(left.available_slots, 3);
      const html = await accountsHtml();
      const taken = chip(html, 4, 'trophy');
      assert.ok(taken.includes('data-status="rented"') && taken.includes('Zzyzx Holder'), taken);
    });

    await ok('the Coming soon page counts the Trophy slots that are taken, and the released game with the same id was not attached', async () => {
      assert.deepStrictEqual(availability(), before);
      const soonAfter = trophyCard(await upcomingHtml());
      assert.ok(soonAfter.includes('1 slot left'), soonAfter);
      assert.ok(!soonAfter.includes('2 slots left'), soonAfter);
      assert.notStrictEqual(soonAfter, soonBefore);
      const releasedPage = await call('GET', '/game/zzyzx-released');
      assert.strictEqual(releasedPage.status, 200, releasedPage.body.slice(0, 200));
      assert.strictEqual(releasedCard(releasedPage.body), releasedBefore);
    });

    console.log('\nAdd Customer');
    await ok('the Quick Add picker already lists the Coming soon game for a new customer', async () => {
      const r = await call('GET', '/admin?tab=customers', { headers: auth() });
      assert.strictEqual(r.status, 200, r.body.slice(0, 300));
      const select = r.body.match(/<select[^>]*id="qaGame"[^>]*>[\s\S]*?<\/select>/);
      assert.ok(select, 'Quick Add game picker missing');
      assert.ok(!/display\s*:\s*none/i.test((select[0].match(/<optgroup[^>]*>/) || [''])[0]), 'Coming soon group hidden on Add');
      assert.ok(select[0].includes('value="upcoming_15"'), 'Coming soon option missing');
      assert.ok(select[0].includes('Zzyzx Auto VI'));
      assert.ok(select[0].includes('value="15"'), 'released game stays listed beside it');
    });

    await ok('adding a Bought customer onto a Coming soon game takes the slot and leaves the stored totals alone', async () => {
      const loc = await post('/admin/customers/add', {
        customer_name: 'Zzyzx Added', game_id: 'upcoming_15', days: '30', account_type: 'tr',
        status: 'bought', start_date: '', end_date: '', price: '2500',
        notes: 'sample permanent access', account_assign: '3:trophy'
      });
      assert.ok(/msg=customer_added/.test(loc), loc);
      const saved = ledger().customers.find(c => c.customer_name === 'Zzyzx Added');
      assert.ok(saved, 'customer row missing');
      assert.strictEqual(saved.game_id, 'upcoming_15');
      assert.strictEqual(saved.game_title, 'Zzyzx Auto VI');
      assert.strictEqual(saved.status, 'bought');
      const trophy = slotOf(3);
      assert.strictEqual(trophy.status, 'buyed');
      assert.strictEqual(trophy.renter_id, saved.id);
      assert.strictEqual(trophy.renter_name, 'Zzyzx Added');
      const acc = ledger().accounts.find(a => a.id === 3);
      assert.deepStrictEqual(acc.game_ids, []);
      assert.deepStrictEqual(acc.upcoming_ids, [15]);
      assert.deepStrictEqual(availability(), before);
      const html = await accountsHtml();
      const taken = chip(html, 3, 'trophy');
      assert.ok(taken.includes('BOUGHT') && taken.includes('Zzyzx Added'), taken);
    });

    await ok('adding a rental of a released game still stores that game as a number', async () => {
      const loc = await post('/admin/customers/add', {
        customer_name: 'Zzyzx Catalogue Buyer', game_id: '8', days: '30', account_type: 'tr',
        status: 'bought', start_date: '', end_date: '', price: '800', notes: '', account_assign: ''
      });
      assert.ok(/msg=customer_added/.test(loc), loc);
      const saved = ledger().customers.find(c => c.customer_name === 'Zzyzx Catalogue Buyer');
      assert.strictEqual(saved.game_id, 8);
      assert.strictEqual(saved.game_title, 'Zzyzx Catalogue');
      assert.strictEqual(gameRow(8).trophy_slots, 2, 'a real released purchase still uses that game\'s slots');
      assert.deepStrictEqual(availability(), before, 'the overlapping id was left alone');
    });

    console.log('\nLater release still finds these customers');
    await ok('a Bought or Renting Coming soon row is the same id the release flow re-points', async () => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
      const start = src.indexOf('repointUpcomingCustomers:');
      const end = src.indexOf('removeUpcoming:', start);
      assert.ok(start > 0 && end > start, 'release route still re-points customers');
      const block = src.slice(start, end);
      assert.ok(block.includes("const key = 'upcoming_' + upcomingId"), block);
      assert.ok(block.includes('String(c.game_id) === key'), block);
      assert.ok(!/\.status/.test(block), 'release only moves Reservation rows');
      const key = 'upcoming_15';
      const rows = ledger().customers.filter(c => String(c.game_id) === key);
      assert.ok(rows.some(c => c.status === 'bought' && c.game_title === 'Zzyzx Auto VI'));
      assert.ok(rows.some(c => c.status === 'renting' && c.game_title === 'Zzyzx Auto VI'));
      assert.ok(!rows.some(c => c.game_id === 15 || c.game_id === '15'));
    });

    await ok('a Reservation on top of taken Trophy slots does not put one back on sale', async () => {
      const loc = await post('/admin/customers/add', {
        customer_name: 'Zzyzx Reserve', game_id: 'upcoming_15', days: '30', account_type: 'tr',
        status: 'reservation', start_date: '', end_date: '', price: '999',
        notes: 'sample reservation', account_assign: ''
      });
      assert.ok(/msg=customer_added/.test(loc), loc);
      const saved = ledger().customers.find(c => c.customer_name === 'Zzyzx Reserve');
      assert.strictEqual(saved.game_id, 'upcoming_15');
      assert.strictEqual(saved.status, 'reservation');
      assert.deepStrictEqual(availability(), before, 'stored slot totals stay what the owner configured');
      const soon = trophyCard(await upcomingHtml());
      assert.ok(soon.includes('Full Slot'), soon);
      assert.ok(!/slot left/.test(soon), soon);
      assert.strictEqual(slotOf(2).renter_id, 40, 'the Bought slot was not freed');
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
