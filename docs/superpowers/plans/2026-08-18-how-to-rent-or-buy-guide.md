# How To Rent Or Buy Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the outdated `/how-it-works` page with the real seven-step order flow, and add a 4:5 shareable step-by-step graphic that can be screenshotted for Facebook and Messenger.

**Architecture:** Two independent deliverables. Task 1 rewrites `views/how-it-works.ejs` in place, reusing the `.hiw-*` CSS classes that already exist in `public/css/style.css`. Task 2 adds a new self-contained static page under `public/promo/`, which `express.static` (`server.js:332`) already serves. No server routes, no business logic, no new dependencies.

**Tech Stack:** EJS, plain CSS/HTML. No build step.

## Global Constraints

- No PNG, JPG, video, or audio is produced. The shareable graphic is an HTML page, screenshotted manually.
- Rental durations are **7-day weekly** and **30-day monthly**. The string "15 days" must not appear anywhere in either deliverable.
- The refundable deposit is **₱100** and applies to **Trophy and PS4 Primary only** — never Non-Trophy. Source: `server.js:1441`, `const depositDue = (type === 'tr' || type === 'ps4') ? (promo.deposit || 0) : 0;`
- The sign-in QR step must state its **~10 minute** expiry, and must link to the existing `/how-to-sign-in` page rather than re-explaining how to produce the QR.
- Payment and confirmation steps are **designed panels only** — no screenshots of a real order status page, which displays a customer's Facebook name and order reference. No test order is created against production at any point.
- Every step in `public/promo/how-to.html` is a designed panel: numbered card plus short caption, no embedded screenshots or iframes anywhere in the file.
- Visual tokens, copied verbatim from the spec: ground `#0a0a0a`, primary accent `#F0A500`, highlight `#FFD700`, Buy gradient `#7b2ff7 → #f107a3`, muted text `#aaaaaa`.
- The existing "Trophy vs. Non-Trophy Account" comparison section on `/how-it-works` is kept, gaining only the deposit rule.
- **Language differs by deliverable, deliberately.** `/how-it-works` is written in **English**, matching the site's own UI, which a reader is looking at while following the page. `public/promo/how-to.html` is written in **Taglish**, matching the audience it gets shared to on Facebook and Messenger — the same choice made for the promo reels. This was decided at plan time rather than in the spec; if the owner wants both in one language, the graphic is the file to change.

---

### Task 1: Rewrite `/how-it-works` with the real flow

**Files:**
- Modify: `views/how-it-works.ejs:18-102` (hero + the three step cards)
- Modify: `views/how-it-works.ejs:174-176` (the "Not sure?" footnote, to carry the deposit rule)

**Interfaces:**
- Consumes: nothing from Task 2 — the two tasks are independent.
- Produces: nothing consumed elsewhere. The page is a leaf template; the route `app.get('/how-it-works', ...)` at `server.js:844` passes `announcement`, `announcements`, and `settings`, all of which the current file already uses and which this task does not change.

- [ ] **Step 1: Replace the hero and step section**

In `views/how-it-works.ejs`, replace everything from line 18 (`<!-- HERO -->`) through line 102 (the `</div>` closing the steps container, immediately before `<!-- TROPHY VS NON-TROPHY -->`) with:

