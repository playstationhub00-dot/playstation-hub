# Weekly/Monthly Rental Durations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the site's three rental durations (10/15/30 days) with two (Weekly=7 days, Monthly=30 days), across all pricing data, admin forms, public pages, promos, the Meta catalog feed, and marketing copy.

**Architecture:** Keep the existing `{type}_price_{N}d` field-naming convention (e.g. `nt_price_10d` → `nt_price_7d`), just changing which `N` values exist, so every dynamic-key lookup (`` g[`nt_price_${d}d`] ``) needs no change. Introduce one `RENTAL_DURATIONS` constant in `server.js`, exposed via `app.locals`, that every hardcoded `[10, 15, 30]` loop in server.js and the 11 affected EJS views reads from instead. Data migration seeds new `_price_7d` fields from the existing `_price_10d` values (the 30-day fields are already correct and untouched).

**Tech Stack:** Node.js/Express, EJS templates, lowdb (`games.json`) synced to MongoDB Atlas via a monkeypatched `db.write`. No local dev server or test framework — this project is verified by deploying to Railway (`git push` → live at https://playstation-hub.com) and checking with `curl`/the Browser tool. Every task below follows that pattern instead of a unit-test framework.

## Global Constraints

- Weekly = 7 days, Monthly = 30 days (spec: Decisions).
- Field naming stays `{type}_price_{days}d` — `nt_price_7d`, `nt_price_30d`, `tr_price_7d`, `tr_price_30d` (spec: Approach).
- Weekly prices seed from the existing `_price_10d` value; Monthly seeds from (is identical to) the existing `_price_30d` value (spec: Data model).
- Applies to all four collections: `games`, `price_categories`, `psplus_prices`, `upcoming` (spec: Data model).
- Promo discounts (`site_settings.promo.discounts`) move from keys `{10,15,30}` to `{7,30}`, seeding `7` from the old `10` (spec: Promo discounts).
- `customers[].days` keeps its existing raw-integer schema — no migration, only the admin `<select>` options and the "is this a standard duration" check change (spec: Customer records).
- Old `10d`/`15d` fields are left in the database, unread, for a clean rollback path — do not delete them in this plan (spec: Out of scope).
- Durations are hardcoded (not admin-editable), but centralized into one `RENTAL_DURATIONS` constant so every consumer reads from it (spec: Decisions).
- Before any deploy step in this plan, confirm with the user that no other session is actively editing `games.json` on the live site (spec: Rollout).
- EJS tag-balance (`<%` count == `%>` count) must be verified for every `.ejs` file touched, before committing — established project convention.
- After every deploy, verify live via `curl`/Browser tool against https://playstation-hub.com — no local dev server exists for this project.

---

### Task 1: Central `RENTAL_DURATIONS` constant + data migration

**Files:**
- Modify: `server.js:96-115` (existing per-game migration block)
- Modify: `server.js` (new constant, placed just above the existing `PROMO_DURATIONS` at line 569 — that line's definition moves into this constant)

**Interfaces:**
- Produces: `RENTAL_DURATIONS` — `[{ days: 7, label: 'Weekly', sub: '1 Week' }, { days: 30, label: 'Monthly', sub: '1 Month' }]`, module-level `const` in server.js, also assigned to `app.locals.RENTAL_DURATIONS` so every EJS view can read it without it being threaded through `res.render`.
- Produces: `PROMO_DURATIONS` — `RENTAL_DURATIONS.map(d => d.days)` → `[7, 30]`. Replaces the current `const PROMO_DURATIONS = [10, 15, 30];` at server.js:569 (delete the old line; the new one lives up near `RENTAL_DURATIONS` instead).
- Consumes: nothing (this is the first task).

- [ ] **Step 1: Add the `RENTAL_DURATIONS`/`PROMO_DURATIONS` constants**

Find this line in `server.js` (around line 569):

```js
const PROMO_DURATIONS = [10, 15, 30];
```

Replace it with nothing — delete that line. Then, near the top of `server.js`, immediately after the `const app = express();` line, add:

```js
// The two rental durations the whole site offers. Every duration-driven loop,
// form, and price lookup reads from this — changing durations again later is a
// one-line edit here instead of a repo-wide hunt. `days` also drives the
// `{type}_price_{days}d` field names on games/price_categories/psplus_prices/
// upcoming (e.g. nt_price_7d, tr_price_30d).
const RENTAL_DURATIONS = [
  { days: 7,  label: 'Weekly',  sub: '1 Week'  },
  { days: 30, label: 'Monthly', sub: '1 Month' },
];
const PROMO_DURATIONS = RENTAL_DURATIONS.map(d => d.days); // [7, 30]
app.locals.RENTAL_DURATIONS = RENTAL_DURATIONS;
```

- [ ] **Step 2: Verify placement with a syntax check**

Run: `node -c server.js`
Expected: no output, exit code 0 (a syntax error would print `SyntaxError: ...` and exit non-zero).

- [ ] **Step 3: Extend the games migration block to seed `_price_7d` fields**

In `server.js`, find the existing migration block (around line 96):

```js
// Migrate existing games to new fields if missing
db.get('games').value().forEach(g => {
  const patch = {};
  if (g.price_10d === undefined) patch.price_10d = g.price_per_week || 149;
  if (g.price_15d === undefined) patch.price_15d = Math.round((g.price_per_week || 149) * 1.5);
  if (g.price_30d === undefined) patch.price_30d = Math.round((g.price_per_week || 149) * 2.5);
  if (g.trophy_account === undefined) patch.trophy_account = false;
  // Separate trophy/non-trophy prices
  if (g.nt_price_10d === undefined) patch.nt_price_10d = g.price_10d || g.price_per_week || 149;
  if (g.nt_price_15d === undefined) patch.nt_price_15d = g.price_15d || Math.round((g.price_per_week || 149) * 1.5);
  if (g.nt_price_30d === undefined) patch.nt_price_30d = g.price_30d || Math.round((g.price_per_week || 149) * 2.5);
  if (g.tr_price_10d === undefined) patch.tr_price_10d = (g.price_10d || g.price_per_week || 149) + 50;
  if (g.tr_price_15d === undefined) patch.tr_price_15d = (g.price_15d || Math.round((g.price_per_week || 149) * 1.5)) + 50;
  if (g.tr_price_30d === undefined) patch.tr_price_30d = (g.price_30d || Math.round((g.price_per_week || 149) * 2.5)) + 50;
  // Backfill with a date well outside the "added this month" window so pre-existing
  // catalog games don't retroactively show a NEW badge.
  if (g.created_at === undefined) patch.created_at = '2020-01-01T00:00:00.000Z';
  if (Object.keys(patch).length) {
    db.get('games').find({ id: g.id }).assign(patch).write();
  }
});
```

Add these four lines right before the `if (Object.keys(patch).length) {` line (so they run as part of the same patch, after the `10d`/`15d`/`30d` fields above them exist to seed from):

```js
  // Weekly/Monthly migration: Monthly reuses the existing (already-correct)
  // 30-day price as-is. Weekly seeds from the old 10-day price — same number,
  // shorter period, a deliberate per-day price increase (spec decision).
  if (g.nt_price_7d === undefined) patch.nt_price_7d = g.nt_price_10d !== undefined ? g.nt_price_10d : (patch.nt_price_10d || 149);
  if (g.tr_price_7d === undefined) patch.tr_price_7d = g.tr_price_10d !== undefined ? g.tr_price_10d : (patch.tr_price_10d || 199);
```

- [ ] **Step 4: Add the same `_price_7d` migration for `price_categories`, `psplus_prices`, and `upcoming`**

Immediately after the games migration `forEach` block closes (right after its closing `});`), add:

```js
// Weekly/Monthly migration for price categories — same rule as games above.
db.get('price_categories').value().forEach(cat => {
  const patch = {};
  if (cat.nt_price_7d === undefined) patch.nt_price_7d = cat.nt_price_10d || 149;
  if (cat.tr_price_7d === undefined) patch.tr_price_7d = cat.tr_price_10d || 199;
  if (Object.keys(patch).length) {
    db.get('price_categories').find({ id: cat.id }).assign(patch).write();
  }
});

// Weekly/Monthly migration for PS Plus rental prices (single object, not an array).
(function migratePsplusPricesWeeklyMonthly() {
  const pp = db.get('psplus_prices').value();
  if (!pp) return;
  const patch = {};
  if (pp.nt_price_7d === undefined) patch.nt_price_7d = pp.nt_price_10d || 349;
  if (pp.tr_price_7d === undefined) patch.tr_price_7d = pp.tr_price_10d || 399;
  if (Object.keys(patch).length) db.set('psplus_prices', { ...pp, ...patch }).write();
})();

// Weekly/Monthly migration for Coming Soon (upcoming) entries.
db.get('upcoming').value().forEach(u => {
  const patch = {};
  if (u.nt_price_7d === undefined) patch.nt_price_7d = u.nt_price_10d || 0;
  if (u.tr_price_7d === undefined) patch.tr_price_7d = u.tr_price_10d || 0;
  if (Object.keys(patch).length) {
    db.get('upcoming').find({ id: u.id }).assign(patch).write();
  }
});
```

- [ ] **Step 5: Migrate promo discounts from `{10,15,30}` keys to `{7,30}`**

Find the promo-discounts migration in `server.js` (around line 544-552):

```js
  } else if (!s.promo.discounts) {
    ...
      discounts[s.promo.apply_on_days] = s.promo.discount_pct;
    ...
    db.set('site_settings.promo.discounts', discounts).write();
    s.promo.discounts = discounts;
```

Directly below that whole `getSiteSettings()` block's closing (before its `return s;` at line 566), add a one-time migration:

```js
  // Weekly/Monthly migration: promo discount keys move from {10,15,30} to {7,30}.
  // Seed the new "7" key from the old "10" key so an existing promo's Weekly
  // discount isn't silently lost; leave "10"/"15"/"30" in place (unread) for a
  // clean rollback.
  if (s.promo && s.promo.discounts && s.promo.discounts[7] === undefined) {
    const migratedDiscounts = { ...s.promo.discounts, 7: s.promo.discounts[10] || 0 };
    db.set('site_settings.promo.discounts', migratedDiscounts).write();
    s.promo.discounts = migratedDiscounts;
  }
```

- [ ] **Step 6: One-time hero subtitle copy migration**

In the same area of `server.js`, find where `site_settings.hero_text` is seeded (around line 518, inside `getSiteSettings()`). Directly below wherever `s.hero_text` is read/defaulted, add:

```js
  // Weekly/Monthly migration: the hero subtitle is admin-editable, so only rewrite
  // it if it still exactly matches the old auto-generated default — never
  // overwrite a subtitle an admin customized.
  const OLD_HERO_SUBTITLE = 'Play more, pay less. Rent top titles starting at ₱99 — choose 10, 15, or 30 days.';
  const NEW_HERO_SUBTITLE = 'Play more, pay less. Rent top titles starting at ₱99 — choose Weekly or Monthly.';
  if (s.hero_text && s.hero_text.subtitle === OLD_HERO_SUBTITLE) {
    db.set('site_settings.hero_text.subtitle', NEW_HERO_SUBTITLE).write();
    s.hero_text.subtitle = NEW_HERO_SUBTITLE;
  }
```

Place this after the block that guarantees `s.hero_text` exists (so `s.hero_text.subtitle` is never read before it's set) but before `return s;`.

- [ ] **Step 7: Update the two hardcoded hero-subtitle defaults to match**

Find both occurrences (server.js:53 and :521) of:

```js
subtitle: 'Play more, pay less. Rent top titles starting at ₱99 — choose 10, 15, or 30 days.',
```

Replace both with:

```js
subtitle: 'Play more, pay less. Rent top titles starting at ₱99 — choose Weekly or Monthly.',
```

- [ ] **Step 8: Syntax-check and confirm no other session is live-editing the DB**

Run: `node -c server.js`
Expected: no output, exit code 0.

Before proceeding to any later task's deploy step, ask the user to confirm no other Claude Code session or browser tab is actively editing `games.json` on the live site (per Global Constraints and the spec's Rollout section) — this task's migration writes to `games`, `price_categories`, `psplus_prices`, and `upcoming` on server start.

- [ ] **Step 9: Commit**

```bash
git add server.js
git commit -m "$(cat <<'EOF'
Add RENTAL_DURATIONS constant and 7d price migration

Introduces the single source of truth for Weekly(7)/Monthly(30)
durations and seeds nt_price_7d/tr_price_7d across games,
price_categories, psplus_prices, and upcoming from the existing
10-day prices. 30-day prices are untouched. Also migrates promo
discount keys and the auto-generated hero subtitle.
EOF
)"
```

---

### Task 2: Update all `server.js` write routes to use 7d/30d fields

**Files:**
- Modify: `server.js:1344-1391` (`POST /admin/add`)
- Modify: `server.js:1402-1460` (`POST /admin/edit/:id`)
- Modify: `server.js:2411-2436` (`POST /admin/price-categories/add`)
- Modify: `server.js:2440-2464` (`POST /admin/price-categories/edit/:id`)
- Modify: `server.js:746-762` (`POST /admin/psplus/prices`)
- Modify: `server.js:1214-1240` (`POST /admin/upcoming/add`)
- Modify: `server.js:1250-1284` (`POST /admin/upcoming/edit/:id`)
- Modify: `server.js:1285-1313` (`POST /admin/upcoming/release/:id`)
- Modify: `server.js:1029-1040` (`POST /admin/promo`)
- Modify: `server.js:1737-1795` (`POST /admin/customers/add`)
- Modify: `server.js:1805-1860` (`POST /admin/customers/edit/:id`)

**Interfaces:**
- Consumes: `RENTAL_DURATIONS`, `PROMO_DURATIONS` from Task 1.
- Produces: nothing new — this task only changes which request-body field names these routes read/write (`_price_10d`/`_price_15d` → `_price_7d`, dropping 15d entirely) and the customer duration default/custom-check logic that Task 4 (customer views) depends on.

- [ ] **Step 1: Update `POST /admin/add`**

In `server.js:1344-1391`, change the destructure line:

```js
  const { title, platform, available_slots, renters,
    nt_price_10d, nt_price_15d, nt_price_30d,
    tr_price_10d, tr_price_15d, tr_price_30d,
```

to:

```js
  const { title, platform, available_slots, renters,
    nt_price_7d, nt_price_30d,
    tr_price_7d, tr_price_30d,
```

and change the assignment block:

```js
    nt_price_10d: cat ? cat.nt_price_10d : (parseInt(nt_price_10d) || 149),
    nt_price_15d: cat ? cat.nt_price_15d : (parseInt(nt_price_15d) || 199),
    nt_price_30d: cat ? cat.nt_price_30d : (parseInt(nt_price_30d) || 349),
    tr_price_10d: cat ? cat.tr_price_10d : (parseInt(tr_price_10d) || 199),
    tr_price_15d: cat ? cat.tr_price_15d : (parseInt(tr_price_15d) || 249),
    tr_price_30d: cat ? cat.tr_price_30d : (parseInt(tr_price_30d) || 399),
```

to:

```js
    nt_price_7d: cat ? cat.nt_price_7d : (parseInt(nt_price_7d) || 149),
    nt_price_30d: cat ? cat.nt_price_30d : (parseInt(nt_price_30d) || 349),
    tr_price_7d: cat ? cat.tr_price_7d : (parseInt(tr_price_7d) || 199),
    tr_price_30d: cat ? cat.tr_price_30d : (parseInt(tr_price_30d) || 399),
```

- [ ] **Step 2: Update `POST /admin/edit/:id`**

In `server.js:1402-1460`, apply the same two changes: destructure `nt_price_7d, nt_price_30d, tr_price_7d, tr_price_30d` (drop the `15d` names), and change the `.assign({...})` block:

```js
    nt_price_10d: cat ? cat.nt_price_10d : parseInt(nt_price_10d),
    nt_price_15d: cat ? cat.nt_price_15d : parseInt(nt_price_15d),
    nt_price_30d: cat ? cat.nt_price_30d : parseInt(nt_price_30d),
    tr_price_10d: cat ? cat.tr_price_10d : parseInt(tr_price_10d),
    tr_price_15d: cat ? cat.tr_price_15d : parseInt(tr_price_15d),
    tr_price_30d: cat ? cat.tr_price_30d : parseInt(tr_price_30d),
```

to:

```js
    nt_price_7d: cat ? cat.nt_price_7d : parseInt(nt_price_7d),
    nt_price_30d: cat ? cat.nt_price_30d : parseInt(nt_price_30d),
    tr_price_7d: cat ? cat.tr_price_7d : parseInt(tr_price_7d),
    tr_price_30d: cat ? cat.tr_price_30d : parseInt(tr_price_30d),
```

- [ ] **Step 3: Update `POST /admin/price-categories/add` and `/edit/:id`**

In both `server.js:2411-2436` and `server.js:2440-2464`, change the destructure:

```js
  const { name, nt_price_10d, nt_price_15d, nt_price_30d, tr_price_10d, tr_price_15d, tr_price_30d,
```

to:

```js
  const { name, nt_price_7d, nt_price_30d, tr_price_7d, tr_price_30d,
```

In the `add` route's `.push({...})`, change:

```js
    nt_price_10d: parseInt(nt_price_10d) || 149,
    nt_price_15d: parseInt(nt_price_15d) || 199,
    nt_price_30d: parseInt(nt_price_30d) || 349,
    tr_price_10d: parseInt(tr_price_10d) || 199,
    tr_price_15d: parseInt(tr_price_15d) || 249,
    tr_price_30d: parseInt(tr_price_30d) || 399,
```

to:

```js
    nt_price_7d: parseInt(nt_price_7d) || 149,
    nt_price_30d: parseInt(nt_price_30d) || 349,
    tr_price_7d: parseInt(tr_price_7d) || 199,
    tr_price_30d: parseInt(tr_price_30d) || 399,
```

In the `edit/:id` route's `.assign({...})`, change:

```js
    nt_price_10d: parseInt(nt_price_10d) || cat.nt_price_10d,
    nt_price_15d: parseInt(nt_price_15d) || cat.nt_price_15d,
    nt_price_30d: parseInt(nt_price_30d) || cat.nt_price_30d,
    tr_price_10d: parseInt(tr_price_10d) || cat.tr_price_10d,
    tr_price_15d: parseInt(tr_price_15d) || cat.tr_price_15d,
    tr_price_30d: parseInt(tr_price_30d) || cat.tr_price_30d,
```

to:

```js
    nt_price_7d: parseInt(nt_price_7d) || cat.nt_price_7d,
    nt_price_30d: parseInt(nt_price_30d) || cat.nt_price_30d,
    tr_price_7d: parseInt(tr_price_7d) || cat.tr_price_7d,
    tr_price_30d: parseInt(tr_price_30d) || cat.tr_price_30d,
```

- [ ] **Step 4: Update `POST /admin/psplus/prices`**

In `server.js:746-762`, change:

```js
app.post('/admin/psplus/prices', requireAuth, (req, res) => {
  const { nt_price_10d, nt_price_15d, nt_price_30d, tr_price_10d, tr_price_15d, tr_price_30d, nt_slots, tr_slots, ps4_slots } = req.body;
  db.set('psplus_slots', {
    nt_slots: parseInt(nt_slots) || 0,
    tr_slots: parseInt(tr_slots) || 0,
    ps4_slots: parseInt(ps4_slots) || 0
  }).write();
  db.set('psplus_prices', {
    nt_price_10d: parseInt(nt_price_10d) || 349,
    nt_price_15d: parseInt(nt_price_15d) || 449,
    nt_price_30d: parseInt(nt_price_30d) || 599,
    tr_price_10d: parseInt(tr_price_10d) || 399,
    tr_price_15d: parseInt(tr_price_15d) || 499,
    tr_price_30d: parseInt(tr_price_30d) || 699
  }).write();
  res.redirect('/admin?msg=psplus_prices');
});
```

to:

```js
app.post('/admin/psplus/prices', requireAuth, (req, res) => {
  const { nt_price_7d, nt_price_30d, tr_price_7d, tr_price_30d, nt_slots, tr_slots, ps4_slots } = req.body;
  db.set('psplus_slots', {
    nt_slots: parseInt(nt_slots) || 0,
    tr_slots: parseInt(tr_slots) || 0,
    ps4_slots: parseInt(ps4_slots) || 0
  }).write();
  db.set('psplus_prices', {
    nt_price_7d: parseInt(nt_price_7d) || 349,
    nt_price_30d: parseInt(nt_price_30d) || 599,
    tr_price_7d: parseInt(tr_price_7d) || 399,
    tr_price_30d: parseInt(tr_price_30d) || 699
  }).write();
  res.redirect('/admin?msg=psplus_prices');
});
```

- [ ] **Step 5: Update `POST /admin/upcoming/add` and `/upcoming/edit/:id`**

In `server.js:1214-1240`, change the destructure:

```js
  const { title, platform, genre, release_date, release_date_tba_val, description,
          non_trophy_slots, trophy_slots, rank,
          nt_price_10d, nt_price_15d, nt_price_30d,
          tr_price_10d, tr_price_15d, tr_price_30d } = req.body;
```

to:

```js
  const { title, platform, genre, release_date, release_date_tba_val, description,
          non_trophy_slots, trophy_slots, rank,
          nt_price_7d, nt_price_30d,
          tr_price_7d, tr_price_30d } = req.body;
```

and the `.push({...})` fields:

```js
    nt_price_10d: parseInt(nt_price_10d) || 0,
    nt_price_15d: parseInt(nt_price_15d) || 0,
    nt_price_30d: parseInt(nt_price_30d) || 0,
    tr_price_10d: parseInt(tr_price_10d) || 0,
    tr_price_15d: parseInt(tr_price_15d) || 0,
    tr_price_30d: parseInt(tr_price_30d) || 0,
```

to:

```js
    nt_price_7d: parseInt(nt_price_7d) || 0,
    nt_price_30d: parseInt(nt_price_30d) || 0,
    tr_price_7d: parseInt(tr_price_7d) || 0,
    tr_price_30d: parseInt(tr_price_30d) || 0,
```

Apply the same destructure and field-name change to `POST /admin/upcoming/edit/:id` at `server.js:1250-1284` (same field names, same pattern — read that route's current body to confirm its exact surrounding fields before editing, since it also handles `remove_cover`/etc. that must be left untouched).

- [ ] **Step 6: Update `POST /admin/upcoming/release/:id`**

In `server.js:1285-1313`, change:

```js
    nt_price_10d: game.nt_price_10d || 0,
    nt_price_15d: game.nt_price_15d || 0,
    nt_price_30d: game.nt_price_30d || 0,
    tr_price_10d: game.tr_price_10d || 0,
    tr_price_15d: game.tr_price_15d || 0,
    tr_price_30d: game.tr_price_30d || 0,
```

to:

```js
    nt_price_7d: game.nt_price_7d || 0,
    nt_price_30d: game.nt_price_30d || 0,
    tr_price_7d: game.tr_price_7d || 0,
    tr_price_30d: game.tr_price_30d || 0,
```

- [ ] **Step 7: Update `POST /admin/promo`**

In `server.js:1029-1040`, change:

```js
  const { enabled, discount_10, discount_15, discount_30, deposit,
```

to:

```js
  const { enabled, discount_7, discount_30, deposit,
```

and:

```js
    10: Math.min(100, Math.max(0, parseInt(discount_10) || 0)),
    15: Math.min(100, Math.max(0, parseInt(discount_15) || 0)),
    30: Math.min(100, Math.max(0, parseInt(discount_30) || 0))
```

to:

```js
    7: Math.min(100, Math.max(0, parseInt(discount_7) || 0)),
    30: Math.min(100, Math.max(0, parseInt(discount_30) || 0))
```

- [ ] **Step 8: Update customer duration default and "is custom" logic**

In `server.js:1737-1795` (`POST /admin/customers/add`), change:

```js
  const actualDays = days === 'custom' ? (parseInt(custom_days) || 1) : (parseInt(days) || 10);
```

to:

```js
  const actualDays = days === 'custom' ? (parseInt(custom_days) || 1) : (parseInt(days) || 7);
```

Apply the identical change in `server.js:1805-1860` (`POST /admin/customers/edit/:id`), which has the same line.

The price lookup two lines below in the `add` route:

```js
  const priceVal = parseInt(price) || (days === 'custom' || isUpcomingGame ? 0 : (account_type === 'tr'
    ? (resolved['tr_price_'+days+'d'] || 0)
    : (resolved['nt_price_'+days+'d'] || 0)));
```

needs no change — it builds the field name dynamically from whatever `days` value was submitted (now `7` or `30` from the updated `<select>` in Task 4), so it already resolves to `tr_price_7d`/`nt_price_7d` correctly.

- [ ] **Step 9: Syntax-check**

Run: `node -c server.js`
Expected: no output, exit code 0.

- [ ] **Step 10: Commit**

```bash
git add server.js
git commit -m "$(cat <<'EOF'
Switch admin write routes from 10/15/30d to 7/30d fields

Updates every POST route that reads or writes nt_price_*/tr_price_*
fields (games, price categories, PS Plus prices, upcoming, promo
discounts, customer default duration) to the new Weekly(7)/
Monthly(30) field names, dropping the 15-day field entirely.
EOF
)"
```

---

### Task 3: Update the Meta catalog feed and swap-reference pricing

**Files:**
- Modify: `server.js:944-953` (Meta feed rental rows)
- Modify: `server.js:592` (`computeSwapReferencePrice`)

**Interfaces:**
- Consumes: `RENTAL_DURATIONS`, `PROMO_DURATIONS` from Task 1.
- Produces: nothing new — this is a pure consumer update.

- [ ] **Step 1: Update the Meta feed's rental duration loop**

In `server.js:944-953`, change:

```js
    // Rentals — one row per duration per account type.
    [10, 15, 30].forEach(d => {
      const pct = getPromoDiscountPct(promo, d);
      const cut = v => pct > 0 ? v - Math.round(v * pct / 100) : v;
      const nt = g[`nt_price_${d}d`];
      if (nt > 0) push(`nt-${d}d`, `${d} Days (Non-Trophy)`, nt, cut(nt), avail.ntSlots > 0, `${d} Days`, 'Non-Trophy');
      if (avail.hasTrophy) {
        const tr = g[`tr_price_${d}d`];
        if (tr > 0) push(`tr-${d}d`, `${d} Days (Trophy)`, tr, cut(tr), avail.trSlots > 0, `${d} Days`, 'Trophy');
      }
    });
```

to:

```js
    // Rentals — one row per duration per account type.
    RENTAL_DURATIONS.forEach(({ days: d, label: durLabel }) => {
      const pct = getPromoDiscountPct(promo, d);
      const cut = v => pct > 0 ? v - Math.round(v * pct / 100) : v;
      const nt = g[`nt_price_${d}d`];
      if (nt > 0) push(`nt-${d}d`, `${durLabel} (Non-Trophy)`, nt, cut(nt), avail.ntSlots > 0, durLabel, 'Non-Trophy');
      if (avail.hasTrophy) {
        const tr = g[`tr_price_${d}d`];
        if (tr > 0) push(`tr-${d}d`, `${durLabel} (Trophy)`, tr, cut(tr), avail.trSlots > 0, durLabel, 'Trophy');
      }
    });
```

- [ ] **Step 2: Confirm `computeSwapReferencePrice` needs no change**

In `server.js:592-599`, the function already does:

```js
  const d = parseInt(days);
  if (!PROMO_DURATIONS.includes(d)) return null;
  const resolved = resolveGamePrices(game);
  const base = resolved[usingType + '_price_' + d + 'd'];
```

Since `PROMO_DURATIONS` now resolves to `[7, 30]` (from Task 1) and the field-name construction is dynamic, this function correctly rejects `15` and resolves `7`/`30` with no code change. No edit needed — just confirm by reading the function that this is still true after Task 1's changes (it is; this step is a verification read, not an edit).

- [ ] **Step 3: Syntax-check**

Run: `node -c server.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "$(cat <<'EOF'
Update Meta catalog feed to Weekly/Monthly durations

Feed rows now loop over RENTAL_DURATIONS instead of a hardcoded
[10,15,30], so product IDs and duration labels reflect the new
Weekly(7)/Monthly(30) pricing. 15-day rows stop being emitted;
existing 10/15-day product IDs will retire on the next Meta sync.
EOF
)"
```

---

### Task 4: Update admin UI — price categories, per-game prices, PS Plus prices, promo form, games table

**Files:**
- Modify: `views/admin.ejs:858` (category summary line)
- Modify: `views/admin.ejs:866-872` (category edit duration inputs)
- Modify: `views/admin.ejs:913-919` (category add duration inputs)
- Modify: `views/admin.ejs:982` (category dropdown label)
- Modify: `views/admin.ejs:989-995` (add-game price fields)
- Modify: `views/admin.ejs:1124-1125` (games table price column)
- Modify: `views/admin.ejs:1203-1215` (per-game price override, add form)
- Modify: `views/admin.ejs:1232` (games table header)
- Modify: `views/admin.ejs:1250-1256` (games table price display)
- Modify: `views/admin.ejs:1339-1345` (PS Plus prices form)
- Modify: `views/admin.ejs:360-372` (promo discount inputs)
- Modify: `views/admin.ejs:2213-2238` (customer add/edit inline duration data attrs and `<select>` options)

**Interfaces:**
- Consumes: `RENTAL_DURATIONS` (available as an EJS local via `app.locals` from Task 1); field names `nt_price_7d`/`nt_price_30d`/`tr_price_7d`/`tr_price_30d` from Task 2's routes.
- Produces: nothing new — this task only changes admin-facing markup/labels.

- [ ] **Step 1: Category summary line and dropdown label**

In `views/admin.ejs:858`, change:

```html
<span style="font-size:0.75rem;color:#555;">NT: ₱<%= cat.nt_price_10d %>/₱<%= cat.nt_price_15d %>/₱<%= cat.nt_price_30d %> &nbsp;|&nbsp; TR: ₱<%= cat.tr_price_10d %>/₱<%= cat.tr_price_15d %>/₱<%= cat.tr_price_30d %></span>
```

to:

```html
<span style="font-size:0.75rem;color:#555;">NT: ₱<%= cat.nt_price_7d %>/₱<%= cat.nt_price_30d %> &nbsp;|&nbsp; TR: ₱<%= cat.tr_price_7d %>/₱<%= cat.tr_price_30d %></span>
```

In `views/admin.ejs:982`, change:

```html
<option value="<%= cat.id %>"><%= cat.name %> (NT: ₱<%= cat.nt_price_10d %>/₱<%= cat.nt_price_15d %>/₱<%= cat.nt_price_30d %>)</option>
```

to:

```html
<option value="<%= cat.id %>"><%= cat.name %> (NT: ₱<%= cat.nt_price_7d %>/₱<%= cat.nt_price_30d %>)</option>
```

- [ ] **Step 2: Category edit and add duration input fields**

In `views/admin.ejs:866-872` (category edit form), change:

```html
                <div class="form-group"><label>10 Days</label><input type="number" name="nt_price_10d" value="<%= cat.nt_price_10d %>" min="1"></div>
                <div class="form-group"><label>15 Days</label><input type="number" name="nt_price_15d" value="<%= cat.nt_price_15d %>" min="1"></div>
                <div class="form-group"><label>30 Days</label><input type="number" name="nt_price_30d" value="<%= cat.nt_price_30d %>" min="1"></div>
```
```html
                <div class="form-group"><label>10 Days</label><input type="number" name="tr_price_10d" value="<%= cat.tr_price_10d %>" min="1"></div>
                <div class="form-group"><label>15 Days</label><input type="number" name="tr_price_15d" value="<%= cat.tr_price_15d %>" min="1"></div>
                <div class="form-group"><label>30 Days</label><input type="number" name="tr_price_30d" value="<%= cat.tr_price_30d %>" min="1"></div>
```

to:

```html
                <div class="form-group"><label>Weekly</label><input type="number" name="nt_price_7d" value="<%= cat.nt_price_7d %>" min="1"></div>
                <div class="form-group"><label>Monthly</label><input type="number" name="nt_price_30d" value="<%= cat.nt_price_30d %>" min="1"></div>
```
```html
                <div class="form-group"><label>Weekly</label><input type="number" name="tr_price_7d" value="<%= cat.tr_price_7d %>" min="1"></div>
                <div class="form-group"><label>Monthly</label><input type="number" name="tr_price_30d" value="<%= cat.tr_price_30d %>" min="1"></div>
```

In `views/admin.ejs:913-919` (category add form), change:

```html
              <div class="form-group"><label>10 Days</label><input type="number" name="nt_price_10d" value="149" min="1"></div>
              <div class="form-group"><label>15 Days</label><input type="number" name="nt_price_15d" value="199" min="1"></div>
              <div class="form-group"><label>30 Days</label><input type="number" name="nt_price_30d" value="349" min="1"></div>
```
```html
              <div class="form-group"><label>10 Days</label><input type="number" name="tr_price_10d" value="199" min="1"></div>
              <div class="form-group"><label>15 Days</label><input type="number" name="tr_price_15d" value="249" min="1"></div>
              <div class="form-group"><label>30 Days</label><input type="number" name="tr_price_30d" value="399" min="1"></div>
```

to:

```html
              <div class="form-group"><label>Weekly</label><input type="number" name="nt_price_7d" value="149" min="1"></div>
              <div class="form-group"><label>Monthly</label><input type="number" name="nt_price_30d" value="349" min="1"></div>
```
```html
              <div class="form-group"><label>Weekly</label><input type="number" name="tr_price_7d" value="199" min="1"></div>
              <div class="form-group"><label>Monthly</label><input type="number" name="tr_price_30d" value="399" min="1"></div>
```

- [ ] **Step 3: Add-game form price fields**

In `views/admin.ejs:989-995`, change:

```html
            <div class="form-group"><label>10 Days</label><input type="number" name="nt_price_10d" value="149" min="1"></div>
            <div class="form-group"><label>15 Days</label><input type="number" name="nt_price_15d" value="199" min="1"></div>
            <div class="form-group"><label>30 Days</label><input type="number" name="nt_price_30d" value="349" min="1"></div>
```
```html
            <div class="form-group"><label>10 Days</label><input type="number" name="tr_price_10d" value="199" min="1"></div>
            <div class="form-group"><label>15 Days</label><input type="number" name="tr_price_15d" value="249" min="1"></div>
            <div class="form-group"><label>30 Days</label><input type="number" name="tr_price_30d" value="399" min="1"></div>
```

to:

```html
            <div class="form-group"><label>Weekly</label><input type="number" name="nt_price_7d" value="149" min="1"></div>
            <div class="form-group"><label>Monthly</label><input type="number" name="nt_price_30d" value="349" min="1"></div>
```
```html
            <div class="form-group"><label>Weekly</label><input type="number" name="tr_price_7d" value="199" min="1"></div>
            <div class="form-group"><label>Monthly</label><input type="number" name="tr_price_30d" value="399" min="1"></div>
```

- [ ] **Step 4: Games table price column and header**

In `views/admin.ejs:1232`, change:

```html
<th>Prices (10/15/30d)</th>
```

to:

```html
<th>Prices (Weekly/Monthly)</th>
```

In `views/admin.ejs:1124-1125`, change:

```html
              <td style="font-size:0.8rem;color:#aaa;line-height:1.7;">₱<%= game.nt_price_10d %> / ₱<%= game.nt_price_15d %> / ₱<%= game.nt_price_30d %></td>
              <td style="font-size:0.8rem;color:#ffc400;line-height:1.7;"><%= game.trophy_account ? '₱'+game.tr_price_10d+' / ₱'+game.tr_price_15d+' / ₱'+game.tr_price_30d : '—' %></td>
```

to:

```html
              <td style="font-size:0.8rem;color:#aaa;line-height:1.7;">₱<%= game.nt_price_7d %> / ₱<%= game.nt_price_30d %></td>
              <td style="font-size:0.8rem;color:#ffc400;line-height:1.7;"><%= game.trophy_account ? '₱'+game.tr_price_7d+' / ₱'+game.tr_price_30d : '—' %></td>
```

- [ ] **Step 5: Per-game price override form (add-game panel) and games-list card display**

In `views/admin.ejs:1203-1215`, change:

```html
              <div class="form-group"><label style="font-size:0.75rem;">Price 10 Days (₱)</label><input type="number" name="nt_price_10d" min="0" placeholder="e.g. 149" style="width:100%;"></div>
              <div class="form-group"><label style="font-size:0.75rem;">Price 15 Days (₱)</label><input type="number" name="nt_price_15d" min="0" placeholder="e.g. 199" style="width:100%;"></div>
              <div class="form-group"><label style="font-size:0.75rem;">Price 30 Days (₱)</label><input type="number" name="nt_price_30d" min="0" placeholder="e.g. 299" style="width:100%;"></div>
```
```html
              <div class="form-group"><label style="font-size:0.75rem;">Price 10 Days (₱)</label><input type="number" name="tr_price_10d" min="0" placeholder="e.g. 199" style="width:100%;"></div>
              <div class="form-group"><label style="font-size:0.75rem;">Price 15 Days (₱)</label><input type="number" name="tr_price_15d" min="0" placeholder="e.g. 249" style="width:100%;"></div>
              <div class="form-group"><label style="font-size:0.75rem;">Price 30 Days (₱)</label><input type="number" name="tr_price_30d" min="0" placeholder="e.g. 349" style="width:100%;"></div>
```

to:

```html
              <div class="form-group"><label style="font-size:0.75rem;">Weekly Price (₱)</label><input type="number" name="nt_price_7d" min="0" placeholder="e.g. 149" style="width:100%;"></div>
              <div class="form-group"><label style="font-size:0.75rem;">Monthly Price (₱)</label><input type="number" name="nt_price_30d" min="0" placeholder="e.g. 299" style="width:100%;"></div>
```
```html
              <div class="form-group"><label style="font-size:0.75rem;">Weekly Price (₱)</label><input type="number" name="tr_price_7d" min="0" placeholder="e.g. 199" style="width:100%;"></div>
              <div class="form-group"><label style="font-size:0.75rem;">Monthly Price (₱)</label><input type="number" name="tr_price_30d" min="0" placeholder="e.g. 349" style="width:100%;"></div>
```

In `views/admin.ejs:1250-1256`, change:

```html
                <% if (game.nt_price_10d || game.nt_price_15d || game.nt_price_30d) { %>
                <div style="color:#ccc;">🎮 ₱<%= game.nt_price_10d||'—' %> / ₱<%= game.nt_price_15d||'—' %> / ₱<%= game.nt_price_30d||'—' %></div>
                <% } %>
                <% if (game.tr_price_10d || game.tr_price_15d || game.tr_price_30d) { %>
                <div style="color:#ffc400;">🏆 ₱<%= game.tr_price_10d||'—' %> / ₱<%= game.tr_price_15d||'—' %> / ₱<%= game.tr_price_30d||'—' %></div>
                <% } %>
                <% if (!game.nt_price_10d && !game.tr_price_10d) { %><span style="color:#444;">—</span><% } %>
```

to:

```html
                <% if (game.nt_price_7d || game.nt_price_30d) { %>
                <div style="color:#ccc;">🎮 ₱<%= game.nt_price_7d||'—' %> / ₱<%= game.nt_price_30d||'—' %></div>
                <% } %>
                <% if (game.tr_price_7d || game.tr_price_30d) { %>
                <div style="color:#ffc400;">🏆 ₱<%= game.tr_price_7d||'—' %> / ₱<%= game.tr_price_30d||'—' %></div>
                <% } %>
                <% if (!game.nt_price_7d && !game.tr_price_7d) { %><span style="color:#444;">—</span><% } %>
```

- [ ] **Step 6: PS Plus prices form**

In `views/admin.ejs:1339-1345`, change:

```html
          <div class="form-group"><label>10 Days</label><input type="number" name="nt_price_10d" value="<%= psplusPrices.nt_price_10d %>" min="1"></div>
          <div class="form-group"><label>15 Days</label><input type="number" name="nt_price_15d" value="<%= psplusPrices.nt_price_15d %>" min="1"></div>
          <div class="form-group"><label>30 Days</label><input type="number" name="nt_price_30d" value="<%= psplusPrices.nt_price_30d %>" min="1"></div>
```
```html
          <div class="form-group"><label>10 Days</label><input type="number" name="tr_price_10d" value="<%= psplusPrices.tr_price_10d %>" min="1"></div>
          <div class="form-group"><label>15 Days</label><input type="number" name="tr_price_15d" value="<%= psplusPrices.tr_price_15d %>" min="1"></div>
          <div class="form-group"><label>30 Days</label><input type="number" name="tr_price_30d" value="<%= psplusPrices.tr_price_30d %>" min="1"></div>
```

to:

```html
          <div class="form-group"><label>Weekly</label><input type="number" name="nt_price_7d" value="<%= psplusPrices.nt_price_7d %>" min="1"></div>
          <div class="form-group"><label>Monthly</label><input type="number" name="nt_price_30d" value="<%= psplusPrices.nt_price_30d %>" min="1"></div>
```
```html
          <div class="form-group"><label>Weekly</label><input type="number" name="tr_price_7d" value="<%= psplusPrices.tr_price_7d %>" min="1"></div>
          <div class="form-group"><label>Monthly</label><input type="number" name="tr_price_30d" value="<%= psplusPrices.tr_price_30d %>" min="1"></div>
```

- [ ] **Step 7: Promo discount inputs**

In `views/admin.ejs:360-372`, change:

```html
            <label style="color:#888;font-size:0.78rem;">Discount % per duration <span style="color:#555;">(0 = no discount for that duration — set any combination of 10/15/30 days)</span></label>
```

to:

```html
            <label style="color:#888;font-size:0.78rem;">Discount % per duration <span style="color:#555;">(0 = no discount for that duration — set either or both of Weekly/Monthly)</span></label>
```

and change:

```html
            <label>10-Day Discount %</label>
            <input type="number" name="discount_10" value="<%= adminDiscounts[10] || 0 %>" min="0" max="100" placeholder="0">
```

to:

```html
            <label>Weekly Discount %</label>
            <input type="number" name="discount_7" value="<%= adminDiscounts[7] || 0 %>" min="0" max="100" placeholder="0">
```

Delete the `15-Day Discount %` input block entirely:

```html
            <label>15-Day Discount %</label>
            <input type="number" name="discount_15" value="<%= adminDiscounts[15] || 0 %>" min="0" max="100" placeholder="0">
```

and change:

```html
            <label>30-Day Discount %</label>
            <input type="number" name="discount_30" value="<%= adminDiscounts[30] || 0 %>" min="0" max="100" placeholder="10">
```

to:

```html
            <label>Monthly Discount %</label>
            <input type="number" name="discount_30" value="<%= adminDiscounts[30] || 0 %>" min="0" max="100" placeholder="10">
```

Read the surrounding markup first (a few lines before/after 360-372) to confirm whether these three inputs sit in a 3-column grid that needs adjusting to 2 columns — if there's a `style="display:grid;grid-template-columns:...` on their wrapper with 3 explicit columns, change it to 2.

- [ ] **Step 8: Customer add/edit inline duration data attributes and `<select>`**

In `views/admin.ejs:2213-2225` (the inline customer-add-modal per-game data attributes), change:

```html
                  data-nt10="<%= g.nt_price_10d %>" data-nt15="<%= g.nt_price_15d %>" data-nt30="<%= g.nt_price_30d %>"
                  data-tr10="<%= g.tr_price_10d %>" data-tr15="<%= g.tr_price_15d %>" data-tr30="<%= g.tr_price_30d %>"
```
```html
                  data-nt10="<%= g.nt_price_10d||0 %>" data-nt15="<%= g.nt_price_15d||0 %>" data-nt30="<%= g.nt_price_30d||0 %>"
                  data-tr10="<%= g.tr_price_10d||0 %>" data-tr15="<%= g.tr_price_15d||0 %>" data-tr30="<%= g.tr_price_30d||0 %>">
```

to:

```html
                  data-nt7="<%= g.nt_price_7d %>" data-nt30="<%= g.nt_price_30d %>"
                  data-tr7="<%= g.tr_price_7d %>" data-tr30="<%= g.tr_price_30d %>"
```
```html
                  data-nt7="<%= g.nt_price_7d||0 %>" data-nt30="<%= g.nt_price_30d||0 %>"
                  data-tr7="<%= g.tr_price_7d||0 %>" data-tr30="<%= g.tr_price_30d||0 %>">
```

Then search `views/admin.ejs` for the client-side JS that reads `data-nt10`/`data-nt15`/`data-tr10`/`data-tr15` (likely in a `<script>` block below this markup, in a function like `updatePrice`/`updateCustPrice`) and rename those reads to `data-nt7`/`data-tr7` to match, removing any 15-day branch.

In `views/admin.ejs:2236-2238`, change:

```html
            <option value="10">10 Days</option>
            <option value="15">15 Days</option>
            <option value="30">30 Days</option>
```

to:

```html
            <option value="7">Weekly</option>
            <option value="30">Monthly</option>
```

- [ ] **Step 9: EJS tag-balance check**

Run: `grep -o '<%' views/admin.ejs | wc -l` and `grep -o '%>' views/admin.ejs | wc -l`
Expected: both counts equal.

- [ ] **Step 10: Commit**

```bash
git add views/admin.ejs
git commit -m "$(cat <<'EOF'
Update admin UI to Weekly/Monthly duration fields

Price category forms, per-game price override, PS Plus prices,
promo discount inputs, games table, and the customer add/edit
duration select all move from 10/15/30-day fields and labels to
Weekly(7)/Monthly(30).
EOF
)"
```

---

### Task 5: Update `edit.ejs`, `edit-upcoming.ejs`, `edit-customer.ejs`

**Files:**
- Modify: `views/edit.ejs:86-104`
- Modify: `views/edit-upcoming.ejs:96-107`
- Modify: `views/edit-customer.ejs:73-81`

**Interfaces:**
- Consumes: field names from Task 2's routes (`nt_price_7d`, `tr_price_7d`, `nt_price_30d`, `tr_price_30d`); `customer.days` values are now `7`/`30`/custom-integer.
- Produces: nothing new.

- [ ] **Step 1: `edit.ejs` price fields and category dropdown**

In `views/edit.ejs:86`, change:

```html
              <option value="<%= cat.id %>" <%= game.price_category_id === cat.id ? 'selected' : '' %>><%= cat.name %> (NT: ₱<%= cat.nt_price_10d %>/₱<%= cat.nt_price_15d %>/₱<%= cat.nt_price_30d %>)</option>
```

to:

```html
              <option value="<%= cat.id %>" <%= game.price_category_id === cat.id ? 'selected' : '' %>><%= cat.name %> (NT: ₱<%= cat.nt_price_7d %>/₱<%= cat.nt_price_30d %>)</option>
```

In `views/edit.ejs:96-104`, change:

```html
          <div class="form-group"><label>10 Days</label><input type="number" name="nt_price_10d" value="<%= game.nt_price_10d || 149 %>" min="1"></div>
          <div class="form-group"><label>15 Days</label><input type="number" name="nt_price_15d" value="<%= game.nt_price_15d || 199 %>" min="1"></div>
          <div class="form-group"><label>30 Days</label><input type="number" name="nt_price_30d" value="<%= game.nt_price_30d || 349 %>" min="1"></div>
```
```html
          <div class="form-group"><label>10 Days</label><input type="number" name="tr_price_10d" value="<%= game.tr_price_10d || 199 %>" min="1"></div>
          <div class="form-group"><label>15 Days</label><input type="number" name="tr_price_15d" value="<%= game.tr_price_15d || 249 %>" min="1"></div>
          <div class="form-group"><label>30 Days</label><input type="number" name="tr_price_30d" value="<%= game.tr_price_30d || 399 %>" min="1"></div>
```

to:

```html
          <div class="form-group"><label>Weekly</label><input type="number" name="nt_price_7d" value="<%= game.nt_price_7d || 149 %>" min="1"></div>
          <div class="form-group"><label>Monthly</label><input type="number" name="nt_price_30d" value="<%= game.nt_price_30d || 349 %>" min="1"></div>
```
```html
          <div class="form-group"><label>Weekly</label><input type="number" name="tr_price_7d" value="<%= game.tr_price_7d || 199 %>" min="1"></div>
          <div class="form-group"><label>Monthly</label><input type="number" name="tr_price_30d" value="<%= game.tr_price_30d || 399 %>" min="1"></div>
```

- [ ] **Step 2: `edit-upcoming.ejs` price fields**

In `views/edit-upcoming.ejs:96-107`, change:

```html
            <div class="form-group"><label style="font-size:0.75rem;">Price 10 Days (₱)</label><input type="number" name="nt_price_10d" min="0" value="<%= game.nt_price_10d || '' %>" style="width:100%;"></div>
            <div class="form-group"><label style="font-size:0.75rem;">Price 15 Days (₱)</label><input type="number" name="nt_price_15d" min="0" value="<%= game.nt_price_15d || '' %>" style="width:100%;"></div>
            <div class="form-group"><label style="font-size:0.75rem;">Price 30 Days (₱)</label><input type="number" name="nt_price_30d" min="0" value="<%= game.nt_price_30d || '' %>" style="width:100%;"></div>
```
```html
            <div class="form-group"><label style="font-size:0.75rem;">Price 10 Days (₱)</label><input type="number" name="tr_price_10d" min="0" value="<%= game.tr_price_10d || '' %>" style="width:100%;"></div>
            <div class="form-group"><label style="font-size:0.75rem;">Price 15 Days (₱)</label><input type="number" name="tr_price_15d" min="0" value="<%= game.tr_price_15d || '' %>" style="width:100%;"></div>
            <div class="form-group"><label style="font-size:0.75rem;">Price 30 Days (₱)</label><input type="number" name="tr_price_30d" min="0" value="<%= game.tr_price_30d || '' %>" style="width:100%;"></div>
```

to:

```html
            <div class="form-group"><label style="font-size:0.75rem;">Weekly Price (₱)</label><input type="number" name="nt_price_7d" min="0" value="<%= game.nt_price_7d || '' %>" style="width:100%;"></div>
            <div class="form-group"><label style="font-size:0.75rem;">Monthly Price (₱)</label><input type="number" name="nt_price_30d" min="0" value="<%= game.nt_price_30d || '' %>" style="width:100%;"></div>
```
```html
            <div class="form-group"><label style="font-size:0.75rem;">Weekly Price (₱)</label><input type="number" name="tr_price_7d" min="0" value="<%= game.tr_price_7d || '' %>" style="width:100%;"></div>
            <div class="form-group"><label style="font-size:0.75rem;">Monthly Price (₱)</label><input type="number" name="tr_price_30d" min="0" value="<%= game.tr_price_30d || '' %>" style="width:100%;"></div>
```

- [ ] **Step 3: `edit-customer.ejs` duration select**

In `views/edit-customer.ejs:72-81`, change:

```html
          <select name="days" id="cust_days" onchange="toggleCustCustomDays(this.value);updateCustPrice()">
            <option value="10" <%= customer.days === 10 ? 'selected' : '' %>>10 Days</option>
            <option value="15" <%= customer.days === 15 ? 'selected' : '' %>>15 Days</option>
            <option value="30" <%= customer.days === 30 ? 'selected' : '' %>>30 Days</option>
            <option value="custom" <%= (customer.days !== 10 && customer.days !== 15 && customer.days !== 30) ? 'selected' : '' %>>✏️ Custom...</option>
          </select>
          <input type="number" id="cust_custom_days" name="custom_days" min="1" max="365"
            placeholder="Enter number of days"
            value="<%= (customer.days !== 10 && customer.days !== 15 && customer.days !== 30) ? customer.days : '' %>"
            <%= (customer.days !== 10 && customer.days !== 15 && customer.days !== 30) ? '' : 'hidden' %>
```

to:

```html
          <select name="days" id="cust_days" onchange="toggleCustCustomDays(this.value);updateCustPrice()">
            <option value="7" <%= customer.days === 7 ? 'selected' : '' %>>Weekly</option>
            <option value="30" <%= customer.days === 30 ? 'selected' : '' %>>Monthly</option>
            <option value="custom" <%= (customer.days !== 7 && customer.days !== 30) ? 'selected' : '' %>>✏️ Custom...</option>
          </select>
          <input type="number" id="cust_custom_days" name="custom_days" min="1" max="365"
            placeholder="Enter number of days"
            value="<%= (customer.days !== 7 && customer.days !== 30) ? customer.days : '' %>"
            <%= (customer.days !== 7 && customer.days !== 30) ? '' : 'hidden' %>
```

This makes a pre-existing 10- or 15-day customer record correctly fall into "Custom" with its real day count shown, rather than matching neither dropdown option (per spec: Customer records).

- [ ] **Step 4: EJS tag-balance check on all three files**

Run: `for f in views/edit.ejs views/edit-upcoming.ejs views/edit-customer.ejs; do echo "$f: open=$(grep -o '<%' $f | wc -l) close=$(grep -o '%>' $f | wc -l)"; done`
Expected: each file's `open` count equals its `close` count.

- [ ] **Step 5: Commit**

```bash
git add views/edit.ejs views/edit-upcoming.ejs views/edit-customer.ejs
git commit -m "$(cat <<'EOF'
Update edit forms to Weekly/Monthly duration fields

Game edit, upcoming-game edit, and customer edit forms move from
10/15/30-day price fields and the 10/15/30 duration select to
Weekly(7)/Monthly(30), including edit-customer's custom-duration
fallback logic.
EOF
)"
```

---

### Task 6: Update public-facing pages — game detail, browse, index, PS Plus, upcoming, rent modal, how-it-works

**Files:**
- Modify: `views/game-detail.ejs:200-207` (duration picker), `:479` (price-calc script), `:536,:549` (validation copy)
- Modify: `views/browse.ejs:86` (price loop)
- Modify: `views/index.ejs:275` (price loop), `:424` (`activeDurations`), `:541` (marketing copy)
- Modify: `views/ps-plus.ejs:92-121` (price display), `:300-308` (JS price rows)
- Modify: `views/psplus-rent.ejs:94,166` (duration grid), `:271` (price-calc script), `:347` (validation copy)
- Modify: `views/upcoming-detail.ejs:227` (price loop)
- Modify: `views/partials/rent-modal.ejs:25-49` (duration display)
- Modify: `views/how-it-works.ejs:38,:81` (marketing copy)

**Interfaces:**
- Consumes: `RENTAL_DURATIONS` (via `app.locals`, available in every EJS view automatically) from Task 1.
- Produces: nothing new.

- [ ] **Step 1: `game-detail.ejs` duration picker**

In `views/game-detail.ejs:199-207`, change:

```html
        <div class="gd-duration-grid" id="durationGrid">
          <% [10, 15, 30].forEach(d => { const pct = promo.enabled ? ((promo.discounts && promo.discounts[d]) || 0) : 0; %>
          <button class="gd-dur-btn" data-days="<%= d %>" onclick="onDurChange(this)">
            <span class="gd-dur-days"><%= d %></span>
            <span class="gd-dur-label">DAYS</span>
            <span class="gd-dur-price" id="price-<%= d %>">—</span>
            <% if (pct > 0) { %><span class="gd-dur-promo"><%= pct %>% OFF</span><% } %>
          </button>
          <% }) %>
        </div>
```

to:

```html
        <div class="gd-duration-grid" id="durationGrid">
          <% RENTAL_DURATIONS.forEach(({ days: d, label: durLabel }) => { const pct = promo.enabled ? ((promo.discounts && promo.discounts[d]) || 0) : 0; %>
          <button class="gd-dur-btn" data-days="<%= d %>" onclick="onDurChange(this)">
            <span class="gd-dur-days"><%= durLabel %></span>
            <span class="gd-dur-price" id="price-<%= d %>">—</span>
            <% if (pct > 0) { %><span class="gd-dur-promo"><%= pct %>% OFF</span><% } %>
          </button>
          <% }) %>
        </div>
```

(The separate `<span class="gd-dur-label">DAYS</span>` is folded into `durLabel`, e.g. "Weekly", since "Weekly"/"Monthly" already reads as a complete word unlike a bare "7"/"30" that needed a "DAYS" suffix.)

- [ ] **Step 2: `game-detail.ejs` price-calc script loop**

In `views/game-detail.ejs:479`, change:

```js
  [10, 15, 30].forEach(d => {
```

to a loop driven by a JSON array injected from the server side (client-side JS can't read the EJS-only `RENTAL_DURATIONS` directly, since it runs in the browser after render). Just above this script block, find where other server data is already being serialized into the page for client JS (look for an existing `<script>const ... = <%- JSON.stringify(...) %>;</script>` pattern nearby — this file already does this for prices/promo, per the file's existing structure) and add:

```html
<script>const RENTAL_DURATIONS = <%- JSON.stringify(RENTAL_DURATIONS.map(d => d.days)) %>;</script>
```

placed before the script block containing line 479. Then change line 479 to:

```js
  RENTAL_DURATIONS.forEach(d => {
```

- [ ] **Step 3: `game-detail.ejs` validation copy**

In `views/game-detail.ejs:536`, change:

```js
    const msg = '⚠️ Please select a rental duration (10, 15, or 30 days) before continuing.';
```

to:

```js
    const msg = '⚠️ Please select a rental duration (Weekly or Monthly) before continuing.';
```

In `views/game-detail.ejs:549`, change:

```js
  if (!selectedDays) { e.preventDefault(); showValidation('Please select a rental duration (10, 15, or 30 days) to continue.'); highlightDurationGrid(); return false; }
```

to:

```js
  if (!selectedDays) { e.preventDefault(); showValidation('Please select a rental duration (Weekly or Monthly) to continue.'); highlightDurationGrid(); return false; }
```

- [ ] **Step 4: `browse.ejs`, `index.ejs`, `upcoming-detail.ejs` price loops**

In `views/browse.ejs:86`, change `[10, 15, 30].forEach(d => {` to `RENTAL_DURATIONS.forEach(({ days: d }) => {` (read the surrounding ~10 lines first to confirm `d` is used the same way downstream — only the source of `d` changes, not how it's used).

In `views/index.ejs:275`, apply the same change: `[10, 15, 30].forEach(d => {` → `RENTAL_DURATIONS.forEach(({ days: d }) => {`.

In `views/index.ejs:424`, change:

```js
  const activeDurations = promo.enabled ? [10, 15, 30].filter(d => getPromoDiscountPct(promo, d) > 0) : [];
```

to:

```js
  const activeDurations = promo.enabled ? RENTAL_DURATIONS.map(d => d.days).filter(d => getPromoDiscountPct(promo, d) > 0) : [];
```

In `views/upcoming-detail.ejs:227`, apply the same change as browse.ejs: `[10, 15, 30].forEach(d => {` → `RENTAL_DURATIONS.forEach(({ days: d }) => {`.

- [ ] **Step 5: `index.ejs` marketing copy**

In `views/index.ejs:541`, change:

```html
        <p>Pick 10, 15, or 30 days — flexible pricing to fit your schedule.</p>
```

to:

```html
        <p>Pick Weekly or Monthly — flexible pricing to fit your schedule.</p>
```

- [ ] **Step 6: `ps-plus.ejs` price display**

In `views/ps-plus.ejs:88-121` (read the full block first — it's two mirrored groups, NT and TR, three `<span class="psplus-price-days">` each), change:

```html
            <span class="psplus-price-days">10 Days</span>
```
```html
            <span class="psplus-price-days">15 Days</span>
```
```html
            <span class="psplus-price-days">30 Days</span>
```

to `Weekly` / (delete the 15-day line and its price span entirely) / `Monthly`, for both the NT group (lines ~92-100) and the TR group (lines ~113-121), removing the middle (15-day) price row from each group's markup — including whatever price-value `<span>` sits alongside each of those three duration labels (read the exact surrounding markup to capture the paired price span, since only the label lines are shown in the grep excerpt).

- [ ] **Step 7: `ps-plus.ejs` client-side price row JS**

In `views/ps-plus.ejs:300-308`, change:

```js
       <div style="font-size:0.8rem;color:#ddd;">10 Days — <b style="color:#22c55e;">₱${p.nt10||0}</b></div>
       <div style="font-size:0.8rem;color:#ddd;">15 Days — <b style="color:#22c55e;">₱${p.nt15||0}</b></div>
       <div style="font-size:0.8rem;color:#ddd;">30 Days — <b style="color:#22c55e;">₱${p.nt30||0}</b></div>
```
```js
       <div style="font-size:0.8rem;color:#ddd;">10 Days — <b style="color:#ffc400;">₱${p.tr10||0}</b></div>
       <div style="font-size:0.8rem;color:#ddd;">15 Days — <b style="color:#ffc400;">₱${p.tr15||0}</b></div>
       <div style="font-size:0.8rem;color:#ddd;">30 Days — <b style="color:#ffc400;">₱${p.tr30||0}</b></div>
```

to:

```js
       <div style="font-size:0.8rem;color:#ddd;">Weekly — <b style="color:#22c55e;">₱${p.nt7||0}</b></div>
       <div style="font-size:0.8rem;color:#ddd;">Monthly — <b style="color:#22c55e;">₱${p.nt30||0}</b></div>
```
```js
       <div style="font-size:0.8rem;color:#ddd;">Weekly — <b style="color:#ffc400;">₱${p.tr7||0}</b></div>
       <div style="font-size:0.8rem;color:#ddd;">Monthly — <b style="color:#ffc400;">₱${p.tr30||0}</b></div>
```

Then find where `p.nt10`/`p.nt15`/`p.tr10`/`p.tr15` are populated (search `views/ps-plus.ejs` for `nt10:` or similar object-literal construction, likely built from `psplusPrices.nt_price_10d` etc. passed from the server) and change those source fields from `nt_price_10d`/`nt_price_15d` to `nt_price_7d`, dropping the 15d line, matching the field names Task 2 already changed server-side.

- [ ] **Step 8: `psplus-rent.ejs` duration grid, price-calc script, validation copy**

In `views/psplus-rent.ejs:94` and `:166`, change both occurrences of:

```html
<% [10, 15, 30].forEach(d => { const pct = promo.enabled ? ((promo.discounts && promo.discounts[d]) || 0) : 0; %>
```

to:

```html
<% RENTAL_DURATIONS.forEach(({ days: d, label: durLabel }) => { const pct = promo.enabled ? ((promo.discounts && promo.discounts[d]) || 0) : 0; %>
```

Read the markup immediately following each of these two lines (mirroring game-detail.ejs's duration button structure) and apply the same `<%= durLabel %>` substitution used in Step 1 above in place of a raw `<%= d %>` + "DAYS" pairing.

In `views/psplus-rent.ejs:271`, change:

```js
  [10, 15, 30].forEach(d => {
```

to (same client-side-array pattern as Step 2): add `<script>const RENTAL_DURATIONS = <%- JSON.stringify(RENTAL_DURATIONS.map(d => d.days)) %>;</script>` before this script block if not already present from a shared layout, then:

```js
  RENTAL_DURATIONS.forEach(d => {
```

In `views/psplus-rent.ejs:347`, change:

```js
    if (el) { el.textContent = '⚠️ Please select a rental duration (10, 15, or 30 days) to continue.'; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 4000); }
```

to:

```js
    if (el) { el.textContent = '⚠️ Please select a rental duration (Weekly or Monthly) to continue.'; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 4000); }
```

- [ ] **Step 9: `rent-modal.ejs` partial**

In `views/partials/rent-modal.ejs:25-49` (read the full block — it mirrors the ps-plus.ejs NT/TR duration-label pattern), change the three `10 Days`/`15 Days`/`30 Days` `<span>` labels in each of the two groups (NT and TR) to `Weekly`/`Monthly`, removing the 15-day row from each group, same as Step 6.

- [ ] **Step 10: `how-it-works.ejs` marketing copy**

In `views/how-it-works.ejs:38`, change:

```html
        <p>Browse our full game list and find the PS5 or PS4 title you want to play. Each listing shows the available slots, rental prices for 10, 15, and 30 days, and whether a Trophy Account is included.</p>
```

to:

```html
        <p>Browse our full game list and find the PS5 or PS4 title you want to play. Each listing shows the available slots, rental prices for Weekly and Monthly durations, and whether a Trophy Account is included.</p>
```

In `views/how-it-works.ejs:81`, change:

```html
              <span>Choose 10 days, 15 days, or 30 days</span>
```

to:

```html
              <span>Choose Weekly or Monthly</span>
```

- [ ] **Step 11: EJS tag-balance check on every file touched in this task**

Run: `for f in views/game-detail.ejs views/browse.ejs views/index.ejs views/ps-plus.ejs views/psplus-rent.ejs views/upcoming-detail.ejs views/partials/rent-modal.ejs views/how-it-works.ejs; do echo "$f: open=$(grep -o '<%' $f | wc -l) close=$(grep -o '%>' $f | wc -l)"; done`
Expected: each file's `open` count equals its `close` count.

- [ ] **Step 12: Commit**

```bash
git add views/game-detail.ejs views/browse.ejs views/index.ejs views/ps-plus.ejs views/psplus-rent.ejs views/upcoming-detail.ejs views/partials/rent-modal.ejs views/how-it-works.ejs
git commit -m "$(cat <<'EOF'
Update public pages to Weekly/Monthly rental durations

Game detail, browse, homepage, PS Plus pages, upcoming-detail, and
the rent-modal partial all switch their duration pickers and price
displays from 10/15/30-day loops to RENTAL_DURATIONS (Weekly/
Monthly). Updates validation copy and marketing copy to match.
EOF
)"
```

---

### Task 7: Update bot reply copy

**Files:**
- Modify: `server.js:2641` (how-to-rent reply)
- Modify: `server.js:2827` (sell/buy reply price hint)
- Modify: `server.js:2873` (bot training system prompt)

**Interfaces:**
- Consumes: nothing structural — plain string literals.
- Produces: nothing new.

- [ ] **Step 1: Update the how-to-rent bot reply**

In `server.js:2641`, change:

```js
      '𝟯. Choose rental duration\n' +
      '   ⏱ 10 days | 15 days | 30 days\n\n' +
```

to:

```js
      '𝟯. Choose rental duration\n' +
      '   ⏱ Weekly | Monthly\n\n' +
```

- [ ] **Step 2: Update the sell/buy reply's duration hint**

In `server.js:2827`, change:

```js
    msg += `(10 / 15 / 30 days)\n`;
```

to:

```js
    msg += `(Weekly / Monthly)\n`;
```

- [ ] **Step 3: Update the bot training system prompt**

In `server.js:2873`, change:

```
- Rent PS5/PS4 games for 10, 15, or 30 days
```

to:

```
- Rent PS5/PS4 games for Weekly or Monthly durations
```

- [ ] **Step 4: Syntax-check**

Run: `node -c server.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "$(cat <<'EOF'
Update Messenger bot copy to Weekly/Monthly durations

How-to-rent reply, sell/buy price hint, and the bot's own system
prompt all describe Weekly/Monthly instead of 10/15/30-day rentals.
EOF
)"
```

---

### Task 8: Deploy and verify live

**Files:** none (deploy + verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-7.

- [ ] **Step 1: Confirm no concurrent session is editing the live database**

Before pushing, explicitly ask the user to confirm no other Claude Code session, browser tab, or admin panel is actively editing games/prices on the live site right now — this deploy's server-start migration writes to `games`, `price_categories`, `psplus_prices`, `upcoming`, and `site_settings.promo.discounts`. Do not proceed to Step 2 without an explicit yes.

- [ ] **Step 2: Push to trigger the Railway deploy**

```bash
git push origin main
```

- [ ] **Step 3: Wait for the deploy and confirm the site is up**

Run: `until curl -s -o /dev/null -w "%{http_code}" https://playstation-hub.com/ | grep -q 200; do sleep 5; done; echo done`
Expected: prints `done` once the homepage returns HTTP 200 (Railway deploys typically land within ~60-90 seconds).

- [ ] **Step 4: Verify the price migration landed correctly**

Run: `curl -s https://playstation-hub.com/feed/meta-catalog.csv -o /tmp/feed-verify.csv && awk -F'","' 'NR>1 && $15!="Permanent"{gsub(/"$/,"",$16); print $13"|"$15"|"$16"|"$7}' /tmp/feed-verify.csv | sort -u`

Expected output: exactly 16 lines (4 price categories × 2 durations × 2 account types), each showing "Weekly" or "Monthly" as the duration (not "10 Days"/"15 Days"/"30 Days"), and the Weekly price for each tier matching the tier's old 10-day price (Regular 249/299, Special 299/349, Deluxe 349/399, New Games 399/499), with Monthly prices unchanged from before (Regular 499/549, Special 549/599, Deluxe 599/699, New Games 699/799).

- [ ] **Step 5: Verify the public game detail page**

Use the Browser tool: navigate to `https://playstation-hub.com/game/<any-live-game-slug>` (pick one from the feed CSV, e.g. the first `link` column value), take a screenshot, and confirm the duration picker shows exactly two buttons labeled "Weekly" and "Monthly" (not three, not showing "10"/"15"/"30"), and that clicking each populates a price.

- [ ] **Step 6: Verify the admin price category and PS Plus prices forms**

Log into `/admin` (password from project context), open the Games tab's Price Categories section, and confirm each category card now shows two price columns (Weekly/Monthly) instead of three. Open the PS Plus tab's prices form and confirm the same two-column layout.

- [ ] **Step 7: Verify the promo discount form**

In the admin Settings/Promo section, confirm the discount inputs show "Weekly Discount %" and "Monthly Discount %" (no 15-day input), and that saving a value round-trips correctly (set a test value, save, reload, confirm it persisted).

- [ ] **Step 8: Spot-check the homepage and PS Plus public pages**

Use the Browser tool to load `/`, `/browse`, and `/ps-plus`, confirming no page shows a "15 Days" price row or a broken/empty price where the old middle column used to be, and no layout looks visually broken (extra empty grid cell, misaligned columns) from the removed middle duration.

- [ ] **Step 9: Report results to the user**

Summarize what was verified in Steps 4-8, and flag anything that didn't match expectations before considering this plan complete.
