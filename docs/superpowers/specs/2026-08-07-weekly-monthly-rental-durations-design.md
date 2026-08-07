# Weekly/Monthly Rental Durations

Date: 2026-08-07
Status: Approved

## Problem

The site currently offers three rental durations — 10, 15, and 30 days — stored as
`nt_price_10d`/`nt_price_15d`/`nt_price_30d` (and `tr_price_*`) across four
collections: `games`, `price_categories`, `psplus_prices`, `upcoming`. We're
switching to two durations: **Weekly** and **Monthly**.

## Decisions

- Weekly = 7 days. Monthly = 30 days (unchanged from today's 30-day tier).
- Weekly price seeds from the current 10-day price (same number, shorter period —
  a real per-day price increase, made knowingly).
- PS Plus rentals move to the same two durations (`psplus_prices`, `/ps-plus`,
  `/psplus-rent`) — one consistent duration story sitewide, not two systems.
- Durations stay hardcoded, not admin-editable, but centralized into a single
  constant so a future change is a one-line edit instead of a repo-wide hunt.

## Approach

Keep the existing `{type}_price_{N}d` field-naming convention and change `N` from
`10/15/30` to `7/30`, rather than renaming fields semantically or moving to a
nested price object. Six call sites build these keys dynamically
(e.g. `` resolved[usingType + '_price_' + d + 'd'] ``, `` g[`nt_price_${d}d`] ``) —
keeping the convention means those call sites need no change at all. The 30-day
side of the migration is already done, since 30-day data is untouched.

Rejected: renaming to `nt_price_weekly`/`nt_price_monthly` (breaks every dynamic
key lookup, full rewrite for no functional gain) and a nested `prices: {nt: {7:..,
30:..}}` object (cleanest on paper, but rewrites every read site and adds risk to
the lowdb→MongoDB sync for a change that doesn't need it since durations aren't
admin-editable).

## Data model

### New constant (server.js, near the top, exported via `app.locals`)

```js
const RENTAL_DURATIONS = [
  { days: 7,  label: 'Weekly',  sub: '1 Week'  },
  { days: 30, label: 'Monthly', sub: '1 Month' },
];
const PROMO_DURATIONS = RENTAL_DURATIONS.map(d => d.days); // [7, 30]
app.locals.RENTAL_DURATIONS = RENTAL_DURATIONS;
```

Every hardcoded `[10, 15, 30]` loop (server.js:944 Meta feed; browse.ejs:86;
index.ejs:275,424; game-detail.ejs:200,479; psplus-rent.ejs:94,166,271;
upcoming-detail.ejs:227) becomes `RENTAL_DURATIONS.forEach(({days: d}) => ...)`
or `.map(d => d.days)` where only the day list is needed. `PROMO_DURATIONS`
replaces its current `[10, 15, 30]` literal at server.js:569.

### Migration (extends the existing per-game migration block at server.js:96)

For `games`, `price_categories`, `psplus_prices`, and `upcoming`, wherever
`*_price_7d` is undefined, seed it from the existing `*_price_10d` (falling back
to the same defaults the current code already uses when `10d` itself is
missing). `*_price_30d` needs no migration — it's already correct. Old `10d`/
`15d` fields are left in place, unread, so a rollback is a pure code revert with
no data restore needed.

Seeded values (current 4 price categories, Weekly = current 10-day price,
Monthly = current 30-day price, unchanged):

| Tier | Weekly NT/TR | Monthly NT/TR |
|---|---|---|
| Regular | 249 / 299 | 499 / 549 |
| Special | 299 / 349 | 549 / 599 |
| Deluxe | 349 / 399 | 599 / 699 |
| New Games | 399 / 499 | 699 / 799 |

### Promo discounts (`site_settings.promo.discounts`)

Keyed object changes from `{10, 15, 30}` to `{7, 30}`. Migration seeds `7` from
the existing `10` value. Admin promo form (admin.ejs:360-372) drops the 15-day
input, relabels 10-day → Weekly, 30-day → Monthly.

### Customer records (`customers[].days`)

No schema change — `days` is already a raw integer, so rental history stays
accurate as-is (a past 15-day rental keeps `days: 15` and is simply no longer a
selectable option going forward). The admin add/edit customer duration
`<select>` (edit-customer.ejs:73-76, admin.ejs's inline equivalent) offers
Weekly (7) / Monthly (30) / Custom, replacing the 10/15/30/Custom options. The
existing "is this a standard duration or custom" check
(`customer.days !== 10 && customer.days !== 15 && customer.days !== 30`)
becomes `!PROMO_DURATIONS.includes(customer.days)`, so pre-existing 10- and
15-day customer records correctly fall into "Custom: N days" display rather
than matching neither button. The `days === 'custom' ? ... : (parseInt(days) ||
10)` default at server.js:1739,1807 changes its fallback from `10` to `7`.

## UI changes

- **Admin → Price Categories** (admin.ejs:866-872, 913-919, 989-995): 3 duration
  columns → 2, relabeled "Weekly" / "Monthly" instead of "10 Days" / "15 Days" /
  "30 Days".
- **Admin → per-game price override** (admin.ejs:1203-1215): same column
  reduction.
- **Admin → PS Plus prices** (admin.ejs:1339-1345): same.
- **Admin → games table** price display (admin.ejs:1124-1125, 1251-1254):
  "10/15/30" summary becomes "Weekly/Monthly".
- **Admin → customer add/edit duration select**: Weekly/Monthly/Custom, per
  above.
- **Public game detail page** duration picker (game-detail.ejs:199-207): 3
  buttons → 2, sourced from `RENTAL_DURATIONS` instead of a literal array.
- **Public browse, index (New Releases/Most Popular cards), ps-plus,
  psplus-rent, upcoming-detail, rent-modal partial**: all duration-driven price
  displays switch from the 3-value array to the 2-value constant.
- **Meta catalog feed** (server.js:903-969): loop changes from `[10,15,30]` to
  `RENTAL_DURATIONS`; `durLabel` becomes "Weekly"/"Monthly" instead of "N Days".
  Product IDs are duration-derived (`ph-{id}-nt-{d}d`), so on the next sync
  ~127 existing 10/15-day product IDs retire and ~127 new 7-day IDs appear, and
  all 15-day rows disappear entirely. Acceptable at this stage — flagged so it's
  not a surprise if a Meta ad was pinned to a specific retiring product ID.

## Copy changes

Plain-text mentions of "10, 15, or 30 days" get rewritten to "Weekly or Monthly"
(or "7 or 30 days" where the button/label context already makes the framing
clear):

- server.js:53, :521 — hero subtitle **default** value only. The hero subtitle
  is also stored in `site_settings` and currently live-serving text that
  matches this same default. A targeted one-time migration checks if the stored
  subtitle still exactly matches the old default string and, if so, rewrites it
  to the new copy — otherwise leaves it alone (don't overwrite an admin's
  custom subtitle).
- server.js:2641 (how-to-rent bot reply), :2827, :2873 (other bot replies)
- how-it-works.ejs:38, :81
- index.ejs:541
- game-detail.ejs:536, :549 (validation messages)
- psplus-rent.ejs:347 (validation message)

## Out of scope

- Admin-editable custom durations (rejected in favor of a hardcoded, centralized
  constant — see Decisions).
- Removing the now-unused `10d`/`15d` fields from the database. Left in place
  post-migration for a clean rollback path; a follow-up cleanup can drop them
  once the change has been live and stable for a while.
- Any change to how `customers[].days` (a raw integer, already supports
  arbitrary custom values) is stored.

## Rollout

Before deploying: confirm no other session/browser is actively editing
`games.json` live data (a prior incident this session showed signs of a second
concurrent editor), since this migration writes to `games`, `price_categories`,
and `psplus_prices`.
