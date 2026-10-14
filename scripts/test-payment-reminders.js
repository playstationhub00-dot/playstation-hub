// Run: node scripts/test-payment-reminders.js
//
// Unpaid-order reminders: who is due, who is skipped, the Messenger 24-hour
// window, the one-claim-per-stage rule, and the recovered-peso count.
// The sweep talks to Mongo through lib/orders, so the claim tests inject a
// fake collection the same way scripts/test-qr-expiry.js does.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

let passed = 0;
function check(name, fn) {
  const r = fn();
  if (r && typeof r.then === 'function') {
    return r.then(() => { passed++; console.log('  ok - ' + name); });
  }
  passed++;
  console.log('  ok - ' + name);
}

const NOW = new Date('2026-09-07T04:00:00.000Z'); // 12:00 in Manila
const MIN = 60 * 1000;

function order(over) {
  const created = new Date(NOW.getTime() - 40 * MIN).toISOString();
  return Object.assign({
    ref: 'PH-0301',
    url_key: 'abc',
    state: 'awaiting_payment',
    fb_name: 'Ana Cruz',
    game_title: 'Tekken 8',
    amount_due: 349,
    deposit_due: 0,
    created_at: created,
    state_history: [{ state: 'awaiting_payment', at: created }],
    psid: null
  }, over || {});
}

function aged(ms, over) {
  const at = new Date(NOW.getTime() - ms).toISOString();
  return order(Object.assign({
    created_at: at,
    state_history: [{ state: 'awaiting_payment', at }]
  }, over || {}));
}

const run = [];

run.push(() => check('the module loads', () => {
  require('../lib/payment-reminders');
}));

