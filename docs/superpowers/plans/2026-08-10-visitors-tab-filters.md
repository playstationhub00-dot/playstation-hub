# Visitors Tab Filters + Nested Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redefine the session funnel so its stages are nested by construction (no percentage can exceed 100%), and give the funnel, exit-pages, and Most Visited Pages panels the same Today/Weekly/Monthly/Yearly/All filtering the neighbouring panels already have — including making a click on the 14-day chart filter every panel at once instead of only Recent Visits.

**Architecture:** A single pass over `visitors[]` collapses raw pageview rows into one compact record per session (`{ startDate, browsed, viewedGame, ordered, paid, exitPath }`). Every time window — five named periods plus the fourteen chart days — is derived from that summary array rather than by re-walking the raw rows. All nineteen result sets are computed server-side in the `/admin` route and shipped to the view as one JSON object, mirroring how `TP_DATA` already serves Most Visited Pages. Client-side filtering swaps precomputed data with no new endpoint and no loading state.

**Tech Stack:** Express.js + EJS server-rendered views, vanilla JS (no framework, no bundler), lowdb for `visitors`, MongoDB for `orders` via `lib/orders.js`. No test framework exists in this project by design; verification is `node -c server.js`, EJS/CSS balance greps, and live smoke-testing on Railway — the established convention.

## Global Constraints

- Funnel stages must be nested **by construction**, so `Landed ⊇ Viewed a game ⊇ Started order ⊇ Paid` holds structurally, not incidentally. Specifically: "Viewed a game" counts a session that has any `/game/*` row **OR** has an order (spec: "the OR the session has an order clause is deliberate and load-bearing"). No percentage may ever exceed 100%.
- `Paid` continues to read the shared `orders.PAID_EXCLUDED_STATES` constant. This plan does not redefine it (spec: "This spec does not redefine it").
- A session belongs to **the date of its first recorded visit**. A session that lands Monday and orders Tuesday counts entirely toward Monday (spec: "A session belongs to the date of its first recorded visit").
- "Browsed the catalog" is a standalone stat above the funnel, **not** a funnel stage (spec: "not as a funnel stage").
- Only sessions with a `session_id` count. Pre-launch rows have none and stay excluded — never backfilled (established by the previous plan).
- Filter buttons are exactly **Today / Weekly / Monthly / Yearly / All**, matching the existing panels' labels, styling, and active-state class (`vis-filter-active`).
- Selecting a period button clears any active date selection; selecting a date clears the active period button. The whole tab always describes one window.
- Only the fourteen chart bars are clickable, so only those fourteen dates are precomputed.
- The Orders tab's weekly funnel readout, the four KPI cards, `ph_sid`/session identity, and the 14-day chart's own data are all untouched.
- `node -c server.js` must exit 0 after every server.js change.
- EJS tag-balance (`<%` count == `%>` count) must hold for `views/admin.ejs`.
- CSS brace-balance must hold for `public/css/style.css` if touched.
- No local dev server exists — live verification happens against https://playstation-hub.com after `git push` (Railway auto-deploys, ~60-90s).

---

### Task 1: Session summaries and windowed metric computation

**Files:**
- Modify: `server.js:1716-1774` (replace the existing session-funnel computation block, and extend the `res.render('admin', {...})` call)

**Interfaces:**
- Consumes: `visitors` (array, already in scope in the `/admin` route), `allOrders` (array, already fetched earlier in the route by the weekly-readout code — reuse it, do not query again), `orders.PAID_EXCLUDED_STATES` (existing shared constant from `lib/orders.js`), `vLast14` — **note:** `vLast14` is computed in the EJS view, not in server.js, so this task computes its own fourteen-date list rather than consuming it.
- Produces: a single view local `VIS_WINDOWS` — an object of the shape below — consumed by Task 2's rendering and Task 3's client-side filtering. The existing `sessionFunnel` and `topExitPages` locals are removed and replaced by it.

