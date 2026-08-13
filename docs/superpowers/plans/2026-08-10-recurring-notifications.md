# Recurring Notifications Opt-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Messenger contact opt into monthly game-drop/promo notifications via Meta's Recurring Notifications feature, store that opt-in, and give the admin a way to send to everyone who opted in — a mechanism that doesn't depend on the 24-hour messaging window pieces 1-3 are bound by.

**Architecture:** A new `notification_optins` lowdb collection stores each opt-in with Meta's raw webhook payload preserved. The bot offer is bolted onto the `/webhook` handler as a follow-up after the existing `handleMessage` call resolves — no existing bot reply branch is touched. A new admin route sends to every active opt-in, reusing the `{promo}`/`{new_games}` token computation and the `{sent, failed, total}` result shape already established by the Auto Blast (piece 1) and blast tool (piece 3) work this session.

**Tech Stack:** Express.js webhook handler, lowdb for `notification_optins`/`messenger_contacts`, the Meta Graph API (`graph.facebook.com`) via the existing `https` request pattern already used by `sendMessage`/`/admin/blast`. No test framework in this project by design — verification is `node -c server.js`, EJS/CSS balance greps, and live smoke-testing on Railway.

## Global Constraints

- `raw_optin_payload` on every `notification_optins` row must store Meta's *entire* opt-in webhook event object, not a hand-picked subset of fields — this is the hedge against uncertain field-name mapping (spec: "What's uncertain, stated plainly").
- The opt-in offer is sent once per PSID: check `messenger_contacts.notif_offered` before sending, and set it to `true` immediately after sending regardless of the recipient's response.
- No existing branch inside `handleMessage` (server.js) may be modified. The offer is sent from the webhook handler after `handleMessage(...)` resolves, not from inside it.
- The admin send route's JSON response must use the exact key names `{ sent, failed, total }` (matching `/admin/blast`'s response shape from piece 1) so the admin UI result-rendering logic that already exists for Auto Blast can be reused for this section's own copy without introducing a second response shape.
- Every Graph API response (status + body) for a notification send must be logged server-side (`console.log`/`console.error`), not assumed successful on a 200 without inspection — this project has no test framework, so this logging is the only diagnostic trail once deployed.
- `node -c server.js` must exit 0 after every server.js change.
- EJS tag-balance (`<%` count == `%>` count) must hold for `views/admin.ejs`.
- No local dev server exists; live verification happens against https://playstation-hub.com after `git push` (Railway auto-deploys, ~60-90s). The webhook itself cannot be exercised by a live browser click — verification of Task 1's webhook code is by careful code reading, `node -c`, and confirming the existing bot's plain-text replies still work unchanged after deploy (proving the added code didn't break the untouched paths), not by simulating a real Messenger opt-in (that requires a live Facebook test message, out of scope for this plan's automated verification).

---

### Task 1: Data model, webhook opt-in/decline handling, ask-once offer

**Files:**
- Modify: `server.js` (db defaults block, `/webhook` handler, new helper functions)

**Interfaces:**
- Consumes: `db` (lowdb instance already in scope), `PAGE_ACCESS_TOKEN`, the existing `sendMessage(recipientId, messageData, cb)` helper (server.js:3338-3359).
- Produces: `notification_optins` collection with shape `{ psid, opted_in_at, frequency, topic, raw_optin_payload, status, last_sent_at }`. A helper function `getActiveOptins()` returning `db.get('notification_optins').filter({ status: 'active' }).value()`, consumed by Task 2's send route.

- [ ] **Step 1: Add the `notification_optins` collection default**

In `server.js`, find the `db.defaults({...})` block (currently around line 120-148, containing `messenger_contacts: [],`). Add a new key immediately after `messenger_contacts: [],`:

```js
  notification_optins: [],
```

- [ ] **Step 2: Add the opt-in offer sender function**

Find the existing `sendText` and `sendImage` helper functions (server.js, immediately after `sendMessage`, currently around line 3361-3369):

```js
function sendText(recipientId, text) {
  sendMessage(recipientId, { text });
}

function sendImage(recipientId, imageUrl) {
  sendMessage(recipientId, {
    attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } }
  });
}
```

Immediately after `sendImage`, add:

