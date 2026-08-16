# Sign-In QR Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give customers an admin-editable, illustrated step-by-step guide (per console: PS5/PS4) for producing a sign-in QR, shown while their payment is being checked, at the `awaiting_qr` order step, and at a standalone public page — so they can just send the QR on Messenger without a manual explanation.

**Architecture:** A new lowdb collection `signin_steps` (id, console, rank, text, image, created_at) holds ordered step rows per console, seeded with default text on first read. One shared EJS partial (`partials/signin-guide.ejs`) renders the console-toggle + step list from that data; it's included in three places — the `verifying_payment` and `awaiting_qr` states of `order-status.ejs`, and a new standalone `GET /how-to-sign-in` page — so editing steps in admin updates all three at once. Screenshots reuse the existing `processUploadedImage` pipeline (WebP, resized, same as payment-method QR images).

**Tech Stack:** Express, EJS, lowdb, multer + sharp (existing `processUploadedImage`), vanilla JS.

## Global Constraints

- Steps are edited individually (add/edit/delete/reorder), never as one bulk form — matches the spec's requirement that uploading one screenshot never risks re-submitting or losing the others.
- Seed default text-only steps for both consoles on first read (no blocking on screenshots to ship).
- Console toggle defaults to PS5 unless the customer already picked PS4 earlier in the same session (`sessionStorage`).
- Upload stays the primary action at the `awaiting_qr` step (it's the tracked path — advances state, starts the countdown, appears in the owner's queue); "Send on Messenger" is secondary.
- The account-type setup copy already on game pages (Console Sharing, Activate as Primary PS4) is untouched — out of scope per the spec.

---

### Task 1: Data model + admin CRUD routes

**Files:**
- Modify: `server.js` — db.defaults block (~line 100-146), a new `getSigninSteps()` helper near the other `getX()` helpers (~line 425), and new routes near the `bot_training` routes (~line 4050-4069)

**Interfaces:**
- Produces: `getSigninSteps()` → `{ ps5: [{id, console, rank, text, image, created_at}, ...], ps4: [...] }`, each array sorted by `rank` ascending. Routes: `POST /admin/signin-steps/add`, `POST /admin/signin-steps/:id` (edit), `POST /admin/signin-steps/:id/delete`, `POST /admin/signin-steps/:id/move` (body: `dir` = `'up'`|`'down'`, swaps rank with the adjacent step in the same console).

- [ ] **Step 1: Add the collection default and seed-on-first-read**

In `server.js`, add to the `db.defaults({...})` block (near `bot_training: [],` / `nextBotTrainingId: 1,`):

```js
  signin_steps: [],
  nextSigninStepId: 1,
```

Immediately after the `db.defaults(...).write();` call, add the seed (mirrors the `message_templates` seed-on-first-read pattern — runs once, only if the collection is empty, so re-deploys never duplicate steps):

```js
// Seed default sign-in steps on first run only — an owner who has already
// edited/reordered these should never have them silently reset.
if (!db.get('signin_steps').value().length) {
  const DEFAULT_SIGNIN_STEPS = [
    { console: 'ps5', text: 'On your PS5, go to Settings → Users and Accounts → Users' },
    { console: 'ps5', text: 'Select your profile, then choose "Sign in with PS App" so the QR code appears on screen' },
    { console: 'ps5', text: 'Take a photo of the QR code and send it to us' },
    { console: 'ps4', text: 'On your PS4, go to Settings → Login Settings → Sign In' },
    { console: 'ps4', text: 'Choose "Sign in with QR Code" so the QR code appears on screen' },
    { console: 'ps4', text: 'Take a photo of the QR code and send it to us' }
  ];
  let nextId = db.get('nextSigninStepId').value();
  const seeded = DEFAULT_SIGNIN_STEPS.map((s, i) => {
    const byConsole = DEFAULT_SIGNIN_STEPS.filter(x => x.console === s.console);
    const rank = byConsole.indexOf(s);
    return Object.assign({ id: nextId++, rank, image: null, created_at: new Date().toISOString() }, s);
  });
  db.set('signin_steps', seeded).write();
  db.set('nextSigninStepId', nextId).write();
}
```

