# Coming soon — PlayStation pictures and game info — Design

Date: 2026-10-10 · Status: approved by owner

Builds on `2026-10-10-upcoming-from-playstation-design.md` (the "Update from
PlayStation" button on Admin → Games → Coming soon).

## Problem

A released game's page shows PlayStation's data (`game.psn`, from
`lib/psn-game.js` `fetchGameInfo`): a trailer + screenshots slider in place of the
cover, the store rating and tagline under the title, "About this game" with Read
more, and a "Game info" table. A Coming soon page (`views/upcoming-detail.ejs`)
shows none of that:

- Games added from PlayStation (live: Castlevania, Final Fantasy Resonance) show
  their screenshots only at the very bottom ("Gameplay") and their 1,786-character
  description as one block under the poster, line breaks lost.
- Games added by hand (live: Call of Duty MW4, GTA VI, Phantom Blade Zero, Rayman
  Legends Retold) have no pictures or description at all, and nothing fetches them.

## Decisions made with the owner

- **Same page as released games.** Coming soon pages get the same PlayStation
  blocks, built by the same code.
- **The existing Update button fills in existing games.** Its list gains a "Get
  PlayStation info" section; no separate button, no per-game box.
- **The owner's own text and pictures win**; PlayStation fills only what the owner
  left empty (the rule `lib/game-psn-view.js` already applies to released games).

## The Coming soon page

`GET /upcoming/:slug` passes `psnView: buildGamePsnView(resolvedGame)` (from
`lib/game-psn-view.js`, unchanged). `views/upcoming-detail.ejs`, following
`views/game-detail.ejs`:

- Loads `/css/game-psn.css`, and `/js/game-media.js` (defer) when
  `psnView.media.length || psnView.about`.
- Under the title: `partials/game-psn-headline` when `psnView.hasPsn`.
- Poster column: `partials/game-psn-media` when `psnView.media.length`, otherwise
  the cover as today. Platform badge and slot banners stay.
- The description paragraph under the poster shows only when `!psnView.hasPsn`;
  with PlayStation data, `partials/game-psn-about` (About + Game info) takes its
  place in the poster column.
- The bottom "Gameplay" section is left out when `psnView.hideGallery`.
- A game without `psn` renders exactly as today.

What `buildGamePsnView` does with an upcoming record (no change to it):
pictures are the owner's `gallery` if any, else PlayStation's screenshots; the
trailer (at most one) always comes from PlayStation; About is the owner's
description if any, else PlayStation's; Game info rows are release date (the
record's `release_date`), genre, publisher, platform, voices and age rating.

## The Update button

### New list section: "Get PlayStation info (N)"

`lib/upcoming-psn.js` `buildPreview` adds `infoUpdates`: every Coming soon game
whose `psn` is missing, has no `fetched_at`, or was fetched more than 7 days ago
(the same 7 days as released games' `PSN_FRESH_MS`). Each item:
`{ id, title, concept_id }`, where `concept_id` is the PlayStation game this run
matched it to in the feed, else its stored `psn_concept_id`, else `''`.

The panel (`views/partials/admin/games/psn-update.ejs`) shows it after "Release
date changed": one row per game — tick box (ticked, `name="info"`,
`value=<upcoming id>`), title, and in small text "Matched on PlayStation" when it
has a concept id or "Will search by name" when not. Note under it: "Trailer,
screenshots, rating and game info from PlayStation. Your own description and
pictures stay." Games in this section still appear in "Already on your site" when
the feed matched them.

The gold button's words gain the count: `applyLabel(adds, dates, infos)` →
"Add 2 games · update 1 date · get info for 4"; with only infos ticked, "Get info
for 4 games" ("Get info for 1 game"). Same rule in
`public/js/admin-upcoming-psn.js`, counting `[data-gmp-info]:checked`. Up-to-date
means no new games, no date changes and no info updates.

### Apply

`readForm` reads `info` (repeated upcoming ids, positive whole numbers).
"Nothing ticked" now means no adds, no dates and no infos. `planApply` returns
`infoUpdates: [{ id, concept_id }]` — only ids offered in the preview whose
record still exists.

For each info update (3 at a time, alongside the adds):
`fetchGameInfo({ title, psn_link })` with `psn_link` =
`https://store.playstation.com/en-us/concept/<concept_id>` when known, else ''
(title search). On success the record gets `psn` (the result as stored for
released games) and, when it had none, `psn_concept_id` = the result's
`concept_id`. Nothing else on the record changes. `no_match` counts as not found;
any other failure counts as failed. Both leave the record untouched, so it is
offered again next time.

New games added by the same apply also keep `psn` (the `fetchGameInfo` result
`buildRecord` already fetches), so they get the full blocks straight away.

Redirect: `psn_upcoming_applied` or `psn_upcoming_partial` with
`&added=X&dates=Y&info=Z&missing=M` (M = not found + failed). Partial when a new
game lacks cover or description, or M > 0. Toasts:

- applied: "✅ Added {added} · updated {dates} · got info for {info}"
- partial: "⚠ Added {added} · updated {dates} · got info for {info} — {missing}
  couldn't be found or downloaded; check the title in Edit."

with `{info}` → "N game(s)" and `{missing}` → "N game(s)", like `{added}`.

## Release

`lib/release.js` `releasedGameRecord` copies `psn` and `psn_concept_id` when the
Coming soon record has them, so the released game's page shows the same blocks.

## Testing

Throwaway data only (temp `DATA_DIR`, blank `MONGODB_URI`, in-memory sessions,
made-up admin password); PlayStation and image downloads stubbed.

- `scripts/test-upcoming-psn.js` — `infoUpdates` (no psn, stale psn, fresh psn
  excluded, concept id from feed match / stored id / none), `readForm` info ids,
  `planApply` info updates (offered and existing only), `applyLabel` with infos,
  `buildRecord` keeps `psn`.
- `scripts/test-admin-upcoming-psn.js` — apply fills `psn` on ticked games only,
  by concept link or by title, leaves prices/slots/cover/description untouched,
  counts not-found and failed in `missing`, new games keep `psn`, info-only apply
  works.
- `scripts/test-admin-upcoming-psn-page.js` — the new section, its ticks and
  words, the button words, the toast placeholders.
- `scripts/test-upcoming-psn-page-public.js` (new) — `/upcoming/<slug>` with psn:
  slider, headline, About, Game info, no description paragraph, no bottom gallery
  when hidden; owner description wins; without psn: unchanged page.
- `scripts/test-release.js` — `releasedGameRecord` copies `psn` and
  `psn_concept_id`, and omits them when absent.
- The full suite stays green except the known `scripts/test-requests-page.js`.

## Out of scope

- A per-game PlayStation box on the upcoming Edit page (owner chose the shared
  button); fixing a not-found game is done by correcting its title in Edit.
- Downloading PlayStation's screenshots for existing games (they play from
  PlayStation's servers, like released games).
- Changing released game pages.

## Rollout

Direct on `main`, pushed when the owner says push.