```js
// Offers the Recurring Notifications opt-in once per contact. The button's
// exact field names (frequency key, token delivery shape) are Meta's current
// Messenger Platform "Recurring Notifications" request format as of this
// writing — this has changed shape across platform versions before, so this
// function is intentionally isolated: if Meta's actual expected payload
// differs, only this one function needs correcting, nothing else in the bot.
function sendNotificationOptinOffer(recipientId) {
  sendMessage(recipientId, {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [{
          title: '🔔 Monthly Game Drops & Promos',
          subtitle: 'Want a heads-up when new games and promos land each month? No spam, one message a month.',
          buttons: [{
            type: 'notification_messages',
            title: 'Yes, notify me!',
            payload: 'NOTIF_OPTIN',
            notification_messages_frequency: 'MONTHLY',
            notification_messages_reoptin: 'PUSH'
          }]
        }]
      }
    }
  });
  // The "No thanks" option is a quick reply on a separate follow-up text —
  // Messenger's notification_messages button type does not support a second,
  // declining button alongside it in the same template element.
  sendMessage(recipientId, {
    text: 'Or if you\'d rather not get monthly updates, that\'s fine too:',
    quick_replies: [{ content_type: 'text', title: 'No thanks', payload: 'NOTIF_DECLINE' }]
  });
}

function markNotifOffered(psid) {
  const existing = db.get('messenger_contacts').find({ psid }).value();
  if (existing) {
    db.get('messenger_contacts').find({ psid }).assign({ notif_offered: true }).write();
  } else {
    db.get('messenger_contacts').push({ psid, first_seen: new Date().toISOString(), last_seen: new Date().toISOString(), notif_offered: true }).write();
  }
}

function getActiveOptins() {
  return db.get('notification_optins').filter({ status: 'active' }).value();
}
```

`markNotifOffered`'s "contact doesn't exist yet" branch exists because the offer-sending call site (Step 4) runs after `handleMessage` resolves, and by that point the webhook handler's existing contact-tracking code (server.js:3327-3332) has already run and created the row — but this function is written defensively in case it is ever called from a path where that isn't guaranteed.

- [ ] **Step 3: Handle the opt-in confirmation and decline in the webhook**

Find the `/webhook` handler (server.js, currently starting line 3294). Locate this exact block, which currently ends the referral-handling section and begins the bot-text section:

```js
      // Everything below this point is the existing chat bot, which only
      // handles real inbound text.
      if (!event.message) return;
```

Immediately **before** this comment (i.e., after the referral `if (rawRef) { ... }` block closes, still inside the `entry.messaging?.forEach(event => { ... })` callback), insert:

```js
      // Recurring Notifications opt-in confirmation arrives as event.optin
      // (Meta's current shape for this button type) with the full grant
      // details; a decline is a normal postback with the payload this bot
      // sets on its own "No thanks" quick reply. The entire raw event is
      // stored on opt-in — see the Global Constraint on raw_optin_payload for
      // why only a subset is not stored instead.
      if (event.optin) {
        db.get('notification_optins').push({
          psid: senderId,
          opted_in_at: new Date().toISOString(),
          frequency: 'MONTHLY',
          topic: 'monthly_promo',
          raw_optin_payload: event.optin,
          status: 'active',
          last_sent_at: null
        }).write();
        console.log('[notif optin] confirmed for psid=' + senderId);
      }
      if (event.postback?.payload === 'NOTIF_DECLINE') {
        console.log('[notif optin] declined by psid=' + senderId);
      }
```

- [ ] **Step 4: Send the offer once, after the existing bot reply**

Find the end of the webhook handler's messaging loop, where `handleMessage` is called (currently server.js:3333):

```js
      handleMessage(senderId, text).catch(e => console.error('[handleMessage]', e));
```

Replace it with:

```js
      handleMessage(senderId, text)
        .then(() => {
          // Offer once per contact, after the bot's real reply — never
          // instead of it, never woven into handleMessage's own branches.
          const contact = db.get('messenger_contacts').find({ psid: senderId }).value();
          if (contact && !contact.notif_offered) {
            setTimeout(() => {
              sendNotificationOptinOffer(senderId);
              markNotifOffered(senderId);
            }, 1500);
          }
        })
        .catch(e => console.error('[handleMessage]', e));
```

The 1.5s delay lets the bot's own reply land first in the conversation, so the offer reads as a follow-up rather than arriving out of order.

- [ ] **Step 5: Verify syntax**

Run: `node -c server.js`
Expected: exit 0, no output.

- [ ] **Step 6: Verify the webhook's existing behavior is unchanged**

