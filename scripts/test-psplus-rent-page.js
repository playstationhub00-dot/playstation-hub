// Run: node scripts/test-psplus-rent-page.js
//
// The PS Plus Deluxe rent page (/ps-plus/rent) is laid out like a game page:
// the same hero, booking card, type pills, setup guide, Messenger-first button,
// "Or order here on the website" fold and phone sticky bar, run by the game
// page's own script. What stays its own: the checkout (/order/create-psplus),
// its prices and its waiting line (game_id 'psplus'). Like a game page, its
// slots come from the accounts linked to the PS Plus row, and Trophy,
// Non-Trophy and PS4 Primary are three separate types.
//  1. Starts four throwaway servers (temp DATA_DIR, blank MONGODB_URI, made-up
//     games): slots open, one slot left, sold out, and five linked accounts
//     whose real slots disagree with the row's old hand-entered counts. Checks
//     the markup.
//  2. Runs the real public/js/game-detail.js in a vm with the globals the
//     rendered page defines, and checks the message preview and order button.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const psplusPrices = { nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799 };
const gamePrice = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };

// A local YYYY-MM-DD `n` days from today, and the "days until" the site works
// out for it (lib/availability.js daysUntil).
function localDate(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function daysUntil(s) { return Math.max(0, Math.ceil((new Date(s + 'T23:59:59') - new Date()) / 86400000)); }
const trEnd = localDate(5);

function fixture(nt, tr, accounts) {
  return {
    site_settings: { promo: { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100 } },
    games: [
      Object.assign({ id: 4, title: 'PS Plus Deluxe', platform: 'PS4/PS5', genre: '', cover_image: '', renters: 9, non_trophy_slots: nt, trophy_slots: tr }, gamePrice),
      Object.assign({ id: 5, title: 'Zzyzx Racer', platform: 'PS5', genre: 'Racing', cover_image: '', renters: 2, non_trophy_slots: 1, trophy_slots: 1 }, gamePrice)
    ],
    psplus_prices: psplusPrices,
    accounts: accounts || []
  };
}
// The one-slot-left case links an account whose Trophy slot is rented until
// trEnd, so the full Trophy pill can say when it frees up.
const rentedTrophy = [{
  id: 1, label: 'Zzyzx PS Plus account', game_ids: [4],
  slots: {
    trophy: { enabled: true, status: 'rented', renter_id: null, renter_name: 'Zzyzx Renter', start: localDate(-25), end: trEnd },
    non_trophy: { enabled: false, status: 'open', renter_id: null, renter_name: '', start: '', end: '' },
    ps4_primary: { enabled: false, status: 'open', renter_id: null, renter_name: '', start: '', end: '' }
  }
}];
// Five linked accounts, the way the owner's Accounts tab showed them: one in
// maintenance, Trophy and Non-Trophy rented on all the others, PS4 Primary open
// on two. The row still carries old hand-entered counts (6 Non-Trophy, 3
// Trophy) that must not show.
const slot = (status, end) => ({ enabled: true, status, renter_id: null, renter_name: status === 'rented' ? 'Zzyzx Renter' : '', start: '', end: end || '' });
const account = (id, tr, nt, ps4) => ({ id, label: 'Zzyzx PS Plus ' + id, game_ids: [4], slots: { trophy: tr, non_trophy: nt, ps4_primary: ps4 } });
const fiveAccounts = [
  account(1, slot('maintenance'), slot('maintenance'), slot('maintenance')),
  account(2, slot('rented', localDate(9)), slot('rented', localDate(22)), slot('open')),
  account(3, slot('rented', localDate(30)), slot('rented', localDate(30)), slot('rented', localDate(18))),
  account(4, slot('rented', localDate(26)), slot('rented', localDate(11)), slot('rented', localDate(15))),
  account(5, slot('rented', localDate(30)), slot('rented', localDate(29)), slot('open'))
];
const SERVERS = {
  open: { port: 4661, data: fixture(1, 1) },
  last: { port: 4662, data: fixture(1, 0, rentedTrophy) },
  sold: { port: 4663, data: fixture(0, 0) },
  accounts: { port: 4664, data: fixture(6, 3, fiveAccounts) }
};

const children = [];
const dirs = [];
function cleanup() {
  children.forEach(c => { try { c.kill(); } catch (e) { /* already gone */ } });
  dirs.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } });
}

function get(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port, path: p, timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone) Safari' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
  });
}

