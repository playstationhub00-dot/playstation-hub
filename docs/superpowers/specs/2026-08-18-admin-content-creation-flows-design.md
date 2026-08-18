# Admin Content Creation Flows — Design

**Date:** 2026-08-18
**Status:** Approved

This is **sub-project A** of a four-part admin panel audit. The audit findings and
the other three sub-projects are recorded at the end of this document.

## The problem

Creating a bundle game takes three pages and two saves.

`is_bundle` and `bundle_account_id` exist on the edit page (`views/edit.ejs`) but
appear nowhere in the add flow — not in the form, and not in the
`POST /admin/add` handler, which never reads them from `req.body`. So the only way
to create a bundle is:

1. `/admin/accounts` — create the account
2. `/admin` Games tab — create the game, with no bundle option available
3. `/admin/edit/:id` — reopen the game purely to tick "Bundle account" and link it

Two smaller problems compound it:

- **The add menu doesn't navigate.** The "What do you want to add?" modal offers
  three cards (New game, Upcoming game, Price category). Each one closes the modal
  and scroll-jumps to a form further down the same page. Bundles are not among them.
- **The game form is 25 flat fields** with no grouping, on a page that already ships
  8,597 DOM nodes.

### What is *not* wrong

An earlier reading of this gap counted six fields as missing from add. Checked
against the code, only two are. The others differ for good reasons and must stay
that way:

| Field | Why add omits it |
|---|---|
| `cover_focal_x`, `cover_focal_y` | Hardcoded to `50` on create, with the comment *"fine-tuned later via Edit, once the cover is visible."* A focal point cannot be chosen before the uploaded cover can be seen. |
| `remove_gallery` | A per-image "Remove" checkbox. A game being created has no gallery to remove. |
| `viewport` | Not a form field. It is the `<meta name="viewport">` tag. |

This matters for the design: because add and edit legitimately differ, they are
**not** merged into one shared partial. Threading `<% if (mode === 'edit') %>`
branches through a shared file to paper over real differences trades a small
duplication for harder-to-read conditional logic. Two forms that differ for stated
reasons are clearer than one that pretends they don't.

## What changes

### 1. Bundle fields on the add path

The narrow, real fix.

**View** — the game add form gains a Bundle section with `is_bundle` (checkbox) and
`bundle_account_id` (select, populated from accounts).

**Handler** — `POST /admin/add` gains `is_bundle` and `bundle_account_id` to its
destructured `req.body` fields, and writes them onto the pushed game record using the
same shape `POST /admin/edit/:id` already uses:

```js
is_bundle: is_bundle === 'on',
bundle_account_id: is_bundle === 'on' && bundle_account_id ? parseInt(bundle_account_id) : null,
```

A bundle becomes creatable in **one save**, provided the account exists.

If no accounts exist, the Bundle section renders a link to `/admin/accounts` instead
of an empty dropdown, so the dead-end is visible rather than silent.

Creating the account inline from the game form is out of scope — it is a second
entity with twelve of its own fields, and folding it in would rebuild the monolith
problem inside the form meant to fix it.

### 2. Add becomes a real page

`/admin/edit/:id` is already its own page. Add follows the same existing convention
rather than inventing one:

| Route | View | Purpose |
|---|---|---|
| `GET /admin/add/game` | `views/add-game.ejs` | Create a game |
| `GET /admin/add/upcoming` | `views/add-upcoming.ejs` | Create an upcoming title |

The existing `POST /admin/add` and `POST /admin/upcoming/add` targets are unchanged
apart from the two new fields above — only the GET-side presentation moves.

Price category creation stays inline in the Games tab; it is a small form and does
not justify its own page.

The modal's cards become real links instead of `scrollIntoView` calls.

### 3. Bundle joins the add menu

A fourth card, routing to `/admin/add/game?bundle=1`, which renders the game form
with the Bundle section expanded and `is_bundle` pre-ticked.

### 4. Fields group into five sections

The add form's fields, grouped, using the same accordion mechanic the Settings tab
already uses:

| Section | Fields | Default |
|---|---|---|
| Basics | `title`, `platform`, `genre`, `description`, `release_date` | Open |
| Pricing | `price_mode`, `price_category_id`, `nt_price_7d`, `nt_price_30d`, `tr_price_7d`, `tr_price_30d`, `buy_nt_price`, `buy_tr_price`, `cost` | Open |
| Media | `cover_image`, `gallery` | Collapsed |
| Stock & slots | `available_slots`, `trophy_account`, `trophy_slots`, `non_trophy_slots`, `ps4_primary_slots`, `renters` | Collapsed |
| Bundle | `is_bundle`, `bundle_account_id` | Collapsed; open when `?bundle=1` |

`link_url`, `link_label`, and `new_window_days` sit at the end of Basics as a
trailing "Extras" group — rarely touched, and not enough to justify a sixth section.

Basics and Pricing are open because every game needs them. The rest are collapsed
because most games never touch them.

Media contains only `cover_image` and `gallery` on the add form; the focal-point and
gallery-removal controls remain edit-only for the reasons stated above.

## What deliberately does not change

- **No business logic.** Pricing maths, availability computation, slot handling, and
  the bundle resolver functions are untouched.
- **`views/edit.ejs`.** The edit page keeps its current layout and its edit-only
  fields.
- **`views/accounts.ejs`.** Account creation stays where it is.
- **Every other admin tab** — Settings, Orders, Customers, PS Plus, Visitors,
  Security, Announcements.

## Out of scope

- Splitting `views/admin.ejs` (250 KB, 3,660 lines) into per-tab partials — that is
  sub-project C.
- Removing any route or feature — that is sub-project B.
- The client-facing order flow — reviewed and explicitly excluded; no defect known.
- Inline account creation from the game form.
- Merging add and edit into a shared partial, for the reasons given above.

---

## Audit findings (context for the remaining sub-projects)

Measured on the live panel, 2026-08-18:

| Metric | Value |
|---|---|
| `views/admin.ejs` | 250 KB, 3,660 lines |
| DOM nodes per load | 8,597 |
| Forms / buttons | 287 / 943 |
| Admin routes | 85 |
| Tabs | 8, all shipped on every page load as `display:none` |

Tabs are CSS-toggled, not routed, so every tab's markup parses on every admin visit.

### Remaining sub-projects, not specced here

- **B — Dead feature removal.** `/admin/app` and `views/admin-app.ejs` (18 KB) have
  zero inbound links from any view and appear fully orphaned. `backfill-images` and
  `fix-end-dates` are one-time migration utilities sitting in the daily UI;
  `mongo-status` is a debug endpoint in the Settings tab. Candidates for removal or
  relocation, subject to the owner's confirmation — no feature with working code
  should be deleted on inference alone.
- **C — Admin file split.** Break `admin.ejs` into per-tab partials so each tab's
  markup is not parsed on every load. Highest structural value, but a pure refactor
  across 85 routes on a live production site with paying customers, delivering no new
  capability. Sequenced after the flows work.
- **D — Client order flow.** Excluded. Built and live-verified this session with no
  known defect.
