# Holiday themes (Halloween, Christmas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner picks None, Halloween or Christmas in Admin → Settings. The public site then shows that holiday's colours, a 🎃 or 🎄 by the logo, a thin holiday outline on game cards and posters, and drifting bats or snow. The admin panel never changes.

**Architecture:**
- **The rules:** `lib/site-theme.js` holds the list of themes and what counts as one.
- **The server:** `server.js` stores the pick (`POST /admin/settings/theme` → `site_settings.theme`) and puts each request's theme in `res.locals.siteTheme`, which is empty on `/admin`.
- **The page:** the shared `views/partials/head.ejs` marks `<html data-theme>` and loads `public/css/theme-<name>.css`. Every rule in that file is scoped to its theme and only adds on top of `style.css`.

**Tech Stack:** Express + lowdb, EJS, plain CSS (no images, no script beyond one line). Tests are `node scripts/test-*.js`.

Spec: `docs/superpowers/specs/2026-10-29-holiday-themes-design.md` (amended after this plan's dry run).

**How this plan was checked.** Every file in this plan was dry-run in a scratch copy of the current `main`:
- The new test fails first and then passes.
- The full suite stays green apart from `scripts/test-upcoming-psn-page-public.js`, which also fails before this work.

A browser check ran on throwaway instances (the Task 2 launcher), one per theme.
- **Halloween at 1280px:**
  - The accent turns orange, and the announcement bar is purple and orange.
  - A 🎃 sits by the logo, and cards get an orange outline.
  - Two bats drift behind the content and never sit over a click.
- **Halloween in light mode:** the background stays light, and the orange accents and border lines are still there.
- **Halloween at 375px:**
  - The page is 375px wide.
  - Only one, smaller bat shows.
  - The pumpkin still fits by the logo.
- **Christmas:**
  - The accent turns red, the announcement bar is green and red, and snow falls behind the content.
  - A 🎄 sits by the logo, and the game page poster gets a red outline.
  - At 375px the page is 375px wide, and a tap lands on the link under the snow.
- **Errors:** none in the console.

## Global Constraints

- Work directly on `main` and do not switch branches. **Push only when the owner says "push".**
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Line endings:**
  - `server.js` is CRLF + UTF-8 BOM.
  - These files are CRLF: `views/partials/head.ejs`, `views/partials/admin/settings.ejs`, `views/admin.ejs`.
  - The new files are LF.
  - The edit script (via `.superpowers/tmp-edits/rep.js`) keeps each file's endings and BOM.
- **The setting:**
  - `site_settings.theme` is `''`, `'halloween'` or `'christmas'`. Anything else saves and reads as `''`.
  - It's saved by `POST /admin/settings/theme` (admin only), which redirects to `/admin?tab=settings&msg=theme_saved` with the toast `🎨 Theme saved.`.
- **Where it shows:** public pages only. `siteTheme.themeFor()` returns `''` for any path starting `/admin`.
- **The theme files:**
  - Every rule in `public/css/theme-<name>.css` is scoped to `html[data-theme="<name>"]`.
  - Each file has a `@media (prefers-reduced-motion: reduce)` rule that stops the animation (`animation: none; display: none;`).
  - The moving layer has `pointer-events: none`.
- **Colours:**
  - Halloween: accent `#f97316`, with purple `#7c3aed` / `#4c1d95`.
  - Christmas: accent `#ef4444`, with green `#14532d` / `#16a34a`.
- **Test data:** tests use a temp `DATA_DIR`, a blank `MONGODB_URI`, the in-memory session store and a made-up admin password. Never touch the project's `games.json` or a database.
- **Known unrelated failure:** `scripts/test-upcoming-psn-page-public.js`. Report it; do not fix it.
- **Edit scripts:** they live in `.superpowers/tmp-edits/` (git-ignored). Never commit them. Task 2 removes the folder.
- **Committing:** always `git add` explicit paths. The untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` must never be committed.

## Files

| File | Task | Change |
|---|---|---|
| `lib/site-theme.js` (new) | 1 | `THEMES`, `LABELS`, `normalizeTheme`, `themeFor` |
| `public/css/theme-halloween.css`, `public/css/theme-christmas.css` (new) | 1 | The two themes |
| `scripts/test-site-theme.js` (new) | 1 | The rules, the stylesheets and the real routes |
| `server.js` | 1 | `res.locals.siteTheme` and `POST /admin/settings/theme` |
| `views/partials/head.ejs` | 1 | Marks `data-theme` and loads the stylesheet |
| `views/partials/admin/settings.ejs` | 1 | The Holiday Theme card |
| `views/admin.ejs` | 1 | The `theme_saved` toast |

---

### Task 1: Holiday themes

**Files:**
- Create: `scripts/test-site-theme.js`, `lib/site-theme.js`, `public/css/theme-halloween.css`, `public/css/theme-christmas.css`, `.superpowers/tmp-edits/rep.js`, `.superpowers/tmp-edits/edit-theme.js`
- Modify (edit script): `server.js`, `views/partials/head.ejs`, `views/partials/admin/settings.ejs`, `views/admin.ejs`

**Interfaces:**
- Consumes (already present):
  - In `server.js`: `getSiteSettings()`, `requireAuth`, `db`, and the locals middleware that sets `res.locals.seoNoindex`.
  - `app.locals.assetV`.
  - The admin toast maps in `views/admin.ejs`.
  - The site accent variable `--ps-blue` and the classes `.announcement-bar`, `nav`, `nav .logo`, `footer`, `.game-card`, `.gd-cover`, `.btn-primary` and `body.light-mode` in `public/css/style.css`.
- Produces:
  - `require('./lib/site-theme')`:
    - `THEMES` (`['halloween', 'christmas']`) and `LABELS`;
    - `normalizeTheme(v)` → `'' | 'halloween' | 'christmas'`;
    - `themeFor(path, settings)` → the same.
  - `res.locals.siteTheme`.
  - The route `POST /admin/settings/theme`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-site-theme.js`:

````js
// Run: node scripts/test-site-theme.js
//
// Holiday themes (Halloween, Christmas) for the public site. The owner picks
// one in Admin → Settings (POST /admin/settings/theme); public pages then mark
// <html data-theme> and load public/css/theme-<name>.css, and the admin panel
// never does. Also checks both theme stylesheets keep every rule scoped to
// their theme and stop the animation for visitors who ask for less motion.
//
// Throwaway only: a temp DATA_DIR, a blank MONGODB_URI, an in-memory session
// store, a made-up admin password and made-up games.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const siteTheme = require('../lib/site-theme');

const PORT = 4668;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'site-theme-'));
const TEST_PASSWORD = 'throwaway-' + Math.random().toString(36).slice(2);
const ROOT = path.join(__dirname, '..');

fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: TEST_PASSWORD,
  games: [
    { id: 4, title: 'PS Plus Deluxe', platform: 'PS4/PS5', nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799, non_trophy_slots: 1, trophy_slots: 1 },
    { id: 5, title: 'Zzyzx Racer', platform: 'PS5', genre: 'Racing', nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899, non_trophy_slots: 1, trophy_slots: 1 }
  ]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.env.SESSION_SECRET = 'site-theme-test';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function call(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method,
      headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, headers),
      timeout: 20000
    }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}
const form = o => new URLSearchParams(o).toString();
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
const ledger = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const PUBLIC = ['/', '/game/zzyzx-racer', '/ps-plus/rent', '/browse'];

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

// Every rule's selector in a theme file, outside @keyframes.
function selectors(css) {
  const out = [];
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const noKeyframes = noComments.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const re = /([^{}]+)\{/g;
  let m;
  while ((m = re.exec(noKeyframes))) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith('@')) continue;
    sel.split(',').forEach(s => out.push(s.trim()));
  }
  return out;
}

(async () => {
  console.log('\nlib/site-theme.js');
  await ok('only the listed themes count; anything else is no theme', async () => {
    assert.deepStrictEqual(siteTheme.THEMES, ['halloween', 'christmas']);
    assert.strictEqual(siteTheme.normalizeTheme('halloween'), 'halloween');
    assert.strictEqual(siteTheme.normalizeTheme(' Christmas '), 'christmas');
    ['', null, undefined, 'easter', '../style', '<script>'].forEach(v => assert.strictEqual(siteTheme.normalizeTheme(v), '', String(v)));
  });
  await ok('the admin panel never shows a theme', async () => {
    assert.strictEqual(siteTheme.themeFor('/', { theme: 'halloween' }), 'halloween');
    assert.strictEqual(siteTheme.themeFor('/admin', { theme: 'halloween' }), '');
    assert.strictEqual(siteTheme.themeFor('/admin/login', { theme: 'christmas' }), '');
    assert.strictEqual(siteTheme.themeFor('/', null), '');
  });

  console.log('\nthe theme stylesheets');
  for (const name of siteTheme.THEMES) {
    await ok(name + ': every rule is scoped to html[data-theme="' + name + '"]', async () => {
      const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'theme-' + name + '.css'), 'utf8');
      const sels = selectors(css);
      assert.ok(sels.length > 5, 'found rules');
      sels.forEach(s => assert.ok(s.startsWith('html[data-theme="' + name + '"]'), 'unscoped: ' + s));
    });
    await ok(name + ': the animation stops for visitors who ask for less motion', async () => {
      const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'theme-' + name + '.css'), 'utf8');
      const i = css.indexOf('@media (prefers-reduced-motion: reduce)');
      assert.ok(i > 0);
      assert.ok(/animation:\s*none;\s*display:\s*none;/.test(css.slice(i)));
      assert.ok(/pointer-events:\s*none/.test(css), 'the moving layer never takes a click');
    });
  }

  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  require('../server.js');
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { await call('GET', '/admin/login'); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(up, 'server did not come up within 15s');

  try {
    console.log('\nthe site');
    await ok('no theme set: public pages look as they did, with no theme mark or stylesheet', async () => {
      for (const p of PUBLIC) {
        const r = await call('GET', p);
        assert.strictEqual(r.status, 200, p);
        assert.ok(!r.body.includes('data-theme') && !r.body.includes('/css/theme-'), p);
      }
    });
    await ok('saving refuses anyone not logged in', async () => {
      const r = await call('POST', '/admin/settings/theme', { headers: FORM, body: form({ theme: 'halloween' }) });
      assert.ok(r.status === 302 || r.status === 401, String(r.status));
      assert.ok(!ledger().site_settings || !ledger().site_settings.theme);
    });

    const login = await call('POST', '/admin/login', { headers: FORM, body: form({ password: TEST_PASSWORD }) });
    const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    assert.ok(cookie, 'logged in');
    const save = async theme => {
      const r = await call('POST', '/admin/settings/theme', { headers: Object.assign({ Cookie: cookie }, FORM), body: form({ theme }) });
      assert.strictEqual(r.status, 302);
      assert.strictEqual(r.headers.location, '/admin?tab=settings&msg=theme_saved');
    };

    for (const name of siteTheme.THEMES) {
      await ok(name + ': saved, then every public page marks it and loads its stylesheet', async () => {
        await save(name);
        assert.strictEqual(ledger().site_settings.theme, name);
        for (const p of PUBLIC) {
          const r = await call('GET', p);
          assert.ok(r.body.includes("<script>document.documentElement.setAttribute('data-theme', '" + name + "');</script>"), p);
          assert.ok(new RegExp('<link rel="stylesheet" href="/css/theme-' + name + '\\.css\\?v=[^"]+">').test(r.body), p);
        }
      });
      await ok(name + ': the admin panel stays plain, and Settings shows it picked', async () => {
        const r = await call('GET', '/admin', { headers: { Cookie: cookie } });
        assert.strictEqual(r.status, 200);
        assert.ok(!r.body.includes('/css/theme-') && !r.body.includes("setAttribute('data-theme'"));
        assert.ok(r.body.includes('<form method="POST" action="/admin/settings/theme">'));
        assert.ok(r.body.includes('<option value="' + name + '" selected>'), 'picked in the form');
        assert.ok(r.body.includes("theme_saved:'🎨 Theme saved.'"));
        const css = await call('GET', '/css/theme-' + name + '.css');
        assert.strictEqual(css.status, 200);
      });
    }

    await ok('an unknown value saves as no theme, and the site goes back to normal', async () => {
      await save('easter');
      assert.strictEqual(ledger().site_settings.theme, '');
      const r = await call('GET', '/');
      assert.ok(!r.body.includes('data-theme') && !r.body.includes('/css/theme-'));
    });

    console.log('\n' + passed + ' assertions passed\n');
  } catch (e) {
    console.error(e);
    cleanup();
    process.exit(1);
  }
  cleanup();
  process.exit(0);
})().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-site-theme.js` → FAIL `Error: Cannot find module '../lib/site-theme'`.

- [ ] **Step 3: The rules, the two themes and the wiring**

Create `lib/site-theme.js`:

````js
// The public site's holiday theme, picked in Admin → Settings → Holiday theme
// and stored as site_settings.theme. '' means no theme. Anything that isn't a
// listed theme counts as '', so a bad or missing value leaves the site as it is.
// views/partials/head.ejs loads public/css/theme-<name>.css for the theme.

const THEMES = ['halloween', 'christmas'];
const LABELS = { '': 'None', halloween: '🎃 Halloween', christmas: '🎄 Christmas' };

function normalizeTheme(value) {
  const s = String(value || '').trim().toLowerCase();
  return THEMES.includes(s) ? s : '';
}

// The theme a request shows. The admin panel never shows one.
function themeFor(path, settings) {
  if (String(path || '').startsWith('/admin')) return '';
  return normalizeTheme(settings && settings.theme);
}

module.exports = { THEMES, LABELS, normalizeTheme, themeFor };
````

Create `public/css/theme-halloween.css`:

````css
/* Halloween theme (Admin → Settings → Holiday theme). Loaded only while it is
   on, by views/partials/head.ejs, which also sets html[data-theme]. Every rule
   is scoped to html[data-theme="halloween"] and only adds on top of style.css,
   so switching the theme off leaves the site exactly as it was. */

/* The site's accent (buttons, links, prices) turns pumpkin orange. */
html[data-theme="halloween"] { --ps-blue: #f97316; }
html[data-theme="halloween"] .btn-primary:hover { background: #fb923c; }

html[data-theme="halloween"] .announcement-bar {
  background: linear-gradient(90deg, #4c1d95 0%, #c2410c 50%, #4c1d95 100%);
  background-size: 200% auto;
}

html[data-theme="halloween"] body:not(.light-mode) { background-color: #0c0712; }
html[data-theme="halloween"] body:not(.light-mode) nav { background: #120a1c; box-shadow: inset 0 -1px 0 rgba(124, 58, 237, 0.35); }
html[data-theme="halloween"] body:not(.light-mode) footer { background: #120a1c; border-top-color: rgba(124, 58, 237, 0.35); }
html[data-theme="halloween"] body.light-mode nav { box-shadow: inset 0 -2px 0 #fdba74; }
html[data-theme="halloween"] body.light-mode footer { border-top: 2px solid #fdba74; }

html[data-theme="halloween"] nav .logo { position: relative; }
html[data-theme="halloween"] nav .logo::after {
  content: '🎃';
  position: absolute; right: -1.5rem; top: 50%;
  transform: translateY(-50%);
  font-size: 1.1rem; line-height: 1;
  pointer-events: none;
}

/* A thin holiday outline on every catalogue card and the game page poster. */
html[data-theme="halloween"] .game-card,
html[data-theme="halloween"] .gd-cover { outline: 1px solid rgba(249, 115, 22, 0.55); outline-offset: -1px; }

/* Two bats drifting across, in a fixed layer under the page's content: it
   never takes a click, and shows only where the page background does. */
html[data-theme="halloween"] body::before,
html[data-theme="halloween"] body::after {
  content: '🦇';
  position: fixed; z-index: -1;
  pointer-events: none;
  font-size: 1.6rem; opacity: 0.55;
  animation: phBatFly 26s linear infinite;
}
html[data-theme="halloween"] body::before { top: 18vh; left: -3rem; }
html[data-theme="halloween"] body::after { top: 62vh; left: -3rem; font-size: 1.2rem; animation-duration: 34s; animation-delay: -12s; }

@keyframes phBatFly {
  0% { transform: translate(0, 0); }
  25% { transform: translate(28vw, -4vh); }
  50% { transform: translate(55vw, 3vh); }
  75% { transform: translate(80vw, -3vh); }
  100% { transform: translate(110vw, 0); }
}

/* Phones get one smaller bat. */
@media (max-width: 640px) {
  html[data-theme="halloween"] body::after { display: none; }
  html[data-theme="halloween"] body::before { font-size: 1.2rem; }
  html[data-theme="halloween"] nav .logo::after { right: -1.2rem; font-size: 0.95rem; }
}

/* Visitors who ask for less motion get no bats at all. */
@media (prefers-reduced-motion: reduce) {
  html[data-theme="halloween"] body::before,
  html[data-theme="halloween"] body::after { animation: none; display: none; }
}
````

Create `public/css/theme-christmas.css`:

````css
/* Christmas theme (Admin → Settings → Holiday theme). Loaded only while it is
   on, by views/partials/head.ejs, which also sets html[data-theme]. Every rule
   is scoped to html[data-theme="christmas"] and only adds on top of style.css,
   so switching the theme off leaves the site exactly as it was. */

/* The site's accent (buttons, links, prices) turns Christmas red. Text on it
   stays dark (style.css), so the light red keeps it readable. */
html[data-theme="christmas"] { --ps-blue: #ef4444; --ph-snow: rgba(255, 255, 255, 0.75); }
html[data-theme="christmas"] .btn-primary:hover { background: #f87171; }

html[data-theme="christmas"] .announcement-bar {
  background: linear-gradient(90deg, #14532d 0%, #b91c1c 50%, #14532d 100%);
  background-size: 200% auto;
}

html[data-theme="christmas"] body:not(.light-mode) { background-color: #06120b; }
html[data-theme="christmas"] body:not(.light-mode) nav { background: #0a1f12; box-shadow: inset 0 -1px 0 rgba(22, 163, 74, 0.4); }
html[data-theme="christmas"] body:not(.light-mode) footer { background: #0a1f12; border-top-color: rgba(22, 163, 74, 0.4); }
html[data-theme="christmas"] body.light-mode { --ph-snow: rgba(148, 163, 184, 0.7); }
html[data-theme="christmas"] body.light-mode nav { box-shadow: inset 0 -2px 0 #86efac; }
html[data-theme="christmas"] body.light-mode footer { border-top: 2px solid #fca5a5; }

html[data-theme="christmas"] nav .logo { position: relative; }
html[data-theme="christmas"] nav .logo::after {
  content: '🎄';
  position: absolute; right: -1.5rem; top: 50%;
  transform: translateY(-50%);
  font-size: 1.1rem; line-height: 1;
  pointer-events: none;
}

/* A thin holiday outline on every catalogue card and the game page poster. */
html[data-theme="christmas"] .game-card,
html[data-theme="christmas"] .gd-cover { outline: 1px solid rgba(239, 68, 68, 0.55); outline-offset: -1px; }

/* Snow: tiny dots drawn with gradients (nothing to download) in a fixed layer
   under the page's content. It never takes a click, and shows only where the
   page background does. */
html[data-theme="christmas"] body::before {
  content: '';
  position: fixed; inset: 0; z-index: -1;
  pointer-events: none;
  background-image:
    radial-gradient(2px 2px at 20px 30px, var(--ph-snow), transparent),
    radial-gradient(2px 2px at 140px 90px, var(--ph-snow), transparent),
    radial-gradient(3px 3px at 230px 170px, var(--ph-snow), transparent),
    radial-gradient(2px 2px at 320px 40px, var(--ph-snow), transparent),
    radial-gradient(1.5px 1.5px at 90px 200px, var(--ph-snow), transparent);
  background-size: 360px 240px;
  animation: phSnowFall 22s linear infinite;
}

@keyframes phSnowFall {
  from { background-position: 0 0; }
  to { background-position: 80px 240px; }
}

/* Phones get sparser snow. */
@media (max-width: 640px) {
  html[data-theme="christmas"] body::before { background-size: 300px 320px; }
  html[data-theme="christmas"] nav .logo::after { right: -1.2rem; font-size: 0.95rem; }
}

/* Visitors who ask for less motion get no snow at all. */
@media (prefers-reduced-motion: reduce) {
  html[data-theme="christmas"] body::before { animation: none; display: none; }
}
````

Create `.superpowers/tmp-edits/rep.js`. It keeps a file's BOM and CRLF, and fails loudly on a missing or repeated anchor:

````js
// Exact-text edit helpers for this plan's edit scripts. Keep a file's UTF-8
// BOM and CRLF line endings; anchors are written with \n. Throw when an
// anchor is missing or appears more than once, so nothing is half-applied
// silently. Run edit scripts from the repo root.
const fs = require('fs');

function load(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const crlf = body.includes('\r\n');
  return { bom, crlf, text: crlf ? body.replace(/\r\n/g, '\n') : body };
}

function save(file, f, text) {
  const out = f.crlf ? text.replace(/\n/g, '\r\n') : text;
  fs.writeFileSync(file, (f.bom ? '﻿' : '') + out);
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

function once(file, text, needle) {
  const n = count(text, needle);
  if (n !== 1) throw new Error(file + ': expected 1 match, found ' + n + ' for: ' + needle.slice(0, 80));
  return text.indexOf(needle);
}

// Replaces the one occurrence of `from` with `to`.
function rep(file, from, to) {
  const f = load(file);
  once(file, f.text, from);
  save(file, f, f.text.replace(from, () => to));
}

// Replaces everything from `start` through `end` (both included) with `to`.
rep.between = function (file, start, end, to) {
  const f = load(file);
  const i = once(file, f.text, start);
  const j = f.text.indexOf(end, i + start.length);
  if (j === -1) throw new Error(file + ': end anchor not found after start: ' + end.slice(0, 80));
  save(file, f, f.text.slice(0, i) + to + f.text.slice(j + end.length));
};

// Replaces the whole of `file` with the text of the file `src`, keeping
// `file`'s own BOM and line endings.
rep.put = function (file, src) {
  const f = load(file);
  save(file, f, load(src).text);
};

module.exports = rep;
````

Create `.superpowers/tmp-edits/edit-theme.js`:

````js
// Holiday themes: the setting (POST /admin/settings/theme and the request's
// res.locals.siteTheme) in server.js, loading the theme's stylesheet in the
// shared head, the Settings card, and its toast. Keeps each file's BOM and
// CRLF.
const rep = require('./rep');
const S = 'server.js';

rep(S,
`const slotHistory = require('./lib/slot-history');
`,
`const slotHistory = require('./lib/slot-history');
const siteTheme = require('./lib/site-theme');
`);

rep(S,
`  res.locals.seoNoindex = req.path.startsWith('/admin');
`,
`  res.locals.seoNoindex = req.path.startsWith('/admin');
  // The holiday theme views/partials/head.ejs loads; never on admin pages.
  res.locals.siteTheme = siteTheme.themeFor(req.path, getSiteSettings());
