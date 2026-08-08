# Editable message templates + console instruction fixes

Date: 2026-08-08
Status: Approved

## Problem

Every message to a renter is typed by hand in Messenger. Two moments repeat
constantly and always carry the same facts:

1. **After payment + sign-in** — confirming what they rented, for how long, at
   what price, and when it's due back.
2. **When a rental is about to end** — reminding them, offering an extension,
   and telling them how to return the account.

Retyping these invites mistakes and omissions, and there is no prompt telling
the owner *who* needs a reminder today.

Separately, and more urgently: the setup instructions shown to every customer
on the game detail page name console menus that do not exist. Customers follow
these before they can play, so each wrong path generates a support message.

| Where | Currently says | Actual path |
|---|---|---|
| Trophy (`views/game-detail.ejs:191`) | Settings → Account → Other → Console Sharing → ENABLE | Settings → **Users and Accounts** → Other → **Console Sharing and Offline Play** → Enable |
| Non-Trophy (`views/game-detail.ejs:215`) | Settings → Account → Other → Console Sharing → DON'T enable | Settings → **Users and Accounts** → Other → **Console Sharing and Offline Play** → leave disabled |
| PS4 Primary (`views/game-detail.ejs:239`) | Settings → Account → Other → Console Sharing → ENABLE (on PS4) | Settings → **Account Management** → Activate as Your Primary PS4 → **Activate** |

The PS4 Primary line is not a wording error — it points at the wrong feature
entirely. PS4 Primary activation has nothing to do with console sharing.

## Decisions taken before this design

- **Fill-in-and-copy, not auto-send.** Proactive Messenger sending already
  works (`/admin/blast` uses the `HUMAN_AGENT` tag, `server.js:3093`, which
  Facebook permits outside the 24-hour window), but it can only broadcast to
  everyone. `messenger_contacts` stores `{psid, first_seen, last_seen}`
  (`server.js:2642`) with no name and no link to a customer record, so there is
  no way to address one renter. Auto-send would first require building that
  link, and with ~155 named customers versus anonymous PSIDs there is nothing
  to match on automatically. Out of scope.
- **The deposit line appears only when a deposit was actually charged** —
  Trophy and PS4 Primary, never Non-Trophy.
- **Return steps differ per account type**, and PS4 Primary is genuinely
  distinct from Trophy rather than a variant of it.
- **The wrong setup instructions get fixed in this same change.**

## Templates

Stored in `site_settings.message_templates`, following the same lowdb pattern as
`hero_text` and `announcement`, so they persist and reach MongoDB through the
existing blob sync.

```
message_templates: {
  confirmation:        "...",
  expiry_tomorrow:     "...",
  expiry_today:        "...",
  return_steps_tr:     "...",   // Trophy
  return_steps_ps4:    "...",   // PS4 Primary
  return_steps_nt:     "...",   // Non-Trophy
  deposit_line:        "...",
  reviews_link:        "https://facebook.com/PlaystationHub00/reviews",
  website_link:        "https://playstation-hub.com"
}
```

### Placeholders

| Token | Substitutes to |
|---|---|
| `{name}` | `customer_name` |
| `{game}` | `game_title` |
| `{type}` | `Trophy` / `Non-Trophy` / `PS4 Primary` |
| `{days}` | `days` |
| `{price}` | `price` |
| `{end_date}` | `end_date` formatted long, e.g. `Aug 18, 2026` |
| `{deposit}` | The deposit amount, e.g. `100` |
| `{return_steps}` | Whichever of the three `return_steps_*` fields matches the account type |
| `{deposit_line}` | `deposit_line`, **or an empty string** when the rental carries no deposit |
| `{reviews_link}` | `reviews_link` |
| `{website}` | `website_link` |

`{return_steps}` and `{deposit_line}` are the conditional pair: both resolve
from the rental's `account_type`, so the owner edits each variant once and the
system picks. A Non-Trophy message simply has no deposit sentence rather than
one saying "₱0".