```js
// Shape of VIS_WINDOWS (both the five named periods and each of the
// fourteen 'YYYY-MM-DD' keys under byDate hold this same object shape):
{
  today: {
    funnel: [ { label: 'Landed', count: 25, pctOfPrev: null }, ... ],  // 4 stages
    exitPages: [ { path: '/game/x', count: 3 }, ... ],                  // up to 8
    browsed: { count: 2, total: 25, pct: 8 },
    topPages: [ ['Home', 4], ['/game/x', 2], ... ]                      // up to 5
  },
  week: { ...same shape... },
  month: { ...same shape... },
  year: { ...same shape... },
  all: { ...same shape... },
  byDate: { '2026-08-10': { ...same shape... }, ... }                   // 14 keys
}
```

- [ ] **Step 1: Replace the session-funnel computation block**

In `server.js`, delete the entire existing block from the comment `// Session funnel: derived entirely from visitors[] and orders` (currently line 1716) through the end of the `topExitPages` assignment (currently line 1772), and replace it with:

```js
  // ── Visitors tab: session summaries + windowed metrics ────────────────────
  // One pass collapses raw pageview rows into a single record per session, and
  // every time window is then derived from that compact array. Re-walking the
  // raw rows once per window would mean nineteen passes over a collection that
  // grows without bound; this is one pass regardless of how many windows exist.
  const sessionedVisits = visitors.filter(v => v.session_id);
  const rowsBySession = {};
  sessionedVisits.forEach(v => {
    (rowsBySession[v.session_id] = rowsBySession[v.session_id] || []).push(v);
  });

  const sessionedOrders = allOrders.filter(o => o.session_id);
  const orderedSessionIds = new Set(sessionedOrders.map(o => o.session_id));
  const paidSessionIds = new Set(
    sessionedOrders
      .filter(o => !orders.PAID_EXCLUDED_STATES.includes(o.state))
      .map(o => o.session_id)
  );

  const sessionSummaries = Object.keys(rowsBySession).map(sid => {
    const rows = rowsBySession[sid];
    const ordered = orderedSessionIds.has(sid);
    return {
      // A session belongs to the day it STARTED. Counting it on every day it
      // was active would double-count sessions across days and make "Landed"
      // meaningless as a total.
      startDate: rows[0].date,
      browsed: rows.some(v => v.path === '/browse'),
      // "OR ordered" is load-bearing, not redundant: an order can only be
      // placed from a game page, so in practice every ordering session also
      // has a /game/ row — but if that row were ever missing (a tracking gap,
      // a middleware exclusion change), a plain check would let "Started
      // order" exceed "Viewed a game" and reintroduce a >100% percentage.
      // Folding the order in makes the nesting structural, not incidental.
      viewedGame: rows.some(v => v.path.startsWith('/game/')) || ordered,
      ordered,
      paid: paidSessionIds.has(sid),
      // No tab-close event exists, so the last row recorded for a session is
      // the closest available proxy for "the last thing they looked at".
      exitPath: rows[rows.length - 1].path,
      rows
    };
  });

  // Builds every metric for one set of sessions. Called once per window.
  function visWindowMetrics(sessions) {
    const landed = sessions.length;
    const viewedGame = sessions.filter(s => s.viewedGame).length;
    const started = sessions.filter(s => s.ordered).length;
    const paid = sessions.filter(s => s.paid).length;
    const browsedCount = sessions.filter(s => s.browsed).length;

    const pct = (n, prev) => (prev > 0 ? Math.round((n / prev) * 100) : null);
    const funnel = [
      { label: 'Landed', count: landed, pctOfPrev: null },
      { label: 'Viewed a game', count: viewedGame, pctOfPrev: pct(viewedGame, landed) },
      { label: 'Started order', count: started, pctOfPrev: pct(started, viewedGame) },
      { label: 'Paid', count: paid, pctOfPrev: pct(paid, started) }
    ];

    const exitCounts = {};
    sessions.forEach(s => { exitCounts[s.exitPath] = (exitCounts[s.exitPath] || 0) + 1; });
    const exitPages = Object.entries(exitCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([path, count]) => ({ path, count }));

    // Most Visited Pages counts PAGE VIEWS, not sessions — it answers "which
    // pages got looked at most", a different question from the session-scoped
    // funnel above it. Kept row-level deliberately.
    const pageCounts = {};
    sessions.forEach(s => s.rows.forEach(v => {
      const key = v.page || v.path;
      pageCounts[key] = (pageCounts[key] || 0) + 1;
    }));
    const topPages = Object.entries(pageCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return {
      funnel,
      exitPages,
      browsed: { count: browsedCount, total: landed, pct: pct(browsedCount, landed) },
      topPages
    };
  }

  const winToday = new Date().toISOString().slice(0, 10);
  const winWeek  = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const winMonth = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const winYear  = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

  const VIS_WINDOWS = {
    today: visWindowMetrics(sessionSummaries.filter(s => s.startDate === winToday)),
    week:  visWindowMetrics(sessionSummaries.filter(s => s.startDate >= winWeek)),
    month: visWindowMetrics(sessionSummaries.filter(s => s.startDate >= winMonth)),
    year:  visWindowMetrics(sessionSummaries.filter(s => s.startDate >= winYear)),
    all:   visWindowMetrics(sessionSummaries),
    byDate: {}
  };

  // Only the fourteen chart bars are clickable, so only those dates need a
  // precomputed entry. This mirrors the same fourteen days the view's own
  // vLast14 chart renders.
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    VIS_WINDOWS.byDate[d] = visWindowMetrics(sessionSummaries.filter(s => s.startDate === d));
  }
```

