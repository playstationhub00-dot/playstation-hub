# Per-game discounts — Design

Date: 2026-10-06 · Status: draft for owner review

## Problem

The rent promo is one site-wide setting: `site_settings.promo = { enabled, discounts: { 7: pct, 30: pct }, deposit, … }`.
Every game gets the same Weekly % and Monthly %. The owner wants some games to carry a
different discount — for example 20% off Monthly on a handful of games while the rest stay
on the site promo (today 10% Monthly).

## Decisions made with the owner

- **Where to set it:** one "Game discounts" table in Admin → Settings → Promo & pricing,
  every game listed with a Weekly % and a Monthly % box (option B).
- **Replace, never stack:** a game's own % replaces the site promo for that duration
  (20% means 20%, not 10% + 20%).
- **Empty box = site promo; 0 = no discount** for that game and duration.
- **Independent of the site promo switch:** game discounts keep working when "Enable Rent
  Promo Discount" is off.
- **No end date:** a game discount stays until the owner clears the box.
- **Rent only:** Weekly and Monthly. Buying keeps the site-wide buy promo.
- **Customers find the deals:** each game shows its own "% OFF" wherever prices show, and
  the homepage gets a "🔥 Special deals" row of games whose own % beats the site promo.

## Out of scope

- The PS Plus Deluxe rent page (`/ps-plus/rent`) and its orders — they price from their own
  PS Plus settings and keep the site promo.
- Buy (permanent) discounts per game, discount end dates, discount groups.
- The site search index's "from ₱" figure, which has never applied any promo.
- Messenger bot promo text and the homepage promo ladder ("Rent Longer. Save More"), which
  describe the site promo.
- Rentals already made: their stored prices never change.

## Data

Each game may carry:

```
game.discounts = { 7: number | null, 30: number | null }
```

- Missing object, missing key, `null` → that duration follows the site promo.
- A number 0–100 → that game's discount for that duration (0 = none).
- Stored on the game in lowdb `games.json` like every other game field. No migration:
  existing games have no `discounts` and keep today's behaviour.

## The rule (one helper)

New `lib/game-discount.js` (pure, unit-tested):

- `discountPct(game, days, promo)` → the % to apply to `game` for `days`:
  the game's own number when set (0–100, integers), otherwise the site promo's % for that
  duration (0 when the site promo is off or has none).
- `hasOwnDiscount(game, days)` → whether the game overrides that duration.
- `specialDeal(game, promo)` → `{ days, pct }` for the duration where the game's own %
  most exceeds the site promo's % (Monthly wins a tie), or `null` when no own % beats it.
  Drives the homepage row and the deal ribbon.
- `cleanInput(raw)` → `null` for an empty box, an integer clamped to 0–100 otherwise
  (non-numbers → `null`).

`server.js` keeps `getPromoDiscountPct(promo, days)` for things that describe the site
promo, and every place that prices **a specific game's rental** switches to
`discountPct(game, days, promo)`. Exposed to views as `app.locals.gameDiscountPct`.

### Where it applies (every game-priced rental figure)

Server:
- `promotedTier` (used by `computeRentPricing` and `extendTierFor`) — website orders priced
  by `computeRentPricing`, Quick Add, the admin Messenger-order form, and the Extend
  preview and save.
- `POST /order/create` (website rental order), `POST /order/reserve` (fall in line /
  priority totals), `priorityUpgradePatch` (looks the game up from the order).
- `computeSwapReferencePrice` (game swap pricing on the customer edit page).
- `/feed/meta-catalog.csv` rental rows (sale price per game).
- `buildPostersView` / poster "From ₱X" per game (Weekly).
- Quick Add's preview data (`qaGames`), so the promo/full-price preview matches the save.

Views (all already have the game in scope):
- `views/partials/game-card.ejs` (browse, homepage sliders, search-free card grids).
- `views/game-detail.ejs` — the "from" price, the duration buttons' "% OFF" tag and the
  inline `PROMO.discounts` the page script prices with (it receives the game's effective
  Weekly and Monthly %).
