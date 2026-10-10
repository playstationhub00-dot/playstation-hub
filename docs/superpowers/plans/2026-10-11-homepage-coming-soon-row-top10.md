# Homepage — still Coming soon row, Top rented top 10 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the homepage, Coming soon becomes a still shelf like New releases: 6 games, soonest first, no arrows, no drifting. The Top rented box beside the banner lists #1–#10 with cover pictures and a "View all games ›" link, and the banner grows to match the box's height.

**Architecture:** The Coming soon card moves unchanged into `views/partials/upcoming-card.ejs`. Browse's slider (`upcoming-section.ejs`) and a new homepage shelf (`partials/home/upcoming-row.ejs`, the same shell as `partials/home/game-row.ejs`) both include it. The homepage stops drifting Coming soon. The Top rented box (`partials/home/top.ejs`) renders 10 rows with a 30px picture. `home.css` lets the banner slide fill its grid row instead of a fixed 340px.

**Tech Stack:** Express + EJS templates, plain CSS; tests are `node scripts/test-*.js`.

Spec: `docs/superpowers/specs/2026-10-11-homepage-coming-soon-row-top10-design.md`.

Every file in this plan was dry-run in a scratch copy of the current `main`. Both new tests fail first and then pass, the updated existing tests pass, and the full suite stays green apart from the known `scripts/test-requests-page.js`. A browser check on a throwaway instance with made-up games confirmed the layout:
- 1440px wide: the banner and box are both 469px, all 10 rows and "View all games" sit inside, and Coming soon is 6 cards in one row that stay still for 3 seconds.
- 375px wide: Coming soon is 6 cards you can swipe, and the Top rented shelf shows "View all ›". Nothing scrolls sideways.
- Browse is unchanged: 7 games, arrows and its own heading.
- No console or server errors.

## Global Constraints

- Work directly on `main`; **push only when the owner says "push"**.
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Line endings: `views/partials/upcoming-section.ejs` is CRLF in the working tree. `views/index.ejs` is LF + UTF-8 BOM. `views/partials/home/top.ejs`, `public/css/home.css`, `public/js/index-4.js` and the test files are LF. The edit scripts (via `.superpowers/tmp-edits/rep.js`) keep each file's endings and BOM. New files are LF. Git stores LF blobs (`core.autocrlf=true`), so a CRLF working copy is expected.
- Homepage Coming soon: at most 6 games, in the order the route already gives (`sortUpcoming`: owner-ranked first, then soonest release, TBA last). No arrows, no `upcomingSlider`, no drift. "View all ›" → `/browse#comingSoon`. The section is left out when there are none.
- Browse's Coming soon looks and behaves as before.
- Top rented box (≥ 900px): #1–#10 from `home.topRented`. Each row has a rank circle, then a 30×30px cover (`object-fit: cover`, `loading="lazy"`, or a dark square when there's none), then the title and weekly price. "View all games ›" → `/browse`. The banner fills the row, at least 340px.
- Phone Top rented shelf: `viewAll: '/browse'`.
- Tests use a temp `DATA_DIR`, blank `MONGODB_URI`, the in-memory session store and a made-up admin password. Never touch the project's `games.json` or a database.
- Known unrelated failure: `scripts/test-requests-page.js`. Report it, do not fix it.
- Edit scripts live in `.superpowers/tmp-edits/` (git-ignored); never commit them; Task 2 removes the folder.
- Always `git add` explicit paths: the untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md` must never be committed.

## Files

| File | Task | Change |
|---|---|---|
| `views/partials/upcoming-card.ejs` (new) | 1 | The Coming soon card, moved unchanged |
| `views/partials/home/upcoming-row.ejs` (new) | 1 | Homepage Coming soon shelf |
| `views/partials/upcoming-section.ejs` | 1 | Includes the card; homepage-only branches removed |
| `views/index.ejs` | 1, 2 | Task 1: uses `upcoming-row`. Task 2: phone Top rented "View all" |
| `public/js/index-4.js` | 1 | No Coming soon drift |
| `public/css/home.css` | 1, 2 | Task 1: drop dead Coming soon rules. Task 2: box, pictures, banner height |
| `scripts/test-homepage-carousel.js` | 1 | Drift wiring and six-games checks updated |
| `scripts/test-home-coming-soon-row.js` (new) | 1 | Homepage shelf and Browse |
| `views/partials/home/top.ejs` | 2 | 10 rows with pictures + "View all games ›" |
| `scripts/test-home-top10.js` (new) | 2 | Box, phone link, styles |

---

### Task 1: Coming soon becomes a still shelf on the homepage

**Files:**
- Create: `views/partials/upcoming-card.ejs`, `views/partials/home/upcoming-row.ejs`, `scripts/test-home-coming-soon-row.js`
- Modify (edit script): `views/partials/upcoming-section.ejs`, `views/index.ejs`, `public/js/index-4.js`, `public/css/home.css`, `scripts/test-homepage-carousel.js`

**Interfaces:**
- Consumes: `upcoming`, already in order from the `GET /` route in `server.js` (`sortUpcoming(getUpcoming()).map(resolveUpcomingSlots)`); `.hm-row` / `.hm-cell` / `.hm-title` / `.hm-viewall` / `.hm-mark` styles in `public/css/home.css`.
- Produces: `views/partials/upcoming-card.ejs` (locals `game`), included from `views/partials/upcoming-section.ejs` as `include('upcoming-card', { game })` and from `views/partials/home/upcoming-row.ejs` as `include('../upcoming-card', { game })`. `views/partials/home/upcoming-row.ejs` (locals `upcoming`), included by `views/index.ejs` as `include('partials/home/upcoming-row', { upcoming })`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-home-coming-soon-row.js`:

