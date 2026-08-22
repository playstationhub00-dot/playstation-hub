# Admin Panel Reorganisation — Design

**Date:** 2026-08-22
**Status:** Approved

Regroup the admin panel's eight tabs by the job the owner is doing, and extract
each tab into its own partial as the vehicle for the move.

This is **sub-project E** of the admin audit begun at
`2026-08-18-admin-content-creation-flows-design.md`. It absorbs and supersedes
that document's sub-projects **B** (dead feature removal) and **C** (admin file
split), both of which are folded into the phases below.

## The problem

Two tabs became dumping grounds.

**Customers is 1,511 lines, and 62% of it is not customers:**

| Section | Lines | What it actually is |
|---|---|---|
| Business Dashboard | ~490 | Revenue, profit, margin, live rental status, month logs |
| Message Blast | ~445 | Outbound marketing |
| All Customers | ~280 | Customer records |
| Add New Customer | ~218 | Customer records |
| Import from Excel | ~53 | Customer records |

The Business Dashboard is the single most valuable screen in the panel — it is
where the money is — and it is buried three levels inside a customer list.

**Settings holds eleven sections, of which five are homepage content and two are
messaging:**

Site Settings, Payment Methods, and Promo & Pricing Rules are configuration.
Hero Promo Slider, Home Page Hero Text, Homepage Popup, Customer Reviews, and
Sign-In QR Guide are public site content. Bot Training and Message Templates are
messaging. Image Optimization is maintenance.

**Analytics is split across two tabs.** Business Dashboard sits in Customers;
Visitors has a tab of its own. They answer the same question.

## Corrections to the 2026-08-18 audit

Two items that audit listed as removal candidates are working features:

- **`mongo-status` is not a debug endpoint.** It powers the database connection
  badge in the admin header (`views/admin.ejs:85`), turning it green, amber, or
  red. It stays.
- **`backfill-images` is not a one-time migration.** It is the re-runnable
  "Optimize All Images Now" button, which reports how many files were already
  optimised — built to be run repeatedly after image uploads. It stays, relocated
  to Maintenance.

This repeats the lesson recorded when `/admin/app` was wrongly flagged: a route's
shape, not its inbound link count, decides whether it is dead.

## Target structure

Eight tabs, same count, regrouped. New tab ids are marked.

| Tab id | Label | Contents | Moved from |
|---|---|---|---|
| `dashboard` *(new)* | 📊 Dashboard | Business Dashboard, Month Logs, Visitor analytics | Customers, Visitors |
| `orders` | 🧾 Orders | Order queue | — |
| `games` | 🎮 Games | All Games, Coming Soon, Game Requests, Price Categories | — |
| `psplus` | ⭐ PS Plus | Most Played, Global Pricing, Monthly Entries | — |
| `customers` | 👥 Customers | All Customers, Add New Customer, Import from Excel | — |
| `messaging` *(new)* | 💬 Messaging | Message Blast, Message Templates, Bot Training | Customers, Settings |
| `content` *(new)* | 🖥️ Site Content | Hero Slider, Hero Text, Homepage Popup, Customer Reviews, Sign-In QR Guide, Announcements | Settings, Announcements |
| `settings` | ⚙️ Settings | Site Settings, Payment Methods, Promo & Pricing Rules, Change Password, Maintenance | Security |

Retired tab ids: `announcements`, `visitors`, `security`. Their contents move; the
tabs themselves disappear.

`/admin` opens on `dashboard`.

### Deliberate deviations from the proposal shown to the owner

- **The Games tab keeps its label and its id.** The visual proposal renamed it
  "Catalogue". Renaming a tab used daily costs the owner's muscle memory and
  breaks `?tab=games` bookmarks, and the tab's contents are not changing. The
  rename buys nothing. Reversible in one line if wanted.
- **PS Plus stays a separate tab**, per the owner's decision — it is a distinct
  product line with its own pricing cycle, not more catalogue rows.

## Adds, updates, deletes

The owner asked for these three explicitly.

**Adds — no new features.** Every new tab is a new home for something that
already exists. The only genuinely new markup is a Maintenance section in
Settings to hold Image Optimization, which currently sits between two content
editors with no heading of its own.

**Updates.** Roughly 1,400 lines of markup move between tabs. Seven tabs become
seven new partials; Orders already uses one. Tab plumbing — the `tabs` array,
`msgTabMap`, the default-tab special case, and the legacy-id handling — is
rewritten.

**Deletes.** One: `/admin/fix-end-dates`. It is a genuine one-time migration
(adds one day to customer end dates), nothing links to it, and the owner
confirmed it can go. Removes `views/fix-end-dates.ejs` and both routes
(`GET` and `POST /admin/fix-end-dates`). Nothing else is deleted.

## The tab plumbing, which is where this breaks

Four pieces of client-side state key off tab ids. All four must change together.

1. **`const tabs` (`admin.ejs:3462`)** — the id list every loop walks.
2. **`switchTab`'s default special-case** — `if (name !== 'settings') q.set('tab', name)`
   must become `'dashboard'`, or the URL will carry `?tab=dashboard` on the
   landing tab and omit it on Settings.
