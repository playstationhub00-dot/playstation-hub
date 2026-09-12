// Run: node scripts/test-quick-add-form.js
//
// The Quick Add form's behaviour lives in an inline <script> in the template,
// which means none of it was reachable by a test until now. This harness runs
// that script for real against a stub DOM, so the wiring between a control and
// the handler it fires is checked rather than assumed.
//
// It exists because of a bug that a unit test of the maths could never have
// caught: qaEnd() computed the end date perfectly, and the custom-days box
// simply never called it.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const TEMPLATE = path.join(__dirname, '..', 'views', 'partials', 'admin', 'quick-add.ejs');
const src = fs.readFileSync(TEMPLATE, 'utf8');

function stubEl(id) {
  const set = new Set();
  return {
    id, value: '', hidden: false, checked: false, disabled: false,
    textContent: '', innerHTML: '', className: '', style: {},
    dataset: {}, selectedOptions: [],
    classList: {
      add: c => set.add(c),
      remove: c => set.delete(c),
      contains: c => set.has(c),
      toggle: (c, on) => {
        const want = on === undefined ? !set.has(c) : !!on;
        if (want) set.add(c); else set.delete(c);
        return want;
      }
    },
    focus() {}, reset() {}, select() {},
    appendChild() {}, removeChild() {}, addEventListener() {}
  };
}

