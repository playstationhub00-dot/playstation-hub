# Editable Request Votes — Design

**Date:** 2026-08-25
**Status:** Approved

Let the owner rename or remove an individual voter on a game request, so a
vote cast under a fake name becomes either usable or gone.

## The problem

Voters type their own Facebook name when requesting or voting, and some type
junk. The public board already shows the result: "Sudden Strike 4 — requested
by Buje, 1" — a voter whose name is literally `1`. The board prints the first
word of each of the first three voters' names
(`views/requests.ejs`), so junk reaches the storefront with no way to correct it.

It costs more than looks. `lib/requests.js` keeps the voter list precisely so
the owner can message the waiting list once a game is stocked. A voter named
`1` is a vote that can never be acted on.

Today the admin panel renders voter names as read-only text
(`views/partials/admin/games.ejs`). The owner can approve, reject, mark
stocked, delete the whole request, or replace its cover — but cannot touch a
single vote. The only way to remove one bad name is to delete the entire
request and lose every legitimate vote with it.

## The change

Each voter in the admin request row becomes an editable line: a text input
holding the name, a **Save** button, and a **✕** that removes that vote.
Everything else in the row — the count, the cover, Approve / Reject / Mark
stocked / Delete — is untouched.

Two admin-only routes back it, both behind `requireAuth` like every other
request route:

| Route | Does |
|---|---|
| `POST /admin/requests/:slug/voter/rename` | Sets one voter's `fb_name` |
| `POST /admin/requests/:slug/voter/remove` | Pulls that voter from the array |

### Identifying a voter

By their `at` timestamp, not their index in the array. Index is racy: a
customer voting between the admin's page load and their click would shift
every position and the edit would land on the wrong person. Every voter
already carries `at` — both `createRequest` and `addVote` set it — so this
needs no migration and no new field.

### Rules

- **`session_id` survives a rename.** The update sets only `fb_name`, through a
  MongoDB `arrayFilters` `$set`. `_hasVoted()` dedups on `session_id` *or*
  name, so clearing `session_id` would silently let a renamed voter vote a
  second time.
- **Renaming to a name already on the same request is refused**,
  case-insensitively — the rule `_hasVoted()` already applies to new votes.
  Without it, two real people could be merged under one name, inflating the
  count with a duplicate.
- **A blank name is refused.** `1` is bad; empty is worse.
- **No counter to maintain.** The vote count is `voters.length` at every read
  site, so removing a voter decrements it on the admin panel and the public
  board at once. Nothing can drift.
- **Any status is editable.** Cleaning up a *stocked* request's list is exactly
  what happens right before messaging everyone.

## Out of scope

- No manual vote-adding. Counts stay customer-driven.
- No change to `views/requests.ejs`. It re-reads `voters`, so corrected names
  appear on the public board with no edit there.
- No change to how customers submit requests or cast votes.
- No change to approve / reject / stock / delete / cover behaviour.

## Verification

Live on `https://playstation-hub.com` after deploy:

- Renaming the `1` voter on Sudden Strike 4 to a real name updates the admin
  row, and `/requests` then shows that name instead of `1`.
- Removing a voter drops the count by one on both the admin panel and
  `/requests`.
- Renaming a voter to a name already voting on that same request is refused
  with a message, and changes nothing.
- Saving a blank name is refused with a message, and changes nothing.
- A renamed voter still cannot cast a second vote from the same browser
  session, proving `session_id` survived.
- No console errors.
