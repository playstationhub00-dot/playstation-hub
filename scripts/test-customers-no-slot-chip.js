// Run: node scripts/test-customers-no-slot-chip.js
//
// The Customers tab used to carry a "🗂️ <account>" chip on each live rental:
// a dropdown that moved the rental to a different account slot. The owner
// moves a rental from the customer's Edit form instead (its account picker
// does the same job), so the chip, its route, its toast and its styles are
// gone. The Edit form's picker must still be there.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

ok('no slot chip or its lookup on the Customers tab', () => {
  const tab = read('views/partials/admin/customers.ejs');
  ['cst-slot', 'CST_SLOT_BY_CUSTOMER', 'custSlotLabel', 'custSlotAssign', '/slot"']
    .forEach(s => assert.ok(!tab.includes(s), s));
});

ok('no route, toast or styles for it', () => {
  assert.ok(!read('server.js').includes("app.post('/admin/customers/:id/slot'"), 'route');
  assert.ok(!read('views/admin.ejs').includes('slot_moved'), 'toast');
  assert.ok(!read('public/css/style.css').includes('.cst-slot'), 'styles');
});

ok('the Edit form still moves a rental to another account', () => {
  assert.ok(read('views/edit-customer.ejs').includes('<select name="account_assign">'));
});

console.log('\n' + passed + ' assertions passed\n');