- [ ] **Step 2: Update the render call**

In the `res.render('admin', { ... })` call (currently `server.js:1774`), remove the two keys `sessionFunnel` and `topExitPages`, and add `VIS_WINDOWS` in their place. Every other key in that object stays exactly as it is.

- [ ] **Step 3: Verify syntax**

Run: `node -c server.js`
Expected: exit 0, no output.

- [ ] **Step 4: Verify the old locals are fully gone from server.js**

Run: `grep -n "sessionFunnel\|topExitPages" server.js`
Expected: **no matches.** If either name still appears, a reference was missed — the view will crash on render with "sessionFunnel is not defined" once Task 2 lands, so resolve it now.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -F - <<'MSGEOF'
Compute Visitors tab metrics per time window from session summaries

Collapses raw pageview rows into one record per session in a single
pass, then derives every window from that compact array — five named
periods plus the fourteen clickable chart days. Re-walking the raw
rows per window would have meant nineteen passes over a collection
that grows without bound.

Also redefines the funnel stages so nesting is structural rather than
incidental: "Viewed a game" now counts a /game/ visit OR an order,
because ordering is only possible from a game page and a missing
pageview row would otherwise let a later stage exceed an earlier one
and produce a percentage above 100%. Browsed drops out of the funnel
and becomes a standalone stat.
MSGEOF
```

---

### Task 2: Render the funnel, exit pages, and Browsed stat from the new data

**Files:**
- Modify: `views/admin.ejs:2880-2916` (the Session Funnel + Exit Pages section)
- Modify: `public/css/style.css` (append styles for the new Browsed stat line and filter button row)

**Interfaces:**
- Consumes: `VIS_WINDOWS` from Task 1.
- Produces: DOM containers with the exact ids `vfFunnelBody`, `vfExitBody`, `vfBrowsedStat`, and buttons `vfBtn-today`/`vfBtn-week`/`vfBtn-month`/`vfBtn-year`/`vfBtn-all`, all consumed by Task 3's client-side rendering.

- [ ] **Step 1: Replace the funnel/exit-pages markup**

In `views/admin.ejs`, replace the entire block from `<!-- Session Funnel + Exit Pages -->` (currently line 2880) through its closing `</div>` (currently line 2916) with:

```ejs
    <!-- Session Funnel + Exit Pages -->
    <div class="vf-section">
      <div class="vf-filter-row">
        <span class="vf-filter-label">Sessions</span>
        <button onclick="setFunnelFilter('today')" id="vfBtn-today" class="vis-filter-btn vis-filter-active" style="font-size:0.7rem;padding:0.25rem 0.6rem;">Today</button>
        <button onclick="setFunnelFilter('week')"  id="vfBtn-week"  class="vis-filter-btn"                  style="font-size:0.7rem;padding:0.25rem 0.6rem;">Weekly</button>
        <button onclick="setFunnelFilter('month')" id="vfBtn-month" class="vis-filter-btn"                  style="font-size:0.7rem;padding:0.25rem 0.6rem;">Monthly</button>
        <button onclick="setFunnelFilter('year')"  id="vfBtn-year"  class="vis-filter-btn"                  style="font-size:0.7rem;padding:0.25rem 0.6rem;">Yearly</button>
        <button onclick="setFunnelFilter('all')"   id="vfBtn-all"   class="vis-filter-btn"                  style="font-size:0.7rem;padding:0.25rem 0.6rem;">All</button>
        <span class="vf-day-label" id="vfDayLabel" style="display:none;"></span>
      </div>
      <div class="vf-grid">
        <div class="vf-panel">
          <div class="vf-panel-label">Funnel</div>
          <div class="vf-browsed" id="vfBrowsedStat"></div>
          <div id="vfFunnelBody"></div>
        </div>
        <div class="vf-panel">
          <div class="vf-panel-label">Top exit pages</div>
          <div id="vfExitBody"></div>
        </div>
      </div>
    </div>
