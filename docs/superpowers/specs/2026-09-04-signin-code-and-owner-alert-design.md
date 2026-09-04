# Sign-in Code Entry and Owner Alert — Design

**Goal:** Let a customer type their console sign-in code instead of photographing
it, and tell the owner the instant one arrives — so the ten-minute window is
spent signing in rather than waiting to be noticed.

**Status:** drafted 2026-09-04, approved for implementation the same day.
Blocked only on a Telegram bot token existing (see Prerequisites); all code can
be built and tested first.

## Why

The request that started this was "can a script sign our account in
automatically once the customer enters the code". **It cannot, and that is not
a gap in this codebase.** Sony publishes no API that lets a third-party server
approve a console sign-in — the PlayStation App does it over Sony's own private,
authenticated endpoints. Automating it would mean storing the shop's PSN
password and driving a login past 2FA, device verification and bot detection,
which exist precisely to stop that.

The risk is also the wrong shape for this business. The PSN account *is* the
inventory. An automation flag does not cost one rental; it locks the account and
every active customer loses their game at once, after the money has been taken.
And because those endpoints are private, they change without notice — it would
break at the least convenient possible moment.

So the sign-in stays manual. What gets fixed is everything around it, because
the real cost was never the twenty seconds of scanning.

**The actual bottleneck:** the QR window is ten minutes
(`QR_WINDOW_MS` in `lib/orders.js`), and when a customer submits, **nothing
tells the owner**. No push, no message, no email. The clock starts and the only
way the owner finds out is by happening to look at the admin page. A window that
expires unwatched costs a full re-do: the customer walks back through the console
menus, and the shop looks slow at the exact moment it promised to be fast.

## Two changes

### 1. Code entry beside the photo

The console shows a code alongside the QR, and the PlayStation App accepts it —
confirmed by the owner. Typing it is faster than photographing a television, and
immune to the blurry-photo retry loop.

The photo upload **stays**. It works today, and keeping it costs one form. If a
console ever shows only a QR, or a customer finds typing harder than snapping,
the working path is still there. This adds a lane; it does not replace one.

### 2. A Telegram alert the moment either one lands

Telegram rather than Messenger, and the reason matters. Messenger only permits
messages to someone who messaged the Page in the last 24 hours — the
`/admin/blast` route already says so in its own error text. An owner alert on
that channel works while the owner is active and **goes silent after 24 quiet
hours**, which is exactly when they are away and need it. It would fail
silently. An alert that cannot be trusted is worse than none, because the owner
stops watching the admin page and gains nothing in return.

Telegram has no such window, pushes to a phone instantly, costs nothing, and is
a single HTTP POST.

## Code handling

`lib/signin-code.js`, pure, with `scripts/test-signin-code.js`:

```js
normalizeCode(raw) -> string    // separators stripped, uppercased
isValidCode(raw)   -> boolean   // 4-16 alphanumeric after normalising
MIN_LEN = 4
MAX_LEN = 16
```

Normalising strips spaces and dashes and uppercases, so `abcd-1234`,
`ABCD 1234` and `abcd1234` all arrive as `ABCD1234`. A customer copying off a
television will introduce exactly those variations.

**Validation is deliberately loose.** PlayStation's exact code format is not
documented here and is not worth guessing: a regex tuned to a format that turns
out to be wrong would reject a valid code at the one moment it matters, and the
customer would have no way around it. A length band plus an alphanumeric check
catches the real failure — an empty box or pasted junk — without inventing a
rule nobody verified. The owner sees the raw code either way and can tell at a
glance if it looks wrong.

## Routes and state

New: `POST /order/:ref/signin-code`, mirroring `POST /order/:ref/qr` — same
`url_key` check, same rate limit, same `qr_pending` transition, same ten-minute
`qr_expires_at`. It is a separate route rather than a branch inside the upload
handler so the working photo path is not touched at all.

The order gains a `qr_code` field. `orders.transition` already accepts arbitrary
patch fields, so no change is needed in `lib/orders.js`.

The two submissions are equivalent from the order's point of view: both mean "a
sign-in is waiting and the clock is running".

## The alert

`lib/telegram.js`, pure, with `scripts/test-telegram.js`:

```js
apiUrl(token)                      -> string
messagePayload(chatId, text)       -> object
isConfigured(env)                  -> boolean
formatQrAlert(order, opts)         -> string
```

The network call lives in `server.js` beside `fetchUsdPhpRate`, following the
split already in place: pure logic in `lib/`, fetches in the server.

**The alert must never affect the customer.** It is fired and forgotten — never
awaited, never able to throw, never able to fail a submission. If Telegram is
down or the token is wrong, the code still submits, the order still transitions,
and the failure is logged for the owner rather than shown to the customer.

The message carries the code itself, not just a nudge to go and look:

```
Sign-in waiting — PH-0071
Code: ABCD1234
Arlloyd · Marvel's Wolverine
Expires 5:42 PM
https://playstation-hub.com/admin?tab=orders
```

That is the whole point: the owner can open the PlayStation App and type the
code straight from the notification, without opening the admin panel at all. A
photo submission sends the same message without a `Code:` line and says
`Photo uploaded` instead, so the owner knows to open admin for that one.

Sending the code over Telegram is safe enough to be worth it: it is single-use,
expires in ten minutes, and is bound to the console that displayed it — someone
else holding it cannot sign the account into their own machine. No customer
detail beyond first name and game title is sent.

## Admin

The order queue shows `qr_code` in large monospace with a copy button when
present, so it is one tap to paste. Photo submissions render as they do today.
A countdown showing what is left of the ten minutes sits on the row, so the
owner triages the one about to expire first rather than the one at the top.

## Configuration

Two environment variables, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. With
either missing the feature is simply off: `isConfigured` returns false, nothing
is sent, nothing is logged as an error, and every other part of the flow behaves
exactly as it does today.

## Prerequisites

A Telegram bot, created by the owner:

1. Message `@BotFather` on Telegram, send `/newbot`, follow the prompts, copy the token.
2. Message the new bot once (a bot cannot open a conversation first).
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `message.chat.id`.
4. Set both values in Railway.

None of this blocks implementation. It blocks the alert firing, which is two
environment variables on the day the bot exists.

## Not building

- **Automated PSN sign-in.** Covered above. The sign-in stays a human action.
- **Storing PSN credentials anywhere, for any reason.**
- **Replacing the photo upload.** It stays as the fallback.
- **Alerts for anything other than a waiting sign-in.** Payment already has its
  own webhook path and its own admin surfacing; widening this now would make the
  alert routine, and a routine alert gets ignored.
