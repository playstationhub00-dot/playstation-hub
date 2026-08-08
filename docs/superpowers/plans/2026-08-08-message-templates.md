# Message Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner three editable message templates (rental confirmation, due-tomorrow, due-today) that fill in a customer's real details and copy to the clipboard, plus a panel showing who needs a reminder today — and correct the console setup instructions on the game detail page, which currently name menus that don't exist.

**Architecture:** A small pure module (`lib/templates.js`) owns placeholder substitution and the account-type-conditional blocks, so the substitution rules are testable without a browser. Templates live in `site_settings.message_templates`, following the same lowdb pattern as `hero_text` and `promo`. The admin gets one new Settings accordion to edit them, a Copy button per customer row, and a "Needs a reminder" panel. The setup-instruction fix is three independent string corrections in one view.

**Tech Stack:** Express.js + EJS server-rendered views, vanilla JS (no framework, no bundler), lowdb (`games.json`) synced to MongoDB. No test framework; `lib/templates.js` gets a plain assert-based Node script under `scripts/` (zero new dependencies, matching `scripts/test-payments.js`). Everything else is verified live on Railway.

## Global Constraints

- Templates are **copy-to-clipboard only**. No automated sending, and no customer↔Messenger-ID link — `messenger_contacts` stores only `{psid, first_seen, last_seen}` (`server.js:2642`) with no name, so a specific renter cannot be addressed (spec: Decisions taken before this design).
- Storage key is `site_settings.message_templates`, holding exactly these fields: `confirmation`, `expiry_tomorrow`, `expiry_today`, `return_steps_tr`, `return_steps_ps4`, `return_steps_nt`, `deposit_line`, `reviews_link`, `website_link` (spec: Templates).
- `{deposit_line}` substitutes to an **empty string** when the rental carries no deposit — never a line reading "₱0" (spec: Placeholders).
- `{return_steps}` resolves to `return_steps_tr` / `return_steps_ps4` / `return_steps_nt` by account type. PS4 Primary is genuinely distinct from Trophy — it uses Account Management, not console sharing (spec: Decisions, Templates).
- Deposit applies to Trophy and PS4 Primary only, never Non-Trophy — matching the existing rule in `server.js`'s `computeRentTotal` and the customer edit route (spec: Decisions).
- Unknown tokens are **left untouched**, not replaced with `undefined`, so a typo shows as literal `{gaem}` (spec: Placeholders).
- `{end_date}` is formatted long, e.g. `Aug 18, 2026` (spec: Placeholders).
- The "Needs a reminder" panel reuses the days-remaining calculation the customers table already performs at `views/admin.ejs:2482` rather than introducing a second one (spec: Using the templates).
- Clipboard writes need a secure context; on failure the button must fall back to selecting the text in a visible textarea rather than failing silently (spec: Using the templates).
- The three setup-instruction strings at `views/game-detail.ejs:191`, `:215`, and `:239` are corrected to the real console paths (spec: Console instruction fixes).
- EJS tag-balance (`<%` count == `%>` count) verified for every `.ejs` file touched, before committing — established project convention.
- `node -c server.js` must exit 0 after every `server.js` change.
- No local dev server — live verification against https://playstation-hub.com after `git push` (Railway auto-deploys, ~60-90s).

---

### Task 1: `lib/templates.js` — placeholder substitution

**Files:**
- Create: `lib/templates.js`
- Create: `scripts/test-templates.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, all from `lib/templates.js`:
  - `DEFAULT_TEMPLATES` — frozen object with all nine string fields, holding the default copy.
  - `TOKENS` — frozen array of the token names (without braces) that `render` understands, for the admin's placeholder reference list.
  - `hasDeposit(accountType)` → `boolean` — true for `'tr'` and `'ps4'`, false otherwise.
  - `returnStepsFor(templates, accountType)` → `string` — picks the matching `return_steps_*` field.
  - `render(templateText, customer, templates, opts)` → `string` — substitutes every token. `customer` is a customer record (`customer_name`, `game_title`, `account_type`, `days`, `price`, `end_date`). `templates` is the `message_templates` object. `opts` is `{ deposit }` — the deposit amount to use, defaulting to 100.
  - `renderFor(kind, customer, templates, opts)` → `string` — convenience wrapper; `kind` is `'confirmation'` / `'expiry_tomorrow'` / `'expiry_today'`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-templates.js`:

