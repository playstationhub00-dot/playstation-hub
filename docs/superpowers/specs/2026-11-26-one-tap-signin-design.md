# One-tap sign-in — Design

**Goal:** When a customer sends a console QR, decode it on the server and give
the owner a link to open on the phone that is already signed into the business
PlayStation account. Signing in stays a human tap. This does not log into
PlayStation, store a PSN password, or call a Sony API.

**Status:** implemented 2026-11-26. Builds on
`docs/superpowers/specs/2026-09-04-signin-code-and-owner-alert-design.md`.

## Decode

`lib/signin-qr.js` reads a JPEG or PNG with `jpeg-js` and `pngjs`, then `jsQR`.
No new native module. WebP and HEIC, which some phones upload, are turned into
pixels with the `sharp` install the site already uses to resize uploads, then
the same decoder. A photo that cannot be read is unchanged: the admin still
shows the picture and any typed code.

`POST /order/:ref/qr` decodes the original file before it is resized to WebP.
The accepted URL is stored on the order as `qr_signin_url`, with the same
ten-minute `qr_expires_at` as the photo and the typed code.

## Sony hosts only

A decoded value is kept only when it is an `https` URL whose host is
`sonyentertainmentnetwork.com`, `playstation.com`, `sony.com`, or a subdomain
of one of those. Lookalike hosts, `http`, and URLs with a username or password
are rejected and the photo is shown instead. The link is wiped when the ten
minutes expire, when the owner asks for a fresh code, and when they mark the
customer signed in.

## Admin

On a `qr_pending` row the sign-in panel has:

- An account picker. It lists accounts with a free slot of the order's type
  that carry that game, and defaults to the order's `account_id` when that
  slot is still free. A bundle order's pinned account is included even without
  a catalogue game id.
- The typed code, with copy, when the customer sent one.
- **Open sign-in**, the decoded URL, opened in a new tab so the owner can come
  back and confirm. Controls are full-width tap targets because this is done
  on a phone.
- **Signed in** (`POST /admin/orders/:ref/signed-in`). Moves the order to
  active the same way the queue's advance button does, records
  `signin_method` (`qr_link`, `typed_code`, or `photo`), `signin_at`, and the
  account on the order and on `state_history`, and fills that account's slot
  (renter, Manila start, end date from the rental's days) through the existing
  slot assignment. A purchase marks the slot bought.
- **Failed / ask for new code** (`POST /admin/orders/:ref/signin-failed`).
  Returns the order to `awaiting_qr`, clears the code, the photo, and the
  link, and the customer's page asks for a fresh QR.

Both routes use `requireAuth`. Each action is appended to `signin_log` (order,
account, method, time). The link and the code are not written to the log or
to history.

## Telegram

When a decoded link was stored, the existing sign-in alert includes
`Open sign-in: <url>` as well as the code, when there is one. A photo that did
not decode still says to open admin. The alert stays fire-and-forget.

## Not building

- Automated PSN sign-in, stored passwords, or private Sony endpoints.
- Replacing the photo upload or the typed code. Both stay.
