// Run: node scripts/test-signin-qr.js
//
// One-tap sign-in: decode a console QR on the server, keep only Sony links,
// and record the owner's Signed in / ask-for-a-fresh-code moves on the order.
// No PlayStation login, no stored PSN password, no private Sony API.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const orders = require('../lib/orders');
const signinQr = require('../lib/signin-qr');

let passed = 0;
function ok(desc, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ok - ' + desc); });
}

const SONY = 'https://login.playstation.com/activate?code=abc123';

function matches(doc, query) {
  return Object.keys(query).every(k => {
    const cond = query[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$lt' in cond) return doc[k] != null && doc[k] < cond.$lt;
      throw new Error('fake collection got an operator it does not implement: ' + JSON.stringify(cond));
    }
    return doc[k] === cond;
  });
}

function fakeDb(docs) {
  const col = {
    find: (q) => ({ toArray: async () => docs.filter(d => matches(d, q)).map(d => Object.assign({}, d)) }),
    findOne: async (q) => {
      const d = docs.find(x => matches(x, q));
      return d ? Object.assign({}, d) : null;
    },
    updateOne: async (q, u) => {
      const d = docs.find(x => matches(x, q));
      if (!d) return { matchedCount: 0 };
      Object.assign(d, u.$set || {});
      if (u.$push) Object.keys(u.$push).forEach(k => { (d[k] = d[k] || []).push(u.$push[k]); });
      return { matchedCount: 1 };
    }
  };
  return { docs, collection: () => col };
}

function account(id, label, slot, gameIds) {
  return {
    id, label, game_ids: gameIds || [7],
    slots: {
      trophy: slot,
      non_trophy: { enabled: true, status: 'open', renter_id: null, renter_name: '', start: '', end: '' },
      ps4_primary: { enabled: true, status: 'open', renter_id: null, renter_name: '', start: '', end: '' }
    }
  };
}

const OPEN = { enabled: true, status: 'open', renter_id: null, renter_name: '', start: '', end: '' };

function pending(over) {
  return Object.assign({
    ref: 'PH-2201', url_key: 'k', state: 'qr_pending',
    game_id: 7, game_title: "Marvel's Wolverine", account_type: 'tr', days: 7,
    fb_name: 'Arlloyd Paredes',
    qr_signin_url: SONY,
    qr_image: '/uploads/qr.webp',
    qr_expires_at: '2099-01-01T00:00:00.000Z',
    state_history: [{ state: 'qr_pending', at: '2026-11-26T00:00:00.000Z' }]
  }, over || {});
}

const run = [];

run.push(() => ok('a generated Sony QR decodes to its URL', async () => {
  const png = await QRCode.toBuffer(SONY, { type: 'png', margin: 4, width: 320, errorCorrectionLevel: 'M' });
  assert.strictEqual(signinQr.decodeQrImage(png), SONY);
  assert.strictEqual(signinQr.urlFromImage(png), SONY);
}));

run.push(() => ok('the same QR still decodes after a JPEG round-trip', async () => {
  const png = await QRCode.toBuffer(SONY, { type: 'png', margin: 4, width: 320, errorCorrectionLevel: 'M' });
  const raw = PNG.sync.read(png);
  const jpg = jpeg.encode({ data: raw.data, width: raw.width, height: raw.height }, 95);
  assert.strictEqual(signinQr.urlFromImage(jpg.data), SONY);
}));

run.push(() => ok('a QR that is not a Sony link is decoded and then rejected', async () => {
  const evil = 'https://evil.example/steal';
  const png = await QRCode.toBuffer(evil, { type: 'png', margin: 4, width: 280 });
  assert.strictEqual(signinQr.decodeQrImage(png), evil);
  assert.strictEqual(signinQr.urlFromImage(png), '');
}));

run.push(() => ok('rubbish bytes and empty input do not throw', () => {
  assert.strictEqual(signinQr.decodeQrImage(Buffer.from('not an image')), '');
  assert.strictEqual(signinQr.urlFromImage(Buffer.from('not an image')), '');
  assert.strictEqual(signinQr.urlFromImage(null), '');
  assert.strictEqual(signinQr.urlFromImage(undefined), '');
  assert.strictEqual(signinQr.decodeQrImage(undefined), '');
}));

