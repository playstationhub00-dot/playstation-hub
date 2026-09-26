// Run: node scripts/test-game-form.js
//
// The Add and Edit game forms: the three fields that did nothing are gone,
// every other field still posts under its old name, and the rest sits in five
// labelled sections. Plus the two save routes in server.js, checked at source
// level the way scripts/test-release-wiring.js checks that file.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const SETTINGS = { title: 'PlayStation Hub', favicon_path: '/favicon.svg', logo_path: '/logo.svg', payment_methods: [] };
const GAME = {
  id: 7, title: "Marvel's Spider-Man 2", platform: 'PS5', genre: 'Action', release_date: '2023-10-20',
  non_trophy_slots: 2, trophy_slots: 1, ps4_primary_slots: 0,
  nt_price_7d: 149, nt_price_30d: 349, tr_price_7d: 199, tr_price_30d: 399, buy_nt_price: 0, buy_tr_price: 0,
  cost: 2000, new_window_days: null, description: 'Swing.', link_label: '', link_url: '',
  cover_image: '/uploads/sm2.webp', gallery: []
};

function render(file, locals) {
  const f = path.join(ROOT, 'views', file);
  return ejs.render(fs.readFileSync(f, 'utf8'), Object.assign({
    settings: SETTINGS, priceCategories: [], accounts: [{ id: 1, label: 'Account A', game_ids: [7] }], msg: null, assetV: '1'
  }, locals), { filename: f });
}
const EDIT = render('edit.ejs', { game: GAME });
const ADD = render('add-game.ejs', { presetBundle: false });
const ADD_BUNDLE = render('add-game.ejs', { presetBundle: true });

const REMOVED = ['trophy_account', 'available_slots', 'renters'];
const KEPT = ['title', 'platform', 'genre', 'release_date', 'description', 'non_trophy_slots', 'trophy_slots', 'ps4_primary_slots',
  'price_mode', 'price_category_id', 'nt_price_7d', 'nt_price_30d', 'tr_price_7d', 'tr_price_30d', 'buy_nt_price', 'buy_tr_price',
  'cover_image', 'gallery', 'is_bundle', 'bundle_account_id', 'new_window_days', 'cost', 'link_label', 'link_url'];
const SECTIONS = ['📝 Basics', '🎮 Slots', '💰 Prices', '🖼️ Images', '🧩 Extras'];

// The markup of one form section: from its title to the next section's title.
function section(html, title) {
  const a = html.indexOf('<span class="afg-title">' + title + '</span>');
  assert.ok(a >= 0, 'section ' + title);
  const b = html.indexOf('<span class="afg-title">', a + 10);
  return html.slice(a, b > 0 ? b : undefined);
}

console.log('\nremoved fields');

ok('neither form has the Trophy switch, the total-slots field or the renters field', () => {
  [['edit', EDIT], ['add', ADD]].forEach(([name, html]) => {
    REMOVED.forEach(f => assert.ok(!html.includes('name="' + f + '"'), name + ' still has ' + f));
    assert.ok(!html.includes('toggle-switch'), name + ' still has a toggle switch');
  });
});

console.log('\nkept fields');

ok('every other field still posts under its old name, in both forms', () => {
  [['edit', EDIT], ['add', ADD]].forEach(([name, html]) => {
    KEPT.forEach(f => assert.ok(html.includes('name="' + f + '"'), name + ' lost ' + f));
  });
});

ok('Edit keeps the focal-point fields and fills in the saved values', () => {
  assert.ok(EDIT.includes('name="cover_focal_x"') && EDIT.includes('name="cover_focal_y"'));
  assert.ok(EDIT.includes('name="trophy_slots" value="1" min="0"'));
  assert.ok(EDIT.includes('value="Marvel&#39;s Spider-Man 2"'));
});

ok('Add starts Trophy at 1 and allows 0', () => {
  assert.ok(ADD.includes('name="trophy_slots" value="1" min="0"'));
});

console.log('\nsections');

