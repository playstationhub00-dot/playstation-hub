// Plain assert-based tests for the Telegram alert adapter. No test framework in
// this project by design — run with `node scripts/test-telegram.js`, which exits
// non-zero on the first failed assertion.
//
// No network and no credentials: every function here is pure, so the message
// the owner would receive is asserted exactly without a bot existing.
const assert = require('assert');
const tg = require('../lib/telegram');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

const ORDER = { ref: 'PH-0071', fb_name: 'Arlloyd Paredes', game_title: "Marvel's Wolverine" };

check('the api url embeds the bot token', () => {
  assert.strictEqual(tg.apiUrl('123:ABC'), 'https://api.telegram.org/bot123:ABC/sendMessage');
});

check('the payload names the chat and carries the text', () => {
  const p = tg.messagePayload('456', 'hello');
  assert.strictEqual(p.chat_id, '456');
  assert.strictEqual(p.text, 'hello');
  // Link previews would turn every alert into a fat card for the admin URL.
  assert.strictEqual(p.disable_web_page_preview, true);
});

check('the feature is off unless both variables are set', () => {
  // Either one missing means the whole alert is simply absent — not an error,
  // not a log line on every submission.
  assert.strictEqual(tg.isConfigured({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' }), true);
  assert.strictEqual(tg.isConfigured({ TELEGRAM_BOT_TOKEN: 't' }), false);
  assert.strictEqual(tg.isConfigured({ TELEGRAM_CHAT_ID: 'c' }), false);
  assert.strictEqual(tg.isConfigured({}), false);
  assert.strictEqual(tg.isConfigured(null), false);
  assert.strictEqual(tg.isConfigured({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: 'c' }), false);
  assert.strictEqual(tg.isConfigured({ TELEGRAM_BOT_TOKEN: '  ', TELEGRAM_CHAT_ID: 'c' }), false);
});

check('a code alert carries the code itself', () => {
  // The whole point: the owner types this straight from the phone notification
  // without opening the admin panel, so the code has to be in the message.
  const msg = tg.formatQrAlert(ORDER, { code: 'ABCD1234', expiresAt: '5:42 PM', adminUrl: 'https://x/admin' });
  assert.ok(msg.includes('PH-0071'), 'has the ref');
  assert.ok(msg.includes('ABCD1234'), 'has the code');
  assert.ok(msg.includes('Arlloyd'), 'has the first name');
  assert.ok(msg.includes("Marvel's Wolverine"), 'has the game');
  assert.ok(msg.includes('5:42 PM'), 'has the expiry');
  assert.ok(msg.includes('https://x/admin'), 'has the admin link');
});

check('only the first name is sent, never the full name', () => {
  const msg = tg.formatQrAlert(ORDER, { code: 'ABCD1234', expiresAt: '5:42 PM', adminUrl: 'https://x/admin' });
  assert.ok(!msg.includes('Paredes'), 'surname must not leave the site');
});

check('a photo alert says so instead of showing a code', () => {
  // No code to type means the owner has to open admin, and the message should
  // say that rather than looking like a code alert with a blank field.
  const msg = tg.formatQrAlert(ORDER, { expiresAt: '5:42 PM', adminUrl: 'https://x/admin' });
  assert.ok(!/Code:/.test(msg), 'must not render an empty Code line');
  assert.ok(/photo/i.test(msg), 'says a photo is waiting');
});

check('a missing name or game never prints undefined', () => {
  const msg = tg.formatQrAlert({ ref: 'PH-0072' }, { code: 'WXYZ9999', adminUrl: 'https://x/admin' });
  assert.ok(!/undefined|null|NaN/.test(msg), 'no placeholder leakage: ' + msg);
  assert.ok(msg.includes('PH-0072'));
  assert.ok(msg.includes('WXYZ9999'));
});

check('a malformed order does not throw', () => {
  // Formatting runs inside a fire-and-forget alert on a customer request path;
  // throwing here must never be able to affect the submission.
  assert.strictEqual(typeof tg.formatQrAlert(null, {}), 'string');
  assert.strictEqual(typeof tg.formatQrAlert({}, null), 'string');
  assert.strictEqual(typeof tg.formatQrAlert(undefined, undefined), 'string');
});

const RENT = {
  ref: 'PH-0083', fb_name: 'Maria Santos', game_title: 'Ghost of Yotei',
  account_type: 'tr', days: 30, amount_due: 399, deposit_due: 100
};

check('a new-order alert names the order and what it is worth', () => {
  const msg = tg.formatOrderAlert(RENT, { kind: 'created', adminUrl: 'https://x/admin' });
  assert.ok(/New order/i.test(msg), 'says it is new: ' + msg);
  assert.ok(msg.includes('PH-0083'));
  assert.ok(msg.includes('Maria'));
  assert.ok(msg.includes('Ghost of Yotei'));
  assert.ok(msg.includes('Trophy'));
  assert.ok(msg.includes('Monthly'));
  assert.ok(msg.includes('499'), 'rent plus deposit: ' + msg);
  assert.ok(msg.includes('https://x/admin'));
});

check('the three order kinds read differently', () => {
  const of = k => tg.formatOrderAlert(RENT, { kind: k, adminUrl: 'https://x/admin' });
  assert.ok(/New order/i.test(of('created')));
  assert.ok(/approve/i.test(of('review')), 'review must say it needs approving');
  assert.ok(/paid/i.test(of('paid')), 'paid must say the money landed');
  // The one that blocks must not read like the two that do not.
  assert.notStrictEqual(of('created'), of('review'));
  assert.notStrictEqual(of('review'), of('paid'));
});

check('only the first name is sent, never the surname', () => {
  ['created', 'review', 'paid'].forEach(k => {
    const msg = tg.formatOrderAlert(RENT, { kind: k, adminUrl: 'https://x/admin' });
    assert.ok(!msg.includes('Santos'), k + ' leaked the surname');
  });
});

check('a free waitlist entry shows no price', () => {
  // "₱0" on a Fall in Line entry reads like a bug, and the entry genuinely
  // owes nothing until it is upgraded.
  const msg = tg.formatOrderAlert(
    { ref: 'PH-0084', fb_name: 'Josh', game_title: 'Onimusha', account_type: 'nt', days: 30, is_waitlist: true, amount_due: 100 },
    { kind: 'created', adminUrl: 'https://x/admin' }
  );
  assert.ok(/free/i.test(msg), 'should say free: ' + msg);
  assert.ok(!/₱/.test(msg), 'should not quote a price: ' + msg);
});

check('a buy order is labelled a purchase, not a duration', () => {
  const msg = tg.formatOrderAlert(
    { ref: 'PH-0085', fb_name: 'Ana', game_title: 'Elden Ring', account_type: 'nt', is_buy: true, amount_due: 1500, deposit_due: 0 },
    { kind: 'created', adminUrl: 'https://x/admin' }
  );
  assert.ok(/one-time|purchase|buy/i.test(msg), 'should mark it a purchase: ' + msg);
  assert.ok(!/Monthly|Weekly/.test(msg), 'a buy has no rental duration: ' + msg);
});

check('account types render as the labels used everywhere else', () => {
  const t = a => tg.formatOrderAlert(Object.assign({}, RENT, { account_type: a }), { kind: 'created', adminUrl: 'u' });
  assert.ok(t('tr').includes('Trophy'));
  assert.ok(t('ps4').includes('PS4 Primary'));
  assert.ok(t('nt').includes('Non-Trophy'));
});

check('a sparse order never prints undefined', () => {
  const msg = tg.formatOrderAlert({ ref: 'PH-0086' }, { kind: 'created', adminUrl: 'https://x/admin' });
  assert.ok(!/undefined|null|NaN/.test(msg), msg);
  assert.ok(msg.includes('PH-0086'));
});

check('a malformed order alert does not throw', () => {
  // Fired from a customer request path, so it must never be able to break one.
  assert.strictEqual(typeof tg.formatOrderAlert(null, null), 'string');
  assert.strictEqual(typeof tg.formatOrderAlert(undefined, { kind: 'created' }), 'string');
  assert.strictEqual(typeof tg.formatOrderAlert({}, {}), 'string');
});

check('a game request alert carries the title and who asked', () => {
  const msg = tg.formatRequestAlert(
    { title: 'Silent Hill f', fb_name: 'Maria Santos' },
    { adminUrl: 'https://x/admin?tab=requests' }
  );
  assert.ok(/request/i.test(msg));
  assert.ok(msg.includes('Silent Hill f'));
  assert.ok(msg.includes('Maria'));
  assert.ok(!msg.includes('Santos'), 'surname must not leave the site');
  assert.ok(msg.includes('https://x/admin?tab=requests'));
});

check('an anonymous request still reads cleanly', () => {
  const msg = tg.formatRequestAlert({ title: 'Silent Hill f' }, { adminUrl: 'https://x/admin' });
  assert.ok(!/undefined|null/.test(msg), msg);
  assert.ok(msg.includes('Silent Hill f'));
});

check('a malformed request alert does not throw', () => {
  assert.strictEqual(typeof tg.formatRequestAlert(null, null), 'string');
  assert.strictEqual(typeof tg.formatRequestAlert({}, {}), 'string');
});

console.log('\n' + passed + ' assertions passed');