async function start(name) {
  const s = SERVERS[name];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psplus-rent-page-' + name + '-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'games.json'), JSON.stringify(s.data));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(s.port), DATA_DIR: dir, MONGODB_URI: '' }),
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let err = '';
  child.stderr.on('data', c => { err += c; });
  children.push(child);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { await get(s.port, '/ps-plus/rent'); return; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  throw new Error(name + ' server did not come up within 20s:\n' + err);
}

let passed = 0;
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

// ── the real game-detail.js in a vm, with the page's own inline globals ──
function inlineScript(html, marker) {
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) if (m[1].includes(marker)) return m[1];
  throw new Error('no inline script with ' + marker);
}
function loadPage(html) {
  const els = {};
  const mk = id => (els[id] = {
    id, href: '', textContent: '', innerHTML: '', hidden: false, value: '', disabled: false,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(k, v) { this.attrs = Object.assign(this.attrs || {}, { [k]: v }); },
    scrollIntoView() {}, focus() {}, click() {}
  });
  ['ctaMsgPrimary', 'ctaMsgMain', 'ctaMsgSub', 'ctaMsgPreview', 'ctaMsgWrap', 'gdOrderBlock', 'orderToggle',
    'gdSbKicker', 'gdSbAmount', 'gdSbBtn', 'ctaBtn', 'ctaSub', 'reserveSection', 'gdOrderForm', 'totalBox',
    'totalRows', 'totalFinal', 'totalRefund', 'totalHint', 'orderType', 'orderDays', 'phAmount', 'phKicker',
    'phRider', 'phWas', 'phSave', 'price-7', 'price-30', 'lineCard', 'lineAsk', 'lineSoon', 'resType', 'resDays'].forEach(mk);
  const amount = html.match(/id="phAmount" data-default-amount="(\d+)"/);
  els.phAmount.dataset = { defaultAmount: amount ? amount[1] : '0', defaultBuyAmount: '0' };
  els.phKicker.dataset = { defaultKicker: 'From' };
  const ctx = {
    console, window: { addEventListener() {}, location: { search: '' } },
    document: { getElementById: id => els[id] || null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    PHMessengerText: require('../public/js/messenger-text.js')
  };
  vm.createContext(ctx);
  vm.runInContext(inlineScript(html, 'const RENTAL_DURATIONS'), ctx);
  vm.runInContext(inlineScript(html, 'const PRICES'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'game-detail.js'), 'utf8'), ctx);
  const dur = d => ({ dataset: { days: String(d) }, classList: { add() {}, remove() {} } });
  return { els, run: code => vm.runInContext(code, ctx), pick: (type, days) => {
    vm.runInContext('onTypeChange({ value: ' + JSON.stringify(type) + ' })', ctx);
    if (days) { ctx.__dur = dur(days); vm.runInContext('onDurChange(__dur)', ctx); }
  } };
}