Unknown tokens are left untouched rather than replaced with `undefined`, so a
typo in a template shows up as literal `{gaem}` and is obvious to spot.

### Default content

**confirmation**
```
✅ You're all set, {name}!

🎮 Game: {game}
👤 Account: {type}
⏱ Duration: {days} days
💰 Paid: ₱{price}
📅 Return by: {end_date}

⚠️ Please don't change the account password or email — it locks everyone out, including you.

⭐ Enjoying it? A quick review really helps us: {reviews_link}
🎮 Browse more games: {website}
```

**expiry_tomorrow**
```
👋 Hi {name}! Quick reminder —

Your rental of {game} ({type}) ends TOMORROW, {end_date}.

Want to extend? Just reply and we'll set it up — no need to sign out or sign back in.

If you're done, here's how to return the account:
{return_steps}

{deposit_line}
```

**expiry_today**
```
👋 Hi {name} — your rental ends TODAY.

🎮 {game} ({type}) · {days} days
📅 Ends: {end_date}

Would you like to extend your rent today? Just reply and we'll set it up —
no need to sign out or sign back in.

If you're done, here's how to return the account:
{return_steps}

{deposit_line}
```

**return_steps_tr**
```
1️⃣ Disable console sharing FIRST:
   Settings → Users and Accounts → Other → Console Sharing and Offline Play → Disable
2️⃣ Then delete the account:
   Settings → Delete Account
```

**return_steps_ps4**
```
1️⃣ Deactivate as primary FIRST:
   Settings → Account Management → Activate as Your Primary PS4 → Deactivate
2️⃣ Then delete the account:
   Settings → Delete Account
```

**return_steps_nt**
```
Just delete the account from your console:
   Settings → Delete Account
```

**deposit_line**
```
💰 Your ₱{deposit} deposit comes back once you've signed out — just send us a screenshot.
```

## Admin editing

A new **Message Templates** collapsible section in the Settings tab, beside Bot
Training. Contents:

- Three textareas for the message templates, three for the return-step
  variants, one for the deposit line.
- Two text inputs for the review and website links.
- A reference list of every available placeholder.
- A **live preview** rendered against the most recent Trophy rental in the
  customers list, so the owner sees a fully substituted message — including the
  conditional blocks — before saving. When no customer exists yet, the preview
  falls back to a fixed sample rental rather than rendering empty tokens.

Saved by a `POST /admin/message-templates` route following the same shape as the
existing `POST /admin/promo`.

## Using the templates

**Per-customer copy.** Each row in the Customers table gains a 📋 **Copy** button
that fills the confirmation template with that customer's values and writes it
to the clipboard.

**"Needs a reminder" panel.** A new panel at the top of the Customers tab lists
every rental with `status === 'renting'` whose `end_date` is today or tomorrow,
each with its own Copy button that picks `expiry_today` or `expiry_tomorrow`
automatically. The customers table already computes this same days-remaining
figure for its "Due today" / "1d left" badges (`views/admin.ejs:2518`), so the
panel reuses that calculation rather than introducing a second one. Without this
panel the expiry templates would require hunting through 222 rows to find who
needs them, which is the work the feature exists to remove.

**Clipboard fallback.** `navigator.clipboard` requires a secure context.
Production is HTTPS so this is satisfied, but on a plain-HTTP localhost the API
is absent — in that case the button selects the message text in a visible
textarea so it can be copied manually, rather than failing silently.

## Console instruction fixes

`views/game-detail.ejs` lines 191, 215, and 239 are corrected to the real paths
in the table at the top of this document. The Non-Trophy line is corrected too:
its menu path was wrong in the same way as Trophy's, even though its
instruction (leave sharing disabled) was right.

## Out of scope

- Automated sending of any message, and the customer↔Messenger-ID link it would
  need.
- Changes to the existing Messenger bot's automated replies.
- Scheduling, queuing, or tracking which reminders have already been sent.
- Any change to the rental lifecycle, pricing, or the payments work.