```html
<!-- HERO -->
<section style="background:linear-gradient(135deg,#000 0%,#001a3a 60%,#000 100%);padding:4rem 2rem 3rem;text-align:center;position:relative;overflow:hidden;">
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,112,209,0.12) 0%,transparent 65%);pointer-events:none;"></div>
  <div style="position:relative;z-index:1;">
    <div style="display:inline-flex;align-items:center;gap:0.5rem;background:rgba(0,112,209,0.15);border:1px solid rgba(0,112,209,0.3);border-radius:20px;padding:0.35rem 1rem;font-size:0.8rem;color:var(--ps-blue);font-weight:600;margin-bottom:1.25rem;">🎮 Order online in minutes</div>
    <h1 style="font-size:clamp(2rem,5vw,3rem);font-weight:900;letter-spacing:-1px;margin-bottom:1rem;">How It <span style="color:var(--ps-blue);">Works</span></h1>
    <p style="color:var(--text-secondary);font-size:1rem;max-width:520px;margin:0 auto;">Rent a game for a week or a month, or buy it permanently. Everything happens right here on the site — pay with GCash or Maya and we'll set you up.</p>
  </div>
</section>

<!-- STEPS -->
<div style="max-width:860px;margin:0 auto;padding:4rem 2rem;">

  <!-- Step 1 -->
  <div class="hiw-step">
    <div class="hiw-num">1</div>
    <div class="hiw-connector"></div>
    <div class="hiw-card">
      <div class="hiw-icon">🎮</div>
      <div class="hiw-body">
        <h2>Pick Rent or Buy</h2>
        <p>Tap <strong style="color:#fff;">Rent</strong> in the menu to rent a game for a week or a month, or <strong style="color:#fff;">Buy</strong> to own it permanently with a one-time payment.</p>
        <div style="display:flex;gap:0.75rem;margin-top:1rem;flex-wrap:wrap;">
          <a href="/browse" class="btn btn-primary" style="font-size:0.875rem;padding:0.6rem 1.4rem;">Rent a Game →</a>
          <a href="/buy" class="btn btn-outline" style="font-size:0.875rem;padding:0.6rem 1.4rem;">Buy Permanently →</a>
        </div>
      </div>
    </div>
  </div>

  <!-- Step 2 -->
  <div class="hiw-step">
    <div class="hiw-num">2</div>
    <div class="hiw-connector"></div>
    <div class="hiw-card">
      <div class="hiw-icon">🔎</div>
      <div class="hiw-body">
        <h2>Choose Your Game</h2>
        <p>Each listing shows the price, how many slots are free, and whether a Trophy Account is available. Tap the game you want.</p>
      </div>
    </div>
  </div>

  <!-- Step 3 -->
  <div class="hiw-step">
    <div class="hiw-num">3</div>
    <div class="hiw-connector"></div>
    <div class="hiw-card">
      <div class="hiw-icon">🏆</div>
      <div class="hiw-body">
        <h2>Choose Your Account Type</h2>
        <p>Pick <strong style="color:#fff;">Non-Trophy</strong>, <strong style="color:#ffc400;">Trophy</strong>, or <strong style="color:#60a5fa;">PS4 Primary</strong>. The difference is explained further down this page.</p>
        <div class="hiw-tip">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
          Trophy and PS4 Primary include a ₱100 refundable deposit. Non-Trophy has no deposit.
        </div>
      </div>
    </div>
  </div>

  <!-- Step 4 -->
  <div class="hiw-step">
    <div class="hiw-num">4</div>
    <div class="hiw-connector"></div>
    <div class="hiw-card">
      <div class="hiw-icon">📅</div>
      <div class="hiw-body">
        <h2>Pick How Long <span style="font-size:0.8rem;color:#555;font-weight:600;">— renting only</span></h2>
        <p>Choose <strong style="color:#fff;">Weekly (7 days)</strong> or <strong style="color:#fff;">Monthly (30 days)</strong>. Monthly works out cheaper per day, and any active discount is applied automatically at checkout.</p>
        <div class="hiw-tip">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
          Buying permanently? Skip this step — there's no time limit.
        </div>
      </div>
    </div>
  </div>

  <!-- Step 5 -->
  <div class="hiw-step">
    <div class="hiw-num">5</div>
    <div class="hiw-connector"></div>
    <div class="hiw-card">
      <div class="hiw-icon">✍️</div>
      <div class="hiw-body">
        <h2>Enter Your Facebook Name</h2>
        <p>Type the name on your Facebook account so we know who the order belongs to, then tap <strong style="color:#fff;">Rent</strong> or <strong style="color:#fff;">Buy</strong>. You'll get an order page with your own reference number — keep that page open.</p>
      </div>
    </div>
  </div>

  <!-- Step 6 -->
  <div class="hiw-step">
    <div class="hiw-num">6</div>
    <div class="hiw-connector"></div>
    <div class="hiw-card">
      <div class="hiw-icon">💳</div>
      <div class="hiw-body">
        <h2>Pay, Then Tell Us</h2>
        <p>Your order page shows the exact amount and a <strong style="color:#fff;">GCash</strong> or <strong style="color:#fff;">Maya</strong> QR code to scan. Once you've paid, confirm it in one of two ways:</p>
        <div class="hiw-details">
          <div class="hiw-detail-item">
            <span class="hiw-detail-icon">📤</span>
            <div>
              <strong>Upload your receipt</strong>
              <span>Attach the screenshot straight from the order page</span>
            </div>
          </div>
          <div class="hiw-detail-item">
            <span class="hiw-detail-icon">💬</span>
            <div>
              <strong>Or send it on Messenger</strong>
              <span>Copy the ready-made message and paste it to us</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Step 7 -->
  <div class="hiw-step" style="--no-connector:1">
    <div class="hiw-num">7</div>
    <div class="hiw-card">
      <div class="hiw-icon">📱</div>
      <div class="hiw-body">
        <h2>Send Your Sign-In QR</h2>
        <p>Last step. Your console shows a sign-in QR code — send it to us and we'll sign you in. Then you're playing.</p>
        <div class="hiw-tip" style="border-color:rgba(245,158,11,0.35);background:rgba(245,158,11,0.08);color:#f59e0b;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
          Your QR expires after about 10 minutes — send it right away.
        </div>
        <a href="/how-to-sign-in" class="btn btn-outline" style="margin-top:1rem;display:inline-block;font-size:0.875rem;padding:0.6rem 1.4rem;">How to get your sign-in QR →</a>
      </div>
    </div>
  </div>

  <!-- After -->
  <div style="margin-top:2rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1rem;">
    <div style="background:#0d0d0d;border:1px solid #1a1a1a;border-radius:12px;padding:1.25rem;">
      <div style="font-weight:800;color:var(--ps-blue);font-size:0.9rem;margin-bottom:0.4rem;">⏱️ If you rented</div>
      <p style="font-size:0.85rem;color:#888;line-height:1.6;margin:0;">When your week or month is up, return the account and send us the return proof. Your deposit comes back after that.</p>
    </div>
    <div style="background:#0d0d0d;border:1px solid #2a1a3a;border-radius:12px;padding:1.25rem;">
      <div style="font-weight:800;color:#a78bfa;font-size:0.9rem;margin-bottom:0.4rem;">♾️ If you bought</div>
      <p style="font-size:0.85rem;color:#888;line-height:1.6;margin:0;">Nothing to return. The game stays on your account permanently — no expiry, no weekly fee.</p>
    </div>
  </div>

</div>
```

