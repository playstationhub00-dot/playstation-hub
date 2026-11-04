// Run: node scripts/test-admin-confirm.js
//
// Which admin action gets which confirm, and the DELETE word gate.
const assert = require('assert');
const confirm = require('../public/js/admin-confirm');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

ok('deleting an order or an account requires typing DELETE', () => {
  assert.strictEqual(confirm.classifyAdminAction('/admin/orders/PH-0313/delete'), 'delete-typed');
  assert.strictEqual(confirm.classifyAdminAction('/admin/accounts/delete/14'), 'delete-typed');
});

ok('deleting a customer who also has an order requires typing DELETE', () => {
  assert.strictEqual(
    confirm.classifyAdminAction('/admin/customers/delete/9', { deletesOrder: true }),
    'delete-typed'
  );
});

ok('a customer row with no order is a simple confirm', () => {
  assert.strictEqual(confirm.classifyAdminAction('/admin/customers/delete/9'), 'delete-simple');
  assert.strictEqual(
    confirm.classifyAdminAction('/admin/customers/delete/9', { deletesOrder: false }),
    'delete-simple'
  );
});

ok('smaller deletes use a simple confirm', () => {
  [
    '/admin/hero-slides/delete',
    '/admin/signin-steps/3/delete',
    '/admin/signin-code-example/remove',
    '/admin/reviews/delete/4',
    '/admin/announcements/delete/2',
    '/admin/posters/background/remove',
    '/admin/upcoming/delete/8',
    '/admin/psplus/delete/1',
    '/admin/psplus/popular/delete/2',
    '/admin/requests/onimusha/delete',
    '/admin/delete/12'
  ].forEach(url => assert.strictEqual(confirm.classifyAdminAction(url), 'delete-simple', url));
});

ok('mark paid and release have their own confirms and do not ask for DELETE', () => {
  assert.strictEqual(confirm.classifyAdminAction('/admin/orders/PH-0313/mark-paid'), 'mark-paid');
  assert.strictEqual(confirm.classifyAdminAction('/admin/upcoming/release/8'), 'release');
});

ok('hide review and remove requester are undoable toggles', () => {
  assert.strictEqual(confirm.classifyAdminAction('/admin/reviews/toggle/4'), 'undo');
  assert.strictEqual(confirm.classifyAdminAction('/admin/requests/onimusha/voter/remove'), 'undo');
  assert.strictEqual(confirm.UNDO_MS, 8000);
});

ok('ordinary saves and cancels are left alone', () => {
  assert.strictEqual(confirm.classifyAdminAction('/admin/orders/PH-0313/cancel'), null);
  assert.strictEqual(confirm.classifyAdminAction('/admin/site-settings'), null);
  assert.strictEqual(confirm.classifyAdminAction(''), null);
});

ok('a full URL and a query string still classify', () => {
  assert.strictEqual(
    confirm.classifyAdminAction('https://playstation-hub.com/admin/orders/PH-0001/delete?x=1'),
    'delete-typed'
  );
});

ok('only the exact word DELETE confirms a typed delete', () => {
  assert.strictEqual(confirm.acceptsDeleteWord('DELETE'), true);
  assert.strictEqual(confirm.acceptsDeleteWord(' DELETE '), true);
  assert.strictEqual(confirm.acceptsDeleteWord('delete'), false);
  assert.strictEqual(confirm.acceptsDeleteWord('DEL'), false);
  assert.strictEqual(confirm.acceptsDeleteWord('DELETE '), true);
  assert.strictEqual(confirm.acceptsDeleteWord(''), false);
});

ok('an explicit data-confirm-kind wins over the URL', () => {
  assert.strictEqual(confirm.kindOf({ action: '/admin/site-settings', confirmKind: 'delete-simple' }), 'delete-simple');
  assert.strictEqual(confirm.kindOf({ action: '/admin/orders/PH-1/delete', confirmKind: '' }), 'delete-typed');
});

console.log('\n' + passed + ' assertions passed\n');