Run: `grep -n "handleMessage(senderId, text)" server.js`
Expected: exactly one match, inside the `.then(...)` chain from Step 4 (confirms the old bare call was replaced, not duplicated).

Run: `grep -n "notif_offered\|notification_optins\|NOTIF_OPTIN\|NOTIF_DECLINE" server.js`
Expected: matches only in the code added by Steps 1-4 (db defaults, `sendNotificationOptinOffer`, `markNotifOffered`, `getActiveOptins`, the two `event.optin`/`event.postback` handlers, and the `.then()` callback) — confirms nothing else in the file references these names, i.e. nothing else was accidentally touched.

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -F - <<'MSGEOF'
Add Recurring Notifications opt-in: data model, webhook handling, ask-once offer

New notification_optins collection stores Meta's entire raw opt-in
payload rather than a hand-picked subset of fields - the button/token
shape for this Messenger Platform feature has changed across versions
before, and this hedges a wrong field-name guess against silent data
loss (nothing else needs the guess to be right; the raw event is always
recoverable).

The offer is sent as a follow-up after handleMessage's existing reply,
once per contact via a new notif_offered flag - no branch inside
handleMessage itself is touched.
MSGEOF
```

---

### Task 2: Admin send route and UI section

**Files:**
- Modify: `server.js` (new `/admin/notifications/send` route)
- Modify: `views/admin.ejs` (new UI subsection inside the Message Blast accordion)

**Interfaces:**
- Consumes: `getActiveOptins()` and `db` from Task 1; `getPromoDiscountPct`, `settings.promo`, and `games` (all already in scope in the admin route, same as the `{promo}`/`{new_games}` computation from the piece 3 blast-tool work at views/admin.ejs's Message Blast stats-bar block).
- Produces: nothing consumed by a later task — this is the final feature task in this plan.

- [ ] **Step 1: Add the send route**

In `server.js`, find the `/admin/blast` route's closing (currently ending with `res.json({ ok: true, sent, failed, total: contacts.length });\n});` followed by the `// ─────` divider comment, around line 3808). Immediately after that divider, add:

```js
// ── Recurring Notifications Send ─────────────────────────────────────────────
app.post('/admin/notifications/send', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.json({ ok: false, error: 'No message provided.' });
  if (!PAGE_ACCESS_TOKEN) return res.json({ ok: false, error: 'MESSENGER_PAGE_TOKEN not configured on server.' });

  const optins = getActiveOptins();
  if (!optins.length) return res.json({ ok: false, error: 'No active opt-ins yet. Contacts opt in via the bot after messaging your Page.' });

  const https = require('https');
  let sent = 0, failed = 0;

  function sendOne(optin) {
    return new Promise((resolve) => {
      // Best-effort per the plan's stated uncertainty: Meta's recurring-
      // notification send is expected to accept the PSID directly like a
      // normal message once a valid opt-in exists for that recipient/topic,
      // tagged so it's exempt from the 24h window this feature exists to
      // bypass. If Meta's account requires a different recipient shape (e.g.
      // a token field instead of the PSID), this is the one place to adjust.
      const payload = JSON.stringify({
        recipient: { id: optin.psid },
        message: { text: message },
        messaging_type: 'MESSAGE_TAG',
        tag: 'CONFIRMED_EVENT_UPDATE'
      });
      const options = {
        hostname: 'graph.facebook.com',
        path: '/v19.0/me/messages?access_token=' + PAGE_ACCESS_TOKEN,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      };
      const r2 = https.request(options, (resp) => {
        let data = '';
        resp.on('data', c => data += c);
        resp.on('end', () => {
          console.log('[notif send] psid=' + optin.psid, resp.statusCode, data);
          if (resp.statusCode === 200) {
            sent++;
            db.get('notification_optins').find({ psid: optin.psid, topic: 'monthly_promo' }).assign({ last_sent_at: new Date().toISOString() }).write();
          } else {
            failed++;
            db.get('notification_optins').find({ psid: optin.psid, topic: 'monthly_promo' }).assign({ status: 'send_failed' }).write();
          }
          resolve();
        });
      });
      r2.on('error', (e) => { console.error('[notif send error] psid=' + optin.psid, e.message); failed++; resolve(); });
      r2.write(payload);
      r2.end();
    });
  }

  for (const optin of optins) {
    await sendOne(optin);
    await new Promise(r => setTimeout(r, 120));
  }

  res.json({ ok: true, sent, failed, total: optins.length });
});

app.get('/admin/notifications/optins', requireAuth, (req, res) => {
  res.json({ active: getActiveOptins().length });
});
// ─────────────────────────────────────────────────────────────────────────────
```

