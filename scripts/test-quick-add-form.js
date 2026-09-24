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
  // Defaults to 'promo', matching the real template's checked attribute on
  // #qaPriceModePromo — a stub the test can flip to 'full' the same way it
  // flips `paid` above.
  const pricingMode = stubEl('pricingModeRadio');
  pricingMode.value = 'promo';

  // The status buttons are labels driven by `for`, and the form rewrites their
  // text when an unreleased game is picked, so the stub has to serve them.
  const labels = {
    qaStRent: stubEl('label-qaStRent'),
    qaStBought: stubEl('label-qaStBought')
  };

  const doc = {
    getElementById(id) { return (els[id] = els[id] || stubEl(id)); },
    querySelector(sel) {
      if (sel === 'input[name=paid]:checked') return paid;
      if (sel === 'input[name=pricing_mode]:checked') return pricingMode;
      const forMatch = /^label\[for="(\w+)"\]$/.exec(sel);
      if (forMatch) return labels[forMatch[1]] || null;
      return null;
    },
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
  // produce in the real template. The "f"-suffixed fields are the undiscounted
  // list price the Full-price toggle reads — deliberately different from the
  // promo'd ones so a test can tell which set the form actually used.
  const game = {
    value: '12',
    dataset: {
      nt7: '199', nt30: '599', buynt: '0', buytr: '0',
      nt7f: '249', nt30f: '699', tr7f: '349', tr30f: '899', buyntf: '0', buytrf: '0'
    }
  };
  const gameEl = doc.getElementById('qaGame');
  gameEl.value = '12';
  gameEl.selectedOptions = [game];
  doc.getElementById('qaType').value = 'nt';
  // The Trophy deposit reaches the script through the modal's data attribute,
  // exactly the way the template supplies it.
  doc.getElementById('qaOverlay').dataset.resDeposit = '100';

  return {
    win: sandbox,
    el: id => doc.getElementById(id),
    pricingMode: pricingMode,
    sandbox,
    get labels() {
      return { qaStRent: labels.qaStRent.textContent, qaStBought: labels.qaStBought.textContent };
    }
  };
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
  //
  // Moved out of quick-add.ejs's own <style> block into the global stylesheet
  // (public/css/style.css) — shared with partials/admin/extend.ejs, which
  // needs the same modal-shell rules on a page that doesn't include this
  // partial at all. Checked there now, not in this template's own source.
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
  assert.ok(/\.qa-in\[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important/.test(css),
    'public/css/style.css no longer has the .qa-in[hidden] display:none !important guard');
});

console.log('\nQuick Add — a Coming Soon game can be reserved or pre-ordered');

// The shape the optgroup renders for an unreleased game: real list prices, so
// a reservation price can be quoted, plus the data-upcoming flag the form keys off.
function pickUpcoming(f, over) {
  const opt = Object.assign({
    value: 'upcoming_4',
    dataset: { upcoming: '1', release: '2026-11-14',
               nt7: '349', nt30: '699', tr7: '449', tr30: '899',
               buynt: '2249', buytr: '2749' }
  }, over || {});
  f.el('qaGame').value = opt.value;
  f.el('qaGame').selectedOptions = [opt];
  f.win.qaGameChanged();
  return opt;
}

ok('both ways of reserving stay open; only Finished is meaningless', () => {
  // Renting on an unreleased game means "hold a slot, paid in full now",
  // which is a real thing the site sells. It used to be disabled outright, so
  // the only option the owner had was a pre-order.
  const f = loadForm();
  pickUpcoming(f);
  assert.strictEqual(f.el('qaStRent').disabled, false, 'reserving is a real option');
  assert.strictEqual(f.el('qaStDone').disabled, true, 'but nobody finished a game that has not shipped');
});

