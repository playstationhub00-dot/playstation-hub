// Run: node scripts/test-trophy-always.js
//
// Every game has both Trophy and Non-Trophy accounts, so the Trophy switch is
// gone: saving a game always stores Trophy on, and games saved with the old
// switch off are brought into line at startup. The customer-side half (the
// site always offers Trophy) is in scripts/test-availability.js.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
function route(marker) {
  const i = SRC.indexOf(marker);
  assert.ok(i >= 0, 'server.js still has ' + marker);
  const next = SRC.indexOf('\napp.', i + marker.length);
  return SRC.slice(i, next > 0 ? next : undefined);
}
const ADD_ROUTE = route("app.post('/admin/add', ");
const EDIT_ROUTE = route("app.post('/admin/edit/:id', ");

console.log('\nTrophy always on');

ok('startup brings every game to Trophy on', () => {
  assert.ok(SRC.includes('if (g.trophy_account !== true) patch.trophy_account = true;'));
  assert.ok(!SRC.includes('if (g.trophy_account === undefined) patch.trophy_account = false;'));
});

ok('Add and Edit always save Trophy on, with the slot count as typed', () => {
  [ADD_ROUTE, EDIT_ROUTE].forEach(r => {
    assert.ok(r.includes('trophy_slots: parseInt(trophy_slots) || 0,'));
    assert.ok(r.includes('trophy_account: true,'));
    assert.ok(!r.includes("trophy_account === 'on'"));
  });
});

ok('neither route reads a trophy_account field from the form', () => {
  [ADD_ROUTE, EDIT_ROUTE].forEach(r => assert.ok(!r.includes('release_date, trophy_account, trophy_slots')));
});

ok('availability no longer consults the old switch', () => {
  const lib = fs.readFileSync(path.join(ROOT, 'lib', 'availability.js'), 'utf8');
  assert.ok(!lib.includes('game.trophy_account'));
});

console.log('\n' + passed + ' assertions passed\n');