async function main() {
  await Promise.all(Object.keys(SERVERS).map(start));
  const open = await get(SERVERS.open.port, '/ps-plus/rent');
  const last = await get(SERVERS.last.port, '/ps-plus/rent');
  const sold = await get(SERVERS.sold.port, '/ps-plus/rent');
  const accts = await get(SERVERS.accounts.port, '/ps-plus/rent');

  console.log('\nrendered page, slots open');
  await okAsync('the game page hero: status badge, chips, title and slot bar', async () => {
    assert.strictEqual(open.status, 200);
    assert.ok(open.body.includes('<body class="gd-page-booking-v2">'));
    assert.ok(open.body.includes('/css/game-psn.css?v='));
    assert.ok(open.body.includes('<div class="usd-hero gdh-hero">'));
    assert.ok(open.body.includes('<span class="usd-badge usd-badge-ok">Available</span>'));
    ['SUBSCRIPTION', 'DELUXE', 'PS4/PS5'].forEach(c => assert.ok(open.body.includes('<span class="usd-plat-chip">' + c + '</span>'), c));
    assert.ok(open.body.includes('<h1 class="usd-title">PS Plus Deluxe</h1>'));
    assert.ok(open.body.includes('<div class="gdh-bar-text">2 slots available</div>'));
  });
  await okAsync('the left column: About this subscription and an Info table that links to the catalogue', async () => {
    assert.ok(open.body.includes('<section class="gpa" id="gpAbout">'));
    assert.ok(open.body.includes('<h2 class="gpa-h">About this subscription</h2>'));
    assert.ok(open.body.includes('Access hundreds of games including monthly titles. Trophy, Non-Trophy or PS4 Primary — your choice.'));
    assert.ok(open.body.includes('<table class="gpa-info">'));
    assert.ok(open.body.includes('<tr><td>Platform</td><td>PS4 / PS5</td></tr>'));
    assert.ok(open.body.includes('<tr><td>Game swaps</td><td>Unlimited · 2-day cooldown</td></tr>'));
    assert.ok(open.body.includes('<tr><td>Catalogue</td><td><a href="/ps-plus">See all games →</a></td></tr>'));
  });
  await okAsync('the booking card: rent only, no Rent / Buy toggle or buy panel, "From" the cheapest weekly', async () => {
    assert.ok(open.body.includes('<div class="gdh-card">'));
    assert.ok(open.body.includes('<div id="rentPanel">'));
    assert.ok(!open.body.includes('id="toggleRent"') && !open.body.includes('id="toggleBuy"') && !open.body.includes('id="buyPanel"'));
    assert.ok(open.body.includes('<span id="phAmount" data-default-amount="349" data-default-buy-amount="0">₱349</span>'));
  });
  await okAsync('three pills — Trophy, Non-Trophy, PS4 Primary — with hidden radios and their slots left', async () => {
    assert.strictEqual((open.body.match(/<label class="gd-type-card gd-type-pill" id="label-(tr|nt|ps4)">/g) || []).length, 3);
    assert.strictEqual((open.body.match(/<input type="radio" name="rentalType" value="(tr|nt|ps4)" class="gd-type-radio" onchange="onTypeChange\(this\)">/g) || []).length, 3);
    assert.ok(open.body.includes('<span class="gd-type-name">Trophy</span>'));
    assert.ok(open.body.includes('<span class="gd-type-name">Non-Trophy</span>'));
    assert.ok(open.body.includes('<span class="gd-type-name">PS4 Primary</span>'));
    assert.ok(!open.body.includes('Trophy / PS4 Primary'), 'PS4 Primary is no longer folded into Trophy');
    assert.strictEqual((open.body.match(/<span class="gd-slots-left">1 slot left<\/span>/g) || []).length, 2);
    assert.ok(/id="label-ps4">[\s\S]*?<span class="gd-type-status gd-status-rented">Full Slot<\/span>/.test(open.body), 'no PS4 Primary slot on this row');
    assert.ok(!open.body.includes('psr-types'));
  });
  await okAsync('How setup works, then the duration cards with PS Plus prices and the promo badge', async () => {
    assert.ok(open.body.includes('id="setupToggle"') && open.body.includes('id="setup-tr"') && open.body.includes('id="setup-nt"') && open.body.includes('id="setup-ps4"'));
    assert.ok(!open.body.includes('Includes PS4 Primary access.'));
    assert.ok(open.body.includes('Settings → Account Management → Activate as Your Primary PS4 → <strong>Activate</strong>'));
    assert.ok(open.body.includes('<span class="gd-dur-price" id="price-7">₱349</span>'));
    assert.ok(/<span class="gd-dur-price" id="price-30"><span class="gd-dur-price-orig">₱699<\/span> ₱629<\/span>/.test(open.body), 'monthly shows the 10% promo');
    assert.ok(open.body.includes('<span class="gd-dur-promo">10% OFF</span>'));
  });
  await okAsync('the Messenger button and its preview, then the website order folded away', async () => {
    assert.ok(open.body.includes('<a href="http://m.me/PlaystationHub00" target="_blank" rel="noopener" class="gd-msg-primary" id="ctaMsgPrimary" data-track-source="game">'));
    assert.ok(open.body.includes('💬 Message us about this game'));
    assert.ok(open.body.includes('YOUR MESSAGE WILL SAY') && open.body.includes('id="ctaMsgPreview"'));
    assert.ok(open.body.includes('id="orderToggle"') && open.body.includes('Or order here on the website'));
    assert.ok(/<div id="gdOrderBlock" hidden>/.test(open.body));
    assert.ok(open.body.includes('<form method="POST" action="/order/create-psplus" class="gd-order-form" id="gdOrderForm">'));
    assert.ok(open.body.includes('name="account_type" id="orderType"') && open.body.includes('name="days" id="orderDays"') && open.body.includes('name="fb_name" id="orderFbName"'));
    const form = open.body.slice(open.body.indexOf('id="gdOrderForm"'), open.body.indexOf('</form>', open.body.indexOf('id="gdOrderForm"')));
    assert.ok(!form.includes('name="game_id"'), 'no game id on the PS Plus checkout');
    assert.ok(!open.body.includes('or message us on Facebook instead') && !open.body.includes('id="ctaHint"'));
  });
  await okAsync('the per-type get-in-line card is ready for PS Plus, hidden until a full type is picked', async () => {
    assert.ok(open.body.includes('<div id="reserveSection" style="display:none;">'));
    assert.ok(open.body.includes('id="lineCard"'));
    assert.ok(open.body.includes('<input type="hidden" name="game_id" value="psplus">'));
  });
  await okAsync('the phone sticky bar, and the game page scripts in place of psplus-rent.js', async () => {
    assert.ok(open.body.includes('<div class="gd-sticky-bar" id="gdStickyBar">'));
    assert.ok(/<div class="gd-sb-amount" id="gdSbAmount">₱349<\/div>/.test(open.body));
    const a = open.body.indexOf('/js/messenger-text.js?v=');
    const b = open.body.indexOf('/js/game-detail.js?v=');
    assert.ok(a > 0 && b > a);
    assert.ok(!open.body.includes('/js/psplus-rent.js'));
    assert.ok(open.body.includes("const gameTitle = 'PS Plus Deluxe';"));
    assert.ok(open.body.includes('const AVAIL = { nt: true, tr: true, ps4: false };'));
  });

  console.log('\nrendered page, one slot left (Trophy full until ' + trEnd + ')');
  await okAsync('Last Slot badge, bar and banner', async () => {
    assert.strictEqual(last.status, 200);
    assert.ok(last.body.includes('<span class="usd-badge usd-badge-warn">Last Slot</span>'));
    assert.ok(last.body.includes('<div class="gdh-bar-text gdh-bar-urgent">Only 1 slot left</div>'));
    assert.ok(last.body.includes('🔥 Last Slot</div>'));
  });
  await okAsync('the full Trophy pill says Full Slot and when it frees up', async () => {
    const n = daysUntil(trEnd);
    assert.ok(/id="label-tr">[\s\S]*?<span class="gd-type-status gd-status-rented">Full Slot<\/span>/.test(last.body));
    assert.ok(last.body.includes('<span class="gd-avail-soon">🏆 Available in <strong>' + n + ' days</strong></span>'));
    assert.ok(last.body.includes('const NEXT_DAYS = {"tr":' + n + ',"nt":null,"ps4":null};'));
    assert.ok(last.body.includes('const AVAIL = { nt: true, tr: false, ps4: false };'));
  });

  console.log('\nrendered page, sold out');
  await okAsync('Sold Out badge and bar; one get-in-line card for PS Plus is the main action', async () => {
    assert.strictEqual(sold.status, 200);
    assert.ok(sold.body.includes('<span class="usd-badge usd-badge-off">Sold Out</span>'));
    assert.ok(sold.body.includes('<div class="gdh-bar-text gdh-bar-urgent">Sold out — all slots rented</div>'));
    assert.strictEqual((sold.body.match(/<span class="gd-type-status gd-status-rented">Full Slot<\/span>/g) || []).length, 3);
    assert.ok(/<div id="ctaMsgWrap" hidden>/.test(sold.body));
    assert.ok(!sold.body.includes('id="orderToggle"') && !sold.body.includes('id="gdOrderForm"'));
    assert.ok(sold.body.includes('<div id="reserveSectionAll">') && sold.body.includes('id="lineCardAll"'));
    assert.ok(sold.body.includes('<input type="hidden" name="game_id" value="psplus">'));
    assert.ok(/var HIDE_STRIP = true;/.test(sold.body));
    assert.ok(/id="gdSbBtn"[^>]*>💬 Ask us<\/button>/.test(sold.body));
  });

  console.log('\nrendered page, five linked accounts (old hand-entered counts: 6 Non-Trophy, 3 Trophy)');
  await okAsync('counts the accounts\' open slots, not the old counts: only PS4 Primary has any', async () => {
    assert.strictEqual(accts.status, 200);
    assert.ok(accts.body.includes('<div class="gdh-bar-text">2 slots available</div>'), 'two PS4 Primary slots are open');
    assert.ok(!accts.body.includes('9 slots available'));
    assert.ok(/id="label-tr">[\s\S]*?<span class="gd-type-status gd-status-rented">Full Slot<\/span>/.test(accts.body));
    assert.ok(/id="label-nt">[\s\S]*?<span class="gd-type-status gd-status-rented">Full Slot<\/span>/.test(accts.body));
    assert.ok(/id="label-ps4">[\s\S]*?<span class="gd-slots-left">2 slots left<\/span>/.test(accts.body));
    assert.ok(!/<span class="gd-slots-left">(3|6) slots left<\/span>/.test(accts.body));
    assert.ok(accts.body.includes('const AVAIL = { nt: false, tr: false, ps4: true };'));
  });
  await okAsync('each full type says when its soonest slot frees up; a slot in maintenance never counts', async () => {
    const tr = daysUntil(localDate(9)), nt = daysUntil(localDate(11)), ps4 = daysUntil(localDate(15));
    assert.ok(accts.body.includes('<span class="gd-avail-soon">🏆 Available in <strong>' + tr + ' days</strong></span>'));
    assert.ok(accts.body.includes('<span class="gd-avail-soon">🎮 Available in <strong>' + nt + ' days</strong></span>'));
    assert.ok(!accts.body.includes('🕹️ Available in'), 'PS4 Primary has a slot now');
    assert.ok(accts.body.includes('const NEXT_DAYS = {"tr":' + tr + ',"nt":' + nt + ',"ps4":' + ps4 + '};'));
  });

  console.log('\ngame-detail.js on the PS Plus page');
  await okAsync('PS4 Primary, then Weekly: the Trophy price with the ₱100 deposit on top', async () => {
    const p = loadPage(accts.body);
    p.pick('ps4', 7);
    assert.strictEqual(p.els.ctaMsgPreview.textContent,
      'Hi! I want to RENT a game 🎮\nGame: PS Plus Deluxe\nAccount Type: PS4 Primary Account\nDuration: 7 Days\nTotal: ₱399 + ₱100 refundable deposit');
    assert.strictEqual(p.els.ctaBtn.textContent, '🎮 Rent now — ₱499');
    assert.strictEqual(p.els.orderType.value, 'ps4');
  });
  await okAsync('Trophy, then Weekly: the message names PS Plus Deluxe with the ₱100 deposit on top', async () => {
    const p = loadPage(open.body);
    p.pick('tr', 7);
    assert.strictEqual(p.els.ctaMsgPreview.textContent,
      'Hi! I want to RENT a game 🎮\nGame: PS Plus Deluxe\nAccount Type: Trophy Account\nDuration: 7 Days\nTotal: ₱399 + ₱100 refundable deposit');
    assert.strictEqual(p.els.ctaMsgPrimary.href, 'http://m.me/PlaystationHub00?text=' + encodeURIComponent(p.els.ctaMsgPreview.textContent));
  });
  await okAsync('the order button enables with the total, and the form gets the picks', async () => {
    const p = loadPage(open.body);
    p.pick('tr', 7);
    assert.strictEqual(p.els.ctaBtn.disabled, false);
    assert.strictEqual(p.els.ctaBtn.textContent, '🎮 Rent now — ₱499');
    assert.strictEqual(p.els.orderType.value, 'tr');
    assert.strictEqual(p.els.orderDays.value, 7);
    assert.strictEqual(p.els.totalFinal.textContent, '₱499');
  });
  await okAsync('Non-Trophy has no deposit; Monthly carries the promo', async () => {
    const p = loadPage(open.body);
    p.pick('nt', 30);
    assert.ok(p.els.ctaMsgPreview.textContent.endsWith('\nAccount Type: Non-Trophy Account\nDuration: 30 Days\nTotal: ₱629 (incl. 10% promo discount)'), p.els.ctaMsgPreview.textContent);
    assert.strictEqual(p.els.ctaBtn.textContent, '🎮 Rent now — ₱629');
  });
  await okAsync('picking the full Trophy type on the one-slot page hands over to the get-in-line card', async () => {
    const p = loadPage(last.body);
    p.pick('tr');
    assert.strictEqual(p.els.ctaMsgWrap.hidden, true);
    assert.strictEqual(p.els.reserveSection.style.display, '');
    assert.strictEqual(p.els.orderToggle.style.display, 'none');
    assert.strictEqual(p.els.lineSoon.textContent, ' · Trophy frees up in about ' + daysUntil(trEnd) + ' days');
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