```

Note the `vf-note` caption is deliberately gone — it explained why a percentage could exceed 100%, which Task 1's nested stages make impossible.

- [ ] **Step 2: Append the new styles**

In `public/css/style.css`, append at the end of the file:

```css
.vf-filter-row { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.9rem; }
.vf-filter-label { font-size: 0.7rem; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #666; margin-right: 0.35rem; }
.vf-day-label { font-size: 0.72rem; color: #60a5fa; margin-left: 0.4rem; }
.vf-browsed { font-size: 0.78rem; color: #888; padding: 0.5rem 0.7rem; background: #111; border: 1px solid #1e1e1e; border-radius: 8px; margin-bottom: 0.9rem; }
.vf-browsed strong { color: #ddd; font-weight: 700; }
.vf-browsed .vf-browsed-pct { color: #a78bfa; font-weight: 700; }
```

- [ ] **Step 3: Verify balance**

Run: `grep -o '<%' views/admin.ejs | wc -l` and `grep -o '%>' views/admin.ejs | wc -l`
Expected: the two counts are equal.

Run: `grep -o '{' public/css/style.css | wc -l` and `grep -o '}' public/css/style.css | wc -l`
Expected: the two counts are equal.

- [ ] **Step 4: Commit**

```bash
git add views/admin.ejs public/css/style.css
git commit -F - <<'MSGEOF'
Restructure funnel panel markup for filtering

Panels become empty containers filled client-side, so switching a
period swaps rendered data rather than reloading the page. Adds the
same five filter buttons the neighbouring panels already use, and a
standalone Browsed-the-catalog line above the funnel.

Drops the "a later percentage can exceed 100%" caption — the nested
stage definitions make that impossible now, so the warning would only
confuse.
MSGEOF
```

---

### Task 3: Client-side filtering, and make a date click filter every panel

**Files:**
- Modify: `views/admin.ejs` — the `<script>` block in the Visitors tab (currently around lines 2994-3100), specifically: add the `VIS_WINDOWS` data blob and new render/filter functions, and extend the existing `setTopFilter`, `setVisFilter`, and `filterVisitsByDate` functions.

**Interfaces:**
- Consumes: `VIS_WINDOWS` (Task 1), the DOM ids from Task 2, and the pre-existing `TP_DATA`, `setTopFilter`, `setVisFilter`, `filterVisitsByDate`, `renderTopPages`, and `ORIGINAL_TBODY_HTML` already defined in this script block.
- Produces: nothing consumed by a later task — this is the final feature task.

- [ ] **Step 1: Add the data blob and render functions**

In `views/admin.ejs`, immediately after the existing `const TP_DATA = { ... };` declaration (currently ending line 3002), insert:

```js
    const VIS_WINDOWS = <%- JSON.stringify(VIS_WINDOWS) %>;

    function renderFunnel(win) {
      const body = document.getElementById('vfFunnelBody');
      const browsedEl = document.getElementById('vfBrowsedStat');
      if (!win || win.funnel[0].count === 0) {
        browsedEl.innerHTML = '';
        body.innerHTML = '<div class="vf-empty">No tracked sessions in this period.</div>';
        return;
      }
      const b = win.browsed;
      browsedEl.innerHTML = 'Browsed the catalog — <strong>' + b.count + '</strong> of <strong>' + b.total +
        '</strong> sessions <span class="vf-browsed-pct">' + (b.pct === null ? '—' : b.pct + '%') + '</span>';
      const top = win.funnel[0].count;
      body.innerHTML = win.funnel.map(stage => {
        const widthPct = top > 0 ? Math.max(2, Math.round((stage.count / top) * 100)) : 0;
        const pctHtml = stage.pctOfPrev === null ? '' : ' <span class="vf-pct">' + stage.pctOfPrev + '%</span>';
        return '<div class="vf-row">' +
          '<span class="vf-name">' + stage.label + '</span>' +
          '<div class="vf-bar-track"><div class="vf-bar-fill" style="width:' + widthPct + '%"></div></div>' +
          '<span class="vf-n"><strong>' + stage.count + '</strong>' + pctHtml + '</span>' +
          '</div>';
      }).join('');
    }

    function renderExitPages(win) {
      const body = document.getElementById('vfExitBody');
      if (!win || !win.exitPages.length) {
        body.innerHTML = '<div class="vf-empty">Nothing to show yet.</div>';
        return;
      }
      body.innerHTML = win.exitPages.map(ep =>
        '<div class="vf-exit-row">' +
          '<span class="vf-exit-path">' + ep.path + '</span>' +
          '<span class="vf-exit-n"><strong>' + ep.count + '</strong> session' + (ep.count !== 1 ? 's' : '') + '</span>' +
        '</div>'
      ).join('');
    }

    // Paints all three session-scoped panels from one window object, so they
    // can never end up describing different periods.
    function renderVisWindow(win) {
      renderFunnel(win);
      renderExitPages(win);
      renderTopPages(win && win.topPages ? win.topPages : []);
    }

    let vfFilter = 'today';
    function setFunnelFilter(f) {
      vfFilter = f;
      document.querySelectorAll('.vis-day-bar').forEach(bar => bar.classList.remove('vis-day-active'));
      document.getElementById('vfDayLabel').style.display = 'none';
      // Both button rows track the same window, so both highlight together.
      ['today','week','month','year','all'].forEach(k => {
        document.getElementById('vfBtn-'+k).classList.toggle('vis-filter-active', k === f);
        document.getElementById('tpBtn-'+k).classList.toggle('vis-filter-active', k === f);
      });
      renderVisWindow(VIS_WINDOWS[f]);
    }
```

- [ ] **Step 2: Point the existing Most Visited Pages filter at the shared renderer**

The Most Visited Pages panel is now driven by the same window object, so its own button row must stay in lockstep with the funnel's.

Replace **both** the existing `let tpFilter = 'today';` declaration (currently line 3022) **and** the `setTopFilter` function immediately below it (currently lines 3023-3029) — that is, lines 3022 through 3029 inclusive — with:

```js
    function setTopFilter(f) {
      // Most Visited Pages and the funnel share one window, so selecting a
      // period on either row moves both.
      setFunnelFilter(f);
    }
```

`tpFilter` is deleted rather than kept: a grep confirms it was only ever assigned, never read, so it was dead state. Leaving the old `let tpFilter = 'today';` line in place while the replacement also declared it would be a duplicate-declaration SyntaxError, and the whole script block would fail to parse — so make sure line 3022 is genuinely part of what gets replaced.

Then replace the existing bare call `renderTopPages(TP_DATA['today']);` (currently line 3030) with:

```js
    renderVisWindow(VIS_WINDOWS['today']);
```

**`TP_DATA` is now unused** — its five precomputed period sets are superseded by `VIS_WINDOWS[period].topPages`. Delete the whole `const TP_DATA = { ... };` declaration (currently lines 2996-3002) and, in `server.js`, delete the five now-unused `topPagesToday`/`topPagesWeek`/`topPagesMonth`/`topPagesYear`/`topPagesAll` computations along with the five `vPageToday`/`vPageWeek`/`vPageMonth`/`vPageYear`/`vPageAll` accumulator objects that feed only them (currently `views/admin.ejs:2844-2853` — these live in the EJS view's own `<% %>` block, not server.js; delete them there). Leave `visToday`/`visWeek`/`visMonth`/`visYear` alone: the KPI cards still use them.

- [ ] **Step 3: Make a date click filter every panel**

Replace the existing `filterVisitsByDate` function (currently starting line 3067) with:

```js
    function filterVisitsByDate(date, label) {
      document.querySelectorAll('.vis-filter-btn').forEach(b => b.classList.remove('vis-filter-active'));
      document.querySelectorAll('.vis-day-bar').forEach(bar => bar.classList.toggle('vis-day-active', bar.dataset.date === date));

      // The three session-scoped panels have this date precomputed; only the
      // Recent Visits table needs a fetch, because the server-rendered table
      // holds just the 100 most recent rows overall and may not contain an
      // older day at all.
      renderVisWindow(VIS_WINDOWS.byDate[date]);
      const vfLabel = document.getElementById('vfDayLabel');
      vfLabel.textContent = '📅 ' + label;
      vfLabel.style.display = '';

      const dayLabel = document.getElementById('rvDayLabel');
      dayLabel.textContent = '📅 ' + label + ' — click a filter button above to clear';
      dayLabel.style.display = '';
      const tbody = document.getElementById('recentVisitsBody');
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#555;padding:1.5rem;">Loading…</td></tr>';
      fetch('/admin/api/visitors-by-date?date=' + encodeURIComponent(date))
        .then(r => r.json())
        .then(rows => {
          if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#555;padding:1.5rem;">No visits on ' + label + '.</td></tr>';
            return;
          }
          tbody.innerHTML = rows.map(v => `<tr data-date="${v.date}">
            <td><span style="color:#22c55e;font-weight:600;">${v.page || v.path}</span></td>
            <td style="color:#aaa;font-size:0.8rem;">${v.date}</td>
            <td style="color:#aaa;font-size:0.8rem;">${v.time ? new Date(v.time).toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'}) : ''}</td>
            <td style="color:#555;font-size:0.75rem;font-family:monospace;">${v.session_id ? v.session_id.slice(0,12) : '—'}</td>
          </tr>`).join('');
        })
        .catch(() => { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#ef4444;padding:1.5rem;">Failed to load visits.</td></tr>'; });
    }
```

- [ ] **Step 4: Clear the funnel's day label when Recent Visits resets**

In the existing `setVisFilter` function, immediately after the line `document.getElementById('rvDayLabel').style.display = 'none';`, add:

```js
      document.getElementById('vfDayLabel').style.display = 'none';
```

This keeps the two "a specific day is selected" indicators from disagreeing when the user clears via the Recent Visits button row.

- [ ] **Step 5: Verify syntax and balance**

Run: `node -c server.js`
Expected: exit 0.

Run: `grep -o '<%' views/admin.ejs | wc -l` and `grep -o '%>' views/admin.ejs | wc -l`
Expected: equal.

Run: `grep -n "TP_DATA" views/admin.ejs`
Expected: **no matches** — the blob and every reference to it were removed in Step 2.

Run: `grep -c "let tpFilter" views/admin.ejs`
Expected: **0**. Any remaining declaration means Step 2 left the old line 3022 in place; combined with the replacement that would be a duplicate `let` in the same scope, which is a parse-time SyntaxError that kills the entire Visitors tab script block — every button on the tab would silently stop responding, with nothing visible in the rendered HTML to indicate why.

- [ ] **Step 6: Commit**

```bash
git add views/admin.ejs server.js
git commit -F - <<'MSGEOF'
Filter funnel, exit pages, and top pages together

All three session-scoped panels now paint from one window object, so
they cannot end up describing different periods. Selecting a period on
either button row moves both rows; clicking a bar in the 14-day chart
filters all three plus Recent Visits, where previously it refreshed
only Recent Visits and silently left the rest showing a different
window.

Drops TP_DATA and the five per-period page-count accumulators that fed
it — VIS_WINDOWS[period].topPages supersedes them, computed in the same
single pass as everything else.
MSGEOF
```

---

### Task 4: Deploy and verify live

**Files:** none (deploy + verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-3.

- [ ] **Step 1: Push to trigger the Railway deploy**

```bash
git push origin main
```

- [ ] **Step 2: Wait for the deploy**

Run: `until curl -s -o /dev/null -w "%{http_code}" https://playstation-hub.com/ | grep -q 200; do sleep 5; done; echo done`

- [ ] **Step 3: Verify the funnel is nested and no percentage exceeds 100%**

Open `/admin?tab=visitors` (password from project context) and confirm the funnel now reads four stages — Landed, Viewed a game, Started order, Paid — with each count less than or equal to the one above it, and every percentage at or below 100%. The pre-fix screenshot showed "Viewed a game 550%"; that is the specific defect being verified as gone.

Confirm the "Browsed the catalog — N of M sessions (X%)" line renders above the funnel, and that the old "stages aren't a strictly sequential path" caption is gone.

- [ ] **Step 4: Verify period filtering**

Click each of Today / Weekly / Monthly / Yearly / All. Confirm on each click that the funnel counts, the exit-pages list, **and** Most Visited Pages all change together, and that both button rows (the funnel's and Most Visited Pages') highlight the same period.

- [ ] **Step 5: Verify the date-click filter**

Click a bar in the 14-day chart that has a non-zero count. Confirm all four panels — funnel, exit pages, Most Visited Pages, and Recent Visits — now describe that single day, that both period button rows show no active selection, and that a `📅 <date>` label appears next to the funnel's filter row.

Then click any period button and confirm the day selection clears everywhere: the bar's highlight, both day labels, and all four panels return to that period.

- [ ] **Step 6: Verify a zero-session day degrades cleanly**

Click a 14-day chart bar for a date with no tracked sessions (any date before 2026-08-10 qualifies, since session tracking shipped that day). Confirm the funnel shows "No tracked sessions in this period." and the exit-pages panel shows "Nothing to show yet." rather than rendering a broken or empty-looking panel, and that Recent Visits still loads that day's raw rows normally (those pre-date session tracking but were still recorded).

- [ ] **Step 7: Confirm nothing else in the tab broke**

Confirm the four KPI cards at the top, the 14-day bar chart itself, and the Recent Visits table's own Today/Weekly/Monthly/Yearly/All buttons all still work exactly as before. Then open `/admin?tab=orders` and confirm the weekly funnel readout ("N started · N completed · N abandoned · X% of game-page visits") still renders unchanged — this plan must not have touched it.

- [ ] **Step 8: Report results to the user**

Summarize what was verified in Steps 3-7, with a screenshot of the live funnel showing the nested stages and a screenshot of a date-filtered view, and flag anything that didn't match expectations before considering this plan complete.
