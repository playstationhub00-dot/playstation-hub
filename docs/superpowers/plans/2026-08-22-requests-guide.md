# Request-a-Game Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-step guide strip to `/requests`, between the flash messages and the form, explaining what happens after a customer submits a request.

**Architecture:** One markup block inserted into `views/requests.ejs`, one CSS block appended near the existing `.req-*` rules in `public/css/style.css`. No JS, no server-side changes, no new routes.

**Tech Stack:** EJS, plain CSS. No new dependencies.

## Global Constraints

- Exactly three steps, this text, in this order (from the spec — do not paraphrase):
  1. "Ask for it" / "Already listed? Vote instead."
  2. "We check it" / "Appears once approved."
  3. "We message you" / "Use your real Facebook name."
- Step 3's number badge is green (`#22c55e`, matching `.req-btn-rent` / `.req-votes-stocked`). Steps 1 and 2 use `var(--ps-blue)` (matching `.req-hint-dupe` / `.req-votes`).
- One copy of the step text — no separate mobile/desktop markup. Layout changes with CSS only.
- Three equal columns (`repeat(3, minmax(0, 1fr))`) at every width, including mobile — the column count never drops to 1 or 2.
- Container styled like `.req-row`: `background: #111; border: 1px solid #222; border-radius: 10px;` — a full border, not a single-sided accent stripe.
- Placement: after all `<% if (msg === ...) %>` flash-message blocks, before `<form class="req-form" id="reqForm">`.
- No dismiss/collapse control. No changes to `/buy`, `/how-it-works`, the form, the type-ahead script, the vote flow, or the admin panel.
- Measured height of the guide block at a 390px viewport must be under 110px (spec's stated budget).

---

### Task 1: Add the guide markup and CSS, deploy, and verify live

**Files:**
- Modify: `views/requests.ejs` (insert between the flash-message block ending at line 24 and the `<form>` opening at line 26)
- Modify: `public/css/style.css` (append after the `.req-btn-rent` rule at line 2937, before the existing `@media (max-width: 600px)` block that starts at line 2938 — insert the new rules as their own block right after `.req-btn-rent`, and add the mobile override inside the *existing* `@media (max-width: 600px)` block rather than opening a second one)

**Interfaces:**
- Consumes: nothing — this is static markup, no data from the route.
- Produces: nothing consumed elsewhere — this task is self-contained front-end-only.

- [ ] **Step 1: Insert the guide markup in `views/requests.ejs`**

Open `views/requests.ejs`. Find this exact block (currently lines 20–24):

```ejs
  <% if (msg === 'already') { %><div class="ord-flash ord-flash-warn">You've already voted for that one.</div><% } %>
  <% if (msg === 'missing') { %><div class="ord-flash ord-flash-warn">Please fill in both the game title and your Facebook name.</div><% } %>
  <% if (msg === 'rate') { %><div class="ord-flash ord-flash-warn">Too many requests — please wait a few minutes.</div><% } %>
  <% if (msg === 'closed') { %><div class="ord-flash ord-flash-warn">That request is already closed.</div><% } %>
  <% if (msg === 'error') { %><div class="ord-flash ord-flash-warn">Something went wrong. Please try again.</div><% } %>

  <form method="POST" action="/requests/add" class="req-form" id="reqForm">
```

Replace it with (adds the guide block between the last flash line and the form, changes nothing else):

```ejs
  <% if (msg === 'already') { %><div class="ord-flash ord-flash-warn">You've already voted for that one.</div><% } %>
  <% if (msg === 'missing') { %><div class="ord-flash ord-flash-warn">Please fill in both the game title and your Facebook name.</div><% } %>
  <% if (msg === 'rate') { %><div class="ord-flash ord-flash-warn">Too many requests — please wait a few minutes.</div><% } %>
  <% if (msg === 'closed') { %><div class="ord-flash ord-flash-warn">That request is already closed.</div><% } %>
  <% if (msg === 'error') { %><div class="ord-flash ord-flash-warn">Something went wrong. Please try again.</div><% } %>

  <div class="req-guide">
    <div class="req-guide-step">
      <span class="req-guide-num">1</span>
      <div class="req-guide-text">
        <div class="req-guide-title">Ask for it</div>
        <div class="req-guide-sub">Already listed? Vote instead.</div>
      </div>
    </div>
    <div class="req-guide-step">
      <span class="req-guide-num">2</span>
      <div class="req-guide-text">
        <div class="req-guide-title">We check it</div>
        <div class="req-guide-sub">Appears once approved.</div>
      </div>
    </div>
    <div class="req-guide-step">
      <span class="req-guide-num req-guide-num-done">3</span>
      <div class="req-guide-text">
        <div class="req-guide-title">We message you</div>
        <div class="req-guide-sub">Use your real Facebook name.</div>
      </div>
    </div>
  </div>

  <form method="POST" action="/requests/add" class="req-form" id="reqForm">
```

The `req-guide-num-done` class on step 3's badge is the only per-step class difference — it is what makes that one badge green while 1 and 2 stay blue.

- [ ] **Step 2: Verify the EJS compiles**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -e "require('ejs').compile(require('fs').readFileSync('views/requests.ejs','utf8')); console.log('COMPILE_OK')"
```

Expected: `COMPILE_OK`

- [ ] **Step 3: Add the CSS**

Open `public/css/style.css`. Find this exact line (currently line 2937):

```css
.req-btn-rent { background: #22c55e; color: #04120a; }
```

It is immediately followed by:

```css
@media (max-width: 600px) {
  .req-row { flex-wrap: wrap; }
  .req-voteform { width: 100%; }
  .req-voteform input { flex: 1; width: auto; }
}
```

Insert the new block between them — after `.req-btn-rent`, before the `@media` line — and add one new line inside that same existing `@media (max-width: 600px)` block (do not open a second `@media (max-width: 600px)` block):

```css
.req-btn-rent { background: #22c55e; color: #04120a; }
.req-guide { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.7rem; background: #111; border: 1px solid #222; border-radius: 10px; padding: 0.9rem; margin-bottom: 1.25rem; }
.req-guide-step { display: flex; align-items: flex-start; gap: 0.5rem; }
.req-guide-num { width: 19px; height: 19px; min-width: 19px; border-radius: 50%; background: var(--ps-blue); color: #fff; font-size: 0.68rem; font-weight: 800; display: flex; align-items: center; justify-content: center; margin-top: 0.05rem; }
.req-guide-num-done { background: #22c55e; color: #04120a; }
.req-guide-title { font-size: 0.76rem; font-weight: 700; color: #fff; margin-bottom: 0.15rem; }
.req-guide-sub { font-size: 0.68rem; color: #7a7a7a; line-height: 1.45; }
@media (max-width: 600px) {
  .req-row { flex-wrap: wrap; }
  .req-voteform { width: 100%; }
  .req-voteform input { flex: 1; width: auto; }
  .req-guide { gap: 0.4rem; padding: 0.7rem 0.5rem; }
  .req-guide-step { flex-direction: column; align-items: center; text-align: center; gap: 0.3rem; }
  .req-guide-title { font-size: 0.66rem; }
  .req-guide-sub { font-size: 0.6rem; }
}
```

- [ ] **Step 4: Deploy**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
git add views/requests.ejs public/css/style.css
git commit -m "Add three-step guide to the request-a-game page"
git push origin main
```

- [ ] **Step 5: Wait for rollover**

```bash
for i in $(seq 1 15); do
  body=$(curl -s "https://playstation-hub.com/requests")
  if echo "$body" | grep -q "req-guide"; then echo "attempt $i: new build live"; break; fi
  echo "attempt $i: still old"; sleep 15
done
```

A bare `/` 200 can be a stale response mid-rollover — this polls for the new CSS class name specifically, which only exists in the new build.

- [ ] **Step 6: Verify live with the Browser tool**

Navigate to `https://playstation-hub.com/requests`.

1. Confirm the guide renders as three columns with the exact text from the Global Constraints table, in order, between the page subtitle and the form.
2. Confirm step 3's number badge is visibly green and steps 1–2 are blue.
3. Check the browser console — zero errors.
4. Resize to a 390×844 viewport (or equivalent mobile size) and reload. Confirm the guide is still three columns (not wrapped to fewer), and measure `.req-guide`'s height via `document.querySelector('.req-guide').getBoundingClientRect().height` — expected under 110.
5. At the same mobile size, confirm the form (`#reqForm`) is still present without needing to scroll past an oversized guide — i.e., guide height plus header/nav is reasonable, not a regression from before this change.
6. Submit a test request (any obviously-test title) and confirm the resulting flash message (`Thanks — we'll review it and add it to the list.`) renders above the guide, not below it. Delete the test entry afterward from `/admin` (Games tab → Game Requests → delete), the same cleanup procedure used when this page was first verified.

- [ ] **Step 7: Report to the user**

Confirm the guide is live with a screenshot or description of the desktop and mobile rendering, and confirm no regressions to the existing flash/form/list behavior.