- [ ] **Step 2: Add the deposit rule to the Trophy comparison footnote**

Find this block near the end of the Trophy vs. Non-Trophy section (currently `views/how-it-works.ejs:174-176`):

```html
  <div style="margin-top:1rem;background:#111;border:1px solid #1a1a1a;border-radius:10px;padding:1rem 1.25rem;font-size:0.82rem;color:#555;text-align:center;">
    💡 Not sure? You can always ask us when you message — we're happy to help you choose!
  </div>
```

Replace with:

```html
  <div style="margin-top:1rem;background:#111;border:1px solid #1a1a1a;border-radius:10px;padding:1rem 1.25rem;font-size:0.82rem;color:#555;text-align:center;line-height:1.7;">
    💡 Trophy accounts include a <strong style="color:#888;">₱100 refundable deposit</strong>, returned once you send the account back. Non-Trophy has no deposit.<br>
    Not sure which to pick? Message us — we're happy to help you choose.
  </div>
```

- [ ] **Step 3: Verify the stale content is gone**

Run:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && grep -c "15 days\|Send Us These Details\|Days of Rent" views/how-it-works.ejs
```

Expected: `0`. Any other number means stale copy survived the replacement.

- [ ] **Step 4: Verify the required new content is present**

Run:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && for s in "GCash" "Maya" "10 minutes" "how-to-sign-in" "refundable deposit" "30 days"; do printf '%s: ' "$s"; grep -c "$s" views/how-it-works.ejs; done
```

Expected: every line prints `1` or higher. A `0` on any line means that required element is missing.

- [ ] **Step 5: Verify the template compiles**

Run:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && node -e "require('ejs').compile(require('fs').readFileSync('views/how-it-works.ejs','utf8'))"
```

Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add views/how-it-works.ejs
git commit -m "Rewrite How It Works to match the real online order flow"
```

---

