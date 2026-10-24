// Run: node scripts/test-queue-session-privacy.js
//
// The public queue strip must never carry anyone's visitor session id (it is a
// cookie credential), yet the viewer's own row must still be highlighted. The
// server can't hold orders without MongoDB, so this renders the real partial
// from real buildQueue output.
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const queue = require('../lib/queue');

const NOW = new Date('2026-09-10T00:00:00Z');
const mk = (ref, sid, n) => ({ ref, account_type: 'tr', state: 'waitlisted', fb_name: n, session_id: sid, created_at: '2026-09-0' + ref.slice(-1) + 'T00:00:00Z' });
const MINE = 'a'.repeat(32), OTHER = 'b'.repeat(32);
const orders = [mk('PH-0001', OTHER, 'Bea Cruz'), mk('PH-0002', MINE, 'Me Myself')];

function render(selfSession) {
  const queues = queue.buildQueue(orders, NOW, selfSession);
  return ejs.renderFile(path.join(__dirname, '..', 'views', 'partials', 'queue-line.ejs'),
    { queues, activeType: 'tr', selfRef: null, suffix: '', hideStrip: true });
}

(async () => {
  const html = await render(MINE);
  assert.ok(!html.includes(OTHER), 'other visitor session id leaked into the page');
  assert.ok(!html.includes(MINE), 'own session id should not be echoed either');
  assert.ok(!/sessionId|SELF_SESSION/.test(html), 'session fields still in the page');
  const data = JSON.parse(/var DATA = (.*?);\n/.exec(html)[1]);
  assert.deepStrictEqual(data.tr.map(r => r.isSelf), [false, true]);
  const anon = JSON.parse(/var DATA = (.*?);\n/.exec(await render(null))[1]);
  assert.deepStrictEqual(anon.tr.map(r => r.isSelf), [false, false]);
  console.log('ok - queue strip hides session ids and flags only the viewer');
})().catch(e => { console.error(e); process.exit(1); });