```js
// Plain assert-based test for message-template substitution. No test framework
// in this project by design — run with `node scripts/test-templates.js`, which
// exits non-zero on the first failed assertion.
const assert = require('assert');
const t = require('../lib/templates');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

const TPL = {
  confirmation: 'Hi {name}, you rented {game} ({type}) for {days} days at P{price}, back by {end_date}. {website}',
  expiry_tomorrow: '{name}: {game} ends {end_date}.\n{return_steps}\n{deposit_line}',
  expiry_today: '{name}: {game} ends TODAY {end_date}.\n{return_steps}\n{deposit_line}',
  return_steps_tr: 'TROPHY STEPS',
  return_steps_ps4: 'PS4 STEPS',
  return_steps_nt: 'NONTROPHY STEPS',
  deposit_line: 'Your P{deposit} deposit comes back.',
  reviews_link: 'https://fb.example/reviews',
  website_link: 'https://site.example'
};

const TR = { customer_name: 'Ana', game_title: 'Tekken 8', account_type: 'tr', days: 7, price: 499, end_date: '2026-08-18' };
const NT = { customer_name: 'Ben', game_title: 'NBA 2K26', account_type: 'nt', days: 30, price: 699, end_date: '2026-09-01' };
const PS4 = { customer_name: 'Cy', game_title: 'UFC 6', account_type: 'ps4', days: 7, price: 499, end_date: '2026-08-18' };

check('deposit applies to trophy and ps4 only', () => {
  assert.strictEqual(t.hasDeposit('tr'), true);
  assert.strictEqual(t.hasDeposit('ps4'), true);
  assert.strictEqual(t.hasDeposit('nt'), false);
});

check('substitutes the plain customer fields', () => {
  const out = t.render(TPL.confirmation, TR, TPL, {});
  assert.strictEqual(out, 'Hi Ana, you rented Tekken 8 (Trophy) for 7 days at P499, back by Aug 18, 2026. https://site.example');
});

check('formats the end date long', () => {
  assert.ok(t.render('{end_date}', NT, TPL, {}).includes('Sep 1, 2026'));
});

check('account type renders as a human label', () => {
  assert.strictEqual(t.render('{type}', TR, TPL, {}), 'Trophy');
  assert.strictEqual(t.render('{type}', NT, TPL, {}), 'Non-Trophy');
  assert.strictEqual(t.render('{type}', PS4, TPL, {}), 'PS4 Primary');
});

check('return steps pick the matching variant', () => {
  assert.strictEqual(t.returnStepsFor(TPL, 'tr'), 'TROPHY STEPS');
  assert.strictEqual(t.returnStepsFor(TPL, 'ps4'), 'PS4 STEPS');
  assert.strictEqual(t.returnStepsFor(TPL, 'nt'), 'NONTROPHY STEPS');
});

check('ps4 gets its own steps, not the trophy ones', () => {
  const out = t.render('{return_steps}', PS4, TPL, {});
  assert.strictEqual(out, 'PS4 STEPS');
  assert.notStrictEqual(out, 'TROPHY STEPS');
});

check('deposit line appears for trophy with the amount filled in', () => {
  assert.strictEqual(t.render('{deposit_line}', TR, TPL, { deposit: 100 }), 'Your P100 deposit comes back.');
});

check('deposit line is empty for non-trophy, not a zero line', () => {
  const out = t.render('{deposit_line}', NT, TPL, { deposit: 100 });
  assert.strictEqual(out, '');
  assert.ok(!out.includes('0'));
});

check('unknown tokens are left alone rather than becoming undefined', () => {
  const out = t.render('a {gaem} b {name}', TR, TPL, {});
  assert.strictEqual(out, 'a {gaem} b Ana');
});

check('renderFor picks the named template', () => {
  const out = t.renderFor('expiry_today', TR, TPL, { deposit: 100 });
  assert.ok(out.startsWith('Ana: Tekken 8 ends TODAY Aug 18, 2026.'));
  assert.ok(out.includes('TROPHY STEPS'));
});

check('a missing end date does not print Invalid Date', () => {
  const out = t.render('{end_date}', { customer_name: 'D', game_title: 'G', account_type: 'nt', days: 7, price: 1, end_date: '' }, TPL, {});
  assert.strictEqual(out, '');
});

check('defaults expose every field the settings form saves', () => {
  ['confirmation','expiry_tomorrow','expiry_today','return_steps_tr','return_steps_ps4',
   'return_steps_nt','deposit_line','reviews_link','website_link'].forEach(k => {
    assert.ok(typeof t.DEFAULT_TEMPLATES[k] === 'string' && t.DEFAULT_TEMPLATES[k].length > 0, 'missing default: ' + k);
  });
});

console.log('\n' + passed + ' assertions passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-templates.js`
Expected: FAIL with `Cannot find module '../lib/templates'`.

