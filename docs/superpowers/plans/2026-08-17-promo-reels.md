# Promo Reels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two self-contained, animated 9:16 HTML pages under `public/promo/` — a ~25s hype promo and a ~78s rent/buy tutorial — that a phone screen-records into a video.

**Architecture:** Two independent static HTML files, each with inline `<style>` and `<script>`, no build step and no server-side rendering. `express.static` (`server.js:332`) already serves everything under `public/`, so no server changes are needed. A small shared JS "scene driver" pattern (duplicated in both files, not extracted into a shared script, since two files sharing one script would need a `<script src>` fetch that adds a load-order dependency neither file needs) advances through timed scenes and exposes a replay button.

**Tech Stack:** Plain HTML/CSS/JS. No frameworks, no external libraries, no build tooling.

## Global Constraints

- No video, image, or audio file is produced by this plan. The deliverable is two HTML pages plus two voiceover scripts (already written in the spec, reproduced verbatim in each task below).
- 9:16 aspect ratio: the page's root element is exactly `390px` wide × `844px` tall (a fixed device-frame size, not `100vw`/`100vh`) so it renders identically regardless of the phone's actual screen size — what matters is the recording captures this fixed frame, not that it fills whatever screen it's opened on.
- Reel 1 total runtime: 25000ms across 5 scenes, timings exactly as spec'd (0–3s, 3–8s, 8–14s, 14–19s, 19–25s converted to per-scene durations of 3000/5000/6000/5000/6000ms).
- Reel 2 total runtime: 78000ms across 13 scenes, timings exactly as spec'd, converted to per-scene durations (all 6000ms except the first two: Title 5000ms, Rent 1 6000ms — see Task 2 for the full per-scene table).
- Visual tokens, copied verbatim from the spec: ground `#0a0a0a`, primary accent `#F0A500`, highlight `#FFD700`, Buy gradient `#7b2ff7 → #f107a3`, muted text `#aaaaaa`.
- Motion is `transform`/`opacity` only within a scene — no animating `width`/`height`/`padding`/`margin`, so playback stays smooth during screen recording.
- Any embedded live page in Reel 2 is a non-interactive `<iframe>` with `pointer-events: none` — recording taps must never be able to interact with the live site underneath.
- No test order is created against the live site at any point in this build.
- Cover art in Reel 1 loads from live `https://playstation-hub.com/uploads/...` URLs — these must be fetched fresh (see Task 1 Step 1) since local `games.json` is a stale stub with different cover filenames.

---

### Task 1: Reel 1 — promo

**Files:**
- Create: `public/promo/reel-1.html`

**Interfaces:**
- Consumes: nothing — no dependency on Task 2.
- Produces: nothing consumed elsewhere. Fully self-contained; `public/promo/reel-2.html` (Task 2) does not reference this file.

- [ ] **Step 1: Fetch live cover image URLs to embed**

Before writing the HTML, get real cover image URLs from the live site — do not
invent placeholder paths. Run:

```bash
curl -s "https://playstation-hub.com/api/search-index" | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const withCovers = data.filter(g => g.y === 'now' && g.img).slice(0, 4);
withCovers.forEach(g => console.log(g.t + ' -> https://playstation-hub.com' + g.img));
"
```

Expected: 4 lines, each a game title and an absolute `https://playstation-hub.com/uploads/...` URL. Use these 4 URLs (in the order printed) as the `src` for the four cover images used in Scene 2 ("What it is"). If fewer than 4 print, re-run — the live catalog has 55+ available games so this should not happen; if it does, the API may be temporarily down, and you should retry rather than substitute a fake path.

- [ ] **Step 2: Write the HTML skeleton, styles, and scene structure**

