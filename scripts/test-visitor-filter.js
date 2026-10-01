// Run: node scripts/test-visitor-filter.js
const assert = require('assert');
const f = require('../lib/visitor-filter');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FB_IAB = 'Mozilla/5.0 (Linux; Android 13; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.40.108;]';

console.log('\nisBotUserAgent');
ok('empty / missing user-agent is a bot', () => {
  assert.strictEqual(f.isBotUserAgent(''), true);
  assert.strictEqual(f.isBotUserAgent(undefined), true);
  assert.strictEqual(f.isBotUserAgent('   '), true);
});
ok('robots and preview fetchers are bots', () => {
  for (const ua of [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.23.20.0 A', 'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0)', 'UptimeRobot/2.0', 'curl/8.4.0',
    'python-requests/2.31.0', 'Mozilla/5.0 HeadlessChrome/124.0', 'Pingdom.com_bot_version_1.4',
    'Go-http-client/2.0', 'node-fetch/1.0', 'TelegramBot (like TwitterBot)'
  ]) assert.strictEqual(f.isBotUserAgent(ua), true, ua);
});
ok('real phone browsers, including the Facebook in-app browser, are not bots', () => {
  assert.strictEqual(f.isBotUserAgent(IPHONE), false);
  assert.strictEqual(f.isBotUserAgent(FB_IAB), false);
});

console.log('\npaths');
ok('webhooks are webhook paths; /api/* is system but not a webhook', () => {
  assert.strictEqual(f.isWebhookPath('/webhook'), true);
  assert.strictEqual(f.isWebhookPath('/webhooks/paymongo'), true);
  assert.strictEqual(f.isWebhookPath('/api/search-index'), false);
  assert.strictEqual(f.isSystemPath('/api/search-index'), true);
  assert.strictEqual(f.isSystemPath('/api/track/message'), true);
  assert.strictEqual(f.isSystemPath('/browse'), false);
  assert.strictEqual(f.isSystemPath('/webhookish'), false);
});

console.log('\nclassifyRequest');
ok('classes', () => {
  assert.strictEqual(f.classifyRequest({ method: 'GET', path: '/browse', userAgent: IPHONE }), 'page');
  assert.strictEqual(f.classifyRequest({ method: 'HEAD', path: '/', userAgent: IPHONE }), 'page');
  assert.strictEqual(f.classifyRequest({ method: 'POST', path: '/order/create', userAgent: IPHONE }), 'action');
  assert.strictEqual(f.classifyRequest({ method: 'GET', path: '/', userAgent: 'facebookexternalhit/1.1' }), 'bot');
  assert.strictEqual(f.classifyRequest({ method: 'GET', path: '/api/search-index', userAgent: IPHONE }), 'system');
  assert.strictEqual(f.classifyRequest({ method: 'POST', path: '/webhooks/paymongo', userAgent: '' }), 'system');
  assert.strictEqual(f.classifyRequest({ method: undefined, path: '/', userAgent: IPHONE }), 'page');
});

console.log('\n' + passed + ' assertions passed\n');
