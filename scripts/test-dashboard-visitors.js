// Run: node scripts/test-dashboard-visitors.js
//
// public/js/dashboard-visitors.js (the markup for the Site tab's visitor cards)
// and the wiring of views/partials/admin/dashboard/site.ejs and public/css/style.css.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dv = require('../public/js/dashboard-visitors.js');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const win = (extra) => Object.assign({
  funnel: [
    { label: 'Landed', count: 300, pctOfPrev: null },
    { label: 'Viewed a game', count: 200, pctOfPrev: 67 },
    { label: 'Messaged us', count: 42, pctOfPrev: 14 },
    { label: 'Ordered on website', count: 0, pctOfPrev: 0 },
    { label: 'Paid', count: 0, pctOfPrev: null }
  ],
  browsed: { count: 37, total: 300, pct: 12 },
  skipped: 0,
  asked: { games: [], other: 0 },
  misses: []
}, extra || {});

console.log('\nfunnel and note');
ok('the funnel draws one row per stage with counts and percentages', () => {
  const h = dv.funnelHtml(win());
  assert.strictEqual((h.match(/class="vf-row"/g) || []).length, 5);
  assert.ok(h.includes('Messaged us') && h.includes('<strong>42</strong> <span class="vf-pct">14%</span>'));
  assert.ok(h.includes('width:100%') && h.includes('width:14%'));
});
ok('the browsed note names the skipped robot hits only when there are some', () => {
  assert.ok(!/robot/.test(dv.browsedHtml(win())));
  const h = dv.browsedHtml(win({ skipped: 113 }));
  assert.ok(h.includes('<strong>37</strong> of <strong>300</strong>'));
  assert.ok(h.includes('<strong>113</strong> robot / system hits not counted'));
});

console.log('\nasked-about games');
ok('rows show cover, title, free / booked badge and count; plus the no-game line', () => {
  const h = dv.askedHtml(win({ asked: { games: [
    { slug: 'a', title: 'God of War', cover: '/uploads/a.png', slots: 2, count: 11 },
    { slug: 'b', title: 'Spider-Man', cover: '', slots: 0, count: 8 }
  ], other: 17 } }));
  assert.ok(h.includes('<img class="vf-ask-img" src="/uploads/a.png"'));
  assert.ok(h.includes('vf-ask-ok">2 free<'));
  assert.ok(h.includes('vf-ask-no">booked<'));
  assert.ok(h.includes('+ taps with no specific game: 17'));
});
ok('empty state', () => {
  assert.ok(dv.askedHtml(win()).includes('No Message Us taps yet.'));
  assert.ok(dv.askedHtml(undefined).includes('No Message Us taps yet.'));
});
ok('titles are escaped', () => {
  const h = dv.askedHtml(win({ asked: { games: [{ slug: 'x', title: '<img src=x onerror=alert(1)>', cover: '', slots: 1, count: 1 }], other: 0 } }));
  assert.ok(!h.includes('<img src=x'));
  assert.ok(h.includes('&lt;img src=x'));
});

console.log('\nsearched, nothing found');
ok('lists phrases with counts, escaped; empty string when none', () => {
  const h = dv.missesHtml(win({ misses: [{ q: 'elden ring', count: 3 }, { q: '<b>x</b>', count: 1 }] }));
  assert.ok(h.includes('elden ring') && h.includes('<strong>3</strong> searches') && h.includes('<strong>1</strong> search<'));
  assert.ok(!h.includes('<b>x</b>'));
  assert.strictEqual(dv.missesHtml(win()), '');
});

console.log('\nwiring');
const site = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin', 'dashboard', 'site.ejs'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
ok('site.ejs loads the script before its inline block and has both new panels', () => {
  const s = site.indexOf('/js/dashboard-visitors.js?v=<%= assetV %>');
  assert.ok(s > 0, 'script tag present');
  assert.ok(s < site.indexOf('const VIS_WINDOWS'), 'loaded before the inline script that uses it');
  assert.ok(site.includes('id="vfAskedBody"') && site.includes('id="vfMissesBody"') && site.includes('id="vfMissesPanel"'));
  assert.ok(/DashVisitors\.funnelHtml\(win\)/.test(site) && /DashVisitors\.askedHtml\(win\)/.test(site) && /DashVisitors\.missesHtml\(win\)/.test(site));
});
ok('the stylesheet styles the new rows', () => {
  for (const c of ['.vf-ask-row', '.vf-ask-img', '.vf-ask-badge', '.vf-ask-ok', '.vf-ask-no', '.vf-ask-n', '.vf-ask-other']) {
    assert.ok(css.includes(c), c + ' missing from style.css');
  }
});

console.log('\n' + passed + ' assertions passed\n');
