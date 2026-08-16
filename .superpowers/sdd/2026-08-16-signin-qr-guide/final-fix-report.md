# Sign-In QR Guide — Final Fix Report

## 1. No save confirmation / accordion collapses after edit

File: `views/admin.ejs`

- Lines ~436–446: added `id="ssgAccordionHeader"` to the Sign-In QR Guide
  `.settings-accordion-header` and `id="ssgAccordionBody"` to its
  `.settings-accordion-body`, so the accordion can be targeted directly
  instead of only via `toggleAccordion(this)`'s click-time `this` reference.
- Line ~512 (inside the existing `ssgSwitch` function): now also writes the
  active console to `sessionStorage.setItem('ssgAdminConsole', cons)` on every
  tab switch.
- Line ~3589 (`msgTabMap`): added `signin_step_saved:'settings'` and
  `signin_step_deleted:'settings'` so the settings tab is selected after a
  step save/delete.
- Line ~3598 (`messages` toast map): added `signin_step_saved:'✅ Step saved!'`
  and `signin_step_deleted:'🗑 Step deleted!'`, giving those redirects an
  actual toast banner (previously they rendered no confirmation at all,
  since no `msg` handling existed for them anywhere).
- Lines ~3607–3620 (toast-handling IIFE): after showing the toast, added a
  check for `msg` starting with `signin_step_` that adds the `open` class to
  `#ssgAccordionHeader` / `#ssgAccordionBody` directly, so the accordion is
  force-open on load instead of resetting closed.
- Lines ~3621–3625: added a load-time restore that reads
  `sessionStorage.getItem('ssgAdminConsole')` and calls `ssgSwitch('ps4')` if
  it was `'ps4'`, so the PS5/PS4 tab selection also survives the reload,
  independent of the toast/msg logic.

## 2. Cross-instance toggle desync in shared partial

File: `views/partials/signin-guide.ejs`, lines ~30–49.

- `ssgGuideSwitch(id, cons)` no longer looks up a single root by `id`. It now
  iterates `document.querySelectorAll('.ssg-guide')` and updates every
  instance's tabs/panels to `cons`, then writes to `sessionStorage` once.
  (`id` is still accepted as a parameter for backward compatibility with the
  existing `onclick="ssgGuideSwitch('<%= ssgId %>','ps5')"` call sites, but is
  no longer used to scope the update.)
- Removed the separate `DOMContentLoaded` sibling-sync loop over all
  `.ssg-guide` roots; replaced with a single call to `ssgGuideSwitch` (against
  whichever root exists) since the function itself now updates every
  instance on the page.

## 3. Brittle id derivation

File: `views/partials/signin-guide.ejs`, line ~46 (the `DOMContentLoaded`
restore block).

- Changed `g.id.replace('-guide','')` (now `first.id.replace(...)` after the
  fix-2 refactor) to `first.id.slice(0, -6)`, since `-guide` is always
  exactly 6 characters and is appended deterministically earlier in this same
  file (`id="<%= ssgId %>-guide"`).

## Verification

```
$ node -c server.js
(no output)

$ node -e "const ejs=require('ejs'); const fs=require('fs'); ['views/admin.ejs','views/partials/signin-guide.ejs'].forEach(f=>{ejs.compile(fs.readFileSync(f,'utf8')); console.log(f,'OK')})"
views/admin.ejs OK
views/partials/signin-guide.ejs OK
```