- [ ] **Step 2: Add the `getSigninSteps()` helper**

Near the other `getX()` helpers (e.g. right after `function getPsplusSlots()`), add:

```js
function getSigninSteps() {
  const all = db.get('signin_steps').value() || [];
  const sortByRank = (a, b) => a.rank - b.rank;
  return {
    ps5: all.filter(s => s.console === 'ps5').sort(sortByRank),
    ps4: all.filter(s => s.console === 'ps4').sort(sortByRank)
  };
}
```

- [ ] **Step 3: Verify syntax**

Run: `node -c server.js`
Expected: no output (success). There is no local dev server for this project — the seed logic and helper are verified live after deploy, in Task 5.

- [ ] **Step 4: Add the admin CRUD routes**

Add near the `bot_training` routes (after `app.post('/admin/bot-training/delete/:id', ...)`):

```js
// ── Sign-In QR Guide ──────────────────────────────────────────────────────────
// Each step is added/edited/deleted individually — never as one bulk form —
// so uploading one screenshot can never risk re-submitting or losing the others.
const uploadSigninStep = multer({
  storage,
  fileFilter: (req, file, cb) => cb(null, /jpeg|jpg|png|gif|webp/.test(file.mimetype)),
  limits: { fileSize: 8 * 1024 * 1024 }
});

app.post('/admin/signin-steps/add', requireAuth, uploadSigninStep.single('image'), async (req, res) => {
  const { console: cons, text } = req.body;
  if (!['ps5', 'ps4'].includes(cons) || !text || !text.trim()) {
    return res.redirect('/admin?tab=settings&msg=error');
  }
  const image = req.file ? await processUploadedImage(req.file, 900) : null;
  const existing = db.get('signin_steps').filter({ console: cons }).value();
  const rank = existing.length ? Math.max(...existing.map(s => s.rank)) + 1 : 0;
  const id = db.get('nextSigninStepId').value();
  db.get('signin_steps').push({
    id, console: cons, rank, text: text.trim(), image, created_at: new Date().toISOString()
  }).write();
  db.set('nextSigninStepId', id + 1).write();
  res.redirect('/admin?tab=settings&msg=signin_step_saved');
});

app.post('/admin/signin-steps/:id', requireAuth, uploadSigninStep.single('image'), async (req, res) => {
  const id = parseInt(req.params.id);
  const step = db.get('signin_steps').find({ id }).value();
  if (!step) return res.redirect('/admin?tab=settings&msg=error');
  const patch = { text: (req.body.text || step.text).trim() };
  if (req.body.remove_image === 'on' && step.image) {
    const fp = path.join(uploadsDir, path.basename(step.image));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    patch.image = null;
  } else if (req.file) {
    if (step.image) {
      const oldFp = path.join(uploadsDir, path.basename(step.image));
      if (fs.existsSync(oldFp)) fs.unlinkSync(oldFp);
    }
    patch.image = await processUploadedImage(req.file, 900);
  }
  db.get('signin_steps').find({ id }).assign(patch).write();
  res.redirect('/admin?tab=settings&msg=signin_step_saved');
});

app.post('/admin/signin-steps/:id/delete', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const step = db.get('signin_steps').find({ id }).value();
  if (step && step.image) {
    const fp = path.join(uploadsDir, path.basename(step.image));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.get('signin_steps').remove({ id }).write();
  res.redirect('/admin?tab=settings&msg=signin_step_deleted');
});

app.post('/admin/signin-steps/:id/move', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const dir = req.body.dir === 'up' ? -1 : req.body.dir === 'down' ? 1 : 0;
  const step = db.get('signin_steps').find({ id }).value();
  if (!step || !dir) return res.redirect('/admin?tab=settings&msg=error');
  const siblings = db.get('signin_steps').filter({ console: step.console }).sortBy('rank').value();
  const idx = siblings.findIndex(s => s.id === id);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= siblings.length) return res.redirect('/admin?tab=settings&msg=signin_step_saved');
  const swapWith = siblings[swapIdx];
  const stepRank = step.rank;
  db.get('signin_steps').find({ id: step.id }).assign({ rank: swapWith.rank }).write();
  db.get('signin_steps').find({ id: swapWith.id }).assign({ rank: stepRank }).write();
  res.redirect('/admin?tab=settings&msg=signin_step_saved');
});
```

