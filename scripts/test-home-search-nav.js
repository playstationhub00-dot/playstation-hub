// Run: node scripts/test-home-search-nav.js
//
// "One search at a time" on the homepage: public/js/home-search.js hides the
// menu's 🔍 icon while the big search is on screen, and sends the icon (and the
// / shortcut) to the big search instead of opening the menu's own search.
// Runs the real script in a vm with a stub DOM.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');

function stubEl(id, tagName) {
  const classes = new Set();
  return {
    id, tagName: tagName || 'DIV', hidden: false, calls: [],
    classList: {
      toggle(c, on) { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
      contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c)
    },
    focus(opts) { this.calls.push(['focus', opts]); },
    scrollIntoView(opts) { this.calls.push(['scrollIntoView', opts]); },
    addEventListener() {},
    appendChild() {}, set textContent(v) {}
  };
}

function load({ withToggle = true, withObserver = true } = {}) {
  const els = {
    hsInput: stubEl('hsInput', 'INPUT'), hsResults: stubEl('hsResults'), hsDim: stubEl('hsDim'),
    homeSearch: stubEl('homeSearch', 'SECTION')
  };
  if (withToggle) els.navSearchToggle = stubEl('navSearchToggle', 'BUTTON');
  const listeners = [];
  const observers = [];
  const ctx = {
    console, setTimeout, clearTimeout,
    navigator: {}, fetch: () => new Promise(() => {}),
    document: {
      activeElement: { tagName: 'BODY' },
      getElementById: id => els[id] || null,
      createElement: () => stubEl('x'),
      addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture: !!capture })
    }
  };
  if (withObserver) {
    ctx.IntersectionObserver = function (cb, opts) { this.cb = cb; this.opts = opts; observers.push(this); this.observe = el => { this.target = el; }; };
  }
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'home-search-core.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'home-search.js'), 'utf8'), ctx);
  const fire = (type, ev) => listeners.filter(l => l.type === type && l.capture).forEach(l => l.fn(ev));
  return { ctx, els, listeners, observers, fire };
}

function clickOn(selectorMatch) {
  const ev = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
    target: { closest: sel => (sel === selectorMatch ? {} : null) } };
  return ev;
}

console.log('\nicon hides while the big search is on screen');
ok('watches the search box, allowing for the sticky menu bar', () => {
  const p = load();
  assert.strictEqual(p.observers.length, 1);
  assert.strictEqual(p.observers[0].target, p.els.hsInput);
  assert.strictEqual(p.observers[0].opts.rootMargin, '-64px 0px 0px 0px');
});
ok('in view → icon hidden; scrolled past → icon back', () => {
  const p = load();
  p.observers[0].cb([{ isIntersecting: true }]);
  assert.strictEqual(p.els.navSearchToggle.classList.contains('hs-nav-hidden'), true);
  p.observers[0].cb([{ isIntersecting: false }]);
  assert.strictEqual(p.els.navSearchToggle.classList.contains('hs-nav-hidden'), false);
});
ok('without IntersectionObserver the icon simply stays visible', () => {
  const p = load({ withObserver: false });
  assert.strictEqual(p.els.navSearchToggle.classList.contains('hs-nav-hidden'), false);
});

console.log('\ntapping the icon goes to the big search');
ok('the tap is taken before the menu sees it, focuses the box and scrolls to it', () => {
  const p = load();
  const ev = clickOn('#navSearchToggle');
  p.fire('click', ev);
  assert.strictEqual(ev.prevented, true);
  assert.strictEqual(ev.stopped, true, "the menu's own search never opens");
  assert.strictEqual(JSON.stringify(p.els.hsInput.calls[0]), JSON.stringify(['focus', { preventScroll: true }]));
  assert.strictEqual(JSON.stringify(p.els.homeSearch.calls[0]), JSON.stringify(['scrollIntoView', { behavior: 'smooth', block: 'center' }]));
});
ok('other clicks are left alone', () => {
  const p = load();
  const ev = clickOn('.something-else');
  p.fire('click', ev);
  assert.strictEqual(ev.stopped, false);
  assert.strictEqual(p.els.hsInput.calls.length, 0);
});
ok('a page without the menu icon still works', () => {
  const p = load({ withToggle: false });
  assert.strictEqual(p.observers.length, 0);
});

console.log('\nthe / shortcut');
ok('/ goes to the big search', () => {
  const p = load();
  const ev = { key: '/', prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  p.fire('keydown', ev);
  assert.strictEqual(ev.stopped, true);
  assert.strictEqual(p.els.hsInput.calls[0][0], 'focus');
});
ok('/ typed inside a text box, or other keys, are left alone', () => {
  const p = load();
  p.ctx.document.activeElement = { tagName: 'TEXTAREA' };
  const a = { key: '/', stopped: false, preventDefault() {}, stopPropagation() { this.stopped = true; } };
  p.fire('keydown', a);
  assert.strictEqual(a.stopped, false);
  p.ctx.document.activeElement = { tagName: 'BODY' };
  const b = { key: 'a', stopped: false, preventDefault() {}, stopPropagation() { this.stopped = true; } };
  p.fire('keydown', b);
  assert.strictEqual(b.stopped, false);
});

console.log('\nmarkup');
ok('the menu icon id the script relies on still exists, and the hiding style is in place', () => {
  const nav = fs.readFileSync(path.join(ROOT, 'views', 'partials', 'nav.ejs'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'home-search.css'), 'utf8');
  assert.ok(nav.includes('id="navSearchToggle"'));
  assert.ok(/#navSearchToggle\.hs-nav-hidden \{ visibility: hidden; opacity: 0; pointer-events: none; \}/.test(css));
});

console.log('\n' + passed + ' assertions passed\n');
