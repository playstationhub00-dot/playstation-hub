// Run: node scripts/test-extend-on-edit-customer.js
//
// Renders the REAL views/edit-customer.ejs (plus the real extend partial it
// now includes) with stub locals, so a template error in the new Extend
// button/wiring shows up here rather than in the browser. No test framework
// in this project by design — exits non-zero on the first failed assertion.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const VIEW = path.join(__dirname, '..', 'views', 'edit-customer.ejs');

function customer(status, over) {
  return Object.assign({
    id: 42, customer_name: 'Ana', game_id: 7, game_title: 'Tekken 8',
    days: 7, account_type: 'nt', start_date: '2026-09-01', end_date: '2026-09-08',
    price: 349, status, notes: ''
  }, over || {});
}

function render(cust, extendTier) {
  return ejs.render(fs.readFileSync(VIEW, 'utf8'), {
    settings: { title: 'PlayStation Hub', favicon_path: '/favicon.svg', logo_path: '/logo.png' },
    assetV: 'test',
    customer: cust,
    games: [{ id: 7, title: 'Tekken 8', platform: 'PS5', nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 449, tr_price_30d: 899, buy_nt_price: 0, buy_tr_price: 0 }],
    upcoming: [],
    accounts: [],
    currentAssign: null,
    extendTier: extendTier || { p7: 0, p30: 0 },
    todayManila: '2026-09-05'
  }, { filename: VIEW });
}

console.log('\nedit-customer.ejs — the Extend button and the extend modal it now includes');

ok('a live rental gets the Extend button, wired with real price tiers and today’s date', () => {
  const html = render(customer('renting'), { p7: 349, p30: 699 });
  assert.ok(html.includes('class="btn btn-outline cst-extend"'), 'the button never rendered');
  assert.ok(html.includes('data-p7="349"'));
  assert.ok(html.includes('data-p30="699"'));
  assert.ok(html.includes('data-today="2026-09-05"'));
  assert.ok(html.includes('data-end="2026-09-08"'));
});

['done', 'bought', 'reservation'].forEach(status => {
  ok('a "' + status + '" record does not get the Extend button', () => {
    // The extend partial's own script always mentions .cst-extend (it's the
    // delegated-listener selector), so this checks for the actual <button>
    // element, not just any occurrence of the class name in the page.
    const html = render(customer(status));
    assert.ok(!html.includes('class="btn btn-outline cst-extend"'), 'Extend button rendered for a non-renting status: ' + status);
  });
});

ok('the extend modal partial is actually included on this page', () => {
  // This is the real fix: before this change, the Customers table was the
  // only page that pulled in partials/admin/extend.ejs at all.
  const html = render(customer('renting'), { p7: 349, p30: 699 });
  assert.ok(html.includes('id="xtOverlay"'), 'the extend modal markup never rendered');
  assert.ok(html.includes('xtSubmit'), 'the extend modal script never rendered');
});

ok('the modal’s success screen classes exist somewhere in CSS, not just in markup', () => {
  // Regression guard for the CSS-location bug found while building this: the
  // modal used to depend on quick-add.ejs's <style> block, which this page
  // never includes. If someone moves the CSS back into quick-add.ejs, this
  // page's modal (and its success screen) goes unstyled again with no
  // template error to catch it — only a stylesheet check can.
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
  ['.qa-overlay', '.qa-box', '.qa-done', '.qa-copy-box', '.qa-copy-btn'].forEach(sel => {
    assert.ok(css.includes(sel), sel + ' has no rule in the global stylesheet');
  });
  const quickAdd = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'admin', 'quick-add.ejs'), 'utf8');
  assert.ok(!quickAdd.includes('<style>'), 'quick-add.ejs still carries its own <style> block — the modal CSS must live in the global stylesheet so a page that only includes extend.ejs still gets it');
});

console.log('\n' + passed + ' assertions passed\n');
