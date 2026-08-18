# How To Rent Or Buy Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce `public/promo/how-to-rent-or-buy.mp4` — a silent ~42s 1080×1920 tutorial built from real captures of the live site.

**Architecture:** Playwright MCP resizes to 540×960 (exactly 9:16, below the 768px mobile breakpoint), navigates each step, injects a caption bar into the DOM via `browser_evaluate`, and screenshots to PNG. Steps 6–7 come from two locally-rendered designed panels instead of the live order page. A verified `ffmpeg` binary concatenates the frames and upscales 2× to 1080×1920.

**Tech Stack:** Playwright MCP (capture), `ffmpeg-static` 6.1.1 (encode), plain HTML/CSS for the two designed panels. No new project dependencies — ffmpeg lives in the scratchpad, outside the repo.

## Execution constraint — do not delegate capture

**Tasks 2 and 3 must be run by the controller in the main session.** They depend on the Playwright MCP tools (`browser_resize`, `browser_navigate`, `browser_evaluate`, `browser_take_screenshot`), which subagents cannot drive. Task 1 is ordinary file authoring and could be delegated, but the pipeline is short and strictly linear, so running all three inline is simpler and avoids handing a subagent a job it cannot finish.

## Verified before planning

| Assumption | Status |
|---|---|
| Playwright `browser_take_screenshot` writes a real PNG to disk | Confirmed — captured live `/browse` |
| `browser_resize` sets an arbitrary viewport | Confirmed |
| `browser_evaluate` is available for DOM injection | Confirmed, schema loaded |
| An ffmpeg binary is obtainable | Confirmed — `ffmpeg-static@5.3.0` fetched, **82 MB binary exists and reports ffmpeg 6.1.1** |

The npm install printed an `allow-scripts` warning, which normally means a package's install script was blocked. The binary was verified to exist and execute anyway. Do not treat that warning as failure.

## Global Constraints

- **Capture viewport is exactly 540×960.** Output is exactly **1080×1920** (2× upscale). Never capture at a viewport ≥768px — that crosses the mobile breakpoint and renders the desktop layout.
- **No audio.** The MP4 is silent by design.
- **No test order is created against production**, and the order status page is never captured. Steps 6–7 are designed panels only. On step 5 the name field is filled but the form is **never submitted**.
- Durations are **7-day weekly / 30-day monthly**. The deposit is **₱100** on **Trophy and PS4 Primary only**. The sign-in QR expires in **~10 minutes**. These match `server.js:1441` and the verified journey spec.
- Captions are **burned in by the browser** before screenshotting. ffmpeg renders **no text** — `drawtext` is not used anywhere.
- Visual tokens: ground `#0a0a0a`, accent `#F0A500`, highlight `#FFD700`, muted `#aaaaaa`, warning `#f59e0b`.
- Frames and the ffmpeg binary live in the scratchpad, never in the repo. Only the final `.mp4` is committed.

**Scratchpad root** (referred to below as `$SP`):
`C:\Users\michael\AppData\Local\Temp\claude\C--Users-michael-Desktop-claude-code\75f45a84-efaf-4937-9b45-d577e9136a34\scratchpad`

**ffmpeg binary** (verified present):
`$SP/ffm/node_modules/ffmpeg-static/ffmpeg.exe`

---

### Task 1: Designed panels for steps 6 and 7

**Files:**
- Create: `$SP/panels/step-6.html`
- Create: `$SP/panels/step-7.html`

**Interfaces:**
- Consumes: nothing.
- Produces: two local HTML files sized to exactly 540×960, loaded by Task 2 via `file:///` URLs. Each already contains its own caption bar, so Task 2 must **not** inject a caption over these two.

- [ ] **Step 1: Create the panels directory**

```bash
mkdir -p "/c/Users/michael/AppData/Local/Temp/claude/C--Users-michael-Desktop-claude-code/75f45a84-efaf-4937-9b45-d577e9136a34/scratchpad/panels"
```

- [ ] **Step 2: Write `step-6.html`**

Create `$SP/panels/step-6.html` with exactly this content:

```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Step 6</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:540px; height:960px; overflow:hidden; background:#0a0a0a;
    font-family:-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { width:540px; height:960px; display:flex; flex-direction:column;
    align-items:center; justify-content:center; padding:3rem 2.5rem 12rem; text-align:center; }
  .icon { font-size:4.5rem; margin-bottom:1.5rem; }
  .h { font-size:2rem; font-weight:900; color:#fff; line-height:1.2; }
  .pays { display:flex; gap:0.75rem; margin:1.75rem 0; }
  .pay { font-size:1.05rem; font-weight:800; color:#fff; background:#141414;
    border:1px solid #2a2a2a; border-radius:26px; padding:0.7rem 1.6rem; }
  .up { width:230px; height:150px; border:2px dashed #444; border-radius:14px;
    display:flex; align-items:center; justify-content:center; color:#777; font-size:1rem; }
  .capbar { position:fixed; left:0; right:0; bottom:0;
    background:linear-gradient(to top,rgba(0,0,0,0.97),rgba(0,0,0,0.9) 62%,rgba(0,0,0,0));
    padding:3.2rem 1.4rem 2rem; text-align:center; }
  .kick { font-size:0.8rem; font-weight:800; letter-spacing:2px; text-transform:uppercase;
    color:#F0A500; margin-bottom:0.5rem; }
  .cap { font-size:1.35rem; font-weight:800; color:#fff; line-height:1.32; }
</style></head><body>
<div class="wrap">
  <div class="icon">💳</div>
  <div class="h">Bayad via<br>GCash o Maya</div>
  <div class="pays"><div class="pay">GCash</div><div class="pay">Maya</div></div>
  <div class="up">I-upload ang resibo</div>
</div>
<div class="capbar">
  <div class="kick">Step 6 / 7</div>
  <div class="cap">I-scan ang QR sa order page, tapos i-upload ang resibo</div>
</div>
</body></html>
```

- [ ] **Step 3: Write `step-7.html`**

Create `$SP/panels/step-7.html` with exactly this content:

```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Step 7</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:540px; height:960px; overflow:hidden; background:#0a0a0a;
    font-family:-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { width:540px; height:960px; display:flex; flex-direction:column;
    align-items:center; justify-content:center; padding:3rem 2.5rem 12rem; text-align:center; }
  .icon { font-size:4.5rem; margin-bottom:1.5rem; }
  .h { font-size:2rem; font-weight:900; color:#fff; line-height:1.2; }
  .warn { margin-top:1.75rem; background:rgba(245,158,11,0.1);
    border:2px solid rgba(245,158,11,0.4); border-radius:14px; padding:1.1rem 1.5rem;
    color:#f59e0b; font-size:1.15rem; font-weight:800; }
  .ok { margin-top:1.5rem; font-size:1.05rem; color:#aaaaaa; }
  .capbar { position:fixed; left:0; right:0; bottom:0;
    background:linear-gradient(to top,rgba(0,0,0,0.97),rgba(0,0,0,0.9) 62%,rgba(0,0,0,0));
    padding:3.2rem 1.4rem 2rem; text-align:center; }
  .kick { font-size:0.8rem; font-weight:800; letter-spacing:2px; text-transform:uppercase;
    color:#F0A500; margin-bottom:0.5rem; }
  .cap { font-size:1.35rem; font-weight:800; color:#fff; line-height:1.32; }
</style></head><body>
<div class="wrap">
  <div class="icon">📱</div>
  <div class="h">Send ang<br>sign-in QR mo</div>
  <div class="warn">⏱️ 10 minutes lang bago mag-expire</div>
  <div class="ok">Kami na ang bahala mag-sign in. Laro na!</div>
</div>
<div class="capbar">
  <div class="kick">Step 7 / 7</div>
  <div class="cap">I-send agad — kami na ang bahala. Laro na!</div>
</div>
</body></html>
```

- [ ] **Step 4: Verify both files exist and are non-empty**

```bash
SP="/c/Users/michael/AppData/Local/Temp/claude/C--Users-michael-Desktop-claude-code/75f45a84-efaf-4937-9b45-d577e9136a34/scratchpad"
for f in step-6 step-7; do printf '%s: ' "$f"; [ -s "$SP/panels/$f.html" ] && wc -c < "$SP/panels/$f.html" || echo MISSING; done
```

Expected: two lines, each printing a byte count over 1000. Any `MISSING` means the file was not written.

---

### Task 2: Capture the seven frames

**Files:**
- Create: `$SP/frames/step-1.png` through `$SP/frames/step-7.png`

**Interfaces:**
- Consumes: `$SP/panels/step-6.html` and `step-7.html` from Task 1.
- Produces: seven 540×960 PNGs named `step-1.png` … `step-7.png`, consumed by Task 3.

**This task is controller-only** — it drives Playwright MCP tools.

- [ ] **Step 1: Create the frames directory and set the viewport**

```bash
mkdir -p "/c/Users/michael/AppData/Local/Temp/claude/C--Users-michael-Desktop-claude-code/75f45a84-efaf-4937-9b45-d577e9136a34/scratchpad/frames"
```

Then call `browser_resize` with `width: 540`, `height: 960`.

- [ ] **Step 2: Define the caption injector**

For every live-site frame (steps 1–5), after navigating, call `browser_evaluate` with this function. Replace `KICKER` and `CAPTION` per the table in Step 3. It also hides the floating Messenger widget and any announcement bar, which would otherwise clutter the frame.