### Task 2: Shareable 4:5 step-by-step graphic

**Files:**
- Create: `public/promo/how-to.html`

**Interfaces:**
- Consumes: nothing from Task 1 — fully independent, and it does not read or include any EJS template.
- Produces: nothing consumed elsewhere. `express.static` already serves `public/`, so no route registration is needed.

- [ ] **Step 1: Create the file**

Create `public/promo/how-to.html` with exactly this content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Playstation Hub — How to Rent or Buy</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #000; }
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
  #card {
    width: 1080px; height: 1350px; background: #0a0a0a;
    padding: 70px 64px; display: flex; flex-direction: column;
    transform-origin: top center;
  }
  .head { text-align: center; margin-bottom: 44px; }
  .kicker { font-size: 22px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #F0A500; margin-bottom: 14px; }
  .title { font-size: 62px; font-weight: 900; color: #fff; line-height: 1.08; }
  .title span { color: #FFD700; }
  .sub { font-size: 25px; color: #aaaaaa; margin-top: 16px; }
  .steps { display: flex; flex-direction: column; gap: 20px; flex: 1; }
  .step { display: flex; align-items: flex-start; gap: 22px; }
  .n {
    width: 58px; height: 58px; border-radius: 50%; background: #F0A500;
    color: #000; font-size: 27px; font-weight: 900;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .n.buy { background: #a78bfa; }
  .txt { padding-top: 6px; }
  .st { font-size: 31px; font-weight: 800; color: #fff; line-height: 1.25; }
  .sd { font-size: 23px; color: #aaaaaa; margin-top: 5px; line-height: 1.45; }
  .warn { color: #f59e0b; font-weight: 700; }
  .foot {
    margin-top: 36px; padding-top: 28px; border-top: 2px solid #1a1a1a;
    display: flex; align-items: center; justify-content: space-between; gap: 20px;
  }
  .url { font-size: 34px; font-weight: 900; color: #fff; }
  .pays { display: flex; gap: 10px; }
  .pay { font-size: 21px; font-weight: 700; color: #aaaaaa; background: #141414; border: 1px solid #2a2a2a; border-radius: 22px; padding: 9px 20px; }
</style>
</head>
<body>
<div id="card">

  <div class="head">
    <div class="kicker">Playstation Hub</div>
    <div class="title">Paano mag-<span>rent</span> o <span>bumili</span></div>
    <div class="sub">PS5 &amp; PS4 games — online lahat, GCash o Maya</div>
  </div>

  <div class="steps">

    <div class="step">
      <div class="n">1</div>
      <div class="txt">
        <div class="st">Buksan ang playstation-hub.com</div>
        <div class="sd">Tap <b style="color:#fff">Rent</b> para umupa, o <b style="color:#fff">Buy</b> para sa'yo na habambuhay</div>
      </div>
    </div>

    <div class="step">
      <div class="n">2</div>
      <div class="txt">
        <div class="st">Pumili ng game</div>
        <div class="sd">Makikita mo ang presyo at kung ilan pang slot ang bakante</div>
      </div>
    </div>

    <div class="step">
      <div class="n">3</div>
      <div class="txt">
        <div class="st">Piliin ang account type</div>
        <div class="sd">Non-Trophy, Trophy, o PS4 Primary — may ₱100 refundable deposit ang Trophy at PS4 Primary</div>
      </div>
    </div>

    <div class="step">
      <div class="n">4</div>
      <div class="txt">
        <div class="st">Pumili ng haba — 7 o 30 days</div>
        <div class="sd">Umuupa lang. Kung bibili ka, laktawan mo 'to — walang expiry</div>
      </div>
    </div>

    <div class="step">
      <div class="n">5</div>
      <div class="txt">
        <div class="st">Ilagay ang Facebook name mo</div>
        <div class="sd">Tapos tap Rent o Buy — may lalabas na order page na may reference number</div>
      </div>
    </div>

    <div class="step">
      <div class="n">6</div>
      <div class="txt">
        <div class="st">Bayad via GCash o Maya</div>
        <div class="sd">I-scan ang QR sa order page, tapos i-upload ang resibo — o send sa Messenger</div>
      </div>
    </div>

    <div class="step">
      <div class="n">7</div>
      <div class="txt">
        <div class="st">Send ang sign-in QR mo</div>
        <div class="sd"><span class="warn">10 minutes lang bago mag-expire</span> — i-send agad. Kami na ang bahala mag-sign in. Laro na!</div>
      </div>
    </div>

  </div>

  <div class="foot">
    <div class="url">playstation-hub.com</div>
    <div class="pays">
      <div class="pay">GCash</div>
      <div class="pay">Maya</div>
    </div>
  </div>

</div>
<script>
  function fit() {
    var c = document.getElementById('card');
    var s = Math.min(window.innerWidth / 1080, window.innerHeight / 1350);
    c.style.transform = s < 1 ? 'scale(' + s + ')' : 'none';
    document.body.style.height = (s < 1 ? 1350 * s : 1350) + 'px';
  }
  window.addEventListener('resize', fit);
  fit();
</script>
</body>
</html>
```

The `fit()` script scales the fixed 1080×1350 card down to fit whatever screen it's opened on, so the full 4:5 frame is visible on a phone for screenshotting. The card itself stays at exact 4:5 pixel dimensions so the proportions never drift.

- [ ] **Step 2: Verify the file is well-formed**

Run:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && node -e "
const fs = require('fs');
const html = fs.readFileSync('public/promo/how-to.html', 'utf8');
const o = (html.match(/<div/g) || []).length, c = (html.match(/<\/div>/g) || []).length;
if (o !== c) { console.error('MISMATCH: ' + o + ' open vs ' + c + ' close div'); process.exit(1); }
console.log('OK: ' + o + ' divs balanced');
"
```

Expected: `OK: N divs balanced`.

- [ ] **Step 3: Verify the constraint-bearing content is present and the banned string is absent**

Run:

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub" && node -e "
const html = require('fs').readFileSync('public/promo/how-to.html', 'utf8');
const must = ['1080px', '1350px', 'GCash', 'Maya', '10 minutes', '7 o 30 days', '₱100'];
const missing = must.filter(s => !html.includes(s));
if (missing.length) { console.error('MISSING: ' + missing.join(', ')); process.exit(1); }
if (html.includes('15 days')) { console.error('BANNED STRING \"15 days\" PRESENT'); process.exit(1); }
if (/<iframe|<img/i.test(html)) { console.error('EMBEDDED MEDIA PRESENT — must be designed panels only'); process.exit(1); }
console.log('OK: all required content present, no banned string, no embedded media');
"
```

Expected: `OK: all required content present, no banned string, no embedded media`.

- [ ] **Step 4: Commit**

```bash
git add public/promo/how-to.html
git commit -m "Add shareable 4:5 how-to-rent-or-buy graphic"
```

- [ ] **Step 5: Deploy and verify live**

```bash
git push origin main
```

Poll until the deploy has rolled over:

```bash
for i in 1 2 3 4 5 6 7 8; do curl -s -o /dev/null -w "%{http_code}" "https://playstation-hub.com/promo/how-to.html" | grep -q "200" && echo "FOUND at attempt $i" && break; echo "attempt $i: not yet"; sleep 20; done
```

Note: deploys this session have usually rolled over inside 90 seconds, but one took roughly ten minutes. If this poll exhausts without a 200, that is a deploy-timing issue rather than a code fault — re-poll rather than changing the code.

Then, using the Browser tool:
1. Navigate to `https://playstation-hub.com/how-it-works`. Confirm seven numbered steps render, the copy mentions GCash/Maya and the 10-minute QR expiry, the "How to get your sign-in QR" button links to `/how-to-sign-in`, and no text anywhere says "15 days" or "Send Us These Details".
2. Confirm the Trophy vs. Non-Trophy comparison still renders below the steps and its footnote now states the ₱100 deposit rule.
3. Resize the viewport to 390×844 and confirm the step cards and the two "If you rented / If you bought" panels stack without horizontal overflow.
4. Navigate to `https://playstation-hub.com/promo/how-to.html` at a 390×844 viewport. Confirm the whole 4:5 card is visible and scaled to fit, all seven steps are legible, and the footer shows the URL plus the GCash and Maya pills.
5. Screenshot both pages and report them, then tell the user the graphic's URL and that screenshotting it on a phone is the manual next step.