- `views/browse.ejs` and `views/index.ejs` category "price starts at" figures, the homepage
  hero card and the spotlight card.
- The homepage rent modal (opened from a game card) — the card passes the game's effective
  Weekly and Monthly % alongside its prices, so the modal quotes the same number as the
  game page.
- `views/edit-customer.ejs` swap box — each game option carries its effective Weekly and
  Monthly %, so the box shows the same number the server records.

### Quick Add "Full price"

"Full price" turns off **all** discounts, the game's own included (it already turns off the
site promo). Implemented by passing an explicit "no discounts" flag through
`computeRentPricing` rather than relying on `promo.enabled`, because game discounts ignore
that switch.

## Admin — "Game discounts" table

Admin → Settings → Promo & pricing, below the existing rent-promo form, as its own form:

- Heading "Game discounts" with one line: "Site promo: Weekly X% · Monthly Y% (on|off).
  Empty box = site promo · 0 = no discount."
- A search box (filters rows by title) and a checkbox "Only games with their own %".
- One row per game, A–Z: title, Weekly % box, Monthly % box, and next to Monthly the
  Non-Trophy monthly price a customer will pay (updates as you type).
- "Save game discounts" → `POST /admin/promo/game-discounts` (requireAuth). Fields
  `d7_<gameId>` and `d30_<gameId>`; each goes through `cleanInput`; an all-empty game has
  its `discounts` removed. Redirects back with toast "✅ Game discounts saved".
- The admin Games list shows a small tag on games with their own %, e.g. "🏷️ 20% monthly".

## Homepage — "🔥 Special deals" row

- Shown only when at least one game has `specialDeal(game, promo)`; hidden otherwise.
- Placed after the "New releases" row (before "Most Popular").
- Uses the standard game card. On top of the card a ribbon reads "20% OFF · Monthly"
  (from `specialDeal`), and the card's price line shows that duration's discounted price
  ("Monthly ₱639", crossed-out base beside it).
- Up to 12 games, biggest % first, then title.

## Error handling

- Invalid inputs never break a save: non-numbers become "use site promo", numbers are
  clamped to 0–100.
- A game deleted after being discounted simply drops out; its stored `discounts` goes with it.
- A discount can never push a price below ₱0 (same rounding as today:
  `base - round(base * pct / 100)`).

## Testing

All tests use fixtures, a temp `DATA_DIR` and a blank `MONGODB_URI`; nothing touches the
project's `games.json`, the database or the real admin.

- `scripts/test-game-discount.js` — `discountPct` (own %, empty, 0, site promo on/off,
  duration without a site %), `hasOwnDiscount`, `specialDeal` (beats / ties / never beats,
  Monthly wins ties), `cleanInput`.
- `scripts/test-game-discount-pricing.js` — boots a throwaway instance with one game at
  20% Monthly and one on the site promo: the game page's `PROMO.discounts`, card prices,
  `computeRentPricing` through Quick Add (promo and full price), swap reference, extend
  tier, meta-feed sale price and poster "from" price all use 20% for the first game and
  10% for the second; with the site promo off, the first stays 20% and the second goes to
  full price.
- `scripts/test-game-discount-admin.js` — the table renders every game with its values,
  the save route stores/clears/clamps values, needs the admin login, and the Games list tag
  appears.
- Homepage: the deals row appears only when a game beats the site promo, with the right
  ribbon and price, and is absent otherwise.
- Existing pricing tests stay green (`test-rent-pricing.js`, `test-buy-pricing.js`,
  `test-order-reserve-promo.js`, game page and Quick Add tests); the full suite stays green
  except the known `scripts/test-requests-page.js`.

## Rollout

Direct on `main`, pushed when the owner says push. Nothing changes until the owner types a
% in the table. Verification on throwaway instances only.