- [ ] **Step 3: Write `lib/templates.js`**

```js
// Message templates the owner copies into Messenger. Substitution lives here
// rather than in the view so the conditional rules — which return steps apply,
// whether a deposit line appears at all — are testable without a browser.
//
// Two tokens are conditional on the rental's account type:
//   {return_steps}  PS4 Primary is NOT a variant of Trophy: it deactivates a
//                   primary console rather than disabling console sharing.
//   {deposit_line}  Resolves to an empty string when no deposit was charged,
//                   so a Non-Trophy message has no sentence at all rather than
//                   one reading "P0".

const TYPE_LABELS = { tr: 'Trophy', nt: 'Non-Trophy', ps4: 'PS4 Primary' };

// Trophy and PS4 Primary carry the deposit; Non-Trophy never does. Mirrors the
// same rule in server.js's rent-total math.
function hasDeposit(accountType) {
  return accountType === 'tr' || accountType === 'ps4';
}

function returnStepsFor(templates, accountType) {
  if (accountType === 'tr') return templates.return_steps_tr || '';
  if (accountType === 'ps4') return templates.return_steps_ps4 || '';
  return templates.return_steps_nt || '';
}

function formatDate(ymd) {
  if (!ymd) return '';
  const d = new Date(ymd + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function render(templateText, customer, templates, opts) {
  if (!templateText) return '';
  const o = opts || {};
  const deposit = o.deposit != null ? o.deposit : 100;
  const c = customer || {};
  const type = c.account_type;

  const depositLine = hasDeposit(type)
    ? String(templates.deposit_line || '').replace(/\{deposit\}/g, String(deposit))
    : '';

  const values = {
    name: c.customer_name || '',
    game: c.game_title || '',
    type: TYPE_LABELS[type] || '',
    days: c.days != null ? String(c.days) : '',
    price: c.price != null ? String(c.price) : '',
    end_date: formatDate(c.end_date),
    deposit: String(deposit),
    return_steps: returnStepsFor(templates, type),
    deposit_line: depositLine,
    reviews_link: templates.reviews_link || '',
    website: templates.website_link || ''
  };

  // Only replace tokens we actually know — an unrecognised {token} is left as
  // written so a typo in a template is visible instead of silently blank.
  return String(templateText).replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole
  );
}

function renderFor(kind, customer, templates, opts) {
  return render(templates[kind] || '', customer, templates, opts);
}

const TOKENS = Object.freeze([
  'name', 'game', 'type', 'days', 'price', 'end_date',
  'deposit', 'return_steps', 'deposit_line', 'reviews_link', 'website'
]);

const DEFAULT_TEMPLATES = Object.freeze({
  confirmation:
`✅ You're all set, {name}!

🎮 Game: {game}
👤 Account: {type}
⏱ Duration: {days} days
💰 Paid: ₱{price}
📅 Return by: {end_date}

⚠️ Please don't change the account password or email — it locks everyone out, including you.

⭐ Enjoying it? A quick review really helps us: {reviews_link}
🎮 Browse more games: {website}`,

  expiry_tomorrow:
`👋 Hi {name}! Quick reminder —

Your rental of {game} ({type}) ends TOMORROW, {end_date}.

Want to extend? Just reply and we'll set it up — no need to sign out or sign back in.

If you're done, here's how to return the account:
{return_steps}

{deposit_line}`,

  expiry_today:
`👋 Hi {name} — your rental ends TODAY.

🎮 {game} ({type}) · {days} days
📅 Ends: {end_date}

Would you like to extend your rent today? Just reply and we'll set it up —
no need to sign out or sign back in.

If you're done, here's how to return the account:
{return_steps}

{deposit_line}`,

  return_steps_tr:
`1️⃣ Disable console sharing FIRST:
   Settings → Users and Accounts → Other → Console Sharing and Offline Play → Disable
2️⃣ Then delete the account:
   Settings → Delete Account`,

  return_steps_ps4:
`1️⃣ Deactivate as primary FIRST:
   Settings → Account Management → Activate as Your Primary PS4 → Deactivate
