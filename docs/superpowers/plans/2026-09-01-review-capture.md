# Review Capture and Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a renter leave a review from their own order page, hold it for owner approval, then show the approved pool on every game page next to the price.

**Architecture:** All review rules — who may be prompted, how a rating is clamped, which badge a card shows, how the pool is sorted for a given game — live in one new pure module, `lib/reviews.js`, testable with plain asserts. Two new fields (`source`, `order_ref`) extend the existing review shape without a migration: a review missing `source` is treated as `'facebook'`, which is exactly how every existing row should display. Reviews stay in lowdb alongside the catalogue, so nothing here touches MongoDB.

**Tech Stack:** Node + Express 4, EJS templates, lowdb for reviews and catalogue, plain CSS in one stylesheet. No test framework — tests are plain `assert` scripts run with `node`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-01-review-capture-design.md` (commit `97be5dc`). It governs; this plan implements it.
- Work directly on `main`. No worktree, no feature branch. Commit after each task.
- Reviews are a **single pool**, never per-game. No page ever renders an empty review block.
- `REVIEWABLE_STATES` is exactly `['active', 'awaiting_return', 'verifying_return', 'closed']`. `awaiting_qr`, `qr_pending` and `reserved` are deliberately excluded.
- Customer submissions are always written `visible: false` and `source: 'site'`. Nothing reaches the site without owner approval.
- A review with no `source` field displays as `'facebook'`. No backfill.
- One review per `order_ref`.
- Rating clamps to 1–5. Text is trimmed, whitespace-collapsed, and capped at **300** characters.
- The aggregate (`4.9 · 12 renters`) counts **every visible review**, not only ones matching the current game.
- No new npm dependencies.
- CSS goes in `public/css/style.css`. Use the `rvp-` prefix for the prompt and `gdr-` for the game-page block, matching the existing `gd-` / `ord-` / `ql-` convention.
- This project has no test framework by design. Tests are plain `assert` scripts under `scripts/`, run with `node scripts/<name>.js`, exiting non-zero on the first failure.
- Copy uses the peso sign `₱` and sentence case, matching the existing pages.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/reviews.js` **(create)** | Every review rule as pure functions over plain objects. No DB, no Express. |
| `scripts/test-reviews.js` **(create)** | Plain-assert tests for `lib/reviews.js`. |
| `views/partials/review-prompt.ejs` **(create)** | The star picker + textarea shown on the customer's order page. |
| `views/partials/review-block.ejs` **(create)** | The pooled review list shown under the order card on game pages. |
| `server.js` **(modify)** | New `POST /order/:ref/review`; `reviews` locals added to the `/game/:slug` and `/order/:ref` renders; `source` handling in `/admin/reviews/add`. |
| `views/order-status.ejs` **(modify)** | Renders the prompt partial; two new flash messages. |
| `views/game-detail.ejs` **(modify)** | Renders the review block under the order card. |
| `views/index.ejs` **(modify)** | Per-card badge driven by `source`; heading copy change. |
| `views/partials/admin/content.ejs` **(modify)** | Pending-approval block, source selector, and honesty copy changes. |
| `public/css/style.css` **(modify)** | `rvp-` and `gdr-` styles. |

---

## Task 1: Review rules module

**Files:**
- Create: `lib/reviews.js`
- Create: `scripts/test-reviews.js`

**Interfaces:**
- Consumes: nothing — this is the base layer.
- Produces, all exported from `lib/reviews.js`:
  - `REVIEWABLE_STATES` — frozen `['active', 'awaiting_return', 'verifying_return', 'closed']`
  - `MAX_TEXT` — the number `300`
  - `badgeFor(review)` → `'facebook' | 'verified'`
  - `hasReviewed(reviews, ref)` → `boolean`
  - `canPrompt(order, reviews)` → `boolean`
  - `normalize(input)` → `{ rating, text }`
  - `sortForGame(reviews, gameTitle)` → new ordered array
  - `aggregate(reviews)` → `{ count, average }`

- [ ] **Step 1: Write the failing tests**

Create `scripts/test-reviews.js`:

```js
// Plain assert-based tests for the review rules. No test framework in this
// project by design — run with `node scripts/test-reviews.js`, which exits
// non-zero on the first failed assertion.
const assert = require('assert');
const reviews = require('../lib/reviews');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

function rev(over) {
  return Object.assign({
    id: 1, name: 'Ram Avila', rating: 5, text: 'Legit seller.',
    game_rented: 'Ghost of Yotei', order: 99, visible: true,
    created_at: '2026-08-20T00:00:00.000Z', source: 'site', order_ref: 'PH-0039'
  }, over);
}

function order(over) {
  return Object.assign({
    ref: 'PH-0039', state: 'active', fb_name: 'Ram Avila',
    game_title: 'Ghost of Yotei', url_key: 'abc123'
  }, over);
}

check('a review with no source field displays as Facebook', () => {
  // Every review that exists today predates the source field. They were all
  // entered from the admin "Add Review from Facebook" form, so Facebook is the
  // correct default and no backfill is needed.
  const legacy = rev({});
  delete legacy.source;
  assert.strictEqual(reviews.badgeFor(legacy), 'facebook');
  assert.strictEqual(reviews.badgeFor({}), 'facebook');
});

check('a site submission gets the verified-renter badge', () => {
  assert.strictEqual(reviews.badgeFor(rev({ source: 'site' })), 'verified');
  assert.strictEqual(reviews.badgeFor(rev({ source: 'facebook' })), 'facebook');
});

check('hasReviewed matches on order ref', () => {
  const list = [rev({ order_ref: 'PH-0039' })];
  assert.strictEqual(reviews.hasReviewed(list, 'PH-0039'), true);
  assert.strictEqual(reviews.hasReviewed(list, 'PH-0040'), false);
  assert.strictEqual(reviews.hasReviewed([], 'PH-0039'), false);
  assert.strictEqual(reviews.hasReviewed(list, null), false);
});

check('the prompt shows only once the customer has the game', () => {
  assert.strictEqual(reviews.canPrompt(order({ state: 'active' }), []), true);
  assert.strictEqual(reviews.canPrompt(order({ state: 'awaiting_return' }), []), true);
  assert.strictEqual(reviews.canPrompt(order({ state: 'verifying_return' }), []), true);
  assert.strictEqual(reviews.canPrompt(order({ state: 'closed' }), []), true);
});

check('paid-but-not-signed-in and reserved orders are not prompted', () => {
  // These customers have paid but never received a game, so there is nothing
  // honest for them to review yet.
  assert.strictEqual(reviews.canPrompt(order({ state: 'awaiting_qr' }), []), false);
  assert.strictEqual(reviews.canPrompt(order({ state: 'qr_pending' }), []), false);
  assert.strictEqual(reviews.canPrompt(order({ state: 'reserved' }), []), false);
  assert.strictEqual(reviews.canPrompt(order({ state: 'awaiting_payment' }), []), false);
  assert.strictEqual(reviews.canPrompt(order({ state: 'waitlisted' }), []), false);
  assert.strictEqual(reviews.canPrompt(null, []), false);
});

check('the prompt disappears once that order has been reviewed', () => {
  const list = [rev({ order_ref: 'PH-0039' })];
  assert.strictEqual(reviews.canPrompt(order({ ref: 'PH-0039' }), list), false);
  assert.strictEqual(reviews.canPrompt(order({ ref: 'PH-0041' }), list), true);
});

check('normalize clamps a rating into 1-5', () => {
  assert.strictEqual(reviews.normalize({ rating: '9', text: 'x' }).rating, 5);
  assert.strictEqual(reviews.normalize({ rating: '0', text: 'x' }).rating, 1);
  assert.strictEqual(reviews.normalize({ rating: '-4', text: 'x' }).rating, 1);
  assert.strictEqual(reviews.normalize({ rating: '3', text: 'x' }).rating, 3);
  assert.strictEqual(reviews.normalize({ rating: 'abc', text: 'x' }).rating, 5);
  assert.strictEqual(reviews.normalize({}).rating, 5);
});

check('normalize trims, collapses whitespace and caps length', () => {
  assert.strictEqual(reviews.normalize({ text: '  hello   there  ' }).text, 'hello there');
  assert.strictEqual(reviews.normalize({ text: '' }).text, '');
  assert.strictEqual(reviews.normalize({ text: '   ' }).text, '');
  assert.strictEqual(reviews.normalize({}).text, '');
  const long = 'a'.repeat(400);
  assert.strictEqual(reviews.normalize({ text: long }).text.length, reviews.MAX_TEXT);
});

check('sortForGame floats reviews for this game to the top', () => {
  const list = [
    rev({ id: 1, game_rented: 'Tekken 8', order: 1 }),
    rev({ id: 2, game_rented: 'Ghost of Yotei', order: 50 }),
    rev({ id: 3, game_rented: 'UFC 6', order: 2 })
  ];
  const out = reviews.sortForGame(list, 'Ghost of Yotei');
  assert.strictEqual(out[0].id, 2);
  // The rest keep their normal ordering behind it.
  assert.deepStrictEqual(out.slice(1).map(r => r.id), [1, 3]);
});

check('sortForGame matches case-insensitively and ignores surrounding space', () => {
  const list = [rev({ id: 1, game_rented: 'Tekken 8', order: 1 }),
                rev({ id: 2, game_rented: '  ghost of YOTEI ', order: 50 })];
  assert.strictEqual(reviews.sortForGame(list, 'Ghost of Yotei')[0].id, 2);
});

check('sortForGame does not mutate the array it was given', () => {
  const list = [rev({ id: 1, order: 9 }), rev({ id: 2, order: 1 })];
  const before = list.map(r => r.id);
  reviews.sortForGame(list, 'Tekken 8');
  assert.deepStrictEqual(list.map(r => r.id), before);
});

check('with no game match it falls back to order then newest', () => {
  const list = [
    rev({ id: 1, game_rented: 'A', order: 5, created_at: '2026-08-01T00:00:00.000Z' }),
    rev({ id: 2, game_rented: 'B', order: 1, created_at: '2026-08-02T00:00:00.000Z' }),
    rev({ id: 3, game_rented: 'C', order: 5, created_at: '2026-08-10T00:00:00.000Z' })
  ];
  assert.deepStrictEqual(reviews.sortForGame(list, 'Nothing').map(r => r.id), [2, 3, 1]);
});

check('aggregate averages to one decimal across the whole pool', () => {
  const list = [rev({ rating: 5 }), rev({ rating: 5 }), rev({ rating: 4 })];
  assert.deepStrictEqual(reviews.aggregate(list), { count: 3, average: 4.7 });
});

check('aggregate on an empty pool is zeroed, not NaN', () => {
  assert.deepStrictEqual(reviews.aggregate([]), { count: 0, average: 0 });
  assert.deepStrictEqual(reviews.aggregate(null), { count: 0, average: 0 });
});

console.log('\n' + passed + ' assertions passed');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/test-reviews.js`
Expected: FAIL — `Cannot find module '../lib/reviews'`.