```js
() => {
  document.querySelectorAll('#__capbar').forEach(e => e.remove());
  ['[class*="messenger"]','[class*="fab"]','[id*="messenger"]','[class*="chat-bubble"]','[class*="announce"]']
    .forEach(sel => document.querySelectorAll(sel).forEach(e => { e.style.display = 'none'; }));
  const b = document.createElement('div');
  b.id = '__capbar';
  b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;'
    + 'background:linear-gradient(to top,rgba(0,0,0,0.97),rgba(0,0,0,0.9) 62%,rgba(0,0,0,0));'
    + 'padding:3.2rem 1.4rem 2rem;text-align:center;'
    + 'font-family:-apple-system,"Segoe UI",Roboto,sans-serif;';
  b.innerHTML = '<div style="font-size:0.8rem;font-weight:800;letter-spacing:2px;'
    + 'text-transform:uppercase;color:#F0A500;margin-bottom:0.5rem;">KICKER</div>'
    + '<div style="font-size:1.35rem;font-weight:800;color:#fff;line-height:1.32;">CAPTION</div>';
  document.body.appendChild(b);
  return 'caption injected';
}
```

- [ ] **Step 3: Capture steps 1–5 from the live site**

For each row: `browser_navigate` to the URL, run the injector from Step 2 with that row's kicker and caption, then `browser_take_screenshot` with `scale: "css"` and the given filename.

| Frame | URL | Kicker | Caption |
|---|---|---|---|
| 1 | `https://playstation-hub.com/` | `Step 1 / 7` | `Buksan ang playstation-hub.com — tap Rent o Buy` |
| 2 | `https://playstation-hub.com/browse` | `Step 2 / 7` | `Pumili ng game` |
| 3 | `https://playstation-hub.com/game/007-first-light` | `Step 3 / 7` | `Piliin ang account type — may ₱100 deposit ang Trophy` |
| 4 | `https://playstation-hub.com/game/007-first-light` | `Step 4 / 7` | `Pumili ng haba — 7 o 30 days` |
| 5 | `https://playstation-hub.com/game/007-first-light` | `Step 5 / 7` | `Ilagay ang Facebook name mo, tapos tap Rent` |

Screenshot filenames, in order:
`../frames/step-1.png`, `../frames/step-2.png`, `../frames/step-3.png`, `../frames/step-4.png`, `../frames/step-5.png`

Playwright writes relative filenames into its own output directory, so verify actual locations in Step 5 rather than trusting the path.

For frames 4 and 5, before injecting the caption, scroll the relevant control into view by calling `browser_evaluate` with:

```js
() => { const el = document.querySelector('.gd-dur-btn') || document.querySelector('#orderFbName'); if (el) el.scrollIntoView({ block: 'center' }); return 'scrolled'; }
```

For frame 5 only, also fill the name field — **without submitting**:

```js
() => { const i = document.getElementById('orderFbName'); if (i) i.value = 'Juan Dela Cruz'; return i ? 'filled' : 'field not found'; }
```

- [ ] **Step 4: Capture steps 6–7 from the local panels**

Navigate to each `file:///` URL and screenshot. These panels already contain their own caption bars, so **do not** run the injector on them.

| Frame | URL | Filename |
|---|---|---|
| 6 | `file:///C:/Users/michael/AppData/Local/Temp/claude/C--Users-michael-Desktop-claude-code/75f45a84-efaf-4937-9b45-d577e9136a34/scratchpad/panels/step-6.html` | `../frames/step-6.png` |
| 7 | `file:///C:/Users/michael/AppData/Local/Temp/claude/C--Users-michael-Desktop-claude-code/75f45a84-efaf-4937-9b45-d577e9136a34/scratchpad/panels/step-7.html` | `../frames/step-7.png` |

Both URLs end in `.html`. The `.png` values are output filenames, not navigation targets.

- [ ] **Step 5: Locate and consolidate all seven frames**

Playwright may write to its own output directory rather than the path given. Find them and move them into place:

```bash
SP="/c/Users/michael/AppData/Local/Temp/claude/C--Users-michael-Desktop-claude-code/75f45a84-efaf-4937-9b45-d577e9136a34/scratchpad"
mkdir -p "$SP/frames"
find /c/Users/michael -maxdepth 5 -name "step-[1-7].png" -newermt "-30 minutes" 2>/dev/null | while read f; do
  [ "$(dirname "$f")" != "$SP/frames" ] && mv -f "$f" "$SP/frames/" && echo "moved $(basename "$f")"
done
ls -la "$SP/frames/"
```

Expected: seven files, `step-1.png` through `step-7.png`.

- [ ] **Step 6: Verify every frame is exactly 540×960**