3. **`msgTabMap`** — about thirty keys. `month_log_saved` and `month_log_deleted`
   move to `dashboard` (Month Logs live inside the Business Dashboard, not with
   customer records). `popup_saved`, `signin_step_saved`, and
   `signin_step_deleted` move to `content`. `password_changed`,
   `wrong_password`, `password_mismatch`, and `password_too_short` move to
   `settings`. `announcement` moves to `content`.
4. **The initial-tab resolver** — `urlTab || msgTabMap[msg] || localStorage || 'settings'`.

### The failure this must prevent

Every admin who has used the panel has a tab id in `localStorage` under
`adminTab`. For anyone whose last tab was Announcements, Visitors, or Security,
that stored id stops existing at deploy. `switchTab` then calls
`document.getElementById('tab-security')`, gets `null`, and throws on
`.classList` — the panel fails to initialise on load, for the owner, silently,
on first visit after deploy.

Two guards, both required:

```js
const LEGACY_TABS = { announcements: 'content', visitors: 'dashboard', security: 'settings' };
```

- Apply `LEGACY_TABS` when resolving the initial tab, so old `localStorage`
  values and old `?tab=visitors` bookmarks land somewhere sensible instead of
  nowhere.
- Guard `switchTab` so an id not in `tabs` falls back to `dashboard` rather than
  dereferencing `null`. The map handles the three known ids; the guard handles
  anything else.

## File structure

Each tab becomes a partial under a new `views/partials/admin/` directory:

```
views/partials/admin/dashboard.ejs
views/partials/admin/games.ejs
views/partials/admin/psplus.ejs
views/partials/admin/customers.ejs
views/partials/admin/messaging.ejs
views/partials/admin/content.ejs
views/partials/admin/settings.ejs
```

`views/partials/order-queue.ejs` stays where it is — it already works, is
included only by `admin.ejs`, and moving it buys nothing.

`admin.ejs` keeps the page shell, the tab bar, and the scripts, and becomes a
list of includes. EJS includes inherit the parent's locals, so no partial needs
its data passed explicitly.

Extraction is what makes the moves safe. Relocating 1,400 lines inside a single
3,567-line file is a sequence of large, hard-to-review edits; as file-level
operations each move is a diff a reviewer can actually check.

## Phasing

Six deploys. Each leaves the panel working.

**Phase 1 — Mechanical extraction.** Move all eight existing tabs into partials
with no content changes and no regrouping. Add the `LEGACY_TABS` map and the
`switchTab` guard now, before any id changes, so the safety net exists before it
is needed. Rendered output should be byte-identical.

**Phase 2 — Dashboard.** Create the `dashboard` tab. Move Business Dashboard
(with Month Logs) out of Customers and Visitor analytics out of Visitors. Retire
the `visitors` tab. Remap `month_log_*`.

**Phase 3 — Messaging.** Create the `messaging` tab. Move Message Blast out of
Customers; Message Templates and Bot Training out of Settings.

**Phase 4 — Site Content.** Create the `content` tab. Move Hero Slider, Hero
Text, Homepage Popup, Customer Reviews, and Sign-In QR Guide out of Settings, and
Announcements out of its own tab. Retire the `announcements` tab. Remap
`announcement`, `popup_saved`, `signin_step_*`. The Sign-In QR Guide's nested
accordion has bespoke reopen logic keyed to `signin_step_*` messages
(`admin.ejs:~3527`) that must travel with it.

**Phase 5 — Settings.** Absorb Change Password from Security; retire the
`security` tab; remap the four password message keys. Add the Maintenance
section and move Image Optimization into it.

**Phase 6 — Finish.** Default tab becomes `dashboard`. Delete
`views/fix-end-dates.ejs` and its two routes. Full sweep of the panel.

## Verification

Per phase, on the live panel:

- Every tab in the bar opens, and its expected sections are present.
- No console errors on load, and none when switching tabs.
- `localStorage.setItem('adminTab', 'security')` then reload — the panel must
  still initialise, landing on Settings. Repeat for `visitors` and
  `announcements`.
- `?tab=visitors` in the URL lands on Dashboard, not a blank panel.
- One save per relocated section, confirming its toast fires and lands on the
  correct tab.

At the end of Phase 6, `views/admin.ejs` should be under ~400 lines, with the
tab markup living in seven partials.

## Out of scope

- **Lazy tab loading.** Every tab's markup still ships on every load, so the
  8,597-node figure does not improve. Making tabs server-routed would fix it, but
  requires conditional data-fetching across the `/admin` handler and is a
  separate project. Extraction into partials is the prerequisite that makes it
  possible later.
- **Any business logic.** Pricing, availability, slots, order transitions, and
  the bundle resolver are untouched.
- **`/admin/accounts`, `/admin/posters`, `/admin/app`.** Separate pages already,
  linked from the tab bar. They stay as they are.
- **The standalone edit pages** (`/admin/edit/:id`, `/admin/customers/edit/:id`,
  `/admin/psplus/edit/:id`, `/admin/upcoming/edit/:id`, `/admin/add/*`).
- **Renaming Games to Catalogue**, for the reason given above.
