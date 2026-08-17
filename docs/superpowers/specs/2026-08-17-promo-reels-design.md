# Promo Reels — Design

**Date:** 2026-08-17
**Status:** Approved

## What this is

Two 9:16 vertical promo reels for Facebook Reels / TikTok / Stories, built as
self-contained animated HTML pages served from `public/promo/`.

**Reel 1** (~25s) is a hype promo: what the site is, what's new, the current promo,
and a call to action. **Reel 2** (~78s) is a tutorial: how to rent, then how to buy.

They are separate because they do different jobs. A promo has roughly three seconds
to stop a thumb and should stay under 30 seconds. A tutorial is watched by someone
already interested and needs time to actually teach two distinct flows. Combined,
the result is too long to hook and too rushed to teach.

## Capability boundary

No video file is produced by this work, and no audio.

The reels are HTML pages that animate. Recording them is a manual step, and the
scripts below are copy to be read or captioned, not generated speech. Music and
voiceover are added afterwards in an editor such as CapCut.

## How they get recorded

The reels live under `public/promo/`, which `express.static`
(`server.js:332`) already serves. After deploy they are reachable at:

- `https://playstation-hub.com/promo/reel-1.html`
- `https://playstation-hub.com/promo/reel-2.html`

**Record on a phone.** A phone screen is already 9:16, so the reel fills it at
native resolution and the built-in screen recorder captures it with no cropping,
letterboxing, or desktop scaling softness. Open the URL, tap the replay button,
record.

Each reel includes a replay control so takes can be repeated without reloading.

## Reel 1 — Promo (~25s)

Designed graphics over real game cover art pulled from the live `/uploads/` paths.

| Time | Scene | On-screen |
|---|---|---|
| 0–3s | Hook | `PS5 GAMES.` / `₱199 LANG.` |
| 3–8s | What it is | `55+ games. Digital lahat.` / `Walang disc. Walang meetup.` |
| 8–14s | What's new | `BAGO: Account Bundles` — `12 games from ₱299` / `BAGO: Buy Permanent` — `Sa'yo na habambuhay` |
| 14–19s | Promo | `30 DAYS RENT = 10% OFF` / `Automatic sa checkout — walang code` |
| 19–25s | CTA | `playstation-hub.com` / `GCash · Maya · QR Ph` / `Message us sa Messenger` |

**Voiceover script (Taglish):**

1. "PS5 games. ₱199 lang."
2. "55+ na games, puro digital. Walang disc, walang meetup — minutes lang, laro ka na."
3. "Bago ngayon: account bundles — 12 games sa isang account, from ₱299. At pwede ka na ring bumili permanent. Sa'yo na 'yon habambuhay."
4. "Mag-30 days ka, 10% off agad. Automatic, walang code."
5. "Punta na sa playstation-hub dot com. GCash, Maya, QR Ph — okay lahat."

Every claim above is taken from the live site: the ₱199 starting price and 55+ game
count from the homepage stats bar, the 10% off 30-day promo from the hero line, and
the payment methods from the hero badges.

## Reel 2 — How-to (~78s)

Live, non-interactive `<iframe>`s of the real site at a 390×844 scale, with
animated tap indicators and callout arrows layered on top — not static screenshots
and not recreated UI. An iframe of the actual live page is the real thing, not a
copy of it, at the moment the reel is recorded; a screenshot would go stale the
next time a price or a game changes, and no tool in this build produces a savable
image file to embed one anyway. Viewers still see the exact buttons they'll be
tapping — more precisely than a screenshot would, since it's literally the same
page.

Each iframe sets `pointer-events: none` so screen-recording taps land on the
overlay's tap-indicator animation, never on the live site underneath.

| Time | Step | On-screen |
|---|---|---|
| 0–5s | Title | `Paano mag-rent at bumili` |
| 5–11s | Rent 1 | `Buksan playstation-hub.com → tap RENT` |
| 11–17s | Rent 2 | `Pumili ng game` |
| 17–24s | Rent 3 | `Piliin: Trophy o Non-Trophy` |
| 24–30s | Rent 4 | `7 days o 30 days` |
| 30–36s | Rent 5 | `Ilagay FB name mo → tap Rent` |
| 36–42s | Rent 6 | `Bayad via GCash o Maya → upload screenshot` |
| 42–48s | Rent 7 | `Ipapadala namin ang account. Laro na!` |
| 48–54s | Buy 1 | `Gusto mo permanent? Tap BUY` |
| 54–60s | Buy 2 | `Naka-group by price — ₱499 hanggang ₱2,499` |
| 60–66s | Buy 3 | `Pumili ng game → Buy Permanent` |
| 66–72s | Buy 4 | `Piliin Non-Trophy o Trophy → bayad` |
| 72–78s | CTA | `Sa'yo na habambuhay.` / `playstation-hub.com` |