- [ ] **Step 3: Write `lib/reviews.js`**

```js
// Review rules for capture and display. Pure functions over plain review and
// order objects — no database access and no Express — so the order page, the
// game page and the admin card all read one implementation.
//
// See docs/superpowers/specs/2026-09-01-review-capture-design.md.

// The customer has actually received a game in these states, so there is
// something honest to review. Deliberately excludes 'awaiting_qr' and
// 'qr_pending' (paid, but not signed in yet) and 'reserved' (nothing played).
const REVIEWABLE_STATES = Object.freeze([
  'active', 'awaiting_return', 'verifying_return', 'closed'
]);

// One sentence is the ask. A cap keeps a card from swallowing the page and
// bounds what an abusive submission can push into the moderation queue.
const MAX_TEXT = 300;

// Every review that existed before this feature was typed into the admin
// "Add Review from Facebook" form, so a missing source is Facebook. That
// default is what makes this change a no-op migration.
function badgeFor(review) {
  return review && review.source === 'site' ? 'verified' : 'facebook';
}

function hasReviewed(reviews, ref) {
  if (!ref) return false;
  return (reviews || []).some(r => r && r.order_ref === ref);
}

function canPrompt(order, reviews) {
  if (!order) return false;
  if (!REVIEWABLE_STATES.includes(order.state)) return false;
  return !hasReviewed(reviews, order.ref);
}

// Customer-supplied rating and text, made safe to store. The rating falls back
// to 5 rather than rejecting, because a missing radio should not lose someone's
// written review.
function normalize(input) {
  const raw = input || {};
  let rating = parseInt(raw.rating, 10);
  if (isNaN(rating)) rating = 5;
  rating = Math.min(5, Math.max(1, rating));
  let text = String(raw.text == null ? '' : raw.text).trim().replace(/\s+/g, ' ');
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT).trim();
  return { rating, text };
}

function titleKey(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

// Reviews are one shared pool shown on every game page, so the only per-game
// behaviour is which ones surface first. Returns a new array — callers render
// this straight into a template and must not have their source list reordered.
function sortForGame(reviews, gameTitle) {
  const want = titleKey(gameTitle);
  return (reviews || []).slice().sort((a, b) => {
    const am = want && titleKey(a.game_rented) === want ? 0 : 1;
    const bm = want && titleKey(b.game_rented) === want ? 0 : 1;
    if (am !== bm) return am - bm;
    const ao = a.order == null ? 999 : a.order;
    const bo = b.order == null ? 999 : b.order;
    if (ao !== bo) return ao - bo;
    return (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0);
  });
}

// Describes the business, not the game — so this counts the whole visible pool
// and shows the same figure on every game page.
function aggregate(reviews) {
  const list = reviews || [];
  if (!list.length) return { count: 0, average: 0 };
  const sum = list.reduce((n, r) => n + (Number(r && r.rating) || 0), 0);
  return { count: list.length, average: Math.round((sum / list.length) * 10) / 10 };
}

module.exports = {
  REVIEWABLE_STATES, MAX_TEXT,
  badgeFor, hasReviewed, canPrompt, normalize, sortForGame, aggregate
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/test-reviews.js`
Expected: prints `14 assertions passed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add lib/reviews.js scripts/test-reviews.js
git commit -m "Add review rules module"
```

---

## Task 2: Submission route

**Files:**
- Modify: `server.js` — require the module beside `const queueRules = require('./lib/queue');`; add the route directly after the `POST /order/:ref/upgrade-priority` handler
- Modify: `server.js` — the `/order/:ref` handler's `res.render('order-status', { ... })` call

**Interfaces:**
- Consumes: `reviewRules.canPrompt(order, reviews)`, `reviewRules.normalize(input)` (Task 1); `orders.getByRef`, `rateLimited`, `clientIp` (existing in `server.js`).
- Produces: `POST /order/:ref/review`; and the `canReview` boolean local on `order-status.ejs`, which Task 3 renders against.

- [ ] **Step 1: Require the module**

In `server.js`, directly beneath `const queueRules = require('./lib/queue');`, add:

```js
const reviewRules = require('./lib/reviews');
```

- [ ] **Step 2: Add the submission route**

In `server.js`, directly after the `app.post('/order/:ref/upgrade-priority', ...)` handler ends, insert:

```js
// A review written by the customer from their own order page. Always lands
// unapproved: the site's review section is its trust surface, so nothing
// reaches it without the owner looking first. Name and game come from the
// order rather than the form — the customer supplies only a rating and a
// sentence, so a review can never claim a rental that did not happen.
app.post('/order/:ref/review', async (req, res) => {
  if (rateLimited('order_create', clientIp(req), 10, 10 * 60 * 1000)) {
    return res.redirect('/browse?order_error=rate');
  }
  const order = await orders.getByRef(req.params.ref);
  if (!order || !order.url_key || req.body.k !== order.url_key) return res.redirect('/browse');
  const back = '/order/' + order.ref + '?k=' + order.url_key;
  const existing = db.get('reviews').value() || [];
  // Covers both "this order can't be reviewed yet" and "already reviewed".
  if (!reviewRules.canPrompt(order, existing)) return res.redirect(back + '&msg=stale');
  const { rating, text } = reviewRules.normalize(req.body);
  if (!text) return res.redirect(back + '&msg=review_empty');
  const id = db.get('nextReviewId').value();
  db.get('reviews').push({
    id,
    name: order.fb_name || 'Guest',
    rating,
    text,
    game_rented: order.game_title || '',
    // Same default the admin form uses — the owner reorders from admin if a
    // review is worth featuring.
    order: 99,
    visible: false,
    created_at: new Date().toISOString(),
    source: 'site',
    order_ref: order.ref
  }).write();
  db.set('nextReviewId', id + 1).write();
  res.redirect(back + '&msg=review_thanks');
});
```

- [ ] **Step 3: Pass `canReview` to the order page**

In `server.js`, inside the `/order/:ref` handler, immediately after the `queueExpired` try/catch block and before `res.render('order-status', {`, insert:

```js
  const canReview = reviewRules.canPrompt(order, db.get('reviews').value() || []);
```

Then add it to the `res.render('order-status', { ... })` locals, beside `queueRules`:

```js
    canReview,
```

- [ ] **Step 4: Verify the server parses and modules load**

Run:
```bash
node -c server.js && node -e "require('./lib/reviews'); console.log('modules load')"
```
Expected: prints `modules load`, exit code 0.

- [ ] **Step 5: Confirm the existing suites are still green**

Run: `node scripts/test-reviews.js && node scripts/test-queue.js && node scripts/test-orders.js`
Expected: all three print `N assertions passed`.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "Add the customer review submission route"
```

---

## Task 3: The prompt on the customer's order page

**Files:**
- Create: `views/partials/review-prompt.ejs`
- Modify: `views/order-status.ejs` — two flash lines beside the existing `msg` block (around line 67), and the partial include after the upgrade card
- Modify: `public/css/style.css` (append at end of file)

**Interfaces:**
- Consumes: the `canReview` local and `order` (Task 2).
- Produces: nothing later depends on this task.

- [ ] **Step 1: Create the partial**

Create `views/partials/review-prompt.ejs`:

```html
<!-- Asked on the customer's own order page once they actually have the game.
     The star picker is five radios in reverse DOM order with a row-reverse
     flex parent: they display 1-5 left to right, and `input:checked ~ label`
     then paints every star from the chosen one leftwards. No JavaScript, so it
     still works in the Facebook in-app browser. -->
<div class="rvp">
  <div class="rvp-title">How's it going so far?</div>
  <div class="rvp-sub">One line helps the next person trust us. Takes 10 seconds.</div>
  <form method="POST" action="/order/<%= order.ref %>/review">
    <input type="hidden" name="k" value="<%= order.url_key %>">
    <div class="rvp-stars">
      <% [5, 4, 3, 2, 1].forEach(n => { %>
      <input type="radio" name="rating" id="rvpStar<%= n %>" value="<%= n %>"<%= n === 5 ? ' checked' : '' %>>
      <label for="rvpStar<%= n %>" aria-label="<%= n %> star<%= n > 1 ? 's' : '' %>">★</label>
      <% }) %>
    </div>
    <textarea name="text" class="rvp-text" rows="2" maxlength="300" required
              placeholder="e.g. Fast sign-in, super accommodating."></textarea>
    <div class="rvp-who"><%= order.fb_name %> · <%= order.game_title %></div>
    <button type="submit" class="rvp-btn">Send review</button>
    <div class="rvp-fine">We check every review before it goes live.</div>
  </form>