(async () => {
  for (const t of run) await t();
  let pr;
  try { pr = require('../lib/payment-reminders'); }
  catch (e) {
    console.error('\nFAILED: ' + e.message);
    process.exit(1);
  }

  const rest = [];

  rest.push(() => check('a reminder is due 30 minutes after awaiting_payment, and not a minute earlier', () => {
    assert.strictEqual(pr.stageDue(aged(29 * MIN), NOW), null);
    assert.strictEqual(pr.stageDue(aged(30 * MIN), NOW), 'nudge');
  }));

  rest.push(() => check('the last call is due 24 hours after, and the earlier nudge still goes first', () => {
    assert.strictEqual(pr.stageDue(aged(24 * 60 * MIN - 1), NOW), 'nudge');
    assert.strictEqual(pr.stageDue(aged(24 * 60 * MIN), NOW), 'nudge');
    const both = aged(24 * 60 * MIN);
    both.payment_reminders = { nudge: { status: 'sent', sent_at: NOW.toISOString() } };
    assert.strictEqual(pr.stageDue(both, NOW), 'last_call');
  }));

  rest.push(() => check('a stage already claimed or sent is never due again', () => {
    const o = aged(60 * MIN);
    o.payment_reminders = { nudge: { status: 'claimed', claimed_at: NOW.toISOString() } };
    assert.strictEqual(pr.stageDue(o, NOW), null);
    o.payment_reminders = { nudge: { status: 'sent', sent_at: NOW.toISOString() } };
    assert.strictEqual(pr.stageDue(o, NOW), null);
  }));

  rest.push(() => check('the clock restarts when the order re-enters awaiting_payment', () => {
    const first = new Date(NOW.getTime() - 48 * 60 * MIN).toISOString();
    const again = new Date(NOW.getTime() - 10 * MIN).toISOString();
    const o = order({
      created_at: first,
      state_history: [
        { state: 'awaiting_payment', at: first },
        { state: 'verifying_payment', at: new Date(NOW.getTime() - 47 * 60 * MIN).toISOString() },
        { state: 'payment_rejected', at: new Date(NOW.getTime() - 46 * 60 * MIN).toISOString() },
        { state: 'awaiting_payment', at: again }
      ]
    });
    assert.strictEqual(pr.awaitingSince(o), again);
    assert.strictEqual(pr.stageDue(o, NOW), null);
  }));

  rest.push(() => check('waitlist orders, owner quick-adds, proofs being checked, and a live checkout are skipped', () => {
    assert.strictEqual(pr.skipReason(order({ is_waitlist: true }), NOW), 'waitlist');
    assert.strictEqual(pr.skipReason(order({ state: 'waitlisted' }), NOW), 'waitlist');
    assert.strictEqual(pr.skipReason(order({ settle_state: 'active' }), NOW), 'owner_recorded');
    assert.strictEqual(pr.skipReason(order({ customer_id: 12 }), NOW), 'owner_recorded');
    assert.strictEqual(pr.skipReason(order({ state: 'verifying_payment' }), NOW), 'verifying');
    assert.strictEqual(pr.skipReason(order({ payment_proof: '/uploads/r.png' }), NOW), 'verifying');
    const started = new Date(NOW.getTime() - 5 * MIN).toISOString();
    assert.strictEqual(pr.skipReason(order({ checkout_session_id: 'cs_1', checkout_started_at: started }), NOW), 'checkout');
  }));

  rest.push(() => check('an abandoned checkout is not in progress forever', () => {
    const started = new Date(NOW.getTime() - 31 * MIN).toISOString();
    assert.strictEqual(pr.skipReason(order({ checkout_session_id: 'cs_old', checkout_started_at: started }), NOW), null);
    // A session id with no timestamp is a leftover from before this field
    // existed. Treating it as live would silence every order that ever opened Pay.
    assert.strictEqual(pr.skipReason(order({ checkout_session_id: 'cs_legacy' }), NOW), null);
  }));

  rest.push(() => check('a priority upgrade that is paying the ₱100 is not a waitlist skip', () => {
    assert.strictEqual(pr.skipReason(order({ upgraded_from_waitlist: true, is_waitlist: false }), NOW), null);
  }));

  rest.push(() => check('Messenger is only open inside 24 hours minus the safety buffer', () => {
    const touch = (msAgo) => new Date(NOW.getTime() - msAgo).toISOString();
    const open = pr.MESSENGER_WINDOW_MS - pr.MESSENGER_SAFETY_BUFFER_MS;
    const o = order({ psid: 'psid-1', psid_linked_at: touch(open) });
    assert.strictEqual(pr.messagingWindowOpen(o, null, NOW), true);
    o.psid_linked_at = touch(open + 1);
    assert.strictEqual(pr.messagingWindowOpen(o, null, NOW), false);
    // An older m.me click still counts when they messaged more recently.
    o.psid_linked_at = touch(48 * 60 * MIN);
    assert.strictEqual(pr.messagingWindowOpen(o, { psid: 'psid-1', last_seen: touch(10 * MIN) }, NOW), true);
    assert.strictEqual(pr.messagingWindowOpen(order({ psid: null, psid_linked_at: touch(1 * MIN) }), null, NOW), false);
  }));

  rest.push(() => check('Graph errors 10 and 551 fall back to the owner; other failures can be retried', () => {
    assert.strictEqual(pr.needsOwnerFallback(10), true);
    assert.strictEqual(pr.needsOwnerFallback(551), true);
    assert.strictEqual(pr.needsOwnerFallback(500), false);
    assert.strictEqual(pr.needsOwnerFallback(null), false);
    assert.strictEqual(pr.graphErrorCode('{"error":{"code":551,"message":"unavailable"}}'), 551);
    assert.strictEqual(pr.graphErrorCode('not json'), null);
  }));

  rest.push(() => check('the nudge is the Taglish copy, first name only, with the pay link', () => {
    const text = pr.customerText(order(), 'nudge', 'https://playstation-hub.com/order/PH-0301?k=abc');
    assert.strictEqual(text,
      'Hi Ana! 👋 Napansin namin di pa tapos yung payment for Tekken 8 (PH-0301). Your slot\'s still on hold. Pay here para ma-lock na natin: https://playstation-hub.com/order/PH-0301?k=abc — any questions, just reply here!');
    assert.ok(!text.includes('Cruz'));
  }));

  rest.push(() => check('the last call is a different message in the same voice', () => {
    const text = pr.customerText(order({ fb_name: '' }), 'last_call', 'https://x/order/PH-0301?k=abc');
    assert.ok(text.startsWith('Hi there! 👋 Last call'));
    assert.ok(text.includes('Tekken 8'));
    assert.ok(text.includes('PH-0301'));
    assert.ok(text.includes('https://x/order/PH-0301?k=abc'));
    assert.ok(!text.includes('still on hold'));
  }));

  rest.push(() => check('reminders default on, auto-cancel defaults off, hold defaults to 24 hours', () => {
    assert.deepStrictEqual(pr.normalizeSettings(undefined), { enabled: true, hold_hours: 24, auto_cancel: false });
    assert.deepStrictEqual(pr.normalizeSettings({}), { enabled: true, hold_hours: 24, auto_cancel: false });
    assert.strictEqual(pr.normalizeSettings({ enabled: false }).enabled, false);
    assert.strictEqual(pr.normalizeSettings({ auto_cancel: true }).auto_cancel, true);
    assert.strictEqual(pr.normalizeSettings({ auto_cancel: 'on' }).auto_cancel, false);
    assert.strictEqual(pr.normalizeSettings({ hold_hours: 0 }).hold_hours, 0);
    assert.strictEqual(pr.normalizeSettings({ hold_hours: '48' }).hold_hours, 48);
  }));

  rest.push(() => check('the hold expires one hold-length after the order entered awaiting_payment', () => {
    const o = aged(60 * MIN);
    const plan = pr.holdPlan(o, { hold_hours: 24 });
    assert.strictEqual(plan.anchor, pr.awaitingSince(o));
    assert.strictEqual(Date.parse(plan.expires) - Date.parse(plan.anchor), 24 * 60 * MIN);
    assert.strictEqual(pr.holdPlan(order({ is_waitlist: true }), { hold_hours: 24 }), null);
    assert.strictEqual(pr.holdPlan(order({ settle_state: 'active' }), { hold_hours: 24 }), null);
    assert.strictEqual(pr.holdPlan(o, { hold_hours: 0 }), null);
  }));

  rest.push(() => check('the status page counts down only when a hold expiry is set, and shows expired once it has passed', () => {
    assert.strictEqual(pr.holdDisplay(order(), NOW), null);
    const future = new Date(NOW.getTime() + 60 * MIN).toISOString();
    const past = new Date(NOW.getTime() - 60 * MIN).toISOString();
    assert.strictEqual(pr.holdDisplay(order({ hold_expires_at: future }), NOW), 'countdown');
    assert.strictEqual(pr.holdDisplay(order({ hold_expires_at: past }), NOW), 'expired');
    assert.strictEqual(pr.holdDisplay(order({ state: 'active', hold_expires_at: future }), NOW), null);
    assert.strictEqual(pr.holdDisplay(order({ state: 'payment_rejected', hold_expires_at: future }), NOW), 'countdown');
  }));

  rest.push(() => check('a plain awaiting_payment order does not hold a queue place', () => {
    // Availability counts open account slots, not orders. The queue is the
    // one place an unpaid state can matter, and only for a waitlist upgrade.
    const queue = require('../lib/queue');
    assert.strictEqual(queue.inQueue({
      state: 'awaiting_payment', created_at: NOW.toISOString(), account_type: 'nt', ref: 'PH-1'
    }, NOW), false);
    assert.strictEqual(queue.inQueue({
      state: 'awaiting_payment', upgraded_from_waitlist: true,
      created_at: NOW.toISOString(), account_type: 'nt', ref: 'PH-2'
    }, NOW), true);
  }));

  rest.push(() => check('recovered pesos count a paid order that had been reminded, on the Manila day', () => {
    // 2026-09-06T20:00Z is 04:00 on the 7th in Manila, not the 6th.
    const sent = '2026-09-06T20:00:00.000Z';
    const range = { from: '2026-09-07', to: '2026-09-30' };
    const stats = pr.recoveryStats([
      order({
        payment_reminders: { nudge: { status: 'sent', sent_at: sent } },
        reminder_recovered_at: sent,
        reminder_recovered_amount: 349
      }),
      order({
        ref: 'PH-0302',
        payment_reminders: { nudge: { status: 'sent', sent_at: '2026-08-01T00:00:00.000Z' } }
      }),
      order({
        ref: 'PH-0303',
        payment_reminders: { nudge: { status: 'claimed', claimed_at: sent } },
        reminder_recovered_at: sent,
        reminder_recovered_amount: 999
      })
    ], range);
    assert.deepStrictEqual(stats, { reminded: 1, recovered: 1, pesos: 349 });
  }));

  rest.push(() => check('the sweep sends one nudge over Messenger and will not send it again', async () => {
    const o = aged(40 * MIN, { psid: 'psid-1', psid_linked_at: new Date(NOW.getTime() - 10 * MIN).toISOString() });
    const store = [o];
    const sent = [];
    const deps = memDeps(store, NOW, sent);
    const first = await pr.runSweep(deps);
    assert.strictEqual(first.messenger, 1);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].channel, 'messenger');
    assert.ok(sent[0].text.includes('Napansin namin'));
    assert.strictEqual(store[0].payment_reminders.nudge.status, 'sent');
    assert.strictEqual(store[0].payment_reminders.nudge.channel, 'messenger');
    const second = await pr.runSweep(deps);
    assert.strictEqual(second.messenger, 0);
    assert.strictEqual(sent.length, 1);
  }));

  rest.push(() => check('outside the window the owner gets Telegram instead, and a 551 does the same', async () => {
    const quiet = aged(40 * MIN, { psid: 'psid-1', psid_linked_at: new Date(NOW.getTime() - 48 * 60 * MIN).toISOString() });
    const blocked = aged(40 * MIN, {
      ref: 'PH-0302',
      psid: 'psid-2',
      psid_linked_at: new Date(NOW.getTime() - 10 * MIN).toISOString()
    });
    const store = [quiet, blocked];
    const sent = [];
    let calls = 0;
    const deps = memDeps(store, NOW, sent);
    deps.sendMessenger = async () => {
      calls++;
      return { ok: false, code: 551, reason: 'api' };
    };
    const summary = await pr.runSweep(deps);
    assert.strictEqual(calls, 1, 'the quiet thread must not be sent to Graph at all');
    assert.strictEqual(summary.telegram, 2);
    assert.strictEqual(summary.messenger, 0);
    assert.ok(sent.every(s => s.channel === 'telegram'));
    assert.ok(sent.some(s => /no recent|window|551|unavailable/i.test(s.text)));
  }));

  rest.push(() => check('a network blip releases the claim so the next sweep can try once', async () => {
    const o = aged(40 * MIN, { psid: 'psid-1', psid_linked_at: new Date(NOW.getTime() - 5 * MIN).toISOString() });
    const store = [o];
    const sent = [];
    const deps = memDeps(store, NOW, sent);
    deps.sendMessenger = async () => ({ ok: false, code: null, reason: 'network' });
    const summary = await pr.runSweep(deps);
    assert.strictEqual(summary.released, 1);
    assert.strictEqual(store[0].payment_reminders, undefined);
    deps.sendMessenger = async () => ({ ok: true });
    const again = await pr.runSweep(deps);
    assert.strictEqual(again.messenger, 1);
  }));

  rest.push(() => check('the order is re-read after the claim and not messaged if it was paid', async () => {
    const o = aged(40 * MIN, { psid: 'psid-1', psid_linked_at: NOW.toISOString() });
    const store = [o];
    const sent = [];
    const deps = memDeps(store, NOW, sent);
    const realGet = deps.get;
    deps.get = async (ref) => {
      const fresh = await realGet(ref);
      fresh.state = 'awaiting_qr';
      return fresh;
    };
    const summary = await pr.runSweep(deps);
    assert.strictEqual(summary.released, 1);
    assert.strictEqual(sent.length, 0);
    assert.strictEqual(store[0].payment_reminders, undefined);
  }));

  rest.push(() => check('auto-cancel stays off unless it is literally on, and it waits until both reminders have gone', async () => {
    const o = aged(48 * 60 * MIN, { psid: null });
    const store = [o];
    const sent = [];
    const deps = memDeps(store, NOW, sent);
    deps.settings = { enabled: true, hold_hours: 24, auto_cancel: true };
    const a = await pr.runSweep(deps);
    assert.strictEqual(a.cancelled, 0);
    assert.strictEqual(a.telegram, 1);
    const b = await pr.runSweep(deps);
    assert.strictEqual(b.cancelled, 0);
    assert.strictEqual(b.telegram, 1);
    const c = await pr.runSweep(deps);
    assert.strictEqual(c.cancelled, 1);
    assert.strictEqual(store[0].state, 'cancelled');
    assert.strictEqual(store[0].cancel_reason, 'hold_expired');
  }));

  rest.push(() => check('reminders switched off send nothing, and a literal false is the only off switch', async () => {
    const o = aged(40 * MIN, { psid: 'psid-1', psid_linked_at: NOW.toISOString() });
    const store = [o];
    const sent = [];
    const deps = memDeps(store, NOW, sent);
    deps.settings = { enabled: false, hold_hours: 24, auto_cancel: false };
    const summary = await pr.runSweep(deps);
    assert.strictEqual(summary.messenger, 0);
    assert.strictEqual(sent.length, 0);
    assert.ok(store[0].hold_expires_at, 'the hold timer is independent of the reminder switch');
  }));

  rest.push(() => check('an overlapping sweep does not claim a second time', async () => {
    const o = aged(40 * MIN, { psid: 'psid-1', psid_linked_at: NOW.toISOString() });
    const store = [o];
    const sent = [];
    let release;
    const gate = new Promise(r => { release = r; });
    const deps = memDeps(store, NOW, sent);
    deps.sendMessenger = (psid, text) => gate.then(() => {
      sent.push({ channel: 'messenger', psid, text });
      return { ok: true };
    });
    const first = pr.runSweep(deps);
    await new Promise(r => setImmediate(r));
    const second = await pr.runSweep(deps);
    assert.strictEqual(second.overlapped, true);
    release();
    await first;
    assert.strictEqual(sent.length, 1);
  }));

  rest.push(() => check('a claim in Mongo sticks across a second run and a restart of the caller', async () => {
    const orders = require('../lib/orders');
    const db = fakeDb([aged(40 * MIN)]);
    orders.init(async () => db);
    const first = await orders.claimPaymentReminder('PH-0301', 'nudge');
    assert.ok(first);
    assert.strictEqual(first.payment_reminders.nudge.status, 'claimed');
    assert.strictEqual(await orders.claimPaymentReminder('PH-0301', 'nudge'), null);
    orders.init(async () => db);
    assert.strictEqual(await orders.claimPaymentReminder('PH-0301', 'nudge'), null);
    assert.strictEqual(await orders.claimPaymentReminder('PH-0301', 'last_call') ? 'ok' : 'no', 'ok');
  }));

  rest.push(() => check('releasing a claim allows one retry; completing it does not', async () => {
    const orders = require('../lib/orders');
    const db = fakeDb([aged(40 * MIN, { ref: 'PH-0401' })]);
    orders.init(async () => db);
    await orders.claimPaymentReminder('PH-0401', 'nudge');
    assert.strictEqual(await orders.releasePaymentReminder('PH-0401', 'nudge'), true);
    assert.ok(await orders.claimPaymentReminder('PH-0401', 'nudge'));
    assert.strictEqual(await orders.completePaymentReminder('PH-0401', 'nudge', {
      status: 'sent', channel: 'messenger', sent_at: NOW.toISOString(), reason: null
    }), true);
    assert.strictEqual(await orders.claimPaymentReminder('PH-0401', 'nudge'), null);
    assert.strictEqual(await orders.releasePaymentReminder('PH-0401', 'nudge'), false);
  }));

  rest.push(() => check('paying an order that was reminded records the recovery once', async () => {
    const orders = require('../lib/orders');
    const o = aged(60 * MIN, {
      ref: 'PH-0501',
      amount_due: 349,
      deposit_due: 100,
      payment_reminders: { nudge: { status: 'sent', sent_at: NOW.toISOString(), channel: 'messenger' } }
    });
    const db = fakeDb([o]);
    orders.init(async () => db);
    const moved = await orders.transition('PH-0501', 'awaiting_qr', { paid_at: NOW.toISOString() });
    assert.ok(moved);
    assert.ok(moved.reminder_recovered_at);
    assert.strictEqual(moved.reminder_recovered_amount, 449);
    const again = db.docs[0].reminder_recovered_amount;
    await orders.transition('PH-0501', 'qr_pending', {});
    assert.strictEqual(db.docs[0].reminder_recovered_amount, again);
  }));

  rest.push(() => check('cancelling does not count as money recovered', async () => {
    const orders = require('../lib/orders');
    const o = aged(60 * MIN, {
      ref: 'PH-0502',
      payment_reminders: { nudge: { status: 'sent', sent_at: NOW.toISOString(), channel: 'telegram' } }
    });
    const db = fakeDb([o]);
    orders.init(async () => db);
    const moved = await orders.transition('PH-0502', 'cancelled', { cancel_reason: 'hold_expired' });
    assert.strictEqual(moved.state, 'cancelled');
    assert.strictEqual(moved.reminder_recovered_at, undefined);
  }));

  rest.push(() => check('a claim is refused once the order is no longer awaiting payment', async () => {
    const orders = require('../lib/orders');
    const db = fakeDb([aged(40 * MIN, { ref: 'PH-0503', state: 'awaiting_qr' })]);
    orders.init(async () => db);
    assert.strictEqual(await orders.claimPaymentReminder('PH-0503', 'nudge'), null);
  }));

  rest.push(() => check('the Didn\'t pay row wears a reminder badge', () => {
    const file = path.join(__dirname, '..', 'views', 'partials', 'admin', 'orders', 'ledger.ejs');
    const reminded = order({
      payment_reminders: { last_call: { status: 'sent', sent_at: NOW.toISOString() } }
    });
    const html = ejs.render(fs.readFileSync(file, 'utf8'), {
      ledgerGroups: [{ key: '2026-09', paidCount: 0, paidTotal: 0, orders: [reminded, order({ ref: 'PH-0309' })] }],
      orderPeriod: '2026-09',
      orderPeriods: ['2026-09'],
      orderYears: ['2026'],
      ledgerStats: { paidCount: 0, paidTotal: 0, total: 2 },
      reminderBadge: pr.reminderBadge
    }, { filename: file });
    assert.ok(html.includes('Last call'), html.slice(html.indexOf('PH-0301'), html.indexOf('PH-0301') + 500));
    const other = html.slice(html.indexOf('PH-0309'), html.indexOf('PH-0309') + 400);
    assert.ok(!other.includes('Last call'));
    assert.strictEqual(pr.reminderBadge(reminded), 'last_call');
    assert.strictEqual(pr.reminderBadge(order({
      payment_reminders: { nudge: { status: 'sent', sent_at: NOW.toISOString() } }
    })), 'nudge');
    assert.strictEqual(pr.reminderBadge(order()), null);
  }));

  rest.push(() => check('the order page, the dashboard, and the sweep are wired', () => {
    const root = path.join(__dirname, '..');
    const page = fs.readFileSync(path.join(root, 'views', 'order-status.ejs'), 'utf8');
    assert.ok(page.includes('holdState'));
    assert.ok(page.includes('ordHoldCountdown'));
    assert.ok(page.includes('Hold ended'));
    const overview = fs.readFileSync(path.join(root, 'views', 'partials', 'admin', 'dashboard', 'overview.ejs'), 'utf8');
    assert.ok(overview.includes('dashMetrics.reminders'));
    assert.ok(overview.includes('Reminded'));
    const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    assert.ok(server.includes('paymentReminders.SWEEP_INTERVAL_MS'));
    assert.ok(server.includes("messaging_type: 'RESPONSE'"));
    assert.ok(!/sendMessengerResponse[\s\S]{0,600}tag:/.test(server), 'reminder sends must not set a message tag');
    const settings = fs.readFileSync(path.join(root, 'views', 'partials', 'admin', 'settings.ejs'), 'utf8');
    assert.ok(settings.includes('name="hold_hours"'));
    assert.ok(settings.includes('name="auto_cancel"'));
    assert.ok(settings.includes('payment_reminder'));
    const tg = require('../lib/telegram');
    assert.ok(tg.ALERT_KINDS.includes('payment_reminder'));
    const msg = tg.formatPaymentReminderAlert(
      { ref: 'PH-0301', fb_name: 'Ana Cruz', game_title: 'Tekken 8', amount_due: 349 },
      { stage: 'nudge', reason: 'outside_window', link: 'https://x/order/PH-0301?k=abc' }
    );
    assert.ok(msg.includes('Ana'));
    assert.ok(!msg.includes('Cruz'));
    assert.ok(msg.includes('PH-0301'));
    assert.ok(/window/i.test(msg));
  }));

  for (const t of rest) await t();
  console.log('\n' + passed + ' assertions passed');
})().catch(e => {
  console.error('\nFAILED: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});

function memDeps(store, now, sent) {
  function find(ref) { return store.find(o => o.ref === ref); }
  return {
    now,
    settings: { enabled: true, hold_hours: 24, auto_cancel: false },
    alertEnabled: true,
    adminUrl: 'https://x/admin?tab=orders',
    listAwaiting: async () => store.filter(o => o.state === 'awaiting_payment'),
    get: async (ref) => find(ref),
    claim: async (ref, stage) => {
      const o = find(ref);
      if (!o || o.state !== 'awaiting_payment') return null;
      o.payment_reminders = o.payment_reminders || {};
      if (o.payment_reminders[stage]) return null;
      o.payment_reminders[stage] = { status: 'claimed', claimed_at: now.toISOString() };
      return o;
    },
    release: async (ref, stage) => {
      const o = find(ref);
      if (!o || !o.payment_reminders || !o.payment_reminders[stage]) return false;
      if (o.payment_reminders[stage].status !== 'claimed') return false;
      delete o.payment_reminders[stage];
      if (!Object.keys(o.payment_reminders).length) delete o.payment_reminders;
      return true;
    },
    complete: async (ref, stage, result) => {
      const o = find(ref);
      if (!o || !o.payment_reminders || !o.payment_reminders[stage]) return false;
      if (o.payment_reminders[stage].status !== 'claimed') return false;
      o.payment_reminders[stage] = result;
      return true;
    },
    setHold: async (ref, plan) => {
      const o = find(ref);
      if (!o) return false;
      o.hold_expires_at = plan.expires;
      o.hold_anchor = plan.anchor;
      return true;
    },
    cancel: async (ref) => {
      const o = find(ref);
      if (!o || o.state !== 'awaiting_payment') return false;
      o.state = 'cancelled';
      o.cancel_reason = 'hold_expired';
      return true;
    },
    contactFor: async (psid) => null,
    orderLink: (o) => 'https://playstation-hub.com/order/' + o.ref + '?k=' + o.url_key,
    sendMessenger: async (psid, text) => {
      sent.push({ channel: 'messenger', psid, text });
      return { ok: true };
    },
    sendTelegram: async (text) => {
      sent.push({ channel: 'telegram', text });
      return { ok: true };
    }
  };
}

function getPath(doc, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
}
function setPath(doc, dotted, value) {
  const parts = dotted.split('.');
  let o = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
}
function unsetPath(doc, dotted) {
  const parts = dotted.split('.');
  let o = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o == null) return;
    o = o[parts[i]];
  }
  if (o) delete o[parts[parts.length - 1]];
}
function matches(doc, query) {
  return Object.keys(query || {}).every(k => {
    const cond = query[k];
    const val = getPath(doc, k);
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$exists' in cond) return cond.$exists ? val !== undefined : val === undefined;
      if ('$in' in cond) return cond.$in.includes(val);
      throw new Error('fake collection got an operator it does not implement: ' + JSON.stringify(cond));
    }
    return val === cond;
  });
}
function applyUpdate(doc, u) {
  Object.keys(u.$set || {}).forEach(k => setPath(doc, k, u.$set[k]));
  Object.keys(u.$unset || {}).forEach(k => unsetPath(doc, k));
  if (u.$push) {
    Object.keys(u.$push).forEach(k => {
      const cur = getPath(doc, k);
      const arr = Array.isArray(cur) ? cur : [];
      arr.push(u.$push[k]);
      setPath(doc, k, arr);
    });
  }
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
      if (!d) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(d, u);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    findOneAndUpdate: async (q, u) => {
      const d = docs.find(x => matches(x, q));
      if (!d) return null;
      applyUpdate(d, u);
      return Object.assign({}, d);
    }
  };
  return { docs, collection: () => col };
}