run.push(() => ok('Sony sign-in hosts are accepted, including subdomains', () => {
  [
    'https://login.playstation.com/activate?code=abc',
    'https://www.playstation.com/acct/qr',
    'https://playstation.com/x',
    'https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/authorize?x=1',
    'https://id.sony.com/signin',
    'https://SONY.COM/path'
  ].forEach(raw => {
    const out = signinQr.acceptedSigninUrl(raw);
    assert.ok(out.startsWith('https://'), raw);
    assert.ok(/sonyentertainmentnetwork\.com|playstation\.com|sony\.com/i.test(out), raw);
  });
}));

run.push(() => ok('lookalike hosts, http, and credentialed URLs are rejected', () => {
  [
    'http://login.playstation.com/activate',
    'https://playstation.com.evil.test/qr',
    'https://notplaystation.com/qr',
    'https://evil.com/playstation.com',
    'https://user:pass@login.playstation.com/activate',
    'javascript:alert(1)',
    'https://login.playstation.com.attacker.com/x',
    '',
    null,
    undefined,
    { toString: () => 'https://login.playstation.com/' }
  ].forEach(raw => {
    assert.strictEqual(signinQr.acceptedSigninUrl(raw), '', String(raw));
  });
}));

run.push(() => ok('free slots for the game are listed, defaulting to the order account', () => {
  const accounts = [
    account(9, 'PSN Business 9', OPEN, [7]),
    account(4, 'PSN Business 2', OPEN, [7]),
    account(5, 'Other game', OPEN, [8]),
    account(6, 'Taken', { enabled: true, status: 'rented', renter_id: 3, renter_name: 'Ana', start: '2026-11-01', end: '2026-11-30' }, [7])
  ];
  const pick = signinQr.freeAccounts(accounts, { game_id: 7, account_type: 'tr', account_id: 4 });
  assert.deepStrictEqual(pick.options.map(a => a.id), [4, 9]);
  assert.strictEqual(pick.selectedId, 4);
  assert.strictEqual(pick.slot, 'trophy');
}));

run.push(() => ok('a pinned bundle account is offered even without a catalogue game id', () => {
  const accounts = [account(12, 'Bundle box', OPEN, [])];
  const pick = signinQr.freeAccounts(accounts, { game_id: 'bundle_12', account_type: 'nt', account_id: 12 });
  assert.strictEqual(pick.options.length, 1);
  assert.strictEqual(pick.options[0].id, 12);
  assert.strictEqual(pick.slot, 'non_trophy');
}));

run.push(() => ok('a posted account that is not free is refused', () => {
  const accounts = [account(4, 'PSN Business 2', OPEN, [7])];
  const order = { game_id: 7, account_type: 'tr', account_id: 4 };
  const bad = signinQr.resolveChoice(accounts, order, '99');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.reason, 'signin_no_slot');
  const good = signinQr.resolveChoice(accounts, order, '4');
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.accountId, 4);
  assert.strictEqual(good.slot, 'trophy');
  assert.strictEqual(good.slotType, 'tr');
}));

run.push(() => ok('no linked slot still allows sign-in without inventing an account', () => {
  const choice = signinQr.resolveChoice([], { game_id: 7, account_type: 'ps4' }, '');
  assert.strictEqual(choice.ok, true);
  assert.strictEqual(choice.accountId, null);
  assert.strictEqual(choice.slot, 'ps4_primary');
}));

run.push(() => ok('a link is qr_link, a typed code is typed_code, a bare photo is photo', () => {
  assert.strictEqual(signinQr.methodOf({ qr_signin_url: SONY, qr_code: 'ABCD' }), 'qr_link');
  assert.strictEqual(signinQr.methodOf({ qr_code: 'ABCD1234' }), 'typed_code');
  assert.strictEqual(signinQr.methodOf({ qr_image: '/uploads/x.webp' }), 'photo');
}));