ok('the buttons say which of the two things they now record', () => {
  const f = loadForm();
  pickUpcoming(f);
  assert.strictEqual(f.labels.qaStRent, '🔖 Reserve');
  assert.strictEqual(f.labels.qaStBought, '🛒 Pre-order');
});

ok('a reservation keeps its duration but loses its dates', () => {
  const f = loadForm();
  f.el('qaStart').value = '2026-09-13';
  f.el('qaDays').value = '30';
  f.win.qaDaysChanged();
  assert.strictEqual(f.el('qaEndDate').value, '2026-10-13', 'a released rental has an end date');

  pickUpcoming(f);
  assert.strictEqual(f.el('qaStBought').checked, false, 'still on Renting, which now means reserving');
  assert.strictEqual(f.el('qaDays').hidden, false, 'a weekly or monthly slot is what they are reserving');
  assert.strictEqual(f.el('qaDays').disabled, false);
  assert.strictEqual(f.el('qaEndWrap').hidden, true, 'but the game has no start or return yet');
  assert.strictEqual(f.el('qaEndDate').value, '', 'and no stale date may reach the server');
});

ok('it quotes the full reservation price, not half of it', () => {
  const f = loadForm();
  f.el('qaDays').value = '30';
  f.win.qaDaysChanged();
  pickUpcoming(f);
  const box = f.el('qaPriceBox').innerHTML;
  // 699 monthly, non-trophy so no deposit: paid in full, nothing on release.
  assert.ok(box.includes('699'), 'full reservation price: ' + box);
  assert.ok(!/downpayment/i.test(box), 'the split this used to charge is gone: ' + box);
  assert.ok(/nothing due on release/i.test(box), box);
});

ok('a trophy reservation carries the deposit into the total, paid in full with it', () => {
  const f = loadForm();
  f.el('qaType').value = 'tr';
  f.el('qaDays').value = '30';
  f.win.qaDaysChanged();
  pickUpcoming(f);
  const box = f.el('qaPriceBox').innerHTML;
  // 899 + 100 deposit = 999, paid in full — nothing owed when it releases.
  assert.ok(box.includes('999'), 'full total including the deposit: ' + box);
});

ok('a duration the game has no price for asks for an override', () => {
  const f = loadForm();
  f.el('qaDays').value = 'custom';
  f.win.qaDaysChanged();
  f.el('qaCustomDays').value = '12';
  pickUpcoming(f);
  const box = f.el('qaPriceBox').textContent;
  assert.ok(/override/i.test(box), 'only 7 and 30 exist on an upcoming record: ' + box);
});

ok('switching to Pre-order prices it in full and drops the duration', () => {
  const f = loadForm();
  pickUpcoming(f);
  f.el('qaStBought').checked = true;
  f.win.qaStatusChanged();
  assert.strictEqual(f.el('qaDays').hidden, true, 'nothing to choose on a permanent copy');
  assert.strictEqual(f.el('qaMode').value, 'buy');
  assert.ok(f.el('qaPriceBox').innerHTML.includes('2,249'), f.el('qaPriceBox').innerHTML);
  assert.ok(/purchase/i.test(f.el('qaPriceBox').innerHTML));
});

ok('Finished moves itself to Pre-order rather than being silently ignored', () => {
  const f = loadForm();
  f.el('qaStDone').checked = true;
  pickUpcoming(f);
  assert.strictEqual(f.el('qaStBought').checked, true);
  assert.strictEqual(f.el('qaStDone').disabled, true);
});

ok('the note explains both options, and names the release date', () => {
  const f = loadForm();
  pickUpcoming(f);
  const note = f.el('qaUpcomingNote');
  assert.strictEqual(note.hidden, false);
  assert.ok(/reserve/i.test(note.textContent), note.textContent);
  assert.ok(/pre-order/i.test(note.textContent), note.textContent);
  assert.ok(note.textContent.includes('2026-11-14'), 'names the release date: ' + note.textContent);
});

