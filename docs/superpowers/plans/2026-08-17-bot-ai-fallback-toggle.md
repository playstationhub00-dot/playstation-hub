# Bot AI Fallback Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-controlled, off-by-default switch that gates the Messenger bot's Claude AI fallback reply, so the owner can disable it without a redeploy and re-enable it later once training examples exist.

**Architecture:** One new boolean in `site_settings` (lazy-initialized in `getSiteSettings()`, the codebase's existing pattern for every setting), one new save route, one checkbox in the existing Bot Training accordion, and one added condition around the existing AI fallback block in `handleMessage`.

**Tech Stack:** Node/Express, lowdb, EJS. No new dependencies.

## Global Constraints

- The new setting is `site_settings.bot_ai_fallback_enabled`, a boolean, defaulted to `false`.
- Keyword-matched bot replies (game lookups, "prices", "how to rent", upcoming titles — everything in `handleMessage` above the "AI FALLBACK" comment block) must not change in any way.
- The existing "FINAL FALLBACK" generic menu message (the block immediately after "AI FALLBACK" in `handleMessage`) is reused as-is when the new setting is off — no new fallback text is written.
- The Claude prompt content itself is not modified — only the condition that gates whether it runs.
- `/admin/ai-generate` (a separate, unrelated AI content-writing route used elsewhere in the admin panel) is not touched.

---

### Task 1: Add the setting, the save route, the checkbox, and the guard

**Files:**
- Modify: `server.js:743` (inside `getSiteSettings()`, add the lazy-init block)
- Modify: `server.js` (add a new route, placed directly after the existing `app.post('/admin/bot-training/delete/:id', ...)` route at line 4451-4454, so it stays grouped with the rest of the Bot Training feature)
- Modify: `server.js` (the "AI FALLBACK" block inside `handleMessage`, currently gated by `if (apiKey) {`)
- Modify: `views/admin.ejs:730-735` (Bot Training accordion, add the checkbox above the existing info banner)

**Interfaces:**
- Consumes: nothing from other tasks — this plan has one task.
- Produces: nothing consumed elsewhere — `getSiteSettings()` already returns the full settings object to every route that calls it, so `settings.bot_ai_fallback_enabled` is automatically available anywhere `settings` is already passed to a view, with no other file needing a change.

- [ ] **Step 1: Add the lazy-init block to `getSiteSettings()`**

Find this existing block in `server.js` (around line 740-743):

```js
  if (s.section_gap === undefined) {
    db.set('site_settings.section_gap', 4).write();
    s.section_gap = 4;
  }
```

Immediately after it, add:

```js
  if (s.bot_ai_fallback_enabled === undefined) {
    db.set('site_settings.bot_ai_fallback_enabled', false).write();
    s.bot_ai_fallback_enabled = false;
  }
```

- [ ] **Step 2: Add the save route**

Find the existing Bot Training delete route in `server.js` (around line 4451-4454):

```js
app.post('/admin/bot-training/delete/:id', requireAuth, (req, res) => {
  db.get('bot_training').remove({ id: parseInt(req.params.id) }).write();
  res.redirect('/admin?tab=settings&msg=training_deleted');
});
```

Immediately after it, add:

```js
app.post('/admin/settings/bot-ai-fallback', requireAuth, (req, res) => {
  db.set('site_settings.bot_ai_fallback_enabled', req.body.bot_ai_fallback_enabled === 'on').write();
  res.redirect('/admin?tab=settings&msg=bot_ai_fallback_updated');
});
```

This follows the exact `checkbox === 'on'` pattern already used for `buy_promo_enabled` elsewhere in `server.js` — an unchecked HTML checkbox sends no field at all, so `req.body.bot_ai_fallback_enabled` is `undefined` when off, and `undefined === 'on'` is `false`.

- [ ] **Step 3: Add the guard around the AI fallback block in `handleMessage`**

Find this line in `server.js` (the start of the "AI FALLBACK" section):

```js
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
```

Replace with:

```js
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && getSiteSettings().bot_ai_fallback_enabled) {
```

Do not change anything else inside that `if` block, and do not change the "FINAL FALLBACK" block that follows it — when the condition is false, execution already falls through to that block unchanged, exactly as it does today when `apiKey` alone is falsy.

- [ ] **Step 4: Add the checkbox to the Bot Training accordion**

Find this block in `views/admin.ejs` (around line 728-735):

```html
      <div class="settings-accordion-body">
        <div style="padding:1.25rem;">

          <!-- Info banner -->
          <div style="background:rgba(168,85,247,0.07);border:1px solid #2a1a3a;border-radius:12px;padding:1rem;margin-bottom:1.25rem;font-size:0.8rem;color:#888;line-height:1.6;">
            <strong style="color:#a855f7;">How it works:</strong> Paste real conversations between you and your customers. The AI will learn your exact Taglish tone, style, and how you handle questions — so the bot sounds just like you. Add 10–30 examples for best results.
          </div>
```

Replace with:

```html
      <div class="settings-accordion-body">
        <div style="padding:1.25rem;">

          <!-- AI fallback toggle -->
          <form method="POST" action="/admin/settings/bot-ai-fallback" style="background:#141414;border:1px solid #2a2a2a;border-radius:12px;padding:1rem;margin-bottom:1rem;">
            <label style="display:flex;align-items:flex-start;gap:0.6rem;cursor:pointer;">
              <input type="checkbox" name="bot_ai_fallback_enabled" <%= settings.bot_ai_fallback_enabled ? 'checked' : '' %> onchange="this.form.submit()" style="margin-top:0.2rem;width:16px;height:16px;flex-shrink:0;accent-color:#a855f7;">
              <span>
                <span style="display:block;font-size:0.88rem;font-weight:700;color:#fff;">Use AI to answer unmatched messages</span>
                <span style="display:block;font-size:0.76rem;color:#888;margin-top:0.15rem;">Off by default until you've added training examples above — otherwise replies won't sound like you.</span>
              </span>
            </label>
          </form>

          <!-- Info banner -->
          <div style="background:rgba(168,85,247,0.07);border:1px solid #2a1a3a;border-radius:12px;padding:1rem;margin-bottom:1.25rem;font-size:0.8rem;color:#888;line-height:1.6;">
            <strong style="color:#a855f7;">How it works:</strong> Paste real conversations between you and your customers. The AI will learn your exact Taglish tone, style, and how you handle questions — so the bot sounds just like you. Add 10–30 examples for best results.
          </div>
```

The checkbox auto-submits its own tiny form on change (`onchange="this.form.submit()"`) rather than requiring a separate save button, matching how a single-purpose toggle is the simplest interaction here — the surrounding Bot Training example form is unaffected since this is a separate `<form>` element.

- [ ] **Step 5: Verify server syntax**

Run:

```bash
node -c server.js
```

Expected: no output, exit code 0.

- [ ] **Step 6: Verify EJS compiles**

Run:

```bash
node -e "require('ejs').compile(require('fs').readFileSync('views/admin.ejs','utf8'))"
```

Expected: no output, exit code 0.

- [ ] **Step 7: Verify the guard condition reads correctly**

Run:

```bash
grep -n "if (apiKey && getSiteSettings" server.js
```

Expected: one line printed, showing the updated condition.

- [ ] **Step 8: Commit**

```bash
git add server.js views/admin.ejs
git commit -m "Add admin toggle for the bot's AI fallback reply, off by default"
```

- [ ] **Step 9: Deploy and verify live**

```bash
git push origin main
```

Poll until the deploy has rolled over:

```bash
for i in 1 2 3 4 5 6; do curl -s "https://playstation-hub.com/robots.txt" -o /dev/null -w "%{http_code}" > /dev/null; curl -s -o /dev/null -w "%{http_code}" "https://playstation-hub.com/" | grep -q "200" && echo "site responding, attempt $i" && break; sleep 15; done
```

(The site itself doesn't expose the new route's presence publicly — this poll just confirms the deploy has rolled over before proceeding to admin verification, since Railway builds take a moment.)

Then, using the Browser tool:
1. Navigate to `https://playstation-hub.com/admin`, log in (password `Ryuzaki2300` — admin sessions expire after every redeploy, so this login is expected here).
2. Go to Settings, open the Bot Training accordion.
3. Confirm the new checkbox renders above the "How it works" banner, labeled "Use AI to answer unmatched messages", and is **unchecked** (confirming the new setting defaulted to `false` on its first read, since this is the first time `getSiteSettings()` will have run this lazy-init block in production).
4. Check the box. Confirm the page reloads/redirects and the box is now checked after reload (confirming the POST route persisted `true`).
5. Uncheck it. Confirm it persists as unchecked after reload.
6. Leave it unchecked (matching the user's original request — AI fallback off) unless the user has said otherwise by the time this step runs.
7. Confirm the existing keyword-matched bot behavior is unaffected: this cannot be tested by messaging the real Facebook Page from this tooling, so instead read `server.js`'s current `handleMessage` function once more end-to-end and confirm no keyword-matching branch above the "AI FALLBACK" comment was touched by this diff — the `git diff` from Task 1 should show changes only in the three exact spots this plan named.