```bash
SP="/c/Users/michael/AppData/Local/Temp/claude/C--Users-michael-Desktop-claude-code/75f45a84-efaf-4937-9b45-d577e9136a34/scratchpad"
FF="$SP/ffm/node_modules/ffmpeg-static/ffmpeg.exe"
for i in 1 2 3 4 5 6 7; do
  printf 'step-%s: ' "$i"
  "$FF" -hide_banner -i "$SP/frames/step-$i.png" 2>&1 | grep -oE '[0-9]{3,4}x[0-9]{3,4}' | head -1 || echo "MISSING"
done
```

Expected: seven lines each reading `540x960`. Any other size means the viewport drifted and that frame must be recaptured — mixed sizes will distort the video.

---

### Task 3: Encode and deploy

**Files:**
- Create: `$SP/frames/list.txt`
- Create: `public/promo/how-to-rent-or-buy.mp4`

**Interfaces:**
- Consumes: the seven 540×960 PNGs from Task 2.
- Produces: the final MP4, committed and deployed.

- [ ] **Step 1: Write the concat list**

Each frame holds 6 seconds. The concat demuxer ignores the final entry's duration, so the last frame is repeated — this is a documented quirk, not a mistake.

```bash
SP="/c/Users/michael/AppData/Local/Temp/claude/C--Users-michael-Desktop-claude-code/75f45a84-efaf-4937-9b45-d577e9136a34/scratchpad"
: > "$SP/frames/list.txt"
for i in 1 2 3 4 5 6 7; do
  echo "file 'step-$i.png'" >> "$SP/frames/list.txt"
  echo "duration 6"         >> "$SP/frames/list.txt"
done
echo "file 'step-7.png'" >> "$SP/frames/list.txt"
cat "$SP/frames/list.txt"
```

Expected output: seven `file` / `duration 6` pairs followed by a final bare `file 'step-7.png'`.

- [ ] **Step 2: Encode to 1080×1920**

```bash
SP="/c/Users/michael/AppData/Local/Temp/claude/C--Users-michael-Desktop-claude-code/75f45a84-efaf-4937-9b45-d577e9136a34/scratchpad"
FF="$SP/ffm/node_modules/ffmpeg-static/ffmpeg.exe"
cd "$SP/frames" && "$FF" -y -hide_banner -loglevel error \
  -f concat -safe 0 -i list.txt \
  -vf "scale=1080:1920:flags=lanczos,format=yuv420p" \
  -r 30 -c:v libx264 -preset medium -crf 20 -movflags +faststart \
  "/c/Users/michael/Desktop/claude code/playstation-hub/public/promo/how-to-rent-or-buy.mp4" && echo "ENCODE OK"
```

Expected: `ENCODE OK` with no error output.

- [ ] **Step 3: Verify the output**

```bash
cd "C:/Users/michael/Desktop/claude code/playstation-hub"
SP="/c/Users/michael/AppData/Local/Temp/claude/C--Users-michael-Desktop-claude-code/75f45a84-efaf-4937-9b45-d577e9136a34/scratchpad"
FF="$SP/ffm/node_modules/ffmpeg-static/ffmpeg.exe"
ls -la public/promo/how-to-rent-or-buy.mp4
"$FF" -hide_banner -i public/promo/how-to-rent-or-buy.mp4 2>&1 | grep -E "Duration|Stream #0"
```

Expected: resolution `1080x1920`, duration close to `00:00:42`, one video stream and **no audio stream**. If the file exceeds roughly 25 MB, re-encode with `-crf 26` before committing rather than committing an oversized binary.

- [ ] **Step 4: Commit and deploy**

```bash
cd "C:/Users/michael/Desktop/claude code/playstation-hub"
git add public/promo/how-to-rent-or-buy.mp4
git commit -m "Add how-to-rent-or-buy tutorial video (1080x1920, ~42s, silent)"
git push origin main
```

- [ ] **Step 5: Verify it is live**

```bash
for i in 1 2 3 4 5 6 7 8; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://playstation-hub.com/promo/how-to-rent-or-buy.mp4")
  [ "$code" = "200" ] && echo "LIVE at attempt $i" && break
  echo "attempt $i: $code"; sleep 20
done
curl -sI "https://playstation-hub.com/promo/how-to-rent-or-buy.mp4" | grep -iE "content-type|content-length"
```

Expected: `LIVE`, `content-type: video/mp4`, and a content-length matching the local file size.

Deploys this session have usually rolled over inside 90 seconds, though one took about ten minutes. Exhausting the poll is a deploy-timing issue, not a code fault — re-poll rather than changing anything.

- [ ] **Step 6: Report to the user**

Give them the URL, the duration and file size, and state plainly that the video is silent so any music or voiceover is theirs to add. Note that frames 1–5 show the real live site and frames 6–7 are designed panels, so no customer data appears anywhere in it.