ok('a release date it does not have is not invented', () => {
  const f = loadForm();
  pickUpcoming(f, { dataset: { upcoming: '1', release: '',
                               nt7: '349', nt30: '699', tr7: '449', tr30: '899',
                               buynt: '2249', buytr: '0' } });
  const note = f.el('qaUpcomingNote');
  assert.ok(note.textContent.includes('until it launches.'), note.textContent);
  assert.ok(!note.textContent.includes('undefined'), note.textContent);
});

ok('choosing a released game restores the wording, the dates and Finished', () => {
  const f = loadForm();
  pickUpcoming(f);
  const normal = { value: '12', dataset: { nt7: '199', nt30: '599', buynt: '799', buytr: '999' } };
  f.el('qaStart').value = '2026-09-13';
  f.el('qaGame').value = '12';
  f.el('qaGame').selectedOptions = [normal];
  f.el('qaDays').value = '7';
  f.win.qaGameChanged();

  assert.strictEqual(f.labels.qaStRent, '🟢 Renting');
  assert.strictEqual(f.labels.qaStBought, '🛒 Bought');
  assert.strictEqual(f.el('qaStDone').disabled, false);
  assert.strictEqual(f.el('qaUpcomingNote').hidden, true, 'and the note goes');
  assert.strictEqual(f.el('qaEndWrap').hidden, false, 'a real rental has dates again');
  assert.strictEqual(f.el('qaEndDate').value, '2026-09-20');
});

ok('reopening the form does not leave the lock on for the next customer', () => {
  const f = loadForm();
  pickUpcoming(f);
  assert.strictEqual(f.el('qaStDone').disabled, true);
  f.win.qaReset();
  assert.strictEqual(f.el('qaStDone').disabled, false, 'qaReset clears it');
  assert.strictEqual(f.el('qaUpcomingNote').hidden, true);
});

console.log('\nQuick Add — Promo / Full price toggle');

ok('defaults to the promo price when nothing is picked', () => {
  const f = loadForm();
  f.el('qaDays').value = '30';
  f.win.qaPrice();
  assert.ok(f.el('qaPriceBox').innerHTML.includes('599'), f.el('qaPriceBox').innerHTML);
  assert.ok(!/full price/i.test(f.el('qaPriceBox').innerHTML));
});

ok('Full price reads the undiscounted tier instead', () => {
  const f = loadForm();
  f.el('qaDays').value = '30';
  f.pricingMode.value = 'full';
  f.win.qaPrice();
  assert.ok(f.el('qaPriceBox').innerHTML.includes('699'), f.el('qaPriceBox').innerHTML);
  assert.ok(/full price/i.test(f.el('qaPriceBox').innerHTML));
});

ok('Full price also applies to a purchase', () => {
  const f = loadForm();
  const game = { value: '12', dataset: { buynt: '1999', buyntf: '2499' } };
  f.el('qaGame').selectedOptions = [game];
  f.el('qaStBought').checked = true;
  f.pricingMode.value = 'full';
  f.win.qaPrice();
  assert.ok(f.el('qaPriceBox').innerHTML.includes('2,499'), f.el('qaPriceBox').innerHTML);
});

ok('a price override still wins over either pricing mode', () => {
  const f = loadForm();
  f.el('qaDays').value = '30';
  f.el('qaPriceOverride').value = '1';
  f.pricingMode.value = 'full';
  f.win.qaPrice();
  assert.ok(f.el('qaPriceBox').innerHTML.includes('>₱1<'), f.el('qaPriceBox').innerHTML);
});

ok('the toggle is hidden for a Coming Soon pick and reset back to promo', () => {
  const f = loadForm();
  f.pricingMode.value = 'full';
  pickUpcoming(f);
  assert.strictEqual(f.el('qaPricingModes').hidden, true);
  assert.strictEqual(f.el('qaPriceModePromo').checked, true, 'reset back to the default');
});

console.log('\n' + passed + ' assertions passed\n');
