# Sign-In QR Guide — Design

**Date:** 2026-08-16
**Status:** Approved

## The problem

Once a customer pays, the order-status page tells them what state they're in but gives no help actually producing a sign-in QR — they have to already know their console's menus, or ask on Messenger and wait for a manual explanation. That's slow for the customer and repetitive for the owner, who re-types the same steps to every new renter. There's also no way to point someone outside an active order (a first-time asker on Messenger) at a self-serve explanation.

## What changes

### Data model

A new lowdb collection, `signin_steps`, holding one row per step:

```js
{
  id: number,
  console: 'ps5' | 'ps4',
  rank: number,        // display order within its console
  text: string,         // short instruction, e.g. "Go to Settings → Users and Accounts"
  image: string | null, // uploaded screenshot path, same convention as other uploads
  created_at: ISO date string
}
```

Seeded on first read with default text-only steps for both consoles (mirroring the `message_templates` seed-on-first-read pattern), so the guide works immediately and screenshots can be added later without blocking launch. Steps are edited individually — add, reorder (rank), replace image, delete — not as one bulk form, so uploading one screenshot never risks re-submitting or losing the others.

### Admin editor

New section in Settings (accordion, matching the existing Promo/Payment Methods pattern): "Sign-in guide", with a PS5/PS4 tab toggle. Each step is a row: rank, text field, screenshot thumbnail with upload/replace, delete. An "Add step" button appends a new row at the end of the current console's list. Screenshots go through the same `processUploadedImage` pipeline already used for payment-method QR codes and promo media.

Routes, mirroring the existing `bot_training` add/delete pattern:
- `POST /admin/signin-steps/add` — console, text, optional image (multipart)
- `POST /admin/signin-steps/:id` — edit text and/or replace image
- `POST /admin/signin-steps/:id/delete`
- `POST /admin/signin-steps/:id/reorder` — move up/down (swaps rank with neighbor)

### Order-status integration

Two places on `order-status.ejs`, both reading the same `signin_steps` data (passed into the render from `server.js`, keyed by console):

**`verifying_payment` state** (today: just "we're checking it"): add a collapsed "While you wait — get your console ready" prompt with a console toggle, expandable to the same step list used below. Lets the customer prep before their QR is even asked for.

**`awaiting_qr` state** (today: one line of instructions above the upload form): replace that line with the full illustrated step list for the order's `account_type`-implied console — actually, console is independent of account type (Trophy/Non-Trophy is about which account, not which hardware), so this needs a manual PS5/PS4 toggle at this step too, defaulting to whichever the customer last picked if they expanded the preview earlier (sessionStorage), else PS5.

Below the steps, the existing upload form stays primary (it's the tracked path — advances state, starts the countdown, appears in the owner's queue automatically), with "Send on Messenger" as a secondary button beside it, matching the visual proposal.

### Public guide page

`GET /how-to-sign-in` — same step list, same console toggle, no order context, reachable from the footer and pasteable into any Messenger chat. Renders the identical partial the order-status page uses, so editing steps in admin updates both places at once.

## What deliberately does not change

- The account-type setup copy already on game pages (Console Sharing and Offline Play, Activate as Primary PS4) — that's pre-rental account configuration, a different question from producing a sign-in QR post-payment.
- The upload endpoint (`/order/:ref/qr`) and its state machine — this only adds explanatory content above the existing form.
- The Messenger fallback already on the QR step — it becomes a labeled secondary button rather than being added new.

## Out of scope

- Video walkthroughs — screenshots only for v1.
- Automatically detecting which console a customer has — always a manual toggle.
- Per-game or per-account-type step variants — the guide is generic to "how to produce a PS5/PS4 sign-in QR," not tied to specific games.