The `messaging_type: 'MESSAGE_TAG'` / `tag: 'CONFIRMED_EVENT_UPDATE'` combination is a placeholder best-effort choice, not a verified-correct one — per the plan's Global Constraints, every response is logged, and a `send_failed` status is recorded per-contact rather than assumed successful.

- [ ] **Step 2: Add the admin UI section**

In `views/admin.ejs`, find the end of the Auto Blast section — the closing `</div>` immediately before the "Manual Copy-Paste Tool" divider (currently around line 2124-2126):

```ejs
      </div>

      <div style="border-top:1px solid #1a1a1a;padding-top:1rem;margin-bottom:1rem;">
        <div style="font-size:0.7rem;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.75rem;">Manual Copy-Paste Tool (for older contacts)</div>
      </div>
```

Insert a new section between the Auto Blast section's closing `</div>` and the Manual Copy-Paste Tool divider:

```ejs
      </div>

      <!-- RECURRING NOTIFICATIONS SECTION -->
      <div style="background:linear-gradient(135deg,rgba(34,197,94,0.08),rgba(59,130,246,0.08));border:1px solid #1a3a2a;border-radius:14px;padding:1.25rem;margin-bottom:1.5rem;">
        <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.85rem;">
          <div style="font-size:1.2rem;">📅</div>
          <div>
            <div style="font-weight:800;font-size:0.9rem;color:#22c55e;">Recurring Notifications (Monthly Opt-In)</div>
            <div style="font-size:0.72rem;color:#555;margin-top:0.1rem;">Sends to contacts who opted in via the bot — not limited by the 24-hour window above</div>
          </div>
          <div style="margin-left:auto;background:#111;border:1px solid #2a2a2a;border-radius:20px;padding:0.3rem 0.75rem;font-size:0.72rem;color:#aaa;" id="notifOptinCount">
            Loading...
          </div>
        </div>
        <textarea id="notifBlastMsg" rows="4" style="width:100%;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:10px;color:#fff;padding:0.85rem;font-size:0.83rem;line-height:1.6;resize:vertical;font-family:inherit;box-sizing:border-box;margin-bottom:0.75rem;">🎮 New games just dropped at PlayStation Hub!

{promo}

Check it out: https://playstation-hub.com</textarea>
        <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
          <button onclick="sendNotifBlast()" id="notifBlastBtn" style="background:linear-gradient(135deg,#22c55e,#3b82f6);color:#fff;border:none;border-radius:9px;padding:0.6rem 1.25rem;font-weight:800;font-size:0.85rem;cursor:pointer;">
            📅 Send to Opted-In Contacts
          </button>
          <div id="notifBlastStatus" style="font-size:0.8rem;color:#555;"></div>
        </div>
        <div id="notifBlastResult" style="display:none;margin-top:0.85rem;background:#0a1a0a;border:1px solid #1a3a1a;border-radius:10px;padding:0.85rem;font-size:0.82rem;line-height:1.7;"></div>
        <div style="margin-top:0.65rem;font-size:0.68rem;color:#333;line-height:1.5;">
          ℹ️ Requires Meta's Recurring Notifications permission to be approved for this Page — sends will fail with a logged error until that's granted. See <code style="background:#1a1a1a;padding:0.1rem 0.35rem;border-radius:4px;">docs/messenger-recurring-notifications.md</code> for setup.
        </div>
      </div>

      <div style="border-top:1px solid #1a1a1a;padding-top:1rem;margin-bottom:1rem;">
        <div style="font-size:0.7rem;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.75rem;">Manual Copy-Paste Tool (for older contacts)</div>
      </div>
```

- [ ] **Step 3: Wire the send button and opt-in count**

In `views/admin.ejs`, find the existing "Load contact count" block for Auto Blast (currently around line 2253-2256):

```js
      // Load contact count — reachable (inside Messenger's 24h window) vs total ever saved
      fetch('/admin/blast/contacts').then(r=>r.json()).then(d=>{
        document.getElementById('blastContactCount').textContent = d.reachable + ' reachable now · ' + d.total + ' total';
        document.getElementById('blastContactCount').style.color = d.reachable > 0 ? '#22c55e' : '#f43f5e';
      }).catch(()=>{});
```

Immediately after it, add:

```js
      // Load opted-in count for the Recurring Notifications section
      fetch('/admin/notifications/optins').then(r=>r.json()).then(d=>{
        document.getElementById('notifOptinCount').textContent = d.active + ' opted in';
        document.getElementById('notifOptinCount').style.color = d.active > 0 ? '#22c55e' : '#f43f5e';
      }).catch(()=>{});

      async function sendNotifBlast() {
        const msg = document.getElementById('notifBlastMsg').value.trim()
          .replace(/\{promo\}/g, BLAST_PROMO_TEXT).replace(/\{new_games\}/g, BLAST_NEW_GAMES_TEXT);
        if (!msg) return showBlastToast('Please write a message first!');
        const btn = document.getElementById('notifBlastBtn');
        const status = document.getElementById('notifBlastStatus');
        const result = document.getElementById('notifBlastResult');
        if (!confirm('Send this month\'s update to everyone who opted in?\n\nThis cannot be undone.')) return;
        btn.disabled = true;
        btn.textContent = '⏳ Sending...';
        status.textContent = 'Please wait...';
        result.style.display = 'none';
        try {
          const resp = await fetch('/admin/notifications/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'message=' + encodeURIComponent(msg)
          });
          const data = await resp.json();
          result.style.display = 'block';
          if (data.ok) {
            result.innerHTML = '<strong style="color:#22c55e;">✅ Send Complete!</strong><br>' +
              '📤 Sent: <strong style="color:#22c55e;">' + data.sent + '</strong> &nbsp;|&nbsp; ' +
              '❌ Failed: <strong style="color:' + (data.failed>0?'#f43f5e':'#555') + '">' + data.failed + '</strong> &nbsp;|&nbsp; ' +
              '👥 Total opted-in: <strong>' + data.total + '</strong>';
            status.textContent = '';
          } else {
            result.innerHTML = '<strong style="color:#f43f5e;">❌ ' + (data.error || 'Send failed') + '</strong>';
            status.textContent = '';
          }
        } catch(e) {
          result.style.display = 'block';
          result.innerHTML = '<strong style="color:#f43f5e;">❌ Network error. Try again.</strong>';
          status.textContent = '';
        }
        btn.disabled = false;
        btn.textContent = '📅 Send to Opted-In Contacts';
      }
```