`);

rep(S,
`app.post('/admin/settings/payment-reminders', requireAuth, (req, res) => {
`,
`// Holiday theme for the public site (lib/site-theme.js). An unknown value
// saves as '' — no theme.
app.post('/admin/settings/theme', requireAuth, (req, res) => {
  db.set('site_settings.theme', siteTheme.normalizeTheme(req.body.theme)).write();
  res.redirect('/admin?tab=settings&msg=theme_saved');
});

app.post('/admin/settings/payment-reminders', requireAuth, (req, res) => {
`);

rep('views/partials/head.ejs',
`<% blocks.forEach(function (block) { %>
`,
`<% if (typeof siteTheme !== 'undefined' && siteTheme) { %>
<%# Holiday theme (Admin → Settings → Holiday theme, lib/site-theme.js): set
    before the page paints, so every public page picks it up. %>
<script>document.documentElement.setAttribute('data-theme', '<%= siteTheme %>');</script>
<link rel="stylesheet" href="/css/theme-<%= siteTheme %>.css?v=<%= assetV %>">
<% } %>
<% blocks.forEach(function (block) { %>
`);

rep('views/partials/admin/settings.ejs',
`    <!-- IMAGE OPTIMIZATION -->
`,
`    <!-- HOLIDAY THEME -->
    <%# lib/site-theme.js; the styles are public/css/theme-<name>.css. %>
    <% const themeNow = (settings && settings.theme) || ''; %>
    <div class="adm-card" id="sec-theme">
      <div class="adm-card-head" style="border-left:3px solid #f97316;">
        <div class="sa-left">
          <div class="sa-icon" style="background:rgba(249,115,22,0.15);">🎨</div>
          <div>
            <div class="sa-title">Holiday Theme</div>
            <div class="sa-desc">Dress the public site for a holiday. The admin panel never changes.</div>
          </div>
        </div>
      </div>
      <div class="adm-card-body">
        <form method="POST" action="/admin/settings/theme">
          <select name="theme" id="themeSelect" class="qa-in" data-ss-skip style="max-width:260px;">
            <option value=""<%= themeNow === '' ? ' selected' : '' %>>None</option>
            <option value="halloween"<%= themeNow === 'halloween' ? ' selected' : '' %>>🎃 Halloween</option>
            <option value="christmas"<%= themeNow === 'christmas' ? ' selected' : '' %>>🎄 Christmas</option>
          </select>
          <button type="submit" class="oq-alert-btn" style="margin-left:0.5rem;">Save theme</button>
          <div class="oq-alert-msg" style="margin-top:0.4rem;">Holiday colours, a small icon by the logo, and drifting bats or snow. The announcement bar keeps your text. Stays on until you set it back to None.</div>
        </form>
      </div>
    </div>

    <!-- IMAGE OPTIMIZATION -->
`);

const A = 'views/admin.ejs';
rep(A, `alerts_saved:'settings', `, `alerts_saved:'settings', theme_saved:'settings', `);
rep(A, `alerts_saved:'🔔 Alert settings saved.', `, `alerts_saved:'🔔 Alert settings saved.', theme_saved:'🎨 Theme saved.', `);

console.log('edited server.js, head.ejs, settings.ejs, admin.ejs');
````

Run: `node .superpowers/tmp-edits/edit-theme.js` → `edited server.js, head.ejs, settings.ejs, admin.ejs`.
Then: `file server.js views/partials/head.ejs views/partials/admin/settings.ejs views/admin.ejs` → `server.js` still has its BOM, and all four are still `with CRLF line terminators`.

- [ ] **Step 4: Run it and watch it pass**

Run: `node scripts/test-site-theme.js` → `13 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/site-theme.js public/css/theme-halloween.css public/css/theme-christmas.css scripts/test-site-theme.js server.js views/partials/head.ejs views/partials/admin/settings.ejs views/admin.ejs
git commit -m "Halloween and Christmas themes for the public site, picked in Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Full suite, browser check and clean-up

Run by the controller, which has the built-in browser. Throwaway instances only; the public pages need no login.

**Files:**
- Create: `.superpowers/tmp-edits/serve-theme-review.js`
- Temporarily modify, outside the repo: `C:\Users\michael\Desktop\claude code\.claude\launch.json`. Add two entries, then remove them.

**Interfaces:**
- Consumes: Task 1.
- Produces: nothing to commit.

- [ ] **Step 1: Run the whole suite**

Run: `fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail"`
Expected: only `FAIL scripts/test-upcoming-psn-page-public.js` and `failed: 1`.

- [ ] **Step 2: Start the two throwaway instances**

Create `.superpowers/tmp-edits/serve-theme-review.js`:

````js
// Throwaway review instance for the holiday themes: a temp DATA_DIR, a blank
// MONGODB_URI and made-up games, with the theme already set. No login needed.
// Runs from any folder:
//   node <repo>/.superpowers/tmp-edits/serve-theme-review.js halloween   → port 4651
//   node <repo>/.superpowers/tmp-edits/serve-theme-review.js christmas   → port 4652
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const THEME = process.argv[2] === 'christmas' ? 'christmas' : 'halloween';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'review-theme-'));
const price = { nt_price_7d: 349, nt_price_30d: 799, tr_price_7d: 399, tr_price_30d: 899 };
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  site_settings: { theme: THEME, promo: { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100 } },
  announcements: [{ id: 1, text: 'Zzyzx test announcement — weekly rentals from ₱349', active: true }],
  games: ['Zzyzx Racer', 'Zzyzx Quest', 'Zzyzx Arena', 'Zzyzx Legends', 'Zzyzx Drift', 'Zzyzx Siege'].map((title, i) =>
    Object.assign({ id: i + 1, title, platform: 'PS5', genre: 'Action', renters: 3 - (i % 3), non_trophy_slots: 1, trophy_slots: i % 2 }, price))
}));
process.env.PORT = THEME === 'christmas' ? '4652' : '4651';
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
process.chdir(ROOT);
const sessionStore = require(path.join(ROOT, 'lib/session-store'));
sessionStore.createStore = () => { const s = new (require(path.join(ROOT, 'node_modules/express-session')).MemoryStore)(); s.ensureIndexes = async () => false; return s; };
require(path.join(ROOT, 'server.js'));
const done = () => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } process.exit(0); };
process.on('SIGINT', done);
process.on('SIGTERM', done);
setTimeout(done, 30 * 60 * 1000);
````

Add these entries to the `configurations` array of `C:\Users\michael\Desktop\claude code\.claude\launch.json`. Keep the other entries as they are:

```json
{
  "name": "theme-review-halloween",
  "runtimeExecutable": "node",
  "runtimeArgs": ["C:/Users/michael/Desktop/claude code/playstation-hub/.superpowers/tmp-edits/serve-theme-review.js", "halloween"],
  "port": 4651
},
{
  "name": "theme-review-christmas",
  "runtimeExecutable": "node",
  "runtimeArgs": ["C:/Users/michael/Desktop/claude code/playstation-hub/.superpowers/tmp-edits/serve-theme-review.js", "christmas"],
  "port": 4652
}
```

The stylesheets are cached for a year under the same `?v=` within one server run. If you edit a theme file during the check, restart that instance before looking again.

- [ ] **Step 3: Check each theme**

Halloween (`http://localhost:4651/browse` and `/`), at 1280px:
- `--ps-blue` is `#f97316`, so the buttons and the Rent tab turn orange.
- The announcement bar is purple and orange.
- 🎃 sits by the logo.
- `.game-card` has an orange `outline`.
- Two bats drift in the gaps behind the content. `document.elementFromPoint` over a card returns the card, not the bat layer.

Switch `body` to `light-mode` (the site's own toggle): the background stays light, and the orange accent and border lines remain.

At 375px (mobile preset, reload):
- `document.documentElement.scrollWidth` is 375.
- `getComputedStyle(document.body, '::after').display` is `none`, so only one bat shows.
- The pumpkin fits by the logo.

Christmas (`http://localhost:4652/game/zzyzx-racer` and `/`):
- `--ps-blue` is `#ef4444`.
- The announcement bar is green and red.
- Snow (`phSnowFall`) falls behind the content.
- 🎄 sits by the logo.
- `.gd-cover` has a red outline.
- At 375px the page is 375px wide, and the first link on the page is what `elementFromPoint` hits at its centre.

The console shows no errors.

- [ ] **Step 4: Tear down and clean up**

- Reset the viewport to the desktop preset, and stop both servers with `preview_stop`.
- Remove the two `theme-review-*` entries from `launch.json`.
- Stopping does not always let the launcher delete its data folder. Delete any leftovers: `rm -rf "$TEMP"/review-theme-*`.

```bash
rm -rf .superpowers/tmp-edits && git status --short
```
Expected `git status`: nothing except the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.
