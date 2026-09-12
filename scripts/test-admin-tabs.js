// Run: node scripts/test-admin-tabs.js
//
// The admin panel's tab and scroll-restore behaviour lives in an inline
// <script> in views/admin.ejs. This runs that script for real against a stub
// DOM, so "after a save you come back where you were" is checked rather than
// hoped for.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const TEMPLATE = path.join(__dirname, '..', 'views', 'admin.ejs');
const src = fs.readFileSync(TEMPLATE, 'utf8');

// The tab block is the one carrying the tab system; the other inline script is
// unrelated page furniture.
function tabScript() {
  const blocks = [];
  const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(src))) if (!m[1].includes('<%')) blocks.push(m[1]);
  const block = blocks.find(b => b.includes('const TAB_KEY'));
  assert.ok(block, 'admin.ejs still has the tab script');
  return block;
}

function stubStore() {
  const data = {};
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; }
  };
}

function stubEl() {
  const set = new Set();
  return {
    textContent: '', value: '', hidden: false, style: {},
    classList: {
      add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c),
      toggle: (c, on) => { const w = on === undefined ? !set.has(c) : !!on; if (w) set.add(c); else set.delete(c); return w; }
    },
    _set: set,
    focus() {}, addEventListener() {}, appendChild() {}, removeChild() {}, remove() {},
    querySelector: () => stubEl(), querySelectorAll: () => []
  };
}

// Runs the script as a fresh page load, and reports what the page did.
function load(opts) {
  const o = opts || {};
  const local = o.local || stubStore();
  const session = o.session || stubStore();
  const els = {};
  const submitHandlers = [];
  const loadHandlers = [];
  const scrolls = [];
  const replaced = [];
  const rafs = [];

  const doc = {
    getElementById(id) { return (els[id] = els[id] || stubEl()); },
    querySelector() { return stubEl(); },
    querySelectorAll() { return []; },
    createElement() { return stubEl(); },
    body: stubEl(),
    documentElement: stubEl(),
    addEventListener(type, fn) { if (type === 'submit') submitHandlers.push(fn); }
  };

  const sandbox = {
    document: doc, console,
    localStorage: local, sessionStorage: session,
    location: { search: o.search || '' },
    history: { replaceState: (a, b, url) => replaced.push(url) },
    scrollY: o.scrollY || 0, pageYOffset: o.scrollY || 0,
    scrollTo: (x, y) => scrolls.push(y),
    requestAnimationFrame: fn => rafs.push(fn),
    addEventListener(type, fn) { if (type === 'load') loadHandlers.push(fn); },
    setTimeout() {}, URLSearchParams, Date, JSON
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(tabScript(), sandbox);

  return {
    win: sandbox, local, session, els, scrolls, replaced,
    submit(defaultPrevented) {
      // dataset must exist: admin.ejs already has a submit listener of its own
      // (the loading overlay) that reads e.target.dataset.noLoading.
      const target = Object.assign(stubEl(), { tagName: 'FORM', dataset: {}, method: 'post' });
      submitHandlers.forEach(fn => fn({ target: target, defaultPrevented: !!defaultPrevented }));
    },
    runRafs() { rafs.forEach(fn => fn()); },
    fireLoad() { loadHandlers.forEach(fn => fn()); },
    activeTab() {
      return Object.keys(els).filter(k => k.indexOf('tab-') === 0 && els[k]._set.has('active'))
        .map(k => k.slice(4))[0] || null;
    }
  };
}

console.log('\nsubmitting from a tab remembers where you were');

ok('a real submit stashes the tab and scroll position', () => {
  const p = load({ search: '?tab=customers', scrollY: 1420 });
  p.submit(false);
  const saved = JSON.parse(p.session.getItem('adminReturnTo'));
  assert.strictEqual(saved.tab, 'customers');
  assert.strictEqual(saved.y, 1420);
  assert.ok(typeof saved.at === 'number');
});

ok('a form handled in JS stashes nothing', () => {
  // Quick Add and the extend modal preventDefault and never navigate. A
  // position saved for one of those would fire on some later reload instead.
  const p = load({ search: '?tab=customers', scrollY: 1420 });
  p.submit(true);
  assert.strictEqual(p.session.getItem('adminReturnTo'), null);
});

console.log('\ncoming back lands where you left');

ok('you return to your tab, not the one the message maps to', () => {
  // msg 'added' maps to 'games'. Before this, saving from Customers bounced
  // you to Games, which is the whole complaint.
  const session = stubStore();
  session.setItem('adminReturnTo', JSON.stringify({ tab: 'customers', y: 900, at: Date.now() }));
  const p = load({ search: '?msg=added', session });
  assert.strictEqual(p.activeTab(), 'customers');
});

ok('and the scroll position comes back with it', () => {
  const session = stubStore();
  session.setItem('adminReturnTo', JSON.stringify({ tab: 'customers', y: 900, at: Date.now() }));
  const p = load({ search: '', session });
  p.runRafs();
  assert.deepStrictEqual(p.scrolls, [900]);
  p.fireLoad();
  assert.deepStrictEqual(p.scrolls, [900, 900], 'reapplied once images have settled');
});

ok('an explicit ?tab= from the server still wins', () => {
  const session = stubStore();
  session.setItem('adminReturnTo', JSON.stringify({ tab: 'customers', y: 900, at: Date.now() }));
  const p = load({ search: '?tab=orders', session });
  assert.strictEqual(p.activeTab(), 'orders', 'the server was explicit; honour it');
});

ok('the stash is consumed, so a later reload does not jump', () => {
  const session = stubStore();
  session.setItem('adminReturnTo', JSON.stringify({ tab: 'customers', y: 900, at: Date.now() }));
  const first = load({ search: '', session });
  first.runRafs();
  assert.deepStrictEqual(first.scrolls, [900]);

  const second = load({ search: '', session });
  second.runRafs();
  assert.deepStrictEqual(second.scrolls, [], 'nothing left to restore');
});

ok('a stale stash is ignored rather than yanking the page', () => {
  const session = stubStore();
  session.setItem('adminReturnTo', JSON.stringify({ tab: 'customers', y: 900, at: Date.now() - 120000 }));
  const p = load({ search: '', session });
  p.runRafs();
  assert.deepStrictEqual(p.scrolls, [], 'two minutes later is not this round trip');
});

ok('junk in the stash does not break the page', () => {
  const session = stubStore();
  session.setItem('adminReturnTo', 'not json');
  const p = load({ search: '', session });
  p.runRafs();
  assert.deepStrictEqual(p.scrolls, []);
  assert.ok(p.activeTab(), 'the panel still picked a tab');
});

ok('being at the top is not treated as something to restore', () => {
  const session = stubStore();
  session.setItem('adminReturnTo', JSON.stringify({ tab: 'customers', y: 0, at: Date.now() }));
  const p = load({ search: '', session });
  p.runRafs();
  assert.deepStrictEqual(p.scrolls, []);
});

console.log('\nthe URL names the tab you are actually on');

ok('the toast rewrite does not point at a different tab', () => {
  const session = stubStore();
  session.setItem('adminReturnTo', JSON.stringify({ tab: 'customers', y: 10, at: Date.now() }));
  const p = load({ search: '?msg=added', session });
  assert.strictEqual(p.activeTab(), 'customers');
  assert.ok(p.replaced.every(u => !/tab=games/.test(u)),
    'reloading must not land on games: ' + JSON.stringify(p.replaced));
});

console.log('\n' + passed + ' assertions passed\n');