This block reads `BLAST_PROMO_TEXT` and `BLAST_NEW_GAMES_TEXT` — the two constants the piece 3 blast-tool work already declares earlier in this same `<script>` block (views/admin.ejs, inside the Manual Copy-Paste Tool's script section). Since this new code is placed in the Auto Blast section's own script area (which loads before the Manual Copy-Paste Tool's script block later in the page), verify in Step 5 that these constants are actually declared before this reference — if the existing `<script>` blocks in this accordion are separate tags executed in document order and `BLAST_PROMO_TEXT` is declared in a later block than this one, move this `sendNotifBlast` function's promo/new_games substitution to execute lazily (inside the function body, which only runs on click, by which time the whole page has loaded) rather than relying on script-block execution order — as written above, the substitution already happens inside `sendNotifBlast()`'s function body (not at the top level at parse time), so this is safe regardless of which `<script>` block declares the constants first, as long as both blocks exist on the same rendered page. No change needed unless Step 5's check finds otherwise.

- [ ] **Step 4: Verify EJS balance**

Run: count `<%` occurrences and `%>` occurrences in `views/admin.ejs` — must be equal.

- [ ] **Step 5: Verify `BLAST_PROMO_TEXT`/`BLAST_NEW_GAMES_TEXT` are declared on the page**

Run: `grep -n "const BLAST_PROMO_TEXT\|const BLAST_NEW_GAMES_TEXT" views/admin.ejs`
Expected: exactly one declaration of each (from the existing piece 3 work) — confirms Step 3's new code has a real global to read at click-time, per the reasoning in Step 3.

- [ ] **Step 6: Verify server.js syntax**

Run: `node -c server.js`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add server.js views/admin.ejs
git commit -F - <<'MSGEOF'
Add admin send route and UI for Recurring Notifications

New /admin/notifications/send route mirrors piece 1/3's
{sent, failed, total} response shape, logs every Graph API response,
and marks a per-contact optin as send_failed rather than assuming a
non-200 was transient - so a failed send is visible in the data, not
just the console.

Admin UI section sits between Auto Blast and the Manual Copy-Paste
Tool, reusing the {promo}/{new_games} constants the blast tool already
computes on this page.
MSGEOF
```

---

### Task 3: Setup doc and deploy verification

**Files:**
- Create: `docs/messenger-recurring-notifications.md`

**Interfaces:**
- Consumes: everything from Tasks 1-2.

- [ ] **Step 1: Write the setup doc**

Create `docs/messenger-recurring-notifications.md`:

```markdown
# Recurring Notifications — Setup & Verification

**Date:** 2026-08-10
**Type:** Reference guide for the feature built in this session's piece 4.

## What this is

Meta's Recurring Notifications lets a Messenger user opt into a specific topic and frequency (this bot uses "monthly game drops + promos," frequency MONTHLY) so the Page can message them on that cadence without the 24-hour standard messaging window or a message tag. The bot now offers this once, as a follow-up, after any reply to a new contact.

## Before this will actually send anything

This Page needs Meta's approval for messaging permissions covering Recurring Notifications, on top of whatever basic Messenger permission already lets the bot reply to messages today. In Meta's App Dashboard (developers.facebook.com, your app → App Review → Permissions and Features), look for the messaging-related permission that covers this feature and request it if not already granted. This typically requires:

- Business verification on the Meta Business Account tied to this app (if not already done for the existing bot).
- A completed App Review submission showing how the feature is used (screen recording of the opt-in flow works well).

This can take anywhere from a few days to a few weeks, and approval isn't guaranteed on the first submission. Until it's approved, `/admin/notifications/send` will log a non-200 response from Meta for each attempted send and mark those opt-ins `send_failed` — check the Railway logs for `[notif send]` lines to see the actual rejection reason Meta returns.

## The payload-shape caveat

The button payload sent in `sendNotificationOptinOffer` (server.js) and the send request in `/admin/notifications/send` are written against the current understanding of Meta's Messenger Platform API for this feature — not verified against a live test at the time this was built. Meta has changed the shape of this feature across platform versions before. If a real opt-in test shows Meta rejecting the button (check `[notif optin]` logs) or the send request failing with a schema-related error (not a permission error) in `[notif send]` logs, the field names in those two functions are the first thing to check against Meta's current Send API docs for "Notification Messages" / "Recurring Notifications."

Because `notification_optins.raw_optin_payload` stores Meta's entire opt-in event object, even if the button/send code needs correcting, no real opt-in data collected before the fix is lost — the raw payload is still there to re-derive the correct token/field from.

## Manual verification steps (after this deploys)

1. Message the Page's Facebook account from a personal test account.
2. Confirm the bot's normal reply arrives first, then the notification opt-in offer arrives ~1.5s later.
3. Tap "Yes, notify me!" and check Railway logs for a `[notif optin] confirmed for psid=...` line.
4. In `/admin` → Customers tab → Message Blast → Recurring Notifications section, confirm the opted-in count reads at least 1.
5. Send a test message via "Send to Opted-In Contacts" and check the `[notif send]` log line for the actual Graph API status code and body — a permission-related rejection here is expected until App Review clears; a schema/field-name error means the payload shape needs fixing per the caveat above.
```

- [ ] **Step 2: Commit**

```bash
git add docs/messenger-recurring-notifications.md
git commit -F - <<'MSGEOF'
Add Recurring Notifications setup and verification doc

Covers the Meta App Review permission this feature depends on, the
payload-shape caveat from the design spec, and the manual steps needed
to verify a real opt-in end-to-end once deployed - none of which this
plan's automated checks (node -c, EJS balance) can confirm on their own
since they require a live Messenger conversation.
MSGEOF
```

- [ ] **Step 3: Push and deploy**

```bash
git push origin main
```

Run: `until curl -s -o /dev/null -w "%{http_code}" https://playstation-hub.com/ | grep -q 200; do sleep 5; done; echo done`

- [ ] **Step 4: Verify the existing bot still works, unchanged**

Since the webhook itself can't be exercised from a browser, verify indirectly: open `/admin?tab=customers`, confirm the page loads without errors, confirm the existing Auto Blast section (piece 1) still shows its reachable/total count correctly, and confirm the new Recurring Notifications section renders with an opt-in count (expected: 0, since no real opt-in has happened yet) and the send button present.

- [ ] **Step 5: Report results to the user**

Summarize what was verified in Step 4, flag that the actual bot opt-in flow and send mechanism require a live Messenger test per `docs/messenger-recurring-notifications.md`'s manual steps (which this plan cannot automate), and note that sends will fail until the user requests and receives Meta's App Review approval.
