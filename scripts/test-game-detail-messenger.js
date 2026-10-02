// Run: node scripts/test-game-detail-messenger.js
//
// The Messenger-first rent box on a game page. Two parts:
//  1. Boots the real server against a throwaway DATA_DIR (blank MONGODB_URI) and
//     checks the rendered markup for a game with open slots and a fully booked
//     one.
//  2. Runs public/js/game-detail.js in a vm with a stub DOM to check the message
//     preview, link, labels, order toggle and sticky bar.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');

const PORT = 4595;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-messenger-'));
const base = { platform: 'PS5', nt_price_7d: 399, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 799, non_trophy_slots: 0, trophy_slots: 0 };
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  games: [
    Object.assign({ id: 1, title: 'Zzyzx Open Game', non_trophy_slots: 2, trophy_slots: 1 }, base, { non_trophy_slots: 2, trophy_slots: 1 }),
    Object.assign({ id: 2, title: 'Zzyzx Booked Game' }, base)
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

// ── stub DOM for game-detail.js ──
function loadPage({ allUnavail, avail }) {
  const els = {};
  const clicks = [];
  const mk = id => (els[id] = {
    id, href: '', textContent: '', hidden: false, value: '', disabled: false,
    style: {}, dataset: { defaultAmount: '399', defaultBuyAmount: '0' },
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(k, v) { this.attrs = Object.assign(this.attrs || {}, { [k]: v }); },
    scrollIntoView() { clicks.push('scroll:' + id); },
    focus() { clicks.push('focus:' + id); },
    click() { clicks.push(id); }
  });
  ['ctaMsgPrimary', 'ctaMsgMain', 'ctaMsgSub', 'ctaMsgPreview', 'ctaMsgWrap', 'gdOrderBlock', 'orderToggle', 'gdSbKicker', 'gdSbAmount', 'gdSbBtn',
    'ctaBtn', 'ctaSub', 'reserveSection', 'gdOrderForm', 'totalBox', 'orderType', 'orderDays', 'phAmount',
    'lineCard', 'lineCardAll', 'lineAsk', 'lineAskAll', 'lineSoon', 'lineSoonAll', 'resFbName', 'resFbNameAll'].forEach(mk);
  const ctx = {
    console, window: { addEventListener() {}, location: { search: '' } },
    document: { getElementById: id => els[id] || null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    PRICES: { nt: { 7: 399, 30: 799 }, tr: { 7: 399, 30: 799 }, ps4: { 7: 399, 30: 799 } },
    BUY_PRICES: { nt: 0, tr: 0 },
    PROMO: { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100 },
    AVAIL: avail, ALL_UNAVAIL: allUnavail, gameTitle: 'Zzyzx Open Game', gdSlideCount: 0, RENTAL_DURATIONS: [7, 30],
    NEXT_DAYS: { tr: 23, nt: 1, ps4: null },
    PHMessengerText: require('../public/js/messenger-text.js')
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'game-detail.js'), 'utf8'), ctx);
  return { ctx, els, clicks, run: code => vm.runInContext(code, ctx) };
}