````js
// Run: node scripts/test-home-coming-soon-row.js
//
// The homepage's Coming soon games sit still, like New releases: one shelf
// (.hm-row) of at most 6 cards, owner-ranked first then soonest release, no
// arrows and no drifting. Browse keeps its own slider, and both pages draw the
// same card (views/partials/upcoming-card.ejs). Boots a throwaway instance
// (temp DATA_DIR, blank MONGODB_URI, in-memory sessions, a made-up admin
// password); nothing touches the project's games.json or a database.
const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4624;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'home-coming-soon-'));
// A local calendar date d days from today — the card counts days in local time.
const daysAhead = d => {
  const t = new Date(Date.now() + d * 86400000);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
};
const up = (id, title, release_date, extra) => Object.assign({
  id, title, platform: 'PS5', release_date, cover_image: '/uploads/up' + id + '.png',
  non_trophy_slots: 2, trophy_slots: 1, nt_price_7d: 349, nt_price_30d: 1099
}, extra || {});
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-' + Math.random().toString(36).slice(2),
  games: [{ id: 1, title: 'Zzyzx Released', platform: 'PS5', cover_image: '/uploads/g1.png', nt_price_7d: 349, non_trophy_slots: 1, trophy_slots: 1 }],
  upcoming: [
    up(1, 'Zzyzx Ranked Late', daysAhead(200), { rank: 1 }),
    up(2, 'Zzyzx Soon A', daysAhead(5)),
    up(3, 'Zzyzx Soon B', daysAhead(12)),
    up(4, 'Zzyzx Date Tba', 'TBA'),
    up(5, 'Zzyzx Soon C', daysAhead(20), { non_trophy_slots: 0, trophy_slots: 0 }),
    up(6, 'Zzyzx Soon D', daysAhead(30)),
    up(7, 'Zzyzx Soon E', daysAhead(40))
  ]
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: p, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, timeout: 20000 }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    req.end();
  });
}
function slice(html, from, to) {
  const i = html.indexOf(from);
  assert.ok(i >= 0, from + ' found');
  const j = html.indexOf(to, i + from.length);
  return html.slice(i, j < 0 ? html.length : j);
}
const upcomingIds = html => [...html.matchAll(/href="\/upcoming\/[a-z0-9-]+-(\d+)" class="game-card upcoming-card/g)].map(m => Number(m[1]));
// One card's HTML, by its upcoming id, with whitespace runs folded so the two pages compare.
function card(html, id) {
  const re = new RegExp('<a href="/upcoming/[a-z0-9-]+-' + id + '" class="game-card upcoming-card[\\s\\S]*?</a>');
  const m = re.exec(html);
  assert.ok(m, 'card ' + id + ' found');
  return m[0].replace(/\s+/g, ' ');
}

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  require('../server.js');
  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    try { await get('/admin/login'); ready = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(ready, 'server did not come up within 15s');

  const home = (await get('/')).body;
  const browse = (await get('/browse')).body;

  console.log('\nhomepage');
  const soon = slice(home, '<section class="hm-wrap hm-sec" id="comingSoon">', '</section>');
  ok('a still shelf like New releases, with the Coming soon heading and View all', () => {
    assert.ok(soon.includes('<h2 class="hm-title"><span aria-hidden="true" class="hm-mark hm-sq">□</span>Coming soon <span class="hm-sub">reserve a slot</span><a class="hm-viewall" href="/browse#comingSoon">View all ›</a></h2>'));
    assert.ok(soon.includes('<div class="hm-row">'));
    assert.strictEqual((soon.match(/<div class="hm-cell">\s*<a href="\/upcoming\//g) || []).length, 6);
  });
  ok('six games: the ranked one first, then soonest release; TBA and the 7th left out', () => {
    assert.deepStrictEqual(upcomingIds(soon), [1, 2, 3, 5, 6, 7]);
  });
  ok('no arrows, no slider, nothing to drift', () => {
    ['upcomingSlider', 'upcoming-slider', 'slider-arrow', 'slideUpcoming', 'upcomingBody'].forEach(t => assert.ok(!soon.includes(t), t));
    assert.ok(!home.includes('id="upcomingSlider"'));
  });
  ok('the page script no longer drifts Coming soon', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'index-4.js'), 'utf8');
    assert.ok(!/autoDrift\('upcomingSlider'/.test(js));
  });

  console.log('\nBrowse and the shared card');
  ok('Browse keeps its Coming soon slider with arrows and every game', () => {
    const b = slice(browse, 'id="upcomingSlider"', 'slider-arrow-right');
    assert.ok(browse.includes('onclick="slideUpcoming(-1)"'));
    const head = slice(browse, 'id="comingSoon"', '</h2>');
    assert.ok(head.includes('Open for Reservation') && head.includes('class="section-toggle-btn"'), "Browse's own heading and collapse button");
    assert.ok(browse.includes('<div class="collapsible-body" id="upcomingBody">'));
    assert.deepStrictEqual(upcomingIds(b), [1, 2, 3, 5, 6, 7, 4]);
  });
  ok('both pages draw the same card', () => {
    [2, 5].forEach(id => assert.strictEqual(card(home, id), card(browse, id), 'card ' + id));
    assert.ok(card(home, 5).includes('cs-full') && card(home, 5).includes('<div class="card-ribbon">Full</div>'));
    assert.ok(card(home, 2).includes('<span class="cs-cd-n">5</span><span class="cs-cd-u">days</span>'));
  });
  ok('no Coming soon games → no homepage section', () => {
    const file = path.join(__dirname, '..', 'views', 'partials', 'home', 'upcoming-row.ejs');
    assert.strictEqual(ejs.render(fs.readFileSync(file, 'utf8'), { upcoming: [] }, { filename: file }).trim(), '');
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-home-coming-soon-row.js` → FAIL `AssertionError [ERR_ASSERTION]: <section class="hm-wrap hm-sec" id="comingSoon"> found`.

- [ ] **Step 3: Create the card and the homepage shelf**

Create `views/partials/upcoming-card.ejs`. This is the card block from `upcoming-section.ejs`, moved unchanged and dedented by 4 spaces, with the loop line removed:

````ejs
<%#
  One Coming soon card (poster art, countdown or FULL ribbon, price, Reserve).
  Used by the Browse page's Coming soon slider (partials/upcoming-section) and
  the homepage's Coming soon row (partials/home/upcoming-row). Locals: game.
%>
<%
  const csIsTba = !game.release_date || game.release_date === 'TBA';
  let csDaysLeft = null;
  if (!csIsTba) {
    const csReleaseDate = new Date(game.release_date + 'T00:00:00');
    const csToday0 = new Date(); csToday0.setHours(0,0,0,0);
    csDaysLeft = Math.ceil((csReleaseDate - csToday0) / 86400000);
  }
  let csDisplayDate = 'TBA';
  if (!csIsTba) {
    csDisplayDate = new Date(game.release_date + 'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  }
  const csSlotsLeft = (game.non_trophy_slots||0) + (game.trophy_slots||0);
  const csFull = csSlotsLeft === 0;
  // A full card gives its top-right corner to the FULL ribbon, so the
  // countdown badge that normally sits there moves into the meta line as
  // text. The release date still matters to someone waiting for a slot —
  // it just stops being the loudest thing on the card.
  const csCountdownText = csIsTba ? '' : (csDaysLeft > 0 ? csDaysLeft + ' day' + (csDaysLeft !== 1 ? 's' : '') : 'Any day now');
  // Cheapest configured price across every duration/type, for the "from ₱X" line.
  const csPrices = [game.nt_price_7d, game.nt_price_30d, game.tr_price_7d, game.tr_price_30d].filter(p => p > 0);
  const csFromPrice = csPrices.length ? Math.min(...csPrices) : null;
%>
<a href="/upcoming/<%= game.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') %>-<%= game.id %>" class="game-card upcoming-card game-card-link<%= csFull ? ' cs-full' : '' %>" data-title="<%= game.title.toLowerCase() %>" data-genre="<%= (game.genre||'').toLowerCase() %>">
  <% if (game.cover_image) { %>
    <img src="<%= game.cover_image %>" alt="<%= game.title %>" class="cs-cover-img" loading="lazy" decoding="async">
  <% } else { %>
    <div class="cs-cover-placeholder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
      </svg>
      <span>No Image</span>
    </div>
  <% } %>
  <div class="cs-scrim"></div>
  <div class="cs-badge">Coming Soon</div>
  <% if (game.rank) { %><div class="cs-hot">🔥 #<%= game.rank %></div><% } %>
  <%# A full game trades its countdown badge for the FULL ribbon — both live
      in the top-right corner and would otherwise overlap. %>
  <% if (csFull) { %>
    <div class="card-ribbon">Full</div>
  <% } else if (csIsTba) { %>
    <div class="cs-cd cs-cd-tba"><span class="cs-cd-n">Date<br>TBA</span></div>
  <% } else if (csDaysLeft > 0) { %>
    <div class="cs-cd"><span class="cs-cd-n"><%= csDaysLeft %></span><span class="cs-cd-u">days</span></div>
  <% } else { %>
    <div class="cs-cd cs-cd-tba"><span class="cs-cd-n" style="font-size:0.62rem;">Any Day<br>Now</span></div>
  <% } %>
  <div class="cs-body">
    <div class="cs-plat"><%= game.platform %><%= game.genre ? ' · ' + game.genre : '' %></div>
    <div class="cs-title"><%= game.title %></div>
    <div class="cs-meta">
      <span><%= csDisplayDate %></span>
      <%# When full, the ribbon already says so — repeating it here in red
          would state the same thing twice and crowd a three-line card. The
          countdown takes the slot instead, since it lost its badge. %>
      <% if (csFull) { %>
        <% if (csCountdownText) { %><span>·</span><span><%= csCountdownText %></span><% } %>
      <% } else { %>
        <span>·</span>
        <span class="cs-slots-ok"><%= csSlotsLeft %> slot<%= csSlotsLeft !== 1 ? 's' : '' %> left</span>
      <% } %>
    </div>
    <div class="cs-foot">
      <% if (csFromPrice) { %><div class="cs-price">from <b>₱<%= csFromPrice %></b></div><% } else { %><div class="cs-price">Pricing TBA</div><% } %>
      <div class="cs-cta<%= csFull ? ' cs-cta-ghost' : '' %>"><%= csFull ? 'Notify Me' : 'Reserve →' %></div>
    </div>
  </div>
</a>
````

Create `views/partials/home/upcoming-row.ejs`:

````ejs
<%#
  The homepage's Coming soon games: the same still shelf as New releases (a
  swipe row on phones, up to 6 a row on computers — public/css/home.css .hm-row),
  with the Coming soon card (partials/upcoming-card). No arrows, no drifting.
  Locals: upcoming (already in order: owner-ranked first, then soonest release).
%>
<% if (upcoming.length) { %>
<section class="hm-wrap hm-sec" id="comingSoon">
  <h2 class="hm-title"><span aria-hidden="true" class="hm-mark hm-sq">□</span>Coming soon <span class="hm-sub">reserve a slot</span><a class="hm-viewall" href="/browse#comingSoon">View all ›</a></h2>
  <div class="hm-row">
    <% upcoming.slice(0, 6).forEach(game => { %><div class="hm-cell"><%- include('../upcoming-card', { game }) %></div><% }) %>
  </div>
</section>
<% } %>
````

- [ ] **Step 4: Apply the edits**

Create `.superpowers/tmp-edits/rep.js`. It keeps the BOM and CRLF, fails loudly on a missing or repeated anchor, and has `rep.between` for block replacements; Task 2 reuses it:

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

// The text from `start` through `end` (both included), for moving it elsewhere.
rep.read = function (file, start, end) {
  const f = load(file);
  const i = once(file, f.text, start);
  const j = f.text.indexOf(end, i + start.length);
  if (j === -1) throw new Error(file + ': end anchor not found after start: ' + end.slice(0, 80));
  return f.text.slice(i, j + end.length);
};

module.exports = rep;
````

Create `.superpowers/tmp-edits/edit-coming-soon-row.js`:

````js
// Task 1: the homepage's Coming soon games become a still shelf like New
// releases; Browse keeps its slider; both draw partials/upcoming-card.
// Run from the repo root: node .superpowers/tmp-edits/edit-coming-soon-row.js
const rep = require('./rep');
const S = 'views/partials/upcoming-section.ejs';

// 1. Browse's slider draws each card from the shared partial (moved there unchanged).
rep.between(S,
  `    <% upcoming.forEach(game => {\n`,
  `    </a>\n    <% }) %>\n`,
  `    <% upcoming.forEach(game => { %><%- include('upcoming-card', { game }) %><% }) %>\n`);

// 2. Only Browse uses this partial now, and it never passes homeMarker or
//    viewAllHref: keep Browse's heading and collapse toggle, drop the rest.
rep.between(S,
  `    <% if (typeof homeMarker !== 'undefined' && homeMarker) { %>\n`,
  `    <% } %>\n  </h2>\n`,
  `    <span style="display:inline-flex;align-items:center;gap:0.5rem;">
      <span style="background:linear-gradient(135deg,#7b2ff7,#f107a3);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-size:1.1em;">🔜</span>
      Coming Soon
    </span>
    <span style="font-size:0.8rem;font-weight:500;color:#666;margin-left:0.5rem;">Open for Reservation</span>
    <button type="button" class="section-toggle-btn" onclick="toggleCollapsible('upcomingBody', this)" aria-label="Collapse Coming Soon">▾</button>
  </h2>
`);
rep(S,
  `  <div class="<%= (typeof viewAllHref !== 'undefined' && viewAllHref) ? '' : 'collapsible-body' %>" id="upcomingBody">\n`,
  `  <div class="collapsible-body" id="upcomingBody">\n`);

// 3. The homepage uses the still shelf.
rep('views/index.ejs',
  `<%- include('partials/upcoming-section', { upcoming: upcoming.slice(0, 6), noBorderTop: true, viewAllHref: '/browse#comingSoon', homeMarker: true }) %>\n`,
  `<%- include('partials/home/upcoming-row', { upcoming }) %>\n`);

// 4. Nothing drifts Coming soon any more.
rep('public/js/index-4.js',
  `  // Only Coming Soon flows left to right; New Releases and Most Popular flow
  // right to left (New Releases was briefly reversed too, then asked back).
  autoDrift('newReleasesSlider', 18);
  autoDrift('upcomingSlider', 16, true);
  autoDrift('popularSlider', 14);
`,
  `  // Coming soon no longer drifts: on the homepage it is a still shelf like
  // New releases (views/partials/home/upcoming-row.ejs).
  autoDrift('newReleasesSlider', 18);
  autoDrift('popularSlider', 14);
`);

// 5. The drift test: two rows, neither reversed, and not Coming soon.
rep('scripts/test-homepage-carousel.js',
  `ok('all three rows drift, and only Coming Soon runs in reverse', () => {
  const calls = jsSrc.match(/autoDrift\\('[^']+',\\s*\\d+(?:,\\s*true)?\\)/g) || [];
  assert.strictEqual(calls.length, 3, 'three rows: ' + JSON.stringify(calls));
  const reversed = calls.filter(c => /,\\s*true\\)/.test(c));
  assert.strictEqual(reversed.length, 1, 'exactly one reversed row: ' + JSON.stringify(reversed));
  assert.ok(/upcomingSlider/.test(reversed[0]), 'and it is Coming Soon: ' + reversed[0]);
});`,
  `ok('New Releases and Most Popular drift; Coming Soon is a still shelf now', () => {
  const calls = jsSrc.match(/autoDrift\\('[^']+',\\s*\\d+(?:,\\s*true)?\\)/g) || [];
  assert.deepStrictEqual(calls, ["autoDrift('newReleasesSlider', 18)", "autoDrift('popularSlider', 14)"]);
  assert.ok(!/upcomingSlider/.test(jsSrc), 'Coming Soon is never drifted');
});`);

rep('scripts/test-homepage-carousel.js',
  `ok('Coming Soon renders six', () => {
  assert.ok(/upcoming-section[\\s\\S]{0,120}upcoming:\\s*upcoming\\.slice\\(0,\\s*6\\)/.test(src),
    'the Coming Soon include still slices to 6');
});`,
  `ok('Coming Soon renders six', () => {
  assert.ok(/include\\('partials\\/home\\/upcoming-row', \\{ upcoming \\}\\)/.test(src), 'the homepage uses the still shelf');
  const row = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'home', 'upcoming-row.ejs'), 'utf8');
  assert.ok(/upcoming\\.slice\\(0, 6\\)/.test(row), 'and it takes six');
});`);

// 6. Home styles: the old Coming soon block's spacing rules no longer match anything.
rep('public/css/home.css',
  `/* Coming soon (partials/upcoming-section) keeps its own look; spacing to match. */
.home2 .section[data-upcoming] { padding: 2.5rem 2rem 0; }
.home2 .section-title::after { content: none; }
.home2 .section[data-upcoming] .section-title { font-size: 1.35rem; font-weight: 900; flex-wrap: wrap; gap: 0.25rem; margin-bottom: 1rem; }
.home2 .section[data-upcoming] .section-viewall { margin-left: auto; background: none; border: none; padding: 0; color: var(--ps-blue); font-size: 0.8rem; }
`,
  `.home2 .section-title::after { content: none; }
`);
rep('public/css/home.css',
  `  .hm-wrap, .home2 .section[data-upcoming] { padding-left: 1rem; padding-right: 1rem; }
`,
  `  .hm-wrap { padding-left: 1rem; padding-right: 1rem; }
`);
rep('public/css/home.css',
  `  .hm-title, .home2 .section[data-upcoming] .section-title { font-size: 1.15rem; }
`,
  `  .hm-title { font-size: 1.15rem; }
`);

console.log('edited upcoming-section.ejs, index.ejs, index-4.js, test-homepage-carousel.js, home.css');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-coming-soon-row.js` → `edited upcoming-section.ejs, index.ejs, index-4.js, test-homepage-carousel.js, home.css`.
Then: `file views/partials/upcoming-section.ejs views/index.ejs` → the first still `with CRLF line terminators`; `index.ejs` still `UTF-8 (with BOM)`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node scripts/test-home-coming-soon-row.js` → `7 assertions passed`.
Run: `node scripts/test-homepage-carousel.js && node scripts/test-home-page.js && node scripts/test-browse-page.js` → `14`, `14`, `16 assertions passed`.

- [ ] **Step 6: Commit**

```bash
git add views/partials/upcoming-card.ejs views/partials/home/upcoming-row.ejs views/partials/upcoming-section.ejs views/index.ejs public/js/index-4.js public/css/home.css scripts/test-homepage-carousel.js scripts/test-home-coming-soon-row.js
git commit -m "Homepage Coming soon: a still shelf of 6 like New releases; one shared card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Top rented box shows #1–#10 with pictures

**Files:**
- Create: `scripts/test-home-top10.js`
- Modify (edit script): `views/partials/home/top.ejs`, `views/index.ejs` (phone Top rented `viewAll`), `public/css/home.css`

**Interfaces:**
- Consumes: `home.topRented` (`[{ game, weekly }]`, up to 10, from `lib/home-view.js` `topRented` via `GET /`); `hmSlug` in `top.ejs`; `.hm-rk` / `.hm-rk-N` rank styles; `.hm-viewall` for the phone shelf. `.superpowers/tmp-edits/rep.js` from Task 1.
- Produces: classes `.hm-board-cover` (30px picture or empty square) and `.hm-board-all` ("View all games ›"). On computers `.hm-aside` becomes a flex column, and `.hm-slide` gets `min-height: 340px` instead of `height: 340px`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-home-top10.js`:

````js
// Run: node scripts/test-home-top10.js
//
// The homepage's "Top rented this month" box beside the banner (computers):
// #1–#10, each with a small cover picture, and "View all games ›" to Browse;
// the banner grows to the box's height. On phones the Top rented shelf gets
// the same View all as New releases. Boots a throwaway instance (temp
// DATA_DIR, blank MONGODB_URI, in-memory sessions, a made-up admin password);
// nothing touches the project's games.json or a database.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 4625;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'home-top10-'));
// Twelve games, renters 12 down to 1, so the all-time fill-up ranks them in id order.
const games = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1, title: 'Zzyzx Game ' + String(i + 1).padStart(2, '0'), platform: 'PS5', genre: 'Action',
  cover_image: i + 1 === 3 ? '' : '/uploads/g' + (i + 1) + '.png', renters: 12 - i,
  nt_price_7d: 349, nt_price_30d: 999, tr_price_7d: 449, tr_price_30d: 1199, non_trophy_slots: 1, trophy_slots: 1,
  created_at: '2020-01-01T00:00:00.000Z'
}));
fs.writeFileSync(path.join(DATA_DIR, 'games.json'), JSON.stringify({
  admin_password: 'throwaway-' + Math.random().toString(36).slice(2), games, upcoming: [], customers: []
}));
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATA_DIR;
process.env.MONGODB_URI = '';
function cleanup() { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path: p, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 test', 'X-Forwarded-Proto': 'https' }, timeout: 20000 }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')); });
    req.end();
  });
}
function slice(html, from, to) {
  const i = html.indexOf(from);
  assert.ok(i >= 0, from + ' found');
  const j = html.indexOf(to, i + from.length);
  return html.slice(i, j < 0 ? html.length : j);
}
// The body of the first `sel { … }` rule in `text`.
const rule = (text, sel) => {
  const m = new RegExp('(?:^|[\\n{])\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}').exec(text);
  assert.ok(m, sel + ' rule found');
  return m[1];
};

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

async function main() {
  const sessionStore = require('../lib/session-store');
  sessionStore.createStore = () => {
    const store = new (require('express-session').MemoryStore)();
    store.ensureIndexes = async () => false;
    return store;
  };
  require('../server.js');
  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    try { await get('/admin/login'); ready = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(ready, 'server did not come up within 15s');
  const home = (await get('/')).body;
  const aside = slice(home, '<aside class="hm-aside"', '</aside>');
  const rows = [...aside.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);

  console.log('\nTop rented box (computers)');
  ok('ten games, most rented first, ranked 1 to 10', () => {
    assert.strictEqual(rows.length, 10);
    assert.deepStrictEqual(rows.map(r => (/class="hm-board-title">([^<]+)</.exec(r) || [])[1]), games.slice(0, 10).map(g => g.title));
    rows.forEach((r, i) => assert.ok(r.includes('<span class="hm-rk hm-rk-' + (i + 1) + '">' + (i + 1) + '</span>'), 'rank ' + (i + 1)));
  });
  ok('each row has its cover picture, and a plain square when there is none', () => {
    assert.ok(rows[0].includes('<img src="/uploads/g1.png" alt="" class="hm-board-cover" loading="lazy" decoding="async">'));
    assert.ok(rows[9].includes('src="/uploads/g10.png"'));
    assert.ok(rows[2].includes('<span class="hm-board-cover" aria-hidden="true"></span>') && !rows[2].includes('<img'), 'game 3 has no cover');
    rows.forEach((r, i) => assert.ok(r.indexOf('hm-board-cover') > r.indexOf('hm-rk') && r.indexOf('hm-board-cover') < r.indexOf('hm-board-title'), 'picture between rank and title, row ' + (i + 1)));
  });
  ok('the weekly price stays on every row', () => {
    rows.forEach(r => assert.ok(r.includes('<span class="hm-board-price">₱349</span>')));
  });
  ok('"View all games ›" opens Browse', () => {
    assert.ok(aside.includes('<a class="hm-board-all" href="/browse">View all games ›</a>'));
  });

  console.log('\nTop rented shelf (phones)');
  ok('its heading has View all, like New releases', () => {
    const head = slice(home, 'id="topRented"', '</h2>');
    assert.ok(head.includes('<a class="hm-viewall" href="/browse">View all ›</a>'));
  });

  console.log('\nstyles');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'home.css'), 'utf8').replace(/\r\n/g, '\n');
  ok('on computers the banner fills its row (at least 340px) instead of a fixed 340px', () => {
    const desktop = css.slice(css.indexOf('@media (min-width: 900px) { .hm-slide'));
    const slide = rule(desktop, '.hm-slide');
    assert.ok(/min-height:\s*340px/.test(slide), slide);
    assert.ok(!/(^|;)\s*height:\s*340px/.test(slide), 'no fixed height: ' + slide);
  });
  ok('the box stacks its list and View all; pictures are 30px squares', () => {
    const desktopAside = css.slice(css.indexOf('@media (min-width: 900px) { .hm-aside'));
    assert.ok(/display:\s*flex/.test(rule(desktopAside, '.hm-aside')) && /flex-direction:\s*column/.test(rule(desktopAside, '.hm-aside')));
    const cover = rule(css, '.hm-board-cover');
    ['width: 30px', 'height: 30px', 'object-fit: cover'].forEach(d => assert.ok(cover.includes(d), d));
    assert.ok(/margin-top:\s*auto/.test(rule(css, '.hm-board-all')), 'View all sits at the bottom');
  });

  console.log('\n' + passed + ' assertions passed\n');
  cleanup();
  process.exit(0);
}

main().catch(e => { console.error(e); cleanup(); process.exit(1); });
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-home-top10.js` → FAIL `AssertionError … actual: 5, expected: 10`.

- [ ] **Step 3: Apply the edits**

Create `.superpowers/tmp-edits/edit-top10.js`:

````js
// Task 2: the Top rented box shows #1–#10 with cover pictures and "View all
// games ›"; the banner grows to match; the phone shelf gets View all.
// Run from the repo root: node .superpowers/tmp-edits/edit-top10.js
const rep = require('./rep');

// 1. The box: ten rows, a picture between rank and title, View all under the list.
rep('views/partials/home/top.ejs',
  `          <% home.topRented.slice(0, 5).forEach((t, i) => { %>
          <li><a href="/game/<%= hmSlug(t.game.title) %>"><span class="hm-rk hm-rk-<%= i + 1 %>"><%= i + 1 %></span><span class="hm-board-title"><%= t.game.title %></span><% if (t.weekly) { %><span class="hm-board-price">₱<%= t.weekly %></span><% } %></a></li>
          <% }) %>
        </ol>
`,
  `          <% home.topRented.slice(0, 10).forEach((t, i) => { %>
          <li><a href="/game/<%= hmSlug(t.game.title) %>"><span class="hm-rk hm-rk-<%= i + 1 %>"><%= i + 1 %></span><% if (t.game.cover_image) { %><img src="<%= t.game.cover_image %>" alt="" class="hm-board-cover" loading="lazy" decoding="async"><% } else { %><span class="hm-board-cover" aria-hidden="true"></span><% } %><span class="hm-board-title"><%= t.game.title %></span><% if (t.weekly) { %><span class="hm-board-price">₱<%= t.weekly %></span><% } %></a></li>
          <% }) %>
        </ol>
        <a class="hm-board-all" href="/browse">View all games ›</a>
`);
rep('views/partials/home/top.ejs',
  `  banner and — on computers — the Top rented list beside it.
`,
  `  banner and — on computers — the Top rented list beside it (#1–#10 with
  pictures; the banner grows to the list's height).
`);

// 2. The phone shelf gets the same View all as New releases.
rep('views/index.ejs',
  `games: home.topRented.map(t => t.game), viewAll: '', ranked: true`,
  `games: home.topRented.map(t => t.game), viewAll: '/browse', ranked: true`);

// 3. Styles: the banner fills its row; the box stacks list + View all; ten
//    tighter rows of 30px pictures keep the box (and the banner) near 470px.
rep('public/css/home.css',
  `@media (min-width: 900px) { .hm-slide { aspect-ratio: auto; height: 340px; } }
`,
  `/* On computers a slide fills the banner, which is as tall as the Top rented box beside it. */
@media (min-width: 900px) { .hm-slide { aspect-ratio: auto; min-height: 340px; } }
`);
rep('public/css/home.css',
  `.hm-aside { display: none; background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 1rem 1.1rem; }
@media (min-width: 900px) { .hm-aside { display: block; } }
`,
  `.hm-aside { display: none; background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 0.85rem 1rem; }
@media (min-width: 900px) { .hm-aside { display: flex; flex-direction: column; } }
`);
rep('public/css/home.css',
  `.hm-aside-head { display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.6rem; font-size: 1rem; color: #fff; }
`,
  `.hm-aside-head { display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.35rem; font-size: 1rem; color: #fff; }
`);
rep('public/css/home.css',
  `.hm-board li a { display: flex; align-items: center; gap: 0.7rem; padding: 0.6rem 0.2rem; border-bottom: 1px solid var(--border); color: #eee; text-decoration: none; font-size: 0.9rem; }
`,
  `.hm-board li a { display: flex; align-items: center; gap: 0.6rem; padding: 0.24rem 0.2rem; border-bottom: 1px solid var(--border); color: #eee; text-decoration: none; font-size: 0.9rem; }
`);
rep('public/css/home.css',
  `.hm-board-price { color: var(--ps-blue); font-weight: 800; }
`,
  `.hm-board-price { color: var(--ps-blue); font-weight: 800; }
.hm-board-cover { flex-shrink: 0; display: block; width: 30px; height: 30px; border-radius: 6px; object-fit: cover; background: #222; }
.hm-board-all { margin-top: auto; padding-top: 0.45rem; align-self: flex-end; font-size: 0.8rem; font-weight: 700; color: var(--ps-blue); text-decoration: none; }
.hm-board-all:hover { text-decoration: underline; }
`);

console.log('edited top.ejs, index.ejs, home.css');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-top10.js` → `edited top.ejs, index.ejs, home.css`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-home-top10.js` → `7 assertions passed`.
Run: `node scripts/test-home-page.js && node scripts/test-home-coming-soon-row.js` → `14`, `7 assertions passed`.
Run the whole suite: `fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail"` → only `FAIL scripts/test-requests-page.js`, `failed: 1`.

- [ ] **Step 5: Commit and clean up**

```bash
git add views/partials/home/top.ejs views/index.ejs public/css/home.css scripts/test-home-top10.js
git commit -m "Homepage Top rented: top 10 with pictures and View all games; banner grows to match

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
rm -rf .superpowers/tmp-edits && git status --short
```
Expected `git status`: nothing except the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.