2️⃣ Then delete the account:
   Settings → Delete Account`,

  return_steps_nt:
`Just delete the account from your console:
   Settings → Delete Account`,

  deposit_line: '💰 Your ₱{deposit} deposit comes back once you\'ve signed out — just send us a screenshot.',
  reviews_link: 'https://facebook.com/PlaystationHub00/reviews',
  website_link: 'https://playstation-hub.com'
});

module.exports = { DEFAULT_TEMPLATES, TOKENS, TYPE_LABELS, hasDeposit, returnStepsFor, render, renderFor };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-templates.js`
Expected: PASS — twelve `ok -` lines then `12 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/templates.js scripts/test-templates.js
git commit -m "$(cat <<'EOF'
Add message-template rendering with account-type conditionals

lib/templates.js owns placeholder substitution so the conditional
rules are testable without a browser: return steps pick between three
variants (PS4 Primary deactivates a primary console rather than
disabling console sharing, so it is not a Trophy variant), and the
deposit line resolves to an empty string for Non-Trophy rather than a
line reading zero. Unknown tokens are left as written so a typo in a
template is visible rather than silently blank.
EOF
)"
```

---

### Task 2: Settings storage and the save route

**Files:**
- Modify: `server.js:10` (require), `server.js` `getSiteSettings()` (seed defaults), and a new `POST /admin/message-templates` route placed immediately after the existing `POST /admin/promo` route

**Interfaces:**
- Consumes: `DEFAULT_TEMPLATES` and `TOKENS` from Task 1.
- Produces: `site_settings.message_templates` guaranteed present on every `getSiteSettings()` call, with all nine fields. The `templates` local and `TEMPLATE_TOKENS` are passed to the admin view for Task 3.

- [ ] **Step 1: Require the module**

In `server.js`, alongside the existing `lib/` requires near line 10, add:

```js
const templates = require('./lib/templates');
```

- [ ] **Step 2: Seed the defaults in `getSiteSettings()`**

Find `getSiteSettings()` in `server.js` and add this block before its `return s;`, following the same shape as the existing `if (s.section_gap === undefined)` seed:

```js
  // Seed message templates on first read, and backfill any individual field
  // added later — an owner who has customised three templates should not lose
  // them when a fourth is introduced.
  if (!s.message_templates) {
    db.set('site_settings.message_templates', Object.assign({}, templates.DEFAULT_TEMPLATES)).write();
    s.message_templates = db.get('site_settings.message_templates').value();
  } else {
    const missing = {};
    Object.keys(templates.DEFAULT_TEMPLATES).forEach(k => {
      if (typeof s.message_templates[k] !== 'string') missing[k] = templates.DEFAULT_TEMPLATES[k];
    });
    if (Object.keys(missing).length) {
      const merged = Object.assign({}, s.message_templates, missing);
      db.set('site_settings.message_templates', merged).write();
      s.message_templates = merged;
    }
  }
```

- [ ] **Step 3: Add the save route**

Immediately after the `POST /admin/promo` route's closing `});` in `server.js`, insert:

```js
app.post('/admin/message-templates', requireAuth, (req, res) => {
  const existing = db.get('site_settings.message_templates').value() || {};
  const next = Object.assign({}, existing);
  // Only fields the module defines are writable — an unexpected form field
  // cannot introduce a key that render() would never read.
  Object.keys(templates.DEFAULT_TEMPLATES).forEach(k => {
    if (typeof req.body[k] === 'string') next[k] = req.body[k];
  });
  db.set('site_settings.message_templates', next).write();
  res.redirect('/admin?msg=templates_saved');
});
```

- [ ] **Step 4: Pass the templates and token list to the admin view**

Find the `res.render('admin', { ... })` call in the `/admin` route and add these two keys to the object:

```js
    messageTemplates: getSiteSettings().message_templates,
    templateTokens: templates.TOKENS,
```

- [ ] **Step 5: Verify**

Run: `node -c server.js` — expect exit 0, no output.
Run: `node scripts/test-templates.js` — expect `12 assertions passed`.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "$(cat <<'EOF'
Store message templates in site settings with a save route