run.push(() => ok('signing in records the account, the method and the time, and wipes the secret', async () => {
  const db = fakeDb([pending()]);
  orders.init(async () => db);
  const order = db.docs[0];
  const choice = { accountId: 4, slot: 'trophy', slotType: 'tr' };
  const at = '2026-11-26T08:15:00.000Z';
  const r = await orders.transition(order.ref, 'active', signinQr.activationPatch(order, choice, at), {
    history: signinQr.historyExtra(order, choice)
  });
  assert.ok(r);
  assert.strictEqual(r.state, 'active');
  assert.strictEqual(r.signin_method, 'qr_link');
  assert.strictEqual(r.signin_account_id, 4);
  assert.strictEqual(r.signin_at, at);
  assert.strictEqual(r.account_id, 4);
  assert.strictEqual(r.slot_type, 'tr');
  assert.strictEqual(r.qr_signin_url, null);
  assert.strictEqual(r.qr_code, null);
  assert.strictEqual(r.qr_image, null);
  assert.strictEqual(r.qr_expires_at, null);
  const last = r.state_history[r.state_history.length - 1];
  assert.strictEqual(last.state, 'active');
  assert.strictEqual(last.method, 'qr_link');
  assert.strictEqual(last.account_id, 4);
  assert.strictEqual(last.via, 'signed_in');
  assert.ok(last.at);
  assert.ok(!JSON.stringify(last).includes('playstation.com'), 'the link must not be copied into history');
}));

run.push(() => ok('a typed code is the method when there is no decoded link', async () => {
  const db = fakeDb([pending({ qr_signin_url: null, qr_code: 'ABCD1234' })]);
  orders.init(async () => db);
  const order = db.docs[0];
  const choice = { accountId: 4, slot: 'trophy', slotType: 'tr' };
  const r = await orders.transition('PH-2201', 'active', signinQr.activationPatch(order, choice, '2026-11-26T08:16:00.000Z'), {
    history: signinQr.historyExtra(order, choice)
  });
  assert.strictEqual(r.signin_method, 'typed_code');
  assert.strictEqual(r.state_history[r.state_history.length - 1].method, 'typed_code');
}));

run.push(() => ok('asking for a fresh code clears the link and the code and says so', async () => {
  const db = fakeDb([pending({ qr_code: 'ABCD1234' })]);
  orders.init(async () => db);
  const at = '2026-11-26T08:20:00.000Z';
  const r = await orders.transition('PH-2201', 'awaiting_qr', signinQr.failedPatch(at), {
    history: { method: 'qr_link', via: 'ask_fresh', url: SONY }
  });
  assert.ok(r);
  assert.strictEqual(r.state, 'awaiting_qr');
  assert.strictEqual(r.signin_failed_at, at);
  assert.strictEqual(r.qr_signin_url, null);
  assert.strictEqual(r.qr_code, null);
  assert.strictEqual(r.qr_image, null);
  assert.strictEqual(r.qr_expires_at, null);
  const last = r.state_history[r.state_history.length - 1];
  assert.strictEqual(last.state, 'awaiting_qr');
  assert.strictEqual(last.via, 'ask_fresh');
  assert.strictEqual(last.method, 'qr_link');
  assert.ok(!JSON.stringify(last).includes('playstation.com'));
  assert.ok(!Object.prototype.hasOwnProperty.call(last, 'url'));
}));

run.push(() => ok('the customer page tells them to send a fresh QR after a failure', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'order-status.ejs'), 'utf8');
  assert.ok(src.includes('signin_failed_at'), 'order-status.ejs never reads signin_failed_at');
  assert.ok(/fresh/i.test(src));
}));

run.push(() => ok('the new admin routes stay behind admin auth', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(src.includes("app.post('/admin/orders/:ref/signed-in', requireAuth"), 'signed-in route missing requireAuth');
  assert.ok(src.includes("app.post('/admin/orders/:ref/signin-failed', requireAuth"), 'signin-failed route missing requireAuth');
  assert.ok(src.includes('signinQr.urlFromImage('), 'QR upload does not decode');
}));

(async () => {
  for (const t of run) await t();
  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error('\nFAILED: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
