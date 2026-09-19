// Run: node scripts/test-dashboard-subtabs.js
//
// Regression test for a real bug: dashboard.ejs's sub-tab restore script runs
// on EVERY /admin page load (the dashboard panel, sub-tabs included, is
// always in the DOM regardless of which top-level tab is active). Its
// restore call used to rewrite the page URL to always carry tab=dashboard
// and drop msg — so saving a customer (or anything else) and getting
// redirected to /admin?tab=customers&msg=customer_updated landed back on
// the Dashboard with no success toast, even though the save itself worked.
// This runs the real inline script from the template against a stub DOM, so
// the fix is verified against the actual shipped code, not a description of it.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const TEMPLATE = path.join(__dirname, '..', 'views', 'partials', 'admin', 'dashboard.ejs');
const src = fs.readFileSync(TEMPLATE, 'utf8');

function stubEl(id) {
  const set = new Set();
  return {
    id, value: '',
    classList: {
      add: c => set.add(c),
      remove: c => set.delete(c),
      contains: c => set.has(c),
      toggle: (c, on) => {
        const want = on === undefined ? !set.has(c) : !!on;
        if (want) set.add(c); else set.delete(c);
        return want;
      }
    }
  };
}

// Loads the real inline script against a stub DOM and a fake history/location,
// starting the page at `search` — exactly the query string the server's
// redirect would have put in the address bar.
function loadScript(search) {
  const m = src.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m, 'dashboard.ejs still has one inline <script> block');

  const els = {};
  const store = {};
  const doc = {
    getElementById(id) { return (els[id] = els[id] || stubEl(id)); },
    querySelector() { return stubEl('scratch'); }
  };
  const replacedUrls = [];
  const sandbox = {
    document: doc,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; }
    },
    URLSearchParams,
    history: {
      replaceState(state, title, url) { replacedUrls.push(url); }
    },
    location: { search },
    scrollTo() {},
    console
  };
  // window IS the global object in a real browser — the script's bare
  // `switchDash(...)` call at the bottom resolves through that, exactly like
  // its own `window.switchDash = ...` assignment does.
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(m[1], sandbox);

  return { win: sandbox, replacedUrls };
}

console.log('\ndashboard.ejs sub-tab restore — the page load that broke every other tab');

ok('loading with another tab active (?tab=customers&msg=...) never touches the URL', () => {
  // This is the exact shape of a post-save redirect. The dashboard partial
  // still runs its own restore because it is always in the DOM, and it must
  // leave this URL alone — admin.ejs's own tab-restore script reads it next.
  const f = loadScript('?tab=customers&msg=customer_updated');
  assert.deepStrictEqual(f.replacedUrls, [],
    'the initial restore rewrote the URL: ' + JSON.stringify(f.replacedUrls));
});

ok('loading on a bare /admin (dashboard, no sub) never touches the URL either', () => {
  const f = loadScript('');
  assert.deepStrictEqual(f.replacedUrls, []);
});

ok('loading with ?sub=money set never touches the URL on its own', () => {
  const f = loadScript('?tab=dashboard&sub=money');
  assert.deepStrictEqual(f.replacedUrls, []);
});

ok('a real pill click still rewrites the URL to the clicked sub-tab', () => {
  // The behaviour the fix must not remove: once the owner is actually on the
  // dashboard and clicks a pill, the URL should follow, same as before.
  const f = loadScript('?tab=dashboard');
  f.win.switchDash('money');
  assert.strictEqual(f.replacedUrls.length, 1);
  assert.strictEqual(f.replacedUrls[0], '/admin?tab=dashboard&sub=money');
});

ok('clicking back to Overview drops sub from the URL', () => {
  const f = loadScript('?tab=dashboard&sub=money');
  f.win.switchDash('overview');
  assert.strictEqual(f.replacedUrls[f.replacedUrls.length - 1], '/admin?tab=dashboard');
});

ok('dashGoto (the overview card links) also updates the URL', () => {
  const f = loadScript('?tab=dashboard');
  f.win.dashGoto('site');
  assert.strictEqual(f.replacedUrls[f.replacedUrls.length - 1], '/admin?tab=dashboard&sub=site');
});

ok('the restored sub-tab still applies its own pane, even though the URL is untouched', () => {
  // The regression fix must not turn the initial call into a no-op — only the
  // URL write is skipped. Money should still end up the active pane.
  const f = loadScript('?tab=dashboard&sub=money');
  const pane = f.win.document.getElementById('dsub-money');
  assert.strictEqual(pane.classList.contains('active'), true);
  const overviewPane = f.win.document.getElementById('dsub-overview');
  assert.strictEqual(overviewPane.classList.contains('active'), false);
});

console.log('\n' + passed + ' assertions passed\n');