Templates seed from lib/templates.js defaults on first read and
backfill field-by-field afterwards, so adding a template later never
overwrites ones the owner has already customised. The save route
accepts only fields the module defines.
EOF
)"
```

---

### Task 3: Admin editor for the templates

**Files:**
- Modify: `views/admin.ejs` (new accordion in the Settings tab, immediately after the Bot Training accordion which ends around `views/admin.ejs:700` — locate it by searching for the Bot Training block that starts at `views/admin.ejs:620`)

**Interfaces:**
- Consumes: `messageTemplates` and `templateTokens` locals from Task 2; `POST /admin/message-templates` from Task 2.
- Produces: nothing consumed downstream — this is a self-contained editing surface.

- [ ] **Step 1: Add the accordion**

In `views/admin.ejs`, find the end of the Bot Training accordion (the `</div><!-- /accordion -->` or equivalent closing the block that begins with the `<!-- Bot Training -->` comment at line 620). Immediately after it, insert:

```ejs
    <!-- Message Templates -->
    <div class="settings-accordion">
      <div class="settings-accordion-header" onclick="toggleAccordion(this)" style="border-left:3px solid #22c55e;">
        <div class="sa-left">
          <div class="sa-icon" style="background:rgba(34,197,94,0.15);">💬</div>
          <div>
            <div class="sa-title">Message Templates</div>
            <div class="sa-desc">Ready-to-send replies for confirmations and rental reminders</div>
          </div>
        </div><span class="sa-arrow">▼</span>
      </div>
      <div class="settings-accordion-body">
        <div style="padding:1.25rem;">

          <div style="background:rgba(34,197,94,0.07);border:1px solid #1a3a2a;border-radius:12px;padding:1rem;margin-bottom:1.25rem;font-size:0.8rem;color:#888;line-height:1.6;">
            <strong style="color:#22c55e;">How it works:</strong> These are copied to your clipboard from the Customers tab, filled in with that customer's details — you paste them into Messenger. Use any placeholder below and it gets swapped for the real value.
            <div style="margin-top:0.7rem;display:flex;flex-wrap:wrap;gap:0.35rem;">
              <% templateTokens.forEach(tok => { %><code style="background:#111;border:1px solid #222;border-radius:5px;padding:0.15rem 0.4rem;font-size:0.72rem;color:#22c55e;">{<%= tok %>}</code><% }) %>
            </div>
            <div style="margin-top:0.7rem;color:#666;">
              <code style="color:#f59e0b;">{return_steps}</code> and <code style="color:#f59e0b;">{deposit_line}</code> change automatically with the account type — Non-Trophy rentals get no deposit sentence at all.
            </div>
          </div>

          <form method="POST" action="/admin/message-templates">
            <div class="form-group">
              <label>✅ Rental confirmation — after they've paid and signed in</label>
              <textarea name="confirmation" rows="12" style="width:100%;font-family:inherit;"><%= messageTemplates.confirmation %></textarea>
            </div>
            <div class="form-group">
              <label>⏰ Reminder — due tomorrow</label>
              <textarea name="expiry_tomorrow" rows="10" style="width:100%;font-family:inherit;"><%= messageTemplates.expiry_tomorrow %></textarea>
            </div>
            <div class="form-group">
              <label>🔔 Reminder — due today</label>
              <textarea name="expiry_today" rows="12" style="width:100%;font-family:inherit;"><%= messageTemplates.expiry_today %></textarea>
            </div>

            <div style="border-top:1px solid #1a1a1a;margin:1.25rem 0;padding-top:1.25rem;">
              <div style="font-size:0.75rem;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#555;margin-bottom:0.85rem;">Return steps — one per account type</div>
              <div class="form-group">
                <label>🏆 Trophy</label>
                <textarea name="return_steps_tr" rows="5" style="width:100%;font-family:inherit;"><%= messageTemplates.return_steps_tr %></textarea>
              </div>
              <div class="form-group">
                <label>🕹️ PS4 Primary</label>
                <textarea name="return_steps_ps4" rows="5" style="width:100%;font-family:inherit;"><%= messageTemplates.return_steps_ps4 %></textarea>
              </div>
              <div class="form-group">
                <label>🎮 Non-Trophy</label>
                <textarea name="return_steps_nt" rows="4" style="width:100%;font-family:inherit;"><%= messageTemplates.return_steps_nt %></textarea>
              </div>
              <div class="form-group">
                <label>💰 Deposit line — shown only on Trophy and PS4 Primary rentals</label>
                <textarea name="deposit_line" rows="3" style="width:100%;font-family:inherit;"><%= messageTemplates.deposit_line %></textarea>
              </div>
            </div>

            <div style="border-top:1px solid #1a1a1a;margin:1.25rem 0;padding-top:1.25rem;">
              <div class="form-group">
                <label>⭐ Facebook reviews link</label>
                <input type="text" name="reviews_link" value="<%= messageTemplates.reviews_link %>" style="width:100%;">
              </div>
              <div class="form-group">
                <label>🌐 Website link</label>
                <input type="text" name="website_link" value="<%= messageTemplates.website_link %>" style="width:100%;">
              </div>
            </div>

            <button type="submit" class="btn-primary">💾 Save Templates</button>
          </form>

        </div>
      </div>
    </div><!-- /accordion message templates -->