</div>
```

- [ ] **Step 2: Add the flash messages**

In `views/order-status.ejs`, directly after the existing `upgrade_started` flash line, insert:

```html
  <% if (msg === 'review_thanks') { %><div class="ord-flash">Thanks — we'll put this up once we've checked it.</div><% } %>
  <% if (msg === 'review_empty') { %><div class="ord-flash ord-flash-warn">Add a sentence before sending, so it's useful to the next renter.</div><% } %>
```

- [ ] **Step 3: Render the prompt**

In `views/order-status.ejs`, directly after the `<% } %>` that closes the `ord-upgrade` block (the Fall in Line to Priority card) and before the `<% if (order.state === 'awaiting_payment' || order.state === 'payment_rejected') { %>` line, insert:

```html
  <% if (canReview) { %>
  <%- include('partials/review-prompt', { order: order }) %>
  <% } %>
```

- [ ] **Step 4: Add the styles**

Append to the end of `public/css/style.css`:

```css
/* Review prompt on the customer's own order page. Purple to match the other
   customer-action cards (priority upgrade, no-slot options) rather than the
   gold used for buying. */
.rvp { background: #141018; border: 1px solid #3b2a5c; border-radius: 12px; padding: 0.9rem 0.95rem; margin-bottom: 1.5rem; }
.rvp-title { font-size: 0.95rem; font-weight: 800; color: #fff; }
.rvp-sub { font-size: 0.78rem; color: #9b8bbd; margin-top: 0.2rem; line-height: 1.5; }
.rvp-stars { display: flex; flex-direction: row-reverse; justify-content: flex-end; gap: 0.15rem; margin: 0.75rem 0 0.6rem; }
.rvp-stars input { position: absolute; opacity: 0; width: 0; height: 0; }
.rvp-stars label { font-size: 1.5rem; line-height: 1; color: #3a3a44; cursor: pointer; transition: color 0.12s; }
.rvp-stars input:checked ~ label { color: #f0a500; }
.rvp-stars label:hover, .rvp-stars label:hover ~ label { color: #ffc63d; }
.rvp-stars input:focus-visible + label { outline: 2px solid var(--ps-blue); outline-offset: 2px; border-radius: 3px; }
.rvp-text { width: 100%; background: #0b0b0d; border: 1px solid #2a2a32; border-radius: 8px; padding: 0.55rem 0.65rem; color: #eee; font-family: inherit; font-size: 0.85rem; resize: vertical; }
.rvp-text:focus { outline: none; border-color: #6d28d9; }
.rvp-who { font-size: 0.75rem; color: #64748b; margin: 0.45rem 0 0.6rem; }
.rvp-btn { display: block; width: 100%; background: #6d28d9; color: #fff; font-weight: 800; font-size: 0.88rem; padding: 0.7rem; border: none; border-radius: 50px; cursor: pointer; font-family: inherit; }
.rvp-btn:hover { background: #7c3aed; }
.rvp-fine { font-size: 0.72rem; color: #64748b; text-align: center; margin-top: 0.5rem; }
```

- [ ] **Step 5: Verify both templates compile**

Run:
```bash
node -e "const ejs=require('ejs'),fs=require('fs');['views/partials/review-prompt.ejs','views/order-status.ejs'].forEach(f=>ejs.compile(fs.readFileSync(f,'utf8'),{filename:f}));console.log('compiles OK')"
```
Expected: prints `compiles OK`.

- [ ] **Step 6: Verify the star picker renders in the right visual order**

Run:
```bash
node -e "
const ejs=require('ejs'),fs=require('fs');
const out=ejs.render(fs.readFileSync('views/partials/review-prompt.ejs','utf8'),
 {order:{ref:'PH-0039',url_key:'k',fb_name:'Ram Avila',game_title:'Ghost of Yotei'}},
 {filename:'views/partials/review-prompt.ejs'});
const order=[...out.matchAll(/value=\"(\d)\"/g)].map(m=>m[1]);
if(order.join('')!=='54321') throw new Error('star DOM order wrong: '+order.join(''));
if(!/value=\"5\" checked/.test(out)) throw new Error('5 stars not preselected');
console.log('star picker OK — DOM 5..1, 5 preselected');
"
```
Expected: prints `star picker OK — DOM 5..1, 5 preselected`. The reverse DOM order is what makes the CSS sibling selector paint the correct stars; if a later edit reorders it, this catches it.

- [ ] **Step 7: Commit**

```bash
git add views/partials/review-prompt.ejs views/order-status.ejs public/css/style.css
git commit -m "Ask for a review on the order page once the game is in hand"
```

---

## Task 4: The pooled review block on game pages

**Files:**
- Create: `views/partials/review-block.ejs`
- Modify: `server.js` — the `/game/:slug` handler's `res.render('game-detail', { ... })` call
- Modify: `views/game-detail.ejs` — insert directly after `</div><!-- /gdh-card -->`
- Modify: `public/css/style.css` (append at end of file)

**Interfaces:**
- Consumes: `reviewRules.sortForGame(reviews, gameTitle)`, `reviewRules.aggregate(reviews)`, `reviewRules.badgeFor(review)` (Task 1).
- Produces: nothing later depends on this task.

- [ ] **Step 1: Create the partial**

Create `views/partials/review-block.ejs`:

```html
<%#
  One shared pool of reviews, shown on every game page under the order card.
  Deliberately not per-game: with ~37 customers across 53 games most pages
  would show zero, and an empty review block is worse than none — it reads as
  "nobody has rented this". sortForGame floats any review that names THIS
  game to the top, so the pool still feels relevant where it can be.

  This is an EJS comment, not an HTML one, on purpose: an HTML comment would
  sit outside the guard below and still be emitted for a game with no reviews,
  so "renders literally nothing when the pool is empty" would stop being
  exactly true. Do not put EJS delimiters inside this block — the parser reads
  the first close tag it finds, wherever it appears.
%>
<% if (reviews && reviews.length) { %>
<div class="gdr">
  <div class="gdr-head">
    <span class="gdr-stars">★★★★★</span>
    <span class="gdr-avg"><%= reviewStats.average %></span>
    <span class="gdr-count">· <%= reviewStats.count %> renter<%= reviewStats.count === 1 ? '' : 's' %></span>
  </div>
  <% reviews.slice(0, 3).forEach(r => { const badge = reviewBadge(r); %>
  <div class="gdr-card">
    <div class="gdr-card-stars"><%= '★'.repeat(r.rating) %></div>
    <p class="gdr-text">"<%= r.text %>"</p>
    <div class="gdr-foot">
      <div class="gdr-avatar"><%= (r.name || '?').charAt(0).toUpperCase() %></div>
      <div class="gdr-who">
        <div class="gdr-name"><%= r.name %></div>
        <% if (r.game_rented) { %><div class="gdr-game"><%= r.game_rented %></div><% } %>
      </div>
      <% if (badge === 'facebook') { %>
      <span class="gdr-badge gdr-badge-fb">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="#60a5fa" aria-hidden="true"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
        Facebook
      </span>
      <% } else { %>
      <span class="gdr-badge gdr-badge-verified">Verified renter</span>
      <% } %>
    </div>
  </div>
  <% }) %>
  <% if (reviewStats.count > 3) { %>
  <a href="/#reviewsSection" class="gdr-more">See all <%= reviewStats.count %> reviews</a>
  <% } %>
</div>
<% } %>
```

- [ ] **Step 2: Load reviews in the game route**

In `server.js`, inside the `/game/:slug` handler, directly after the `queues` try/catch block and before `res.render('game-detail', {`, insert:

```js
  // One shared pool, sorted so any review naming this game surfaces first. The
  // aggregate counts the whole pool on purpose — it describes the business, so
  // the same figure is true on every game page.
  const gdReviews = db.get('reviews').filter({ visible: true }).value() || [];
```

Then add these three locals to the `res.render('game-detail', { ... })` object:

```js
    reviews: reviewRules.sortForGame(gdReviews, game.title),
    reviewStats: reviewRules.aggregate(gdReviews),
    reviewBadge: reviewRules.badgeFor,
```

- [ ] **Step 3: Render the block under the order card**

In `views/game-detail.ejs`, directly after the line `</div><!-- /gdh-card -->` and before the `</div>` that follows it, insert:

```html
      <%- include('partials/review-block', { reviews: reviews, reviewStats: reviewStats, reviewBadge: reviewBadge }) %>
```

- [ ] **Step 4: Add the styles**

Append to the end of `public/css/style.css`:

```css
/* Pooled reviews under the order card on a game page — the point of hesitation.
   Compact by design: three cards, then a link to the full homepage section. */
.gdr { margin-top: 1rem; }
.gdr-head { display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.6rem; }
.gdr-stars { font-size: 0.8rem; color: #f0a500; letter-spacing: 1px; }
.gdr-avg { font-size: 0.85rem; font-weight: 800; color: #fff; }
.gdr-count { font-size: 0.78rem; color: #64748b; }
.gdr-card { background: #111116; border: 1px solid #23232b; border-radius: 12px; padding: 0.7rem 0.75rem; margin-bottom: 0.5rem; }
.gdr-card-stars { font-size: 0.78rem; color: #f0a500; letter-spacing: 1.5px; }
.gdr-text { font-size: 0.82rem; color: #ccc; font-style: italic; line-height: 1.6; margin: 0.35rem 0 0.55rem; }
.gdr-foot { display: flex; align-items: center; gap: 0.5rem; }
.gdr-avatar { width: 26px; height: 26px; border-radius: 50%; background: #3b2a5c; color: #c4b5fd; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0; }
.gdr-who { flex: 1; min-width: 0; }
.gdr-name { font-size: 0.8rem; font-weight: 700; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gdr-game { font-size: 0.72rem; color: #777; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gdr-badge { font-size: 0.68rem; border-radius: 20px; padding: 0.15rem 0.5rem; white-space: nowrap; flex-shrink: 0; display: flex; align-items: center; gap: 0.2rem; }
.gdr-badge-fb { color: #60a5fa; background: rgba(24,119,242,0.1); border: 1px solid rgba(24,119,242,0.25); }
.gdr-badge-verified { color: #4ade80; background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.25); }
.gdr-more { display: block; text-align: center; font-size: 0.78rem; color: #60a5fa; text-decoration: none; margin-top: 0.6rem; }
.gdr-more:hover { text-decoration: underline; }
```

- [ ] **Step 5: Verify the template compiles**

Run:
```bash
node -e "const ejs=require('ejs'),fs=require('fs');['views/partials/review-block.ejs','views/game-detail.ejs'].forEach(f=>ejs.compile(fs.readFileSync(f,'utf8'),{filename:f}));console.log('compiles OK')"
```
Expected: prints `compiles OK`.

- [ ] **Step 6: Verify both badges render and hostile text is escaped**

Run:
```bash
node -e "
const ejs=require('ejs'),fs=require('fs');
const R=require('./lib/reviews');
const pool=[
 {id:1,name:'Ram Avila',rating:5,text:'Legit <script>alert(1)</script>',game_rented:'Ghost of Yotei',order:1,created_at:'2026-08-20T00:00:00Z',source:'site',order_ref:'PH-1'},
 {id:2,name:'Jenny R.',rating:5,text:'Ang bilis mag-reply.',game_rented:'Tekken 8',order:2,created_at:'2026-08-21T00:00:00Z'}
];
const out=ejs.render(fs.readFileSync('views/partials/review-block.ejs','utf8'),
 {reviews:R.sortForGame(pool,'Ghost of Yotei'),reviewStats:R.aggregate(pool),reviewBadge:R.badgeFor},
 {filename:'views/partials/review-block.ejs'});
if(out.includes('<script>alert')) throw new Error('review text was not escaped');
if(!out.includes('Verified renter')) throw new Error('missing verified badge');
if(!out.includes('Facebook')) throw new Error('missing facebook badge');
console.log('both badges render, text escaped');
"
```
Expected: prints `both badges render, text escaped`.

- [ ] **Step 7: Verify the empty pool renders nothing**

Run:
```bash
node -e "
const ejs=require('ejs'),fs=require('fs');
const out=ejs.render(fs.readFileSync('views/partials/review-block.ejs','utf8'),
 {reviews:[],reviewStats:{count:0,average:0},reviewBadge:()=>'facebook'},
 {filename:'views/partials/review-block.ejs'});
if(out.trim().length) throw new Error('empty pool rendered markup: '+out.trim().slice(0,80));
console.log('empty pool renders nothing');
"
```
Expected: prints `empty pool renders nothing`. This is the guarantee that no game page ever shows an empty review block.

- [ ] **Step 8: Commit**

```bash
git add views/partials/review-block.ejs server.js views/game-detail.ejs public/css/style.css
git commit -m "Show pooled reviews under the order card on game pages"
```

---

## Task 5: Admin approval queue and the honesty copy changes

**Files:**
- Modify: `server.js` — `POST /admin/reviews/add` (around line 5312)
- Modify: `views/partials/admin/content.ejs:292-306` (accordion header, add-form heading, source selector) and `:307` (pending block above the list)
- Modify: `views/index.ejs:530` (heading) and `:541-544` (per-card badge)

**Interfaces:**
- Consumes: `reviewRules.badgeFor(review)` (Task 1).
- Produces: nothing later depends on this task.

- [ ] **Step 1: Accept a source on the admin add form**

In `server.js`, replace the body of `app.post('/admin/reviews/add', ...)`:

```js
app.post('/admin/reviews/add', requireAuth, (req, res) => {
  const { name, rating, text, game_rented, order, source } = req.body;
  const id = db.get('nextReviewId').value();
  db.get('reviews').push({
    id, name, rating: parseInt(rating) || 5, text,
    game_rented: game_rented || '', order: parseInt(order) || 99,
    visible: true, created_at: new Date().toISOString(),
    // Defaults to facebook: copying a real Facebook comment is what this form
    // is for, and it matches how every pre-existing review should display.
    source: source === 'site' ? 'site' : 'facebook',
    order_ref: null
  }).write();
  db.set('nextReviewId', id + 1).write();
  res.redirect('/admin#reviews');
});
```

- [ ] **Step 2: Update the admin accordion copy and add the source selector**

In `views/partials/admin/content.ejs`, change the accordion description from
`Reviews shown on homepage — sourced from your Facebook page`
to
`Shown on your homepage and game pages`.

Change the add-form heading from `➕ Add Review from Facebook` to `➕ Add a review`.

In the add form's grid, directly after the `Order` form-group, add:

```html
            <div class="form-group" style="margin:0;"><label>Source</label><select name="source"><option value="facebook">Facebook</option><option value="site">Website</option></select></div>
```

- [ ] **Step 3: Add the pending-approval block**

In `views/partials/admin/content.ejs`, directly after the closing `</form>` of the add form and before the `<% if (reviews && reviews.length > 0) { %>` line, insert:

```html
        <% const pendingReviews = (reviews || []).filter(r => !r.visible); %>
        <% if (pendingReviews.length) { %>
        <div style="margin-top:1.5rem;border:1px solid #4a3a00;background:#1a1204;border-radius:10px;padding:1rem;">
          <div style="font-weight:700;color:#f59e0b;margin-bottom:0.75rem;">⏳ Waiting for your approval (<%= pendingReviews.length %>)</div>
          <% pendingReviews.forEach(pr => { %>
          <div style="background:#111;border:1px solid #2a2a2a;border-radius:10px;padding:0.85rem;margin-bottom:0.5rem;">
            <div style="color:#f59e0b;font-size:0.85rem;"><%= '⭐'.repeat(pr.rating) %></div>
            <div style="color:#ccc;font-size:0.88rem;line-height:1.5;margin:0.35rem 0 0.5rem;">"<%= pr.text %>"</div>
            <div style="font-size:0.75rem;color:#777;margin-bottom:0.6rem;">
              <%= pr.name %><% if (pr.game_rented) { %> · <%= pr.game_rented %><% } %><% if (pr.order_ref) { %> · <%= pr.order_ref %><% } %>
            </div>
            <div style="display:flex;gap:0.5rem;">
              <form method="POST" action="/admin/reviews/toggle/<%= pr.id %>"><button type="submit" style="background:#14532d;color:#4ade80;border:1px solid #22c55e;border-radius:6px;padding:0.35rem 0.9rem;font-size:0.78rem;cursor:pointer;">✓ Approve</button></form>
              <form method="POST" action="/admin/reviews/delete/<%= pr.id %>" onsubmit="return confirm('Delete this review?')"><button type="submit" style="background:#2a0000;color:#ef4444;border:1px solid #4a0000;border-radius:6px;padding:0.35rem 0.9rem;font-size:0.78rem;cursor:pointer;">🗑 Delete</button></form>
            </div>
          </div>
          <% }) %>
        </div>
        <% } %>
```

Approve reuses the existing `POST /admin/reviews/toggle/:id` route, which flips `visible`. No new route is needed.

- [ ] **Step 4: Fix the homepage heading and per-card badge**

In `views/index.ejs`, change the heading text `What Our Customers Say` to stay as-is, and replace the sub-label `Real reviews from Facebook` with `From renters who paid`.

Then replace the fixed Facebook badge block (the `<div class="review-fb-badge">` element and its SVG) with a source-driven one:

```html
        <% if (reviewBadge(r) === 'facebook') { %>
        <div class="review-fb-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
          Facebook
        </div>
        <% } else { %>
        <div class="review-verified-badge">Verified renter</div>
        <% } %>
```

- [ ] **Step 5: Pass the badge helper to the homepage**

In `server.js`, add `reviewBadge: reviewRules.badgeFor,` to the `res.render('index', { ... })` locals, beside the existing `reviews` local.

- [ ] **Step 6: Add the verified badge style**

Append to `public/css/style.css`:

```css
/* Homepage counterpart of .gdr-badge-verified — a review submitted on the site
   by someone with a real paid order behind it. */
.review-verified-badge { margin-left: auto; display: flex; align-items: center; gap: 0.3rem; font-size: 0.75rem; color: #4ade80; font-weight: 600; background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.25); border-radius: 20px; padding: 0.2rem 0.6rem; flex-shrink: 0; }
```

- [ ] **Step 7: Verify the templates compile**

Run:
```bash
node -e "const ejs=require('ejs'),fs=require('fs');['views/index.ejs','views/partials/admin/content.ejs'].forEach(f=>ejs.compile(fs.readFileSync(f,'utf8'),{filename:f}));console.log('compiles OK')"
```
Expected: prints `compiles OK`.

- [ ] **Step 8: Confirm no stale Facebook claim survives**

Run:
```bash
grep -rn "Real reviews from Facebook\|Add Review from Facebook\|sourced from your Facebook page" views/ || echo "no stale Facebook claims"
```
Expected: prints `no stale Facebook claims`.

- [ ] **Step 9: Run the full test suite**

Run: `node scripts/test-reviews.js && node scripts/test-queue.js && node scripts/test-orders.js && node scripts/test-payments.js && node scripts/test-templates.js`
Expected: all five green.

- [ ] **Step 10: Verify the whole loop in the browser**

With the dev server running:

1. Open a game page. With no approved reviews, confirm **no review block renders at all** — not an empty one.
2. Open an order whose state is `active` (or set one to `active` in admin). Confirm the review prompt appears below the order card.
3. Pick 3 stars, type a sentence, submit. Confirm the redirect shows "Thanks — we'll put this up once we've checked it." and the prompt is gone.
4. Reload that order page. Confirm the prompt does **not** come back.
5. In admin, confirm the review appears under "Waiting for your approval (1)" with its ref. Click Approve.
6. Reload the game page. Confirm the block now renders with the aggregate line and a green **Verified renter** badge.
7. Add a review through the admin form with Source = Facebook. Confirm it renders with the blue **Facebook** badge on both the homepage and the game page.
8. Confirm the browser console is clean.

- [ ] **Step 11: Commit**

```bash
git add server.js views/partials/admin/content.ejs views/index.ejs public/css/style.css
git commit -m "Add the review approval queue and fix the Facebook badge claim"
```

---

## Self-review notes

**Spec coverage.** Every spec section maps to a task: data model → Task 2 (write path) and Task 5 (admin path); pooled-not-per-game → Task 4; the prompt and its state gate → Tasks 1 and 3; submission route → Task 2; game-page display and aggregate → Task 4; admin approval → Task 5; the three honesty copy changes → Task 5; `lib/reviews.js` architecture → Task 1; failure modes → the empty-pool check in Task 4 Step 7, the escaping check in Task 4 Step 6, and the `canPrompt` duplicate guard tested in Task 1; testing → `scripts/test-reviews.js`.

**Deliberately not built** (spec "Out of scope"): no `/reviews` page — "see all" points at `/#reviewsSection`; no per-game pools; no editing a review after submission; no Messenger review requests; no photo or video reviews.

**Known risk.** Task 5 Step 4 edits markup inside `views/index.ejs` that this plan quotes only in part. Locate it by searching for `review-fb-badge` and replace that single element, leaving the surrounding `.review-footer` structure untouched.

**Reach on day one.** The prompt fires only for orders in the four reviewable states. On current production data that is 8 customers; the other ~29 past customers are not in the live order list and still need the manual message described in the growth plan. This feature stops the *next* cohort being manual — it does not retroactively collect the last one.