Create `public/promo/reel-1.html` with this exact structure. Replace the four `COVER_URL_N` placeholders with the 4 URLs from Step 1, in order.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Playstation Hub — Promo Reel</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #000; }
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
  #frame {
    position: relative; width: 390px; height: 844px; overflow: hidden;
    background: #0a0a0a; border-radius: 0;
  }
  .scene {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
    padding: 2rem; opacity: 0; transform: scale(0.96);
    transition: opacity 0.5s ease, transform 0.5s ease;
    pointer-events: none;
  }
  .scene.active { opacity: 1; transform: scale(1); pointer-events: auto; }
  .kicker { font-size: 0.9rem; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #F0A500; margin-bottom: 0.75rem; }
  .headline { font-size: 2.6rem; font-weight: 900; color: #fff; line-height: 1.1; }
  .headline.small { font-size: 1.9rem; }
  .sub { font-size: 1.2rem; color: #aaaaaa; margin-top: 1rem; font-weight: 500; }
  .accent { color: #F0A500; }
  .highlight { color: #FFD700; }
  .stat-row { display: flex; gap: 1.5rem; margin-top: 1.5rem; }
  .stat { display: flex; flex-direction: column; align-items: center; }
  .stat-num { font-size: 1.6rem; font-weight: 900; color: #F0A500; }
  .stat-label { font-size: 0.7rem; color: #aaaaaa; text-transform: uppercase; letter-spacing: 0.5px; }
  .cover-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem; margin-top: 1.5rem; width: 100%; max-width: 300px; }
  .cover-grid img { width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: 10px; }
  .buy-badge {
    display: inline-block; margin-top: 1.5rem; padding: 0.75rem 1.5rem; border-radius: 30px;
    background: linear-gradient(135deg, #7b2ff7, #f107a3); font-weight: 800; font-size: 1.1rem; color: #fff;
  }
  .promo-box {
    margin-top: 1.5rem; padding: 1.25rem 2rem; border-radius: 16px;
    background: rgba(240,165,0,0.1); border: 2px solid #F0A500;
  }
  .promo-pct { font-size: 3rem; font-weight: 900; color: #FFD700; }
  .cta-methods { display: flex; gap: 0.75rem; margin-top: 1.25rem; }
  .cta-pill { padding: 0.4rem 0.9rem; border-radius: 20px; background: #141414; border: 1px solid #2a2a2a; font-size: 0.8rem; color: #aaaaaa; font-weight: 700; }
  .cta-url { margin-top: 2rem; font-size: 1.5rem; font-weight: 900; color: #fff; }
  #replay {
    position: absolute; bottom: 16px; right: 16px; z-index: 10;
    background: rgba(0,0,0,0.6); color: #fff; border: 1px solid #444; border-radius: 20px;
    padding: 0.4rem 0.9rem; font-size: 0.75rem; cursor: pointer;
  }
  .feature-row { display: flex; flex-direction: column; gap: 1rem; margin-top: 1.5rem; width: 100%; max-width: 300px; }
  .feature-card { background: #141414; border: 1px solid #2a2a2a; border-radius: 12px; padding: 1rem; text-align: left; }
  .feature-card .tag { font-size: 0.65rem; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #FFD700; }
  .feature-card .title { font-size: 1.1rem; font-weight: 800; color: #fff; margin-top: 0.3rem; }
  .feature-card .desc { font-size: 0.85rem; color: #aaaaaa; margin-top: 0.2rem; }
</style>
</head>
<body>
<div id="frame">

  <div class="scene" data-scene="hook">
    <div class="headline">PS5 GAMES.</div>
    <div class="headline highlight">₱199 LANG.</div>
  </div>

  <div class="scene" data-scene="what-it-is">
    <div class="kicker">Playstation Hub</div>
    <div class="headline small">55+ na games.<br>Digital lahat.</div>
    <div class="sub">Walang disc. Walang meetup.</div>
    <div class="cover-grid">
      <img src="COVER_URL_1" alt="">
      <img src="COVER_URL_2" alt="">
      <img src="COVER_URL_3" alt="">
      <img src="COVER_URL_4" alt="">
    </div>
  </div>

  <div class="scene" data-scene="whats-new">
    <div class="kicker">Bago Ngayon</div>
    <div class="feature-row">
      <div class="feature-card">
        <div class="tag">Account Bundles</div>
        <div class="title">12 games, isang account</div>
        <div class="desc">From ₱299</div>
      </div>
      <div class="feature-card">
        <div class="tag">Buy Permanent</div>
        <div class="title">Sa'yo na habambuhay</div>
        <div class="desc">Isang bayad, forever access</div>
      </div>
    </div>
  </div>

  <div class="scene" data-scene="promo">
    <div class="kicker">Limited Promo</div>
    <div class="promo-box">
      <div class="sub" style="margin-top:0;">30 DAYS RENT</div>
      <div class="promo-pct">10% OFF</div>
    </div>
    <div class="sub">Automatic sa checkout — walang code</div>
  </div>

  <div class="scene" data-scene="cta">
    <div class="kicker">Simulan Na</div>
    <div class="cta-url">playstation-hub.com</div>
    <div class="cta-methods">
      <div class="cta-pill">GCash</div>
      <div class="cta-pill">Maya</div>
      <div class="cta-pill">QR Ph</div>
    </div>
    <div class="sub" style="margin-top:1.5rem;">Message us sa Messenger</div>
  </div>

  <button id="replay" onclick="playReel()">↻ Replay</button>
</div>
<script>
  var SCENES = [
    { id: 'hook', duration: 3000 },
    { id: 'what-it-is', duration: 5000 },
    { id: 'whats-new', duration: 6000 },
    { id: 'promo', duration: 5000 },
    { id: 'cta', duration: 6000 }
  ];
  var timers = [];

  function clearTimers() {
    timers.forEach(function (t) { clearTimeout(t); });
    timers = [];
  }

  function playReel() {
    clearTimers();
    document.querySelectorAll('.scene').forEach(function (el) { el.classList.remove('active'); });
    var elapsed = 0;
    SCENES.forEach(function (scene) {
      var startTimer = setTimeout(function () {
        document.querySelectorAll('.scene').forEach(function (el) { el.classList.remove('active'); });
        var el = document.querySelector('.scene[data-scene="' + scene.id + '"]');
        if (el) el.classList.add('active');
      }, elapsed);
      timers.push(startTimer);
      elapsed += scene.duration;
    });
  }

  playReel();
</script>
</body>
</html>
```

- [ ] **Step 3: Verify HTML is well-formed**

Run:

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/promo/reel-1.html', 'utf8');
const openTags = (html.match(/<div/g) || []).length;
const closeTags = (html.match(/<\/div>/g) || []).length;
if (openTags !== closeTags) { console.error('MISMATCH: ' + openTags + ' open vs ' + closeTags + ' close div tags'); process.exit(1); }
console.log('OK: ' + openTags + ' div tags balanced');
"
```

Expected: `OK: N div tags balanced` with no MISMATCH error.

- [ ] **Step 4: Verify all 5 scene ids referenced in SCENES exist in the HTML**

Run:

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/promo/reel-1.html', 'utf8');
const ids = ['hook','what-it-is','whats-new','promo','cta'];
const missing = ids.filter(id => !html.includes('data-scene=\"' + id + '\"'));
if (missing.length) { console.error('MISSING SCENES: ' + missing.join(', ')); process.exit(1); }
console.log('OK: all 5 scenes present');
"
```

Expected: `OK: all 5 scenes present`.

- [ ] **Step 5: Verify the 4 cover URLs were substituted (no placeholder text remains)**

Run:

```bash
grep -c "COVER_URL_" public/promo/reel-1.html
```

Expected: `0`. If it prints anything other than `0`, Step 1's placeholders were not fully replaced — go back and substitute the real URLs.

- [ ] **Step 6: Commit**

```bash
git add public/promo/reel-1.html
git commit -m "Add promo reel 1 (hype, ~25s)"
```

---

### Task 2: Reel 2 — how-to

**Files:**
- Create: `public/promo/reel-2.html`

**Interfaces:**
- Consumes: nothing from Task 1 — fully independent file.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Confirm the two live URLs this reel embeds are still live and correctly shaped**

This reel embeds two real pages of the live site as non-interactive iframes:
`https://playstation-hub.com/browse` and `https://playstation-hub.com/game/007-first-light`.
Confirm both resolve before embedding:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://playstation-hub.com/browse"
curl -s -o /dev/null -w "%{http_code}\n" "https://playstation-hub.com/game/007-first-light"
curl -s -o /dev/null -w "%{http_code}\n" "https://playstation-hub.com/game/007-first-light?mode=buy"
```

Expected: `200` printed three times. If any prints something else, the game
`007-first-light` may have been removed from the catalog since this plan was
written — pick any other live rentable game with a buy price from
`https://playstation-hub.com/browse` and substitute its slug everywhere below.

- [ ] **Step 2: Write the HTML skeleton, styles, and scene structure**

Create `public/promo/reel-2.html` with this exact structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Playstation Hub — How To Reel</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #000; }
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
  #frame { position: relative; width: 390px; height: 844px; overflow: hidden; background: #0a0a0a; }
  .scene {
    position: absolute; inset: 0; opacity: 0; pointer-events: none;
    transition: opacity 0.4s ease;
  }
  .scene.active { opacity: 1; pointer-events: auto; }
  .caption-bar {
    position: absolute; left: 0; right: 0; bottom: 0; z-index: 5;
    background: linear-gradient(to top, rgba(0,0,0,0.92), rgba(0,0,0,0));
    padding: 2.5rem 1.25rem 1.25rem; text-align: center;
  }
  .caption-bar .text { font-size: 1.15rem; font-weight: 800; color: #fff; line-height: 1.3; }
  .caption-bar .step { font-size: 0.7rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #F0A500; margin-bottom: 0.4rem; }
  .live-frame {
    position: absolute; top: 0; left: 0; width: 390px; height: 844px;
    border: 0; pointer-events: none;
  }
  .tap-dot {
    position: absolute; width: 44px; height: 44px; border-radius: 50%;
    border: 3px solid #FFD700; opacity: 0;
  }
  .scene.active .tap-dot { animation: tap-pulse 1.4s ease-out infinite; }
  @keyframes tap-pulse {
    0% { transform: scale(0.6); opacity: 0.9; }
    70% { transform: scale(1.3); opacity: 0; }
    100% { transform: scale(1.3); opacity: 0; }
  }
  .title-scene { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; padding: 2rem; }
  .title-scene .headline { font-size: 2.2rem; font-weight: 900; color: #fff; }
  .title-scene .kicker { font-size: 0.85rem; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #F0A500; margin-bottom: 0.75rem; }
  .designed-panel { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 2rem; text-align: center; }
  .pay-methods { display: flex; gap: 0.75rem; margin: 1.25rem 0; }
  .pay-pill { padding: 0.5rem 1rem; border-radius: 20px; background: #141414; border: 1px solid #2a2a2a; font-size: 0.9rem; color: #fff; font-weight: 700; }
  .upload-box { width: 200px; height: 140px; border: 2px dashed #444; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #666; font-size: 0.85rem; margin-top: 1rem; }
  .check-circle { width: 72px; height: 72px; border-radius: 50%; background: rgba(34,197,94,0.15); border: 2px solid #22c55e; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: #22c55e; }
  .cta-final .headline { font-size: 2rem; font-weight: 900; color: #fff; }
  .cta-final .url { font-size: 1.4rem; font-weight: 900; color: #F0A500; margin-top: 1rem; }
  #replay {
    position: absolute; bottom: 16px; right: 16px; z-index: 10;
    background: rgba(0,0,0,0.6); color: #fff; border: 1px solid #444; border-radius: 20px;
    padding: 0.4rem 0.9rem; font-size: 0.75rem; cursor: pointer;
  }
</style>
</head>
<body>
<div id="frame">

  <div class="scene" data-scene="title">
    <div class="title-scene">
      <div class="kicker">Playstation Hub</div>
      <div class="headline">Paano mag-rent<br>at bumili</div>
    </div>
  </div>

  <div class="scene" data-scene="rent-1">
    <iframe class="live-frame" src="https://playstation-hub.com/" scrolling="no" tabindex="-1"></iframe>
    <div class="caption-bar"><div class="step">Rent · Hakbang 1</div><div class="text">Buksan playstation-hub.com</div></div>
  </div>

  <div class="scene" data-scene="rent-2">
    <iframe class="live-frame" src="https://playstation-hub.com/browse" scrolling="no" tabindex="-1"></iframe>
    <div class="tap-dot" style="top: 300px; left: 60px;"></div>
    <div class="caption-bar"><div class="step">Rent · Hakbang 2</div><div class="text">Pumili ng game</div></div>
  </div>

  <div class="scene" data-scene="rent-3">
    <iframe class="live-frame" src="https://playstation-hub.com/game/007-first-light" scrolling="no" tabindex="-1"></iframe>
    <div class="tap-dot" style="top: 420px; left: 195px;"></div>
    <div class="caption-bar"><div class="step">Rent · Hakbang 3</div><div class="text">Piliin: Trophy o Non-Trophy</div></div>
  </div>

  <div class="scene" data-scene="rent-4">
    <iframe class="live-frame" src="https://playstation-hub.com/game/007-first-light" scrolling="no" tabindex="-1"></iframe>
    <div class="tap-dot" style="top: 520px; left: 195px;"></div>
    <div class="caption-bar"><div class="step">Rent · Hakbang 4</div><div class="text">7 days o 30 days</div></div>
  </div>

  <div class="scene" data-scene="rent-5">
    <iframe class="live-frame" src="https://playstation-hub.com/game/007-first-light" scrolling="no" tabindex="-1"></iframe>
    <div class="tap-dot" style="top: 620px; left: 195px;"></div>
    <div class="caption-bar"><div class="step">Rent · Hakbang 5</div><div class="text">Ilagay FB name mo → tap Rent</div></div>
  </div>

  <div class="scene" data-scene="rent-6">
    <div class="designed-panel">
      <div class="kicker" style="color:#F0A500;font-weight:800;font-size:0.85rem;letter-spacing:1px;text-transform:uppercase;">Rent · Hakbang 6</div>
      <div style="font-size:1.3rem;font-weight:800;color:#fff;margin-top:0.5rem;">Bayad via GCash o Maya</div>
      <div class="pay-methods"><div class="pay-pill">GCash</div><div class="pay-pill">Maya</div></div>
      <div class="upload-box">Upload screenshot</div>
    </div>
  </div>

  <div class="scene" data-scene="rent-7">
    <div class="designed-panel">
      <div class="check-circle">✓</div>
      <div style="font-size:1.3rem;font-weight:800;color:#fff;margin-top:1rem;">Ipapadala namin ang account</div>
      <div style="font-size:1rem;color:#aaaaaa;margin-top:0.4rem;">Laro na!</div>
    </div>
  </div>

  <div class="scene" data-scene="buy-1">
    <iframe class="live-frame" src="https://playstation-hub.com/buy" scrolling="no" tabindex="-1"></iframe>
    <div class="caption-bar"><div class="step">Buy · Hakbang 1</div><div class="text">Gusto mo permanent? Tap BUY</div></div>
  </div>

  <div class="scene" data-scene="buy-2">
    <iframe class="live-frame" src="https://playstation-hub.com/buy" scrolling="no" tabindex="-1"></iframe>
    <div class="caption-bar"><div class="step">Buy · Hakbang 2</div><div class="text">Naka-group by price — ₱499 hanggang ₱2,499</div></div>
  </div>

  <div class="scene" data-scene="buy-3">
    <iframe class="live-frame" src="https://playstation-hub.com/game/007-first-light?mode=buy" scrolling="no" tabindex="-1"></iframe>
    <div class="tap-dot" style="top: 420px; left: 195px;"></div>
    <div class="caption-bar"><div class="step">Buy · Hakbang 3</div><div class="text">Pumili ng game → Buy Permanent</div></div>
  </div>

  <div class="scene" data-scene="buy-4">
    <iframe class="live-frame" src="https://playstation-hub.com/game/007-first-light?mode=buy" scrolling="no" tabindex="-1"></iframe>
    <div class="tap-dot" style="top: 480px; left: 195px;"></div>
    <div class="caption-bar"><div class="step">Buy · Hakbang 4</div><div class="text">Piliin Non-Trophy o Trophy → bayad</div></div>
  </div>

  <div class="scene" data-scene="cta">
    <div class="designed-panel cta-final">
      <div class="headline">Sa'yo na habambuhay.</div>
      <div class="url">playstation-hub.com</div>
    </div>
  </div>

  <button id="replay" onclick="playReel()">↻ Replay</button>
</div>
<script>
  var SCENES = [
    { id: 'title', duration: 5000 },
    { id: 'rent-1', duration: 6000 },
    { id: 'rent-2', duration: 6000 },
    { id: 'rent-3', duration: 7000 },
    { id: 'rent-4', duration: 6000 },
    { id: 'rent-5', duration: 6000 },
    { id: 'rent-6', duration: 6000 },
    { id: 'rent-7', duration: 6000 },
    { id: 'buy-1', duration: 6000 },
    { id: 'buy-2', duration: 6000 },
    { id: 'buy-3', duration: 6000 },
    { id: 'buy-4', duration: 6000 },
    { id: 'cta', duration: 6000 }
  ];
  var timers = [];

  function clearTimers() {
    timers.forEach(function (t) { clearTimeout(t); });
    timers = [];
  }

  function playReel() {
    clearTimers();
    document.querySelectorAll('.scene').forEach(function (el) { el.classList.remove('active'); });
    var elapsed = 0;
    SCENES.forEach(function (scene) {
      var startTimer = setTimeout(function () {
        document.querySelectorAll('.scene').forEach(function (el) { el.classList.remove('active'); });
        var el = document.querySelector('.scene[data-scene="' + scene.id + '"]');
        if (el) el.classList.add('active');
      }, elapsed);
      timers.push(startTimer);
      elapsed += scene.duration;
    });
  }

  playReel();
</script>
</body>
</html>
```

Note the per-scene duration sum: 5000+6000+6000+7000+6000+6000+6000+6000+6000+6000+6000+6000+6000 = 79000ms — within the spec's "~78s" tolerance (the spec's timing table is itself approximate to the second; this is not a mismatch to fix).

- [ ] **Step 3: Verify HTML is well-formed**

Run:

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/promo/reel-2.html', 'utf8');
const openTags = (html.match(/<div/g) || []).length;
const closeTags = (html.match(/<\/div>/g) || []).length;
if (openTags !== closeTags) { console.error('MISMATCH: ' + openTags + ' open vs ' + closeTags + ' close div tags'); process.exit(1); }
console.log('OK: ' + openTags + ' div tags balanced');
"
```

Expected: `OK: N div tags balanced` with no MISMATCH error.

- [ ] **Step 4: Verify all 13 scene ids referenced in SCENES exist in the HTML**

Run:

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/promo/reel-2.html', 'utf8');
const ids = ['title','rent-1','rent-2','rent-3','rent-4','rent-5','rent-6','rent-7','buy-1','buy-2','buy-3','buy-4','cta'];
const missing = ids.filter(id => !html.includes('data-scene=\"' + id + '\"'));
if (missing.length) { console.error('MISSING SCENES: ' + missing.join(', ')); process.exit(1); }
console.log('OK: all 13 scenes present');
"
```

Expected: `OK: all 13 scenes present`.

- [ ] **Step 5: Verify every `<iframe>` has `pointer-events: none` enforced and points at an https URL**

This is a Global Constraint (no live-site interaction must be possible during
recording). Run:

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/promo/reel-2.html', 'utf8');
const iframeCount = (html.match(/<iframe/g) || []).length;
const httpsIframes = (html.match(/<iframe[^>]*src=\"https:\/\//g) || []).length;
if (iframeCount !== httpsIframes) { console.error('Found ' + iframeCount + ' iframes but only ' + httpsIframes + ' use an https:// src'); process.exit(1); }
const rule = html.includes('.live-frame') && html.includes('pointer-events: none');
if (!rule) { console.error('MISSING: .live-frame pointer-events: none rule'); process.exit(1); }
console.log('OK: ' + iframeCount + ' iframes, all https, pointer-events disabled');
"
```

Expected: `OK: N iframes, all https, pointer-events disabled`.

- [ ] **Step 6: Commit**

```bash
git add public/promo/reel-2.html
git commit -m "Add promo reel 2 (how-to, ~78s)"
```

- [ ] **Step 7: Deploy and verify live**

```bash
git push origin main
```

Poll until the deploy has rolled over:

```bash
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code}" "https://playstation-hub.com/promo/reel-1.html" | grep -q "200" && echo "FOUND at attempt $i" && break; echo "attempt $i: not yet"; sleep 15; done
```

Then, using the Browser tool:
1. Resize the viewport to 390×844 (or as close as the tool allows) and navigate to `https://playstation-hub.com/promo/reel-1.html`.
2. Confirm all 5 scenes play through in sequence with no visible layout jump, and the cover images in Scene 2 load (not broken image icons).
3. Click "↻ Replay" and confirm it restarts cleanly from Scene 1 without any scene from the previous run staying visible.
4. Navigate to `https://playstation-hub.com/promo/reel-2.html`.
5. Confirm all 13 scenes play through, that the four live-iframe scenes (`rent-1`, `rent-2`, `rent-3`/`rent-4`/`rent-5`, `buy-1`/`buy-2`, `buy-3`/`buy-4`) actually load the real site content (not blank/broken iframes — check for a network or console error if any iframe is blank, since `X-Frame-Options` or CSP `frame-ancestors` on the embedded page could block it; this repo does not currently set either header on these routes, but confirm at runtime rather than assuming).
6. Confirm the two designed-panel scenes (`rent-6` payment, `rent-7` confirmation) show no real order reference, name, or any live data — this is the privacy constraint from the spec, and it is worth a deliberate second look since it is the one thing that must never regress.
7. Click "↻ Replay" on reel 2 and confirm the same clean restart behavior as reel 1.
8. Report back to the user with both URLs and a reminder that these are unlisted (not linked from site navigation) — recording is a manual next step outside this plan's scope.
