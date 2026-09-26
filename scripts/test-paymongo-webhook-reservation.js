// Run: node scripts/test-paymongo-webhook-reservation.js
//
// Bug: a customer paid the ₱100 Fall in Line priority fee via the site's
// PayMongo QR Ph checkout. The webhook confirmed the payment but sent the
// order to 'awaiting_qr' — the "send us your sign-in code" state meant for an
// ordinary rental with an account already waiting. A reservation has no slot
// yet, and 'awaiting_qr' is not one of the states lib/queue.js looks for
// (QUEUE_STATES or an in-flight upgrade), so the order silently dropped out
// of the waitlist instead of showing the priority badge.
//
// Every OTHER payment-confirmation path (POST /admin/orders/:ref/advance,
// POST /admin/orders/:ref/mark-paid, POST /admin/orders/:ref/priority-paid)
// already checks order.is_reservation and lands on 'reserved' instead. The
// webhook was the one path that didn't. This boots the real server in-process
// and hits the real webhook route, so it proves the fix at the route level,
// not just in a helper function.
const assert = require('assert');
const http = require('http');

const PORT = 4590;
process.env.PORT = String(PORT);
process.env.PAYMONGO_WEBHOOK_SECRET = 'test-secret';

function post(path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: 'localhost', port: PORT, path, method: 'POST', timeout: 5000,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': data.length }, headers || {})
    }, (res) => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    req.write(data);
    req.end();
  });
}
function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: PORT, path, timeout: 5000 }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
  });
}

async function main() {
  require('../server.js');

  const orders = require('../lib/orders');
  const paymongo = require('../lib/paymongo');
  const originalGetByRef = orders.getByRef;
  const originalWasEventProcessed = orders.wasEventProcessed;
  const originalRecordEvent = orders.recordEvent;
  const originalNoteWebhook = orders.noteWebhook;
  const originalTransition = orders.transition;
  const originalVerifySignature = paymongo.verifySignature;
  const originalNormalizeEvent = paymongo.normalizeEvent;

  const live = {
    ref: 'PH-0174', state: 'awaiting_payment', is_reservation: true,
    amount_due: 100, deposit_due: 0, account_type: 'nt', game_id: 3, days: 30
  };
  const transitions = [];

  paymongo.verifySignature = () => true;
  paymongo.normalizeEvent = () => ({ id: 'evt_test_1', paid: true, orderRef: 'PH-0174', amountCentavos: 10000 });
  orders.getByRef = async (ref) => (ref === 'PH-0174' ? Object.assign({}, live) : null);
  orders.wasEventProcessed = async () => false;
  orders.recordEvent = async () => true;
  orders.noteWebhook = async () => {};
  // Enforces the REAL state machine (lib/orders.js's own canTransition), so a
  // fix that skips a required intermediate hop (e.g. tries
  // awaiting_payment -> reserved directly, which is not a legal edge) is
  // caught here rather than silently accepted by an over-permissive stub.
  orders.transition = async (ref, toState, patch) => {
    if (!orders.canTransition(live.state, toState)) {
      transitions.push({ ref, toState, patch, rejected: true, from: live.state });
      return null;
    }
    transitions.push({ ref, toState, patch, from: live.state });
    Object.assign(live, patch || {}, { state: toState });
    return Object.assign({}, live);
  };

  try {
    const deadline = Date.now() + 10000;
    let up = false;
    while (Date.now() < deadline) {
      try { await get('/'); up = true; break; }
      catch { await new Promise(r => setTimeout(r, 200)); }
    }
    assert.ok(up, 'server did not come up within 10s');

    console.log('\nPOST /webhooks/paymongo — a settled reservation payment');

    const res = await post('/webhooks/paymongo', { data: { attributes: {} } }, { 'Paymongo-Signature': 'irrelevant, verifySignature is stubbed' });
    assert.strictEqual(res.statusCode, 200, 'webhook responded ' + res.statusCode + ': ' + res.body);
    console.log('  ok - webhook accepted the settled payment');

    assert.ok(transitions.every(t => !t.rejected), 'a transition was rejected by the real state machine: ' + JSON.stringify(transitions));
    console.log('  ok - every transition the webhook made is a legal edge in the real state machine');

    assert.strictEqual(live.state, 'reserved', 'a reservation order must end up \'reserved\', ended up \'' + live.state + '\' instead (transitions: ' + JSON.stringify(transitions) + ')');
    console.log('  ok - a reservation order settles into \'reserved\', not \'awaiting_qr\'');

    console.log('\nPOST /webhooks/paymongo — a settled ORDINARY rental payment (regression check)');

    Object.assign(live, { ref: 'PH-0200', state: 'awaiting_payment', is_reservation: false, amount_due: 349 });
    transitions.length = 0;
    orders.getByRef = async (ref) => (ref === 'PH-0200' ? Object.assign({}, live) : null);
    paymongo.normalizeEvent = () => ({ id: 'evt_test_2', paid: true, orderRef: 'PH-0200', amountCentavos: 34900 });

    const res2 = await post('/webhooks/paymongo', { data: { attributes: {} } }, { 'Paymongo-Signature': 'irrelevant, verifySignature is stubbed' });
    assert.strictEqual(res2.statusCode, 200, 'webhook responded ' + res2.statusCode + ': ' + res2.body);
    assert.ok(transitions.every(t => !t.rejected), 'a transition was rejected: ' + JSON.stringify(transitions));
    assert.strictEqual(transitions.length, 1, 'an ordinary rental should settle in one hop, got ' + transitions.length);
    assert.strictEqual(live.state, 'awaiting_qr', 'an ordinary rental must still settle into \'awaiting_qr\', got \'' + live.state + '\'');
    console.log('  ok - an ordinary rental still settles into \'awaiting_qr\' in one hop, unchanged');

    console.log('\n4 assertions passed\n');
  } finally {
    orders.getByRef = originalGetByRef;
    orders.wasEventProcessed = originalWasEventProcessed;
    orders.recordEvent = originalRecordEvent;
    orders.noteWebhook = originalNoteWebhook;
    orders.transition = originalTransition;
    paymongo.verifySignature = originalVerifySignature;
    paymongo.normalizeEvent = originalNormalizeEvent;
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