async function main() {
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await get('/browse'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  console.log('\nrendered page, open game');
  const open = await get('/game/zzyzx-open-game');
  await okAsync('has the big Messenger button, preview, collapsed website order, and no old link or hint', async () => {
    assert.strictEqual(open.status, 200);
    assert.ok(/<a href="http:\/\/m\.me\/PlaystationHub00" target="_blank" rel="noopener" class="gd-msg-primary" id="ctaMsgPrimary" data-track-source="game">/.test(open.body));
    assert.ok(open.body.includes('💬 Message us about this game'));
    assert.ok(open.body.includes('YOUR MESSAGE WILL SAY') && open.body.includes('id="ctaMsgPreview"'));
    assert.ok(/<div id="gdOrderBlock" hidden>/.test(open.body), 'order block starts collapsed');
    assert.ok(open.body.includes('id="orderToggle"') && open.body.includes('Or order here on the website'));
    assert.ok(open.body.includes('id="gdOrderForm"'), 'the website order form is still there');
    assert.ok(!open.body.includes('id="ctaMsgLink"') && !open.body.includes('id="ctaHint"'));
    assert.ok(/id="gdSbBtn"[^>]*>💬 Message us<\/button>/.test(open.body));
  });
  await okAsync('loads messenger-text.js before game-detail.js', async () => {
    const a = open.body.indexOf('/js/messenger-text.js?v=');
    const b = open.body.indexOf('/js/game-detail.js?v=');
    assert.ok(a > 0 && b > a);
  });
  await okAsync('a failed website order (?order_error=1) reopens the order block', async () => {
    const r = await get('/game/zzyzx-open-game?order_error=1');
    assert.ok(/<div id="gdOrderBlock">/.test(r.body));
    assert.ok(/aria-expanded="true"/.test(r.body));
  });

  console.log('\nrendered page, fully booked game');
  await okAsync('one "get in line" card is the main action; the big Messenger button starts hidden', async () => {
    const r = await get('/game/zzyzx-booked-game');
    assert.strictEqual(r.status, 200);
    assert.ok(/<div id="ctaMsgWrap" hidden>/.test(r.body), 'big Messenger button hidden');
    assert.ok(!r.body.includes('id="orderToggle"') && !r.body.includes('id="gdOrderBlock"'));
    assert.ok(r.body.includes('id="reserveSectionAll"') && r.body.includes('id="lineCardAll"'));
    assert.ok(r.body.includes('Fully booked') && r.body.includes('id="lineHeadAll"'));
    assert.ok(/id="noslotOptQueueAll"[^>]*>/.test(r.body) && /aria-checked="true" class="gd-noslot-opt gd-line-opt gd-type-selected" id="noslotOptQueueAll"/.test(r.body), 'Free is picked first');
    assert.ok(/name="kind" id="resKindAll" value="queue"/.test(r.body));
    assert.ok(r.body.includes('Join the line — free') && r.body.includes('data-text-priority="Reserve priority — ₱100"'));
    assert.ok(/id="lineAskAll"[^>]*data-track-source="game"/.test(r.body) && r.body.includes('Have a question?'));
  });
  await okAsync('the old duplicates are gone: second banner, "Choose your option", Facebook fallback link, "Paying puts you first"', async () => {
    const r = await get('/game/zzyzx-booked-game');
    assert.ok(!r.body.includes('No Slots Available Right Now'));
    assert.ok(!r.body.includes('CHOOSE YOUR OPTION'));
    assert.ok(!r.body.includes('or message us on Facebook instead'));
    assert.ok(!r.body.includes('id="reserveLinkAll"'));
    assert.ok(/var HIDE_STRIP = true;/.test(r.body), 'the separate queue strip stays hidden; the card shows the count');
  });
  await okAsync('the PS Plus rent page shares these partials and keeps its classic layout', async () => {
    const r = await get('/ps-plus/rent');
    assert.strictEqual(r.status, 200);
    assert.ok(!r.body.includes('gd-line-card'));
    assert.ok(r.body.includes('or message us on Facebook instead') && r.body.includes('Reserve Now'));
    assert.ok(/var HIDE_STRIP = false;/.test(r.body));
  });

  console.log('\ngame-detail.js, open game');
  await okAsync('nothing picked: the link and preview name only the game', async () => {
    const p = loadPage({ allUnavail: false, avail: { nt: true, tr: true, ps4: false } });
    p.run('updateReserveLinks()');
    const text = 'Hi! I want to RENT a game 🎮\nGame: Zzyzx Open Game';
    assert.strictEqual(p.els.ctaMsgPreview.textContent, text);
    assert.strictEqual(p.els.ctaMsgPrimary.href, 'http://m.me/PlaystationHub00?text=' + encodeURIComponent(text));
    assert.strictEqual(p.els.ctaMsgMain.textContent, '💬 Message us about this game');
  });
  await okAsync('type and duration picked: they and the total join the message', async () => {
    const p = loadPage({ allUnavail: false, avail: { nt: true, tr: true, ps4: false } });
    p.run("selectedType = 'tr'; selectedDays = 30; updateReserveLinks()");
    assert.strictEqual(p.els.ctaMsgPreview.textContent,
      'Hi! I want to RENT a game 🎮\nGame: Zzyzx Open Game\nAccount Type: Trophy Account\nDuration: 30 Days\nTotal: ₱819 (incl. 10% promo discount) + ₱100 refundable deposit');
  });
  await okAsync('picking a full type switches the wording to a next-slot question', async () => {
    const p = loadPage({ allUnavail: false, avail: { nt: true, tr: false, ps4: false } });
    p.run("selectedType = 'tr'; updateReserveLinks()");
    assert.ok(p.els.ctaMsgPreview.textContent.startsWith("Hi! I'm interested in Zzyzx Open Game"));
    assert.strictEqual(p.els.ctaMsgMain.textContent, '💬 Ask us about this game');
  });
  await okAsync('a full type hides the big button; the card link carries the message and the frees-up line', async () => {
    const p = loadPage({ allUnavail: false, avail: { nt: true, tr: false, ps4: false } });
    p.run("selectedType = 'tr'; updateReserveLinks()");
    assert.strictEqual(p.els.ctaMsgWrap.hidden, true);
    assert.strictEqual(p.els.lineAsk.href, p.els.ctaMsgPrimary.href);
    assert.ok(p.els.lineAsk.href.includes(encodeURIComponent('fully booked')));
    assert.strictEqual(p.els.lineSoon.textContent, ' · Trophy frees up in about 23 days');
    p.run("selectedType = 'nt'; updateReserveLinks()");
    assert.strictEqual(p.els.ctaMsgWrap.hidden, false, 'a type with a slot brings the big button back');
  });
  await okAsync('frees-up line: singular day, and nothing when unknown', async () => {
    const p = loadPage({ allUnavail: true, avail: { nt: false, tr: false, ps4: false } });
    p.run("selectedType = 'nt'; updateReserveLinks()");
    assert.strictEqual(p.els.lineSoonAll.textContent, ' · Non-trophy frees up in about 1 day');
    p.run("selectedType = 'ps4'; updateReserveLinks()");
    assert.strictEqual(p.els.lineSoonAll.textContent, '');
  });
  await okAsync('the website-order toggle opens and closes the block', async () => {
    const p = loadPage({ allUnavail: false, avail: { nt: true, tr: true, ps4: false } });
    p.els.gdOrderBlock.hidden = true;
    p.run('toggleOrderBlock()');
    assert.strictEqual(p.els.gdOrderBlock.hidden, false);
    assert.strictEqual(p.els.orderToggle.attrs['aria-expanded'], 'true');
    p.run('toggleOrderBlock()');
    assert.strictEqual(p.els.gdOrderBlock.hidden, true);
    assert.strictEqual(p.els.orderToggle.attrs['aria-expanded'], 'false');
  });
  await okAsync('a type with no slot hides the website-order toggle; a type with a slot shows it', async () => {
    const p = loadPage({ allUnavail: false, avail: { nt: true, tr: false, ps4: false } });
    p.run("selectedType = 'tr'; updateCtaState()");
    assert.strictEqual(p.els.orderToggle.style.display, 'none');
    p.run("selectedType = 'nt'; updateCtaState()");
    assert.strictEqual(p.els.orderToggle.style.display, '');
  });
  await okAsync('the sticky bar button is the Messenger button, never "waiting"', async () => {
    const p = loadPage({ allUnavail: false, avail: { nt: true, tr: true, ps4: false } });
    p.run('syncStickyBar()');
    assert.strictEqual(p.els.gdSbBtn.textContent, '💬 Message us');
    assert.strictEqual(p.els.gdSbKicker.textContent, 'From');
    p.run("selectedType = 'nt'; selectedDays = 7; syncStickyBar()");
    assert.strictEqual(p.els.gdSbKicker.textContent, 'Your total');
    assert.strictEqual(p.els.gdSbAmount.textContent, '₱399');
    p.run('handleStickyBarClick()');
    assert.deepStrictEqual(p.clicks, ['ctaMsgPrimary'], 'tapping the bar taps the big button');
  });

  console.log('\ngame-detail.js, fully booked game');
  await okAsync('every type full: the bar says Get in line and takes you to the card with the name box ready', async () => {
    const p = loadPage({ allUnavail: true, avail: { nt: false, tr: false, ps4: false } });
    p.run('updateReserveLinks(); syncStickyBar()');
    assert.ok(p.els.ctaMsgPreview.textContent.includes('fully booked'));
    assert.strictEqual(p.els.gdSbBtn.textContent, 'Get in line');
    assert.strictEqual(p.els.gdSbKicker.textContent, 'Fully booked');
    assert.strictEqual(p.els.gdSbAmount.textContent, '');
    p.run('handleStickyBarClick()');
    assert.deepStrictEqual(p.clicks, ['scroll:lineCardAll', 'focus:resFbNameAll'], 'no Messenger click');
  });
  await okAsync('picked type full (others free): the bar goes to the per-type card', async () => {
    const p = loadPage({ allUnavail: false, avail: { nt: true, tr: false, ps4: false } });
    p.run("selectedType = 'tr'; syncStickyBar(); handleStickyBarClick()");
    assert.strictEqual(p.els.gdSbBtn.textContent, 'Get in line');
    assert.deepStrictEqual(p.clicks, ['scroll:lineCard', 'focus:resFbName']);
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
