// Run: node scripts/test-message-taps.js
//
// public/js/message-taps.js with a stubbed browser: which clicks send a beacon,
// what it carries, and that nav / footer links are tagged and the script is
// loaded by the nav.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const sent = [];
global.location = { pathname: '/game/zzyzx-test-quest' };
// Node defines a read-only global navigator, so it has to be replaced explicitly.
Object.defineProperty(global, 'navigator', { configurable: true, value: { sendBeacon: (url, blob) => { sent.push({ url, blob }); return true; } } });
global.document = { addEventListener() {} };
const taps = require('../public/js/message-taps.js');

function link(href, source) {
  const a = { getAttribute: n => (n === 'href' ? href : n === 'data-track-source' ? source || null : null) };
  return { target: { closest: sel => (sel === 'a[href]' ? a : null) } };
}
async function lastBody() { return JSON.parse(await sent[sent.length - 1].blob.text()); }

async function main() {
  console.log('\nmessage-taps.js');

  ok('a tap on an m.me link sends one beacon to /api/track/message', () => {
    taps.onTap(link('http://m.me/PlaystationHub00?text=Hi'));
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].url, '/api/track/message');
    assert.strictEqual(sent[0].blob.type, 'application/json');
  });

  const body = await lastBody();
  ok('it carries the page path and defaults the source to other', () => {
    assert.deepStrictEqual(body, { page: '/game/zzyzx-test-quest', source: 'other' });
  });

  ok('data-track-source is passed along', async () => {
    taps.onTap(link('https://m.me/PlaystationHub00', 'fab'));
    assert.strictEqual(sent.length, 2);
  });
  assert.deepStrictEqual(await lastBody(), { page: '/game/zzyzx-test-quest', source: 'fab' });

  ok('other links and non-link clicks send nothing', () => {
    taps.onTap(link('/browse'));
    taps.onTap(link('http://m.me/SomeoneElse'));
    taps.onTap({ target: { closest: () => null } });
    taps.onTap(undefined);
    assert.strictEqual(sent.length, 2);
  });

  console.log('\nnav and footer markup');
  const read = f => fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', f), 'utf8');
  const nav = read('nav.ejs');
  const footer = read('footer.ejs');

  ok('the nav loads the tap script', () => {
    assert.ok(/<script src="\/js\/message-taps\.js\?v=<%= assetV %>" defer><\/script>/.test(nav));
  });
  ok('nav buttons, the phone button and the footer links are tagged', () => {
    assert.strictEqual((nav.match(/class="nav-cta" data-track-source="nav"/g) || []).length, 2);
    assert.ok(/class="mobile-fab" data-track-source="fab"/.test(nav));
    assert.ok(/class="navsearch-empty-btn2" data-track-source="search-empty"/.test(nav));
    assert.ok(/class="social-icon messenger" data-track-source="footer"/.test(footer));
    assert.ok(/rel="noopener" data-track-source="footer">Message Us on Messenger/.test(footer));
  });

  console.log('\n' + passed + ' assertions passed\n');
}
main().catch(e => { console.error(e); process.exit(1); });
