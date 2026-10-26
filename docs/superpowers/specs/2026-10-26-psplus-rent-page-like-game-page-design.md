# PS Plus Deluxe rent page, laid out like a game page — Design

Date: 2026-10-26 · Status: approved by owner (approach A)

## Problem

`/ps-plus/rent` (views/psplus-rent.ejs + public/js/psplus-rent.js) is an old
template that missed the game page redesign. Next to a game page (for example
/game/marvels-wolverine) it is missing several things:

- the hero banner;
- the framed booking panel;
- the type pills with slot status;
- "How setup works";
- the Messenger-first button with its "YOUR MESSAGE WILL SAY" preview;
- the "Or order here on the website" fold;
- the phone sticky bar.

The owner wants it to look and work the same as the game pages.

## Decision (approach A)

Rebuild `views/psplus-rent.ejs` from the game page's own building blocks:
the same markup, classes and element ids as `views/game-detail.ejs`. Then run
it with the game page's own script, **`public/js/game-detail.js`, unchanged**,
so the two pages can't drift apart again. `public/js/psplus-rent.js` and its
extraction test retire.

What PS Plus keeps of its own:

- **Checkout:** the form posts to `/order/create-psplus`, with the same
  `account_type`, `days` and `fb_name` fields.
- **Prices:** from `getPsplusPrices()`.
- **Waiting line:** queue and "get in line" orders use `game_id 'psplus'`.
- **Account types:** two types, Trophy / PS4 Primary (`tr`) and Non-Trophy
  (`nt`). The ₱100 deposit applies to `tr` only, as now.

Normal game pages are not touched.

## The page

- **Hero** (same `usd-hero gdh-hero` block as games):
  - Badges: a status badge (Available / Last Slot / Sold Out, by the same rule
    as games), then chips `SUBSCRIPTION`, `DELUXE` and `PS4/PS5`.
  - Title: `PS Plus Deluxe`.
  - Bar text, using the game page's rule: `Sold out — all slots rented`,
    `Only 1 slot left`, else `<n> slots available`. PS Plus has no release
    date.
  - The site logo on the right.
- **Left column** (`gd-cover-col`):
  - the PS Plus cover, using the catalogue row's `cover_image` with the
    existing gold fallback tile, and the `PS4/PS5` badge;
  - **About this subscription:** the swap line (`partials/swap-line`) and
    "Access hundreds of games including monthly titles. Trophy or Non-Trophy —
    your choice."
  - **Info** table, in the same style as GAME INFO:
    - Platform: PS4 / PS5
    - Game swaps: Unlimited · 2-day cooldown
    - Games: Hundreds, including monthly titles
    - Catalogue: "See all games →" (`/ps-plus`)
- **Right column**, the framed booking card (`gdh-card`):
  - No Rent / Buy Permanent toggle; PS Plus is rent only.
  - Price header, starting "From ₱<cheapest weekly>".
  - **Pills:**
    - 🏆 Trophy / PS4 Primary and 🎮 Non-Trophy, as `gd-type-card gd-type-pill`
      with a hidden `gd-type-radio`.
    - Each shows "N slots left" or "Full Slot", plus "Available in N days"
      under a full type when the PS Plus catalogue row's accounts know it.
  - **How setup works:** the game page's Trophy text for `tr` and Non-Trophy
    text for `nt`.
  - **Duration cards:** Weekly and Monthly, with the promo badge.
  - **Messenger button:** "💬 Message us about this game", with the message
    preview. The message reads:
    - "Game: PS Plus Deluxe"
    - the type
    - the duration
    - "Total: ₱<rent> + ₱100 refundable deposit"
  - **"Or order here on the website"** opens the summary, the Facebook name
    field and the Rent button. The form posts to `/order/create-psplus`.
  - **When the picked type is full, or every type is:** the same "get in line"
    card games use (`partials/queue-line` + `partials/noslot-options`,
    `variant: 'card'`), for `game_id 'psplus'`.
- **Phone:** the game page's sticky bottom bar.

## Data the template needs

`GET /ps-plus/rent` already passes `prices`, `slots`, `psplusCover`, `promo`,
`queues` and `order_error`. It adds:

- **`nextDays` (`{ tr, nt }`):** days until each type frees up, from
  `computeAvailability(psplusGame, accountSummary)` `trNext` / `ntNext` when the
  catalogue row exists, else `null`.
- **The globals game-detail.js reads**, written inline like the game page:
  - `PRICES { nt, tr }` from the PS Plus prices; there is no `ps4`.
  - `BUY_PRICES { nt: 0, tr: 0 }`.
  - `PROMO`.
  - `AVAIL { nt, tr, ps4: false }`.
  - `ALL_UNAVAIL`.
  - `NEXT_DAYS { tr, nt, ps4: null }`.
  - `gameTitle = 'PS Plus Deluxe'`.
  - `gdSlideCount = 0`.

## Unchanged

- **Checkout:** `/order/create-psplus`, the `psplus` queue, prices, slots, the
  deposit rule and the order page.
- **The rest of PS Plus:** `/ps-plus`, the catalogue, SEO (`/ps-plus/rent`
  keeps its own canonical), and the tile links from the last change.
- **Game pages:** `views/game-detail.ejs` and `public/js/game-detail.js` are not
  edited.

## Testing

Throwaway instance only: a temp `DATA_DIR`, a blank `MONGODB_URI` and made-up
games.

- **Route test on `/ps-plus/rent`:**
  - The hero badges and title, and the bar text for the open, last-slot and
    sold-out cases.
  - The left About and Info, with the link to `/ps-plus`.
  - The card has no toggle and no buy panel.
  - Two pills with hidden radios, their slot status, and "Available in N days".
  - The setup guide.
  - The duration cards.
  - The Messenger button and preview container.
  - The order fold, with its form posting to `/order/create-psplus`.
  - The get-in-line card with `game_id 'psplus'` when a type or every type is
    full.
  - The sticky bar.
  - It loads `messenger-text.js` and `game-detail.js`, not `psplus-rent.js`.
- **Script test:** run the real `game-detail.js` in a vm with the PS Plus
  globals and the page's element ids, and check that:
  - picking Trophy, then Weekly, previews "Game: PS Plus Deluxe … Total: ₱<rent>
    + ₱100 refundable deposit";
  - Non-Trophy has no deposit;
  - the order button enables.
- **Existing tests:**
  - Retire `scripts/test-js-extraction-psplus-rent.js` along with
    `psplus-rent.js`.
  - In `scripts/test-game-detail-messenger.js`, change the "keeps its classic
    layout" case to the new card layout.
- A browser check at 1280px and 375px.
- The full suite stays green except the known
  `scripts/test-upcoming-psn-page-public.js`.

## Out of scope

- A Buy option for PS Plus.
- A PS4 Primary pill of its own; it stays part of Trophy.
- Any change to normal game pages.
- PS Plus gameplay media or a gallery.

## Rollout

Direct on `main`, pushed when the owner says push.