- [ ] **Step 5: Verify syntax**

Run: `node -c server.js`
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: sign-in QR guide data model and admin CRUD routes"
```

---

### Task 2: Admin settings UI

**Files:**
- Modify: `views/admin.ejs` — new settings accordion section (place it after the "Promo & Pricing Rules" accordion, ~line 419, matching that section's exact pattern), and the render call passing `signinSteps` into the template context
- Modify: `server.js` — the `app.get('/admin', ...)` render route (find via `res.render('admin', {`) to add `signinSteps: getSigninSteps()` to the passed context

**Interfaces:**
- Consumes: `getSigninSteps()` from Task 1 (`{ ps5: [...], ps4: [...] }`)

- [ ] **Step 1: Pass `signinSteps` into the admin render context**

In `server.js`, find the `res.render('admin', { games, upcoming, ... })` call (the one that already includes `orderQueue, refundsOwed, ...`). Add `signinSteps: getSigninSteps(),` anywhere in that object.

- [ ] **Step 2: Add the accordion section to admin.ejs**

Insert this new accordion block into `views/admin.ejs` immediately after the closing `</div>` of the Promo & Pricing Rules accordion (the one with `border-left:3px solid #22c55e;` at its header):

```html
    <!-- SIGN-IN QR GUIDE -->
    <div class="settings-accordion">
      <div class="settings-accordion-header" onclick="toggleAccordion(this)" style="border-left:3px solid #38bdf8;">
        <div class="sa-left">
          <div class="sa-icon" style="background:rgba(56,189,248,0.15);">📷</div>
          <div>
            <div class="sa-title">Sign-In QR Guide</div>
            <div class="sa-desc">Step-by-step, with screenshots, for PS5 and PS4</div>
          </div>
        </div>
        <span class="sa-arrow">▼</span>
      </div>
      <div class="settings-accordion-body">
    <div style="border-color:rgba(56,189,248,0.3);background:linear-gradient(135deg,#04141c,#071d2a);padding:1.25rem;">
      <div style="display:flex;gap:0.5rem;margin-bottom:1rem;">
        <button type="button" class="ssg-tab ssg-tab-on" data-c="ps5" onclick="ssgSwitch('ps5')">PS5 steps</button>
        <button type="button" class="ssg-tab" data-c="ps4" onclick="ssgSwitch('ps4')">PS4 steps</button>
      </div>

      <% ['ps5', 'ps4'].forEach(cons => { %>
      <div class="ssg-panel<%= cons === 'ps5' ? '' : ' ssg-hidden' %>" data-c="<%= cons %>">
        <% signinSteps[cons].forEach((s, i) => { %>
        <div style="border:1px solid #1a3a4a;border-radius:8px;padding:0.6rem 0.75rem;margin-bottom:0.5rem;background:#0a1a24;">
          <form method="POST" action="/admin/signin-steps/<%= s.id %>" enctype="multipart/form-data" style="display:flex;gap:0.6rem;align-items:flex-start;">
            <span style="color:#555;font-size:0.8rem;padding-top:0.5rem;width:16px;flex-shrink:0;"><%= i + 1 %></span>
            <div style="flex:1;min-width:0;">
              <input type="text" name="text" value="<%= s.text %>" style="width:100%;background:#111;border:1px solid #222;border-radius:6px;padding:0.5rem 0.7rem;color:#fff;font-size:0.85rem;margin-bottom:0.4rem;">
              <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;">
                <% if (s.image) { %>
                <img src="<%= s.image %>" style="width:48px;height:38px;object-fit:cover;border-radius:4px;border:1px solid #222;">
                <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.72rem;color:#e74c3c;cursor:pointer;">
                  <input type="checkbox" name="remove_image" style="width:13px;height:13px;">Remove
                </label>
                <% } %>
                <input type="file" name="image" accept="image/*" style="font-size:0.72rem;color:#888;max-width:180px;">
                <button type="submit" style="font-size:0.72rem;padding:0.3rem 0.7rem;background:#38bdf8;color:#000;border:none;border-radius:5px;font-weight:700;cursor:pointer;">Save</button>
              </div>
            </div>
          </form>
          <div style="display:flex;gap:0.4rem;margin-top:0.4rem;padding-left:26px;">
            <form method="POST" action="/admin/signin-steps/<%= s.id %>/move">
              <input type="hidden" name="dir" value="up">
              <button type="submit" <%= i === 0 ? 'disabled' : '' %> style="font-size:0.7rem;padding:0.2rem 0.5rem;background:#1a1a1a;color:#aaa;border:1px solid #222;border-radius:4px;cursor:pointer;">↑</button>
            </form>
            <form method="POST" action="/admin/signin-steps/<%= s.id %>/move">
              <input type="hidden" name="dir" value="down">
              <button type="submit" <%= i === signinSteps[cons].length - 1 ? 'disabled' : '' %> style="font-size:0.7rem;padding:0.2rem 0.5rem;background:#1a1a1a;color:#aaa;border:1px solid #222;border-radius:4px;cursor:pointer;">↓</button>
            </form>
            <form method="POST" action="/admin/signin-steps/<%= s.id %>/delete" onsubmit="return confirm('Delete this step?');">
              <button type="submit" style="font-size:0.7rem;padding:0.2rem 0.5rem;background:#2a0a0a;color:#ef4444;border:1px solid #4a1e1e;border-radius:4px;cursor:pointer;">Delete</button>
            </form>
          </div>
        </div>
        <% }) %>

        <form method="POST" action="/admin/signin-steps/add" enctype="multipart/form-data" style="border:1px dashed #2a4a5a;border-radius:8px;padding:0.75rem;margin-top:0.5rem;">
          <input type="hidden" name="console" value="<%= cons %>">
          <input type="text" name="text" placeholder="New step text…" required style="width:100%;background:#111;border:1px solid #222;border-radius:6px;padding:0.5rem 0.7rem;color:#fff;font-size:0.85rem;margin-bottom:0.4rem;">
          <div style="display:flex;align-items:center;gap:0.6rem;">
            <input type="file" name="image" accept="image/*" style="font-size:0.72rem;color:#888;">
            <button type="submit" style="font-size:0.75rem;padding:0.35rem 0.9rem;background:#38bdf8;color:#000;border:none;border-radius:5px;font-weight:700;cursor:pointer;">+ Add step</button>
          </div>
        </form>
      </div>
      <% }) %>

      <div style="margin-top:1rem;font-size:0.72rem;color:#555;">Also live at <code>/how-to-sign-in</code> — link it in Messenger anytime.</div>
    </div>
      </div>
    </div>

    <style>
      .ssg-tab { font-size:0.78rem; padding:0.4rem 1rem; background:#111; color:#888; border:1px solid #222; border-radius:6px; cursor:pointer; }
      .ssg-tab-on { background:#38bdf8; color:#000; font-weight:700; border-color:#38bdf8; }
      .ssg-hidden { display:none; }
    </style>
    <script>
      function ssgSwitch(cons) {
        document.querySelectorAll('.ssg-tab').forEach(function(t){ t.classList.toggle('ssg-tab-on', t.dataset.c === cons); });
        document.querySelectorAll('.ssg-panel').forEach(function(p){ p.classList.toggle('ssg-hidden', p.dataset.c !== cons); });
      }
    </script>
```

- [ ] **Step 3: Verify EJS compiles**

Run: `node -e "require('ejs').compile(require('fs').readFileSync('views/admin.ejs','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 4: Verify server syntax**

Run: `node -c server.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add server.js views/admin.ejs
git commit -m "feat: sign-in QR guide admin editor UI"
```

---

### Task 3: Shared guide partial + wire into order-status.ejs

**Files:**
- Create: `views/partials/signin-guide.ejs`
- Modify: `views/order-status.ejs` — the `verifying_payment` block (currently just `awaiting_payment`/`payment_rejected` share one block; `verifying_payment` today renders no step block at all, only the title/sub at the top) and the `awaiting_qr` block (~line 174-189)
- Modify: `server.js` — the `app.get('/order/:ref', ...)` route (~line 1379) to pass `signinSteps: getSigninSteps()` into the render context

**Interfaces:**
- Consumes: `getSigninSteps()` from Task 1
- Produces: `partials/signin-guide.ejs`, included as `<%- include('partials/signin-guide', { signinSteps, idPrefix: '<unique-string>' }) %>` — `idPrefix` keeps DOM ids unique when the partial is included more than once on a page (it isn't, on any single page here, but the prefix is included for that reason since two different pages both include it).

- [ ] **Step 1: Create the shared partial**

Write `views/partials/signin-guide.ejs`:

```html
<%
  // idPrefix keeps element ids unique if this partial is ever included twice
  // on the same page. locals.idPrefix may be undefined on some includes.
  const ssgId = (typeof idPrefix !== 'undefined' && idPrefix) ? idPrefix : 'ssg';
%>
<div class="ssg-guide" id="<%= ssgId %>-guide">
  <div class="ssg-guide-tabs">
    <button type="button" class="ssg-guide-tab ssg-guide-tab-on" data-c="ps5" onclick="ssgGuideSwitch('<%= ssgId %>','ps5')">PS5</button>
    <button type="button" class="ssg-guide-tab" data-c="ps4" onclick="ssgGuideSwitch('<%= ssgId %>','ps4')">PS4</button>
  </div>
  <% ['ps5', 'ps4'].forEach(cons => { %>
  <div class="ssg-guide-panel<%= cons === 'ps5' ? '' : ' ssg-guide-hidden' %>" data-c="<%= cons %>">
    <% if (!signinSteps[cons].length) { %>
    <p class="ssg-guide-empty">Steps for <%= cons.toUpperCase() %> haven't been added yet — message us and we'll walk you through it.</p>
    <% } %>
    <% signinSteps[cons].forEach((s, i) => { %>
    <div class="ssg-guide-step">
      <span class="ssg-guide-num"><%= i + 1 %></span>
      <div class="ssg-guide-body">
        <p class="ssg-guide-text"><%= s.text %></p>
        <% if (s.image) { %>
        <img src="<%= s.image %>" alt="Step <%= i + 1 %>" class="ssg-guide-img">
        <% } %>
      </div>
    </div>
    <% }) %>
  </div>
  <% }) %>
</div>
<script>
  if (!window.ssgGuideSwitch) {
    window.ssgGuideSwitch = function(id, cons) {
      var root = document.getElementById(id + '-guide');
      if (!root) return;
      root.querySelectorAll('.ssg-guide-tab').forEach(function(t){ t.classList.toggle('ssg-guide-tab-on', t.dataset.c === cons); });
      root.querySelectorAll('.ssg-guide-panel').forEach(function(p){ p.classList.toggle('ssg-guide-hidden', p.dataset.c !== cons); });
      try { sessionStorage.setItem('ssgConsole', cons); } catch (e) {}
    };
    // Restore the customer's last-picked console across every instance of
    // this partial on the page (there's at most one per page today, but this
    // stays correct if that ever changes).
    document.addEventListener('DOMContentLoaded', function() {
      var saved = null;
      try { saved = sessionStorage.getItem('ssgConsole'); } catch (e) {}
      if (saved === 'ps4') {
        document.querySelectorAll('.ssg-guide').forEach(function(g){ window.ssgGuideSwitch(g.id.replace('-guide',''), 'ps4'); });
      }
    });
  }
</script>
```

- [ ] **Step 2: Add the partial's CSS to `public/css/style.css`**

Append:

```css
.ssg-guide-tabs { display: flex; gap: 0.5rem; margin-bottom: 0.85rem; }
.ssg-guide-tab { font-size: 0.8rem; padding: 0.4rem 1.1rem; background: #111; color: #888; border: 1px solid #222; border-radius: 6px; cursor: pointer; }
.ssg-guide-tab-on { background: var(--ps-blue); color: #fff; font-weight: 700; border-color: var(--ps-blue); }
.ssg-guide-hidden { display: none; }
.ssg-guide-empty { font-size: 0.82rem; color: #888; }
.ssg-guide-step { display: flex; gap: 0.7rem; align-items: flex-start; margin-bottom: 0.85rem; }
.ssg-guide-num { flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; background: rgba(0,112,209,0.15); color: var(--ps-blue); font-size: 0.75rem; display: flex; align-items: center; justify-content: center; }
.ssg-guide-body { flex: 1; min-width: 0; }
.ssg-guide-text { font-size: 0.82rem; color: #ccc; margin: 0 0 0.4rem; line-height: 1.45; }
.ssg-guide-img { max-width: 100%; border-radius: 8px; border: 1px solid #222; display: block; }
```

- [ ] **Step 3: Pass `signinSteps` from the order route**

In `server.js`, in `app.get('/order/:ref', ...)`, add `signinSteps: getSigninSteps(),` to the `res.render('order-status', {...})` context object.

- [ ] **Step 4: Add the "get ready" prompt to the `verifying_payment` state**

In `views/order-status.ejs`, immediately after the `</div>` that closes `<div class="ord-card">` (the block ending at the line with `<% } %>` right before `<% if (order.state === 'awaiting_payment' ...`), insert:

```html
  <% if (order.state === 'verifying_payment') { %>
  <div class="ord-step" style="border:2px solid var(--border-accent, #185fa5);background:rgba(24,95,165,0.08);">
    <div class="ord-step-label">While you wait — get your console ready</div>
    <p class="ord-help">Next we'll ask for a sign-in QR from your PlayStation. Getting it ready now means you start playing sooner.</p>
    <details>
      <summary style="cursor:pointer;font-size:0.82rem;color:var(--ps-blue);font-weight:700;">Show me how</summary>
      <div style="margin-top:0.85rem;">
        <%- include('partials/signin-guide', { signinSteps, idPrefix: 'wait' }) %>
      </div>
    </details>
  </div>
  <% } %>
  ```

- [ ] **Step 5: Replace the single-line instruction in `awaiting_qr` with the full guide**

In `views/order-status.ejs`, replace:

```html
    <p class="ord-help">On your console, open the sign-in screen so the QR code is showing, take a photo of it, and upload it here. Your QR is only good for about 10 minutes.</p>
```

with:

```html
    <%- include('partials/signin-guide', { signinSteps, idPrefix: 'qr' }) %>
    <p class="ord-help" style="margin-top:0.85rem;">Your QR is only good for about 10 minutes — send it right away.</p>
```

- [ ] **Step 6: Make "Send on Messenger" a visible secondary button beside the upload form**

Immediately after the closing `</form>` of the QR upload form in the `awaiting_qr` block, add:

```html
    <% if (mmLink) { %>
    <a class="ord-btn-secondary" style="display:block;text-align:center;margin-top:0.6rem;" target="_blank" rel="noopener" href="<%= mmLink %>">Send on Messenger instead</a>
    <% } %>
```

- [ ] **Step 7: Verify EJS compiles**

Run: `node -e "
const ejs = require('ejs');
const fs = require('fs');
['views/order-status.ejs','views/partials/signin-guide.ejs'].forEach(f => { ejs.compile(fs.readFileSync(f,'utf8')); console.log(f, 'OK'); });
"`
Expected: both print `OK`.

- [ ] **Step 8: Verify server syntax**

Run: `node -c server.js`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add server.js views/order-status.ejs views/partials/signin-guide.ejs public/css/style.css
git commit -m "feat: illustrated sign-in guide on the order-status page"
```

---

### Task 4: Public `/how-to-sign-in` page + footer link

**Files:**
- Create: `views/how-to-sign-in.ejs`
- Modify: `server.js` — new `app.get('/how-to-sign-in', ...)` route (add it near the other simple content routes, e.g. next to `app.get('/how-it-works', ...)`)
- Modify: `views/partials/footer.ejs` — add the link under "Get In Touch"

**Interfaces:**
- Consumes: `getSigninSteps()` from Task 1, `partials/signin-guide.ejs` from Task 3

- [ ] **Step 1: Add the route**

In `server.js`, find `app.get('/how-it-works', (req, res) => {` and add immediately after its closing `});`:

```js
app.get('/how-to-sign-in', (req, res) => {
  res.render('how-to-sign-in', {
    signinSteps: getSigninSteps(),
    announcement: getAnnouncement(),
    announcements: getAnnouncements(),
    settings: getSiteSettings()
  });
});
```

- [ ] **Step 2: Create the view**

Write `views/how-to-sign-in.ejs`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>How to sign in and send your QR — Playstation Hub</title>
  <link rel="icon" href="<%= settings.favicon_path %>" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
<%- include('partials/announcement') %>
<%- include('partials/nav', { active: '' }) %>

<div class="ord-page">
  <h1 class="ord-title">How to sign in and send your QR</h1>
  <p class="ord-sub">Pick your console below, follow the steps, then send the QR code here on Messenger.</p>

  <div class="ord-card">
    <%- include('partials/signin-guide', { signinSteps, idPrefix: 'pub' }) %>
  </div>

  <a class="ord-btn-primary" style="display:block;text-align:center;margin-top:1rem;" target="_blank" rel="noopener" href="http://m.me/PlaystationHub00">Message us on Facebook</a>
</div>

<%- include('partials/footer') %>
</body>
</html>
```

- [ ] **Step 3: Add the footer link**

In `views/partials/footer.ejs`, in the "Get In Touch" column, add a line right after the "Message Us on Messenger" link:

```html
        <a href="/how-to-sign-in">How to Sign In</a>
```

- [ ] **Step 4: Verify EJS compiles**

Run: `node -e "require('ejs').compile(require('fs').readFileSync('views/how-to-sign-in.ejs','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 5: Verify server syntax**

Run: `node -c server.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add server.js views/how-to-sign-in.ejs views/partials/footer.ejs
git commit -m "feat: public /how-to-sign-in guide page"
```

---

### Task 5: Deploy and verify live

**Files:** none (verification only)

- [ ] **Step 1: Push to main**

```bash
git push
```

- [ ] **Step 2: Wait for Railway rollover, then confirm the deploy is live**

Poll `curl -s -o /dev/null -w "%{http_code}" https://playstation-hub.com/` every ~10s until it returns `200`, then wait an additional ~25-30s for the new instance to fully take over.

- [ ] **Step 3: Verify the admin editor live**

Log into `/admin` (password `Ryuzaki2300`), open Settings → "Sign-In QR Guide", confirm both PS5 and PS4 tabs show the 3 seeded default steps each, add a test step with a screenshot, confirm it appears, reorder it, then delete it and confirm it's gone.

- [ ] **Step 4: Verify the public page live**

Visit `https://playstation-hub.com/how-to-sign-in`, confirm the PS5/PS4 toggle works and steps render, confirm the footer link on any page points to it.

- [ ] **Step 5: Verify the order-status integration live**

Using the same synthetic-order technique established earlier this session (`fetch('/order/create-psplus', ...)` or a real game order), walk a test order to `verifying_payment` and confirm the collapsible "get ready" prompt appears; advance it to `awaiting_qr` and confirm the full illustrated guide renders above the upload form with "Send on Messenger instead" beside it. Clean up the test order afterward.