### Live pages versus designed graphics — and why the split

Browsing and selection steps embed the real, live site. **Payment and confirmation
steps use designed graphics instead.**

The reason is customer privacy. A real order status page carries an order reference
and the customer's Facebook name. Displaying one — live or as a screenshot — in a
promo video would expose a real person's data. Those two steps (Rent 6 and Rent 7)
are therefore rendered as designed panels — GCash and Maya marks, an upload
affordance, a generic confirmation — with no real order data anywhere.

No test order is created for this work either. Creating one would write a real
record into the production order queue, and a scripted iframe has no way to fill
and submit the order form on the customer's behalf regardless.

Live pages to embed (none contain customer data), and the step each one serves:

| # | URL | Serves |
|---|---|---|
| 1 | `/` | Rent 1 |
| 2 | `/browse` | Rent 2 |
| 3 | `/game/<any live rentable slug>` | Rent 3, Rent 4, Rent 5 |
| 4 | `/buy` | Buy 1, Buy 2 |
| 5 | `/game/<any live game with a buy price>?mode=buy` | Buy 3, Buy 4 (tier selection only) |

Steps 3–5 within Rent and Buy each reuse one embedded page, scrolled or with a
different area highlighted per step by the overlay — not five separate iframes —
since the game detail page already carries both its rent and buy panels together.

The remaining steps are designed graphics with no real order data: **Rent 6**
(payment), **Rent 7** (confirmation), the payment half of **Buy 4**, and the CTA.
Buy's payment step reuses the same designed panel as Rent 6 — it is the same order
flow underneath, so a second variant would be duplication.

## Visual system

Taken from the existing stylesheet so the reels read as the site in motion rather
than as a template:

- Ground `#0a0a0a`
- Primary accent `#F0A500` (`--ps-blue` in `public/css/style.css:2`)
- Highlight `#FFD700` (`--ps-light-blue`)
- Buy gradient `#7b2ff7 → #f107a3`, already the site-wide Buy signal
- Muted text `#aaaaaa` (`--text-secondary`)

## Technical approach

One self-contained HTML file per reel. No external libraries, no build step.

Scene sequencing uses a small JavaScript driver — an array of
`{ id, duration }` advanced by `setTimeout`, toggling an `.active` class — rather
than chained CSS `animation-delay` values. Long delay chains are brittle to retime,
and the driver is what makes the replay control possible.

Within a scene, motion is CSS: `transform` and `opacity` only, so playback stays
smooth during screen recording.

Cover art loads from live `/uploads/` URLs. These are ordinary pages served by the
app, not sandboxed artifacts, so remote images load normally.

## Out of scope

- Audio of any kind: music, voiceover, sound effects.
- Video encoding, cutting, or export. Recording and editing are manual.
- Publishing or scheduling the posts.
- Linking the reels from the site's navigation. The URLs stay unlisted.
- A third reel for PS Plus Deluxe. Revisit once these two are live.
