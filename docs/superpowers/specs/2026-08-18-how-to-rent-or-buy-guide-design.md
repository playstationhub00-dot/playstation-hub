# How To Rent Or Buy — Customer Guide Design

**Date:** 2026-08-18
**Status:** Approved

## The problem

`/how-it-works` describes a flow the site no longer uses.

The page walks the customer through three steps ending in **"Send Us These
Details"** — message the Facebook page with the game name, days, and account type.
It contains no mention of GCash, Maya, QR payment, the order reference, or the
online order flow. Its example message asks for **"15 days"**, which is not a
rental duration the site offers.

A customer following the current page is told to do something the site no longer
requires, and is never told about the steps it now does require.

Separately, there is no shareable graphic for answering "how do I rent?" in a
Messenger reply or a Facebook post.

## Capability boundary

No PNG or JPG is produced by this work. The shareable graphic is an HTML page,
screenshotted on a phone. This is the same approach used for the promo reels.

## The verified journey

Traced from the code, not from the existing page.

The full order lifecycle has roughly eleven states. A guide that lists all eleven
is unreadable, so shared steps merge and the rent/buy split happens once:

| # | Step | Detail |
|---|---|---|
| 1 | Open playstation-hub.com, tap **Rent** or **Buy** | |
| 2 | Pick your game | |
| 3 | Choose account type | Trophy and PS4 Primary add a ₱100 refundable deposit; Non-Trophy has none |
| 4 | **Rent:** pick 7 days or 30 days. **Buy:** skip | The only branch in the whole flow |
| 5 | Type your Facebook name, tap Rent or Buy | The order reference appears here |
| 6 | Pay via GCash or Maya QR, then upload your receipt | Or send it on Messenger using the prefilled message |
| 7 | Send your sign-in QR within ~10 minutes | Links to the existing `/how-to-sign-in` page |

Rent closes with a note about returning the account at the end of the period. Buy
states the game is permanent, with no return.

### The sign-in QR step matters

After payment, `views/order-status.ejs` asks the customer to send their PSN sign-in
QR, warning *"Your QR is only good for about 10 minutes — send it right away."*

This is a hard timing constraint in the middle of the flow, and it is the step most
likely to generate support messages. Both deliverables include it. Neither
re-explains how to produce the QR — `/how-to-sign-in` already covers that and is
linked from the footer.

### Verified facts

- Durations are 7-day weekly and 30-day monthly.
- Deposit is `(type === 'tr' || type === 'ps4')` at `server.js:1441`, defaulting to
  ₱100. Non-Trophy rentals carry no deposit.
- Payment confirmation offers two routes: upload a receipt image, or copy a
  prefilled message and send it on Messenger.

## What gets built

### 1. `/how-it-works`, rewritten

The full-detail source of truth. Replaces the "Send Us These Details" section and
its 15-day example with the seven steps above.

The existing "Trophy vs. Non-Trophy Account" comparison section is kept — it is
accurate and useful — and gains the deposit rule, which it currently omits.

### 2. `public/promo/how-to.html`, new

A condensed seven-step graphic at **4:5 portrait** (1080×1350), Facebook's tallest
feed-friendly ratio, so it fills the most screen without being cropped.

Served from `public/promo/`, which `express.static` (`server.js:332`) already
serves, so it is reachable at `playstation-hub.com/promo/how-to.html` and can be
opened on a phone and screenshotted — the same delivery path as the promo reels.

Unlisted: not linked from site navigation.

### Payment steps use designed panels

Steps 6 and 7 are drawn as designed graphics, not screenshots of a real order page.
A real order status page displays a customer's Facebook name and order reference;
publishing one would expose a real person's data. No test order is created for this
work either, since that writes a real record into the production order queue.

Steps 1 through 5 describe UI that contains no customer data, so they may name real
interface elements ("tap Rent", "choose Trophy") freely.

To be explicit, since this is the kind of detail an implementer would otherwise
guess at: **every step in `how-to.html` is a designed panel — numbered step card,
short caption, no embedded screenshots or iframes anywhere in the file.** A static
graphic that has to stay legible at feed size cannot carry readable UI screenshots,
and mixing screenshot steps with drawn steps would look inconsistent. The
screenshot-versus-panel distinction above governs only what the copy may *describe*,
not how any step is rendered.

## Visual system

Taken from the existing stylesheet so both deliverables read as the site:

- Ground `#0a0a0a`
- Primary accent `#F0A500` (`--ps-blue` in `public/css/style.css:2`)
- Highlight `#FFD700` (`--ps-light-blue`)
- Buy gradient `#7b2ff7 → #f107a3`, already the site-wide Buy signal
- Muted text `#aaaaaa` (`--text-secondary`)

## What deliberately does not change

- **`/how-to-sign-in`.** Already exists, is accurate, and is linked from the footer.
  Both deliverables link to it rather than duplicating it.
- **The order flow itself.** No route, template, or business logic in the ordering
  path is touched. This is documentation only.
- **The Trophy vs. Non-Trophy comparison** on `/how-it-works`, beyond adding the
  deposit rule.

## Out of scope

- PS Plus Deluxe rentals — a different product with a different flow.
- Bundle-specific messaging on the guide.
- Any change to `/how-to-sign-in`.
- Audio, video, or raster image generation.