```

- [ ] **Step 2: Verify balance**

Run: `grep -o '<%' views/admin.ejs | wc -l` and `grep -o '%>' views/admin.ejs | wc -l` — expect equal.

- [ ] **Step 3: Commit**

```bash
git add views/admin.ejs
git commit -m "$(cat <<'EOF'
Add Message Templates editor to admin settings

One accordion holding the three message templates, the three
account-type return-step variants, the deposit line, and the two
links — with the full placeholder list shown inline so the owner
doesn't have to remember token names.
EOF
)"
```

---

### Task 4: Copy buttons and the "Needs a reminder" panel

**Files:**
- Modify: `views/admin.ejs` — the Customers tab: a new panel above the customers table, a new cell in each table row, and one `<script>` block

**Interfaces:**
- Consumes: `messageTemplates` from Task 2; the `tableCustomers` loop and its `daysLeft`/`isRenting` locals already computed at `views/admin.ejs:2476-2482`; the deposit amount from `settings.promo.deposit`.
- Produces: nothing consumed downstream — final feature surface.

- [ ] **Step 1: Serialise the templates and a rendered message per customer**

Rendering happens server-side so the substitution rules live in exactly one place (`lib/templates.js`) rather than being reimplemented in browser JS. In `views/admin.ejs`, immediately **before** the `<% tableCustomers.forEach(c => {` line (currently `views/admin.ejs:2475`), insert:

```ejs
            <%
              // Pre-render every message server-side so lib/templates.js stays the
              // single implementation of the substitution rules — the browser only
              // copies a finished string.
              const tplDeposit = (settings.promo && settings.promo.deposit) || 100;
              const renderMsg = (kind, cust) => renderTemplate(kind, cust, messageTemplates, { deposit: tplDeposit });
            %>
```

Then in `server.js`, expose the renderer to views by adding this next to the other `app.locals` assignments (near `server.js:241`):

```js
app.locals.renderTemplate = (kind, customer, tpls, opts) => templates.renderFor(kind, customer, tpls, opts);
```

- [ ] **Step 2: Add the "Needs a reminder" panel**

In `views/admin.ejs`, immediately **before** the customers `<table>` opening tag, insert:

```ejs
            <%
              // Reuses the same day arithmetic the table rows below already do,
              // rather than introducing a second definition of "due tomorrow".
              const remToday = new Date(); remToday.setHours(0,0,0,0);
              const needsReminder = customers.filter(c => {
                if (c.status !== 'renting' || !c.end_date) return false;
                const end = new Date(c.end_date + 'T00:00:00');
                const dl = Math.ceil((end - remToday) / 86400000);
                return dl === 0 || dl === 1;
              }).map(c => {
                const end = new Date(c.end_date + 'T00:00:00');
                const dl = Math.ceil((end - remToday) / 86400000);
                return { c, dl, kind: dl === 0 ? 'expiry_today' : 'expiry_tomorrow' };
              }).sort((a, b) => a.dl - b.dl);
            %>
            <% if (needsReminder.length) { %>
            <div class="rem-panel">
              <div class="rem-title">🔔 Needs a reminder (<%= needsReminder.length %>)</div>
              <% needsReminder.forEach(r => { %>
              <div class="rem-row">
                <div class="rem-info">
                  <span class="rem-name"><%= r.c.customer_name %></span>
                  <span class="rem-badge <%= r.dl === 0 ? 'rem-today' : 'rem-tomorrow' %>"><%= r.dl === 0 ? 'Due today' : 'Due tomorrow' %></span>
                  <div class="rem-meta"><%= r.c.game_title %> · <%= r.c.account_type === 'tr' ? 'Trophy' : r.c.account_type === 'ps4' ? 'PS4 Primary' : 'Non-Trophy' %> · <%= r.c.days %> days</div>
                </div>
                <button type="button" class="rem-copy" data-msg="<%= renderMsg(r.kind, r.c) %>">📋 Copy reminder</button>
              </div>
              <% }) %>
            </div>
            <% } %>
```

- [ ] **Step 3: Add the per-row copy button**

In the customers table, find the final `<td>` containing the Edit/Delete actions (`views/admin.ejs:2539-2546`):

```ejs
              <td>
                <div class="action-btns">
                  <a href="/admin/customers/edit/<%= c.id %>" class="btn-edit">✏️ Edit</a>
```

Insert a copy button immediately before the Edit link, inside the same `action-btns` div:

```ejs
                  <button type="button" class="btn-copy rem-copy" data-msg="<%= renderMsg('confirmation', c) %>" title="Copy confirmation message">📋</button>
```

- [ ] **Step 4: Add the clipboard script**

At the end of `views/admin.ejs`'s existing `<script>` section for the customers tab (or as a new `<script>` block immediately after the customers table), add:

```html
<script>
(function(){
  // navigator.clipboard needs a secure context. Production is HTTPS so this
  // works, but on plain-http localhost the API is absent — fall back to a
  // visible textarea the owner can copy from manually rather than doing nothing.
  function fallbackCopy(text, btn) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:1rem;right:1rem;bottom:1rem;height:9rem;z-index:9999;font-size:0.8rem;';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    if (ok) { ta.remove(); flash(btn, '✅ Copied'); }
    else { flash(btn, '⬇ Copy from the box'); setTimeout(() => ta.remove(), 15000); }
  }
  function flash(btn, text) {
    const original = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = original; }, 1800);
  }
  document.addEventListener('click', function(e){
    const btn = e.target.closest('.rem-copy');
    if (!btn) return;
    const msg = btn.dataset.msg || '';
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(msg).then(() => flash(btn, '✅ Copied')).catch(() => fallbackCopy(msg, btn));
    } else {
      fallbackCopy(msg, btn);
    }
  });
})();
</script>
```

- [ ] **Step 5: Add the panel styles**

In `public/css/style.css`, append at the end of the file:

```css
.rem-panel { background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.25); border-radius: 12px; padding: 1rem 1.1rem; margin-bottom: 1.25rem; }
.rem-title { font-size: 0.78rem; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; color: #f59e0b; margin-bottom: 0.85rem; }
.rem-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.6rem 0; border-top: 1px solid rgba(245,158,11,0.15); }
.rem-row:first-of-type { border-top: 0; }
.rem-info { min-width: 0; }
.rem-name { font-weight: 700; font-size: 0.9rem; }
.rem-badge { font-size: 0.68rem; font-weight: 800; padding: 0.12rem 0.45rem; border-radius: 5px; margin-left: 0.5rem; }
.rem-today { background: rgba(239,68,68,0.15); color: #ef4444; }
.rem-tomorrow { background: rgba(245,158,11,0.15); color: #f59e0b; }
.rem-meta { font-size: 0.75rem; color: #777; margin-top: 0.2rem; }
.rem-copy { background: #1a1a1a; color: #ddd; border: 1px solid #2a2a2a; border-radius: 8px; padding: 0.45rem 0.75rem; font-size: 0.78rem; font-weight: 700; cursor: pointer; font-family: inherit; white-space: nowrap; flex-shrink: 0; }
.rem-copy:hover { border-color: #22c55e; color: #fff; }
.btn-copy { padding: 0.25rem 0.5rem !important; font-size: 0.8rem !important; }
```

- [ ] **Step 6: Verify**

Run: `node -c server.js` — expect exit 0.
Run: `grep -o '<%' views/admin.ejs | wc -l` and `grep -o '%>' views/admin.ejs | wc -l` — expect equal.
Run: `grep -o '{' public/css/style.css | wc -l` and `grep -o '}' public/css/style.css | wc -l` — expect equal.

- [ ] **Step 7: Commit**

```bash
git add server.js views/admin.ejs public/css/style.css
git commit -m "$(cat <<'EOF'
Add copy buttons and a needs-a-reminder panel

Every customer row gets a button that copies their filled-in
confirmation message; a panel above the table lists everyone due today
or tomorrow and copies the matching reminder. Messages render
server-side through lib/templates.js so the substitution rules have one
implementation. Clipboard falls back to a selectable textarea when the
API is unavailable rather than failing silently.
EOF
)"
```

---

### Task 5: Correct the console setup instructions

**Files:**
- Modify: `views/game-detail.ejs:191`, `:215`, `:239`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Independent of Tasks 1-4 — the only reason it is last is that it is the smallest and most easily verified change.

- [ ] **Step 1: Fix the Trophy instruction**

At `views/game-detail.ejs:191`, replace:

```ejs
              <p style="color:#22c55e;">Setup: Settings → Account → Other → Console Sharing → <strong>ENABLE</strong></p>
```

with:

```ejs
              <p style="color:#22c55e;">Setup: Settings → Users and Accounts → Other → Console Sharing and Offline Play → <strong>Enable</strong></p>
```

- [ ] **Step 2: Fix the Non-Trophy instruction**

At `views/game-detail.ejs:215`, replace:

```ejs
              <p style="color:#888;">Setup: Settings → Account → Other → Console Sharing → <strong>DON'T enable</strong></p>
```

with:

```ejs
              <p style="color:#888;">Setup: Settings → Users and Accounts → Other → Console Sharing and Offline Play → <strong>leave disabled</strong></p>
```

- [ ] **Step 3: Fix the PS4 Primary instruction**

At `views/game-detail.ejs:239`, replace:

```ejs
              <p style="color:#22c55e;">Setup: Settings → Account → Other → Console Sharing → <strong>ENABLE</strong> (on PS4)</p>
```

with:

```ejs
              <p style="color:#22c55e;">Setup: Settings → Account Management → Activate as Your Primary PS4 → <strong>Activate</strong></p>
```

This one is not a wording correction — PS4 Primary activation has nothing to do
with console sharing, so the entire menu path changes.

- [ ] **Step 4: Verify balance and commit**

Run: `grep -o '<%' views/game-detail.ejs | wc -l` and `grep -o '%>' views/game-detail.ejs | wc -l` — expect equal.

```bash
git add views/game-detail.ejs
git commit -m "$(cat <<'EOF'
Fix console setup instructions on the game detail page

All three named menus that don't exist. Trophy and Non-Trophy pointed
at "Account -> Other -> Console Sharing" instead of "Users and Accounts
-> Other -> Console Sharing and Offline Play". PS4 Primary pointed at
console sharing entirely, which is not how primary activation works —
it lives under Account Management.

Customers follow these before they can play, so each wrong path was a
support message.
EOF
)"
```

---

### Task 6: Deploy and verify live

**Files:** none (deploy + verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-5.

- [ ] **Step 1: Run the tests**

Run: `node scripts/test-templates.js` — expect `12 assertions passed`.
Run: `node scripts/test-payments.js` — expect `10 assertions passed` (confirms the earlier revenue work still passes).
Run: `node -c server.js` — expect exit 0.

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Wait for the deploy**

Run: `until curl -s -o /dev/null -w "%{http_code}" https://playstation-hub.com/ | grep -q 200; do sleep 5; done; echo done`

- [ ] **Step 4: Verify the setup instructions**

Load any live game page and confirm all three account-type rows now read the
corrected paths — Trophy and Non-Trophy showing "Users and Accounts → Other →
Console Sharing and Offline Play", and PS4 Primary showing "Account Management →
Activate as Your Primary PS4". Expand each row's chevron to see them.

- [ ] **Step 5: Verify the templates editor**

In `/admin` → Settings, open the Message Templates accordion. Confirm all nine
fields render with their default content, the placeholder chips are listed, and
saving an edit persists after a page reload.

- [ ] **Step 6: Verify the copy buttons**

In `/admin` → Customers, confirm each row shows a 📋 button. Click one and paste
into any text field — the message must contain that customer's real name, game,
account type, days, price, and a long-form date, with no leftover `{token}` text.

- [ ] **Step 7: Verify the conditional blocks**

Find a **Trophy** customer and a **Non-Trophy** customer in the "Needs a
reminder" panel (or temporarily set a customer's end date to today to make one
appear). Copy each reminder and confirm: the Trophy one contains the deposit
sentence and the console-sharing return steps; the Non-Trophy one contains
neither the deposit sentence nor any console-sharing text, and shows only the
delete-account step. If a PS4 Primary rental exists, confirm it shows the
Account Management steps rather than the Trophy ones.

- [ ] **Step 8: Report results**

Summarize what was verified in Steps 4-7, with a screenshot of the reminder
panel and one copied message, and flag anything that did not match expectation.
