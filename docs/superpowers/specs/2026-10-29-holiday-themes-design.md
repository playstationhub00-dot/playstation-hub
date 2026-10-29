# Holiday themes (Halloween, Christmas) — Design

Date: 2026-10-29 · Status: approved by owner

## Goal

The owner can dress the public site for a holiday — **Halloween** or
**Christmas** — from Admin → Settings, and switch it off again.

## Decisions (owner)

- **Switch:** chosen by hand in Admin → Settings: None / Halloween / Christmas.
  It stays on until changed; nothing turns on by date.
- **Strength:** "Festive" (option B of the mockups):
  - holiday colours on buttons, links and price highlights;
  - a darker holiday tint in the header and footer;
  - a thin holiday-coloured outline on game covers;
  - a small 🎃 / 🎄 beside the logo;
  - a few slowly drifting bats (Halloween) or snowflakes (Christmas).
- **Where:** public pages only. The admin panel never shows a theme.
- **Banner text:** the existing announcement bar keeps its text; the theme
  only recolours it.

## How it works

- **Setting:** `site_settings.theme` is `''`, `'halloween'` or `'christmas'`.
  - Any other value is treated as `''`.
  - A missing value is `''`, so the site looks as it does today.
- **Saving:** a small form in Admin → Settings posts to
  `POST /admin/settings/theme` (admin only) and redirects back with a toast
  ("Theme saved").
- **Loading:** `views/partials/head.ejs`, which every public page uses, does
  this when a theme is set:
  - adds `<link rel="stylesheet" href="/css/theme-<name>.css?v=<assetV>">`;
  - marks the page with `<html data-theme="<name>">`, set by one inline line
    before the page paints, so no page template changes.
  - The admin pages don't load the theme.
- **Styles:** each theme is its own file,
  `public/css/theme-halloween.css` and `public/css/theme-christmas.css`.
  - Every rule is scoped to `html[data-theme="<name>"]`, and they only add on
    top of `style.css`, so "None" leaves the site exactly as it is.
  - Light mode gets lighter holiday shades.
- **Animation:**
  - It's CSS only (no script, no images to download), drawn in a fixed layer
    behind the content with `pointer-events: none`, so it never blocks a
    click.
  - It's off under `prefers-reduced-motion: reduce`.
  - Phones get fewer, smaller pieces.
- **Colours:**
  - Halloween: orange `#f97316` with purple `#7c3aed`.
  - Christmas: red `#dc2626` with green `#16a34a` and white snow.
  - Text on coloured buttons keeps readable contrast.

## Not changing

Prices, slots, orders, the checkout, the announcement text, the admin panel,
and SEO.

## Testing

Throwaway only: a temp `DATA_DIR`, a blank `MONGODB_URI`, the in-memory
session store and a made-up admin password.

- **Route test:**
  - saving each theme stores it;
  - a bad value stores `''`;
  - a public page (home, a game page, `/ps-plus/rent`) carries
    `data-theme` and the right stylesheet;
  - with `''` it carries neither;
  - the admin page never carries them;
  - saving refuses anyone not logged in.
- **CSS check:**
  - both theme files scope every rule under their `html[data-theme=…]`;
  - both have a `prefers-reduced-motion` rule that stops the animation.
- **Browser check** on a throwaway instance:
  - each theme at 1280px and 375px, in dark and light mode;
  - clicks still work through the animation layer;
  - no sideways scroll;
  - no console errors.
- **Full suite** stays green except the known
  `scripts/test-upcoming-psn-page-public.js`.

## Out of scope

- Turning on by date.
- More holidays (Valentine's, New Year) — easy to add later as more theme
  files.
- Themed hero images or game art.
- Music or sound.

## Rollout

Direct on `main`, pushed when the owner says push. The theme starts as None,
so nothing changes until the owner picks one.
