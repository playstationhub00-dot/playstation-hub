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

console.log('\n' + passed + ' assertions passed');