ok('both forms have the five sections, in order', () => {
  [['edit', EDIT], ['add', ADD]].forEach(([name, html]) => {
    const at = SECTIONS.map(s => html.indexOf('<span class="afg-title">' + s + '</span>'));
    assert.ok(at.every(n => n >= 0), name + ' is missing a section: ' + at);
    assert.deepStrictEqual(at.slice().sort((a, b) => a - b), at, name + ' sections are out of order');
  });
});

ok('each field sits in its section', () => {
  [['📝 Basics', 'description'], ['🎮 Slots', 'trophy_slots'], ['🎮 Slots', 'ps4_primary_slots'], ['💰 Prices', 'buy_tr_price'],
   ['🖼️ Images', 'gallery'], ['🧩 Extras', 'is_bundle'], ['🧩 Extras', 'cost'], ['🧩 Extras', 'link_url'], ['🧩 Extras', 'new_window_days']]
    .forEach(([s, f]) => {
      assert.ok(section(EDIT, s).includes('name="' + f + '"'), 'edit: ' + f + ' not in ' + s);
      assert.ok(section(ADD, s).includes('name="' + f + '"'), 'add: ' + f + ' not in ' + s);
    });
});

console.log('\nPS4 Primary');

ok('PS4 Primary hides on a PS5 game and follows the platform select', () => {
  assert.ok(EDIT.includes('<select name="platform" onchange="gfPlatformChanged(this.value)">'));
  assert.ok(EDIT.includes('id="gf_ps4" style="display:none;"'));
  assert.ok(render('edit.ejs', { game: Object.assign({}, GAME, { platform: 'PS4/PS5' }) }).includes('id="gf_ps4" style=""'));
  assert.ok(ADD.includes('id="gf_ps4" style="display:none;"'));
  [EDIT, ADD].forEach(html => assert.ok(html.includes('function gfPlatformChanged(v)')));
});

console.log('\nbundle preset');

ok('?bundle=1 still starts with the bundle box ticked and Extras open', () => {
  assert.ok(ADD_BUNDLE.includes('id="add_bundle_chk" checked'));
  assert.ok(ADD_BUNDLE.includes('id="afg_extras" open>'));
  assert.ok(!ADD.includes('id="add_bundle_chk" checked'));
  assert.ok(ADD.includes('id="afg_extras">'));
});

ok('the section styles live in style.css, not inline in the Add page', () => {
  const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  ['.afg-sec {', '.afg-head {', '.afg-title', '.afg-body {', '.afg-sec[open] > .afg-head .afg-arrow'].forEach(r => assert.ok(CSS.includes(r), r));
  assert.ok(!fs.readFileSync(path.join(ROOT, 'views', 'add-game.ejs'), 'utf8').includes('<style>'));
});

console.log('\nsave routes (server.js)');

const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
function route(marker) {
  const i = SRC.indexOf(marker);
  assert.ok(i >= 0, 'server.js still has ' + marker);
  const next = SRC.indexOf('\napp.', i + marker.length);
  return SRC.slice(i, next > 0 ? next : undefined);
}
const ADD_ROUTE = route("app.post('/admin/add', ");
const EDIT_ROUTE = route("app.post('/admin/edit/:id', ");

ok('neither route reads the removed fields from the form', () => {
  [ADD_ROUTE, EDIT_ROUTE].forEach(r => {
    assert.ok(!/available_slots,\s*renters/.test(r));
    assert.ok(!r.includes('parseInt(available_slots)'));
    assert.ok(!r.includes('parseInt(renters)'));
  });
});

ok('Edit leaves the stored total and renters alone', () => {
  assert.ok(!EDIT_ROUTE.includes('available_slots:'));
  assert.ok(!EDIT_ROUTE.includes('renters:'));
});

ok('Add starts at 0 renters with the total set from the slot counts', () => {
  assert.ok(ADD_ROUTE.includes('renters: 0,'));
  assert.ok(ADD_ROUTE.includes('available_slots: (parseInt(non_trophy_slots) || 0) + (parseInt(trophy_slots) || 0) + (parseInt(ps4_primary_slots) || 0),'));
});

console.log('\n' + passed + ' assertions passed\n');