// Loads the template's inline script into a sandbox where `window` IS the
// global object, exactly as in a browser. Without that, the script's bare
// calls to its own window.* functions (qaReset calls qaPaidChanged()) would
// throw ReferenceError and nothing would run.
function loadForm() {
  const m = src.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m, 'quick-add.ejs still has one inline <script> block');

  const els = {};
  const paid = stubEl('paidRadio');
  paid.value = 'yes';

  const doc = {
    getElementById(id) { return (els[id] = els[id] || stubEl(id)); },
    querySelector(sel) { return sel === 'input[name=paid]:checked' ? paid : null; },
    createElement() { return stubEl('scratch'); },
    body: { appendChild() {}, removeChild() {} },
    addEventListener() {},
    execCommand() { return true; }
  };

  const sandbox = {
    document: doc, navigator: {}, console,
    setTimeout() {}, location: { reload() {} }, isSecureContext: false,
    URLSearchParams: function () {}, FormData: function () {}, fetch() {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(m[1], sandbox);

  // A game the form can price: the same shape the <option> data-attributes
  // produce in the real template.
  const game = { value: '12', dataset: { nt7: '199', nt30: '599', buynt: '0', buytr: '0' } };
  const gameEl = doc.getElementById('qaGame');
  gameEl.value = '12';
  gameEl.selectedOptions = [game];
  doc.getElementById('qaType').value = 'nt';

  return { win: sandbox, el: id => doc.getElementById(id), sandbox };
}

// Fires whatever the template actually wires to a control, rather than calling
// the handler this test wishes were wired. That distinction IS the bug.
function fireAttr(sandbox, elementId, attr) {
  const tag = src.match(new RegExp('<input[^>]*id="' + elementId + '"[^>]*>'));
  assert.ok(tag, 'quick-add.ejs still has an <input id="' + elementId + '">');
  const handler = tag[0].match(new RegExp(attr + '="([^"]*)"'));
  assert.ok(handler, elementId + ' still has an ' + attr + ' handler');
  vm.runInContext(handler[1], sandbox);
}

console.log('\nQuick Add — the end date follows the duration');

ok('a preset duration sets the end date', () => {
  const f = loadForm();
  f.el('qaStart').value = '2026-09-12';
  f.el('qaDays').value = '30';
  f.win.qaDaysChanged();
  assert.strictEqual(f.el('qaEndDate').value, '2026-10-12');

  f.el('qaDays').value = '7';
  f.win.qaDaysChanged();
  assert.strictEqual(f.el('qaEndDate').value, '2026-09-19');
});

ok('typing a custom duration moves the end date with it', () => {
  // The reported bug, step for step: open on Monthly, switch to Custom, type
  // 10. The price updated to 10 days while the end date stayed 30 days out.
  const f = loadForm();
  f.el('qaStart').value = '2026-09-12';
  f.el('qaDays').value = '30';
  f.win.qaDaysChanged();
  assert.strictEqual(f.el('qaEndDate').value, '2026-10-12', 'starts on the monthly default');

  f.el('qaDays').value = 'custom';
  f.win.qaDaysChanged();

  f.el('qaCustomDays').value = '10';
  fireAttr(f.sandbox, 'qaCustomDays', 'oninput');

  assert.strictEqual(f.el('qaEndDate').value, '2026-09-22',
    'ten days from 12 Sep is 22 Sep, not the stale monthly date');
});

ok('editing the custom duration again moves it again', () => {
  const f = loadForm();
  f.el('qaStart').value = '2026-09-12';
  f.el('qaDays').value = 'custom';
  f.win.qaDaysChanged();

  f.el('qaCustomDays').value = '3';
  fireAttr(f.sandbox, 'qaCustomDays', 'oninput');
  assert.strictEqual(f.el('qaEndDate').value, '2026-09-15');

  f.el('qaCustomDays').value = '45';
  fireAttr(f.sandbox, 'qaCustomDays', 'oninput');
  assert.strictEqual(f.el('qaEndDate').value, '2026-10-27');
});

ok('the custom duration still prices correctly', () => {
  // Guards the other half of the pair: whatever now recalculates the end date
  // must not have displaced the price update that already worked.
  const f = loadForm();
  f.el('qaStart').value = '2026-09-12';
  f.el('qaDays').value = 'custom';
  f.win.qaDaysChanged();
  f.el('qaCustomDays').value = '10';
  fireAttr(f.sandbox, 'qaCustomDays', 'oninput');
  // 199 + (599-199) * (10-7)/23 = 251.17 -> 251
  assert.ok(f.el('qaPriceBox').innerHTML.includes('251'),
    'price box should quote the 10-day figure, got: ' + f.el('qaPriceBox').innerHTML);
});

ok('a later start date drags the end date along', () => {
  const f = loadForm();
  f.el('qaStart').value = '2026-09-12';
  f.el('qaDays').value = 'custom';
  f.win.qaDaysChanged();
  f.el('qaCustomDays').value = '10';
  fireAttr(f.sandbox, 'qaCustomDays', 'oninput');

  f.el('qaStart').value = '2026-09-20';
  f.win.qaEnd();
  assert.strictEqual(f.el('qaEndDate').value, '2026-09-30');
});

ok('a purchase has no end date at all', () => {
  const f = loadForm();
  f.el('qaStart').value = '2026-09-12';
  f.el('qaDays').value = 'custom';
  f.el('qaCustomDays').value = '10';
  f.el('qaStBought').checked = true;
  fireAttr(f.sandbox, 'qaCustomDays', 'oninput');
  assert.strictEqual(f.el('qaEndDate').value, '', 'a bought game is never returned');
});

console.log('\nQuick Add — a purchase has no duration');

ok('choosing Bought hides the duration control and disables it', () => {
  const f = loadForm();
  f.el('qaDays').value = '30';
  f.win.qaDaysChanged();

  f.el('qaStBought').checked = true;
  f.win.qaStatusChanged();

  // Hidden AND disabled: a hidden select still posts its value, and a stale
  // "30" reaching the server is how a purchase got a duration in the first
  // place.
  assert.strictEqual(f.el('qaDays').hidden, true, 'the duration select is hidden');
  assert.strictEqual(f.el('qaDays').disabled, true, 'and cannot post a stale value');
  assert.strictEqual(f.el('qaCustomDays').hidden, true, 'the custom box goes too');
  assert.strictEqual(f.el('qaCustomDays').disabled, true);
  assert.strictEqual(f.el('qaNoDuration').hidden, false, '"Yours to keep" takes its place');
});

ok('choosing Bought clears the end date and hides the field', () => {
  const f = loadForm();
  f.el('qaStart').value = '2026-09-12';
  f.el('qaDays').value = '30';
  f.win.qaDaysChanged();
  assert.strictEqual(f.el('qaEndDate').value, '2026-10-12');

  f.el('qaStBought').checked = true;
  f.win.qaStatusChanged();
  assert.strictEqual(f.el('qaEndDate').value, '', 'no return date on something they own');
  assert.strictEqual(f.el('qaEndWrap').hidden, true);
  assert.strictEqual(f.el('qaEndDate').disabled, true);
});

ok('a purchase posts mode=buy', () => {
  const f = loadForm();
  f.el('qaStBought').checked = true;
  f.win.qaStatusChanged();
  assert.strictEqual(f.el('qaMode').value, 'buy');
});

ok('switching back to Renting gives the duration back', () => {
  const f = loadForm();
  f.el('qaStart').value = '2026-09-12';
  f.el('qaStBought').checked = true;
  f.win.qaStatusChanged();
  assert.strictEqual(f.el('qaDays').hidden, true);

  f.el('qaStBought').checked = false;
  f.el('qaDays').value = '7';
  f.win.qaStatusChanged();
  assert.strictEqual(f.el('qaDays').hidden, false, 'the duration comes back');
  assert.strictEqual(f.el('qaDays').disabled, false, 'and can post again');
  assert.strictEqual(f.el('qaNoDuration').hidden, true, '"Yours to keep" goes away');
  assert.strictEqual(f.el('qaEndWrap').hidden, false);
  assert.strictEqual(f.el('qaEndDate').value, '2026-09-19', 'and the end date is rebuilt');
});

ok('the CSS guard that actually hides it is still present', () => {
  // hidden is only an attribute; a class with an explicit display beats it.
  // .qa-in carries no display of its own, but it sits in a grid, and this
  // modal has already been bitten twice by exactly this. The rule is the
  // thing doing the hiding, so its absence is a regression.
  assert.ok(/\.qa-in\[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important/.test(src),
    'quick-add.ejs still has the .qa-in[hidden] display:none !important guard');
});

console.log('\nQuick Add — Coming Soon games are pre-orders');

// The shape the optgroup renders: zero rent tiers, a real buy price, and the
// data-upcoming flag the form keys off.
function pickUpcoming(f, over) {
  const opt = Object.assign({
    value: 'upcoming_4',
    dataset: { upcoming: '1', release: '2026-11-14', nt7: '0', nt30: '0', tr7: '0', tr30: '0', buynt: '2249', buytr: '2749' }
  }, over || {});
  f.el('qaGame').value = opt.value;
  f.el('qaGame').selectedOptions = [opt];
  f.win.qaGameChanged();
  return opt;
}

ok('picking one flips the form to a purchase on its own', () => {
  const f = loadForm();
  assert.strictEqual(f.el('qaStBought').checked, false, 'starts on Renting');
  pickUpcoming(f);
  assert.strictEqual(f.el('qaStBought').checked, true, 'switched itself to Bought');
  assert.strictEqual(f.el('qaMode').value, 'buy');
  assert.strictEqual(f.el('qaDays').hidden, true, 'no duration on an unreleased game');
  assert.strictEqual(f.el('qaEndDate').value, '', 'and no dates');
});

ok('Renting and Finished are switched off, not silently ignored', () => {
  const f = loadForm();
  pickUpcoming(f);
  assert.strictEqual(f.el('qaStRent').disabled, true);
  assert.strictEqual(f.el('qaStDone').disabled, true);
});

ok('it says why, and when the game lands', () => {
  const f = loadForm();
  pickUpcoming(f);
  const note = f.el('qaUpcomingNote');
  assert.strictEqual(note.hidden, false);
  assert.ok(note.textContent.includes('pre-order'), note.textContent);
  assert.ok(note.textContent.includes('2026-11-14'), 'names the release date: ' + note.textContent);
});

ok('a release date it does not have is not invented', () => {
  const f = loadForm();
  pickUpcoming(f, { dataset: { upcoming: '1', release: '', buynt: '2249', buytr: '0', nt7: '0', nt30: '0', tr7: '0', tr30: '0' } });
  const note = f.el('qaUpcomingNote');
  assert.ok(note.textContent.includes('until it launches.'), note.textContent);
  assert.ok(!note.textContent.includes('undefined'), note.textContent);
});

ok('it is priced from the buy price, not a rental tier', () => {
  const f = loadForm();
  pickUpcoming(f);
  assert.ok(f.el('qaPriceBox').innerHTML.includes('2,249'),
    'shows the pre-order price: ' + f.el('qaPriceBox').innerHTML);
  assert.ok(f.el('qaPriceBox').innerHTML.includes('purchase'), 'priced as a purchase');
});

ok('choosing a released game afterwards gives the choices back', () => {
  const f = loadForm();
  pickUpcoming(f);
  assert.strictEqual(f.el('qaStRent').disabled, true);

  const normal = { value: '12', dataset: { nt7: '199', nt30: '599', buynt: '799', buytr: '999' } };
  f.el('qaGame').value = '12';
  f.el('qaGame').selectedOptions = [normal];
  f.win.qaGameChanged();

  assert.strictEqual(f.el('qaStRent').disabled, false, 'Renting is available again');
  assert.strictEqual(f.el('qaStDone').disabled, false);
  assert.strictEqual(f.el('qaUpcomingNote').hidden, true, 'and the note goes');
});

ok('reopening the form does not leave the lock on for the next customer', () => {
  const f = loadForm();
  pickUpcoming(f);
  assert.strictEqual(f.el('qaStRent').disabled, true);
  f.win.qaReset();
  assert.strictEqual(f.el('qaStRent').disabled, false, 'qaReset clears it');
  assert.strictEqual(f.el('qaStDone').disabled, false);
  assert.strictEqual(f.el('qaUpcomingNote').hidden, true);
});

console.log('\n' + passed + ' assertions passed\n');
