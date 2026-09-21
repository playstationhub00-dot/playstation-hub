# Inline JavaScript Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the inline `<script>` logic on 5 public pages into external, cacheable `.js` files, with zero behavior change.

**Architecture:** Per script block: hoist any server-interpolated `const`s into a small EJS-rendered inline `<script>` at the block's original position, then move everything else verbatim into a new `public/js/*.js` file loaded via `<script src="...?v=<%= assetV %>">` at that exact same position. No `defer`/`async`. Blocks that already contain nothing but server data (no logic) are left inline untouched.

**Tech Stack:** EJS views, plain external `.js` files (no bundler, no build step — matches this project's existing `public/js/admin-searchable-select.js`), `node`/`sed`/`diff` for verified extraction, plain Node test scripts.

## Global Constraints

- Direct-on-main workflow, no worktree isolation (established practice in this repo).
- No `defer`, no `async`, no reordering — every extracted `<script src>` replaces its original `<script>` tag at the exact same position in the document.
- Every extracted file must be requested with `?v=<%= assetV %>`, exactly like `admin-searchable-select.js` from Phase 1, so it gets the immutable cache Phase 1 already built.
- No logic changes. If something looks odd while moving it, leave it as-is and note it — do not fix it in this pass.
- A block that is already pure server-data with no logic (the pre-existing `RENTAL_DURATIONS` one-liners, and `upcoming-detail.ejs`'s 383-390 data block) is **not** extracted — moving a single data declaration to an external file adds an HTTP request for no benefit and is out of scope.
- Every extraction must be verified as behaviorally identical: after moving a block, `grep -c '<%' <extracted-file>.js` must be `0` (proves no unrendered EJS tag was accidentally carried into a static file), and a diff between {the original block's non-hoisted lines} and {the new file's content} must show no differences beyond the lines explicitly called out as intentional rewrites in this plan.
- Two blocks require one intentional, explicitly-scoped rewrite beyond pure relocation — both are called out by exact line number in their task below. Every other block moves byte-for-byte.

---

### Task 1: `game-detail.ejs` (27.5 KB, the largest file)

**Files:**
- Modify: `views/game-detail.ejs:573-1176` (the big script block; leave line 572's `RENTAL_DURATIONS` one-liner untouched)
- Create: `public/js/game-detail.js`
- Test: `scripts/test-js-extraction-game-detail.js` (new)

**Interfaces:**
- Consumes: nothing from other tasks — each file's extraction is independent.
- Produces: `public/js/game-detail.js`, referenced only by `game-detail.ejs`.

**What's in the block today (verified by direct reading, not just grep):**

The block at `views/game-detail.ejs:573-1176` contains, in order: five server-interpolated `const` declarations (`PRICES`, `BUY_PRICES`, `PROMO`, `AVAIL`, `ALL_UNAVAIL`, all between lines 574 and 601), then ~575 lines of pure logic, with two more interpolated values buried deep inside that logic: `gameTitle` at line 1028 (declared **inside** `function updateReserveLinks()`, not at page level) and `gdSlideCount` at line 1124 (page-level, just physically far from the others).

- [ ] **Step 1: Capture the current block for later comparison**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
sed -n '573,1176p' views/game-detail.ejs > /tmp/gd-before.txt
wc -l /tmp/gd-before.txt
```

Expected: 604 lines.

- [ ] **Step 2: Write the failing test**

Create `scripts/test-js-extraction-game-detail.js`:

```js
// Run: node scripts/test-js-extraction-game-detail.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const viewSrc = fs.readFileSync(path.join(REPO_ROOT, 'views', 'game-detail.ejs'), 'utf8');
const jsPath = path.join(REPO_ROOT, 'public', 'js', 'game-detail.js');

console.log('\ngame-detail.ejs — inline logic extracted to public/js/game-detail.js');

ok('public/js/game-detail.js exists', () => {
  assert.ok(fs.existsSync(jsPath), 'public/js/game-detail.js was not created');
});

ok('the extracted file has no leftover EJS tags', () => {
  const js = fs.readFileSync(jsPath, 'utf8');
  assert.ok(!js.includes('<%'), 'an EJS tag was left in the extracted file — it will render as literal text, not run');
});

ok('the extracted file still defines the functions the page depends on', () => {
  const js = fs.readFileSync(jsPath, 'utf8');
  for (const fn of ['computeRentTotal', 'promoPctFor', 'updateReserveLinks', 'gdGo']) {
    assert.ok(js.includes(fn), 'expected function `' + fn + '` not found in the extracted file');
  }
});

ok('the view loads it via a versioned <script src> in the original position', () => {
  assert.ok(
    /<script src="\/js\/game-detail\.js\?v=<%=\s*assetV\s*%>"><\/script>/.test(viewSrc),
    'game-detail.ejs does not request /js/game-detail.js with ?v=<%= assetV %>'
  );
});

ok('the view no longer carries the big inline block', () => {
  assert.ok(!/function updateReserveLinks/.test(viewSrc), 'updateReserveLinks is still inline in the view — extraction did not remove it');
});

ok('the hoisted data block still declares every value the moved code reads as a global', () => {
  for (const name of ['PRICES', 'BUY_PRICES', 'PROMO', 'AVAIL', 'ALL_UNAVAIL', 'gameTitle', 'gdSlideCount']) {
    assert.ok(
      new RegExp('const ' + name + '\\s*=').test(viewSrc),
      'expected `const ' + name + ' =` still declared inline in game-detail.ejs'
    );
  }
});

ok('gameTitle is no longer declared a second time inside updateReserveLinks (would shadow the hoisted global)', () => {
  const fnMatch = viewSrc.match(/function updateReserveLinks\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(fnMatch, 'could not locate updateReserveLinks to check its body');
  assert.ok(!/const gameTitle/.test(fnMatch[1]), 'updateReserveLinks still has its own `const gameTitle` — this shadows the hoisted global and silently keeps the OLD per-call recomputation instead of the hoisted one-time value');
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node scripts/test-js-extraction-game-detail.js`
Expected: FAIL on the first assertion — `public/js/game-detail.js` does not exist yet.

- [ ] **Step 4: Extract — create the external file**

Take lines 573-1176 of `views/game-detail.ejs` (captured in `/tmp/gd-before.txt` at Step 1) and produce `public/js/game-detail.js` containing everything **except**:
- The `<script>` and `</script>` wrapper lines themselves
- The five top-of-block declarations: `const PRICES = {...};`, `const BUY_PRICES = {...};`, `const PROMO = {...};`, `const AVAIL = {...};`, `const ALL_UNAVAIL = ...;` (lines 574-601 of the original block, i.e. the EJS-interpolated declarations shown in this task's "What's in the block today" section — these stay in the view)
- Inside `function updateReserveLinks()`: delete the line `const gameTitle = '<%= game.title.replace(/'/g, "\\'") %>';` entirely (do not move it anywhere — it becomes a stale duplicate declaration if left, and a page-level `const gameTitle` is being added in Step 5 to replace it)
- The line `const gdSlideCount = <%= gdhGallery.length %>;` (this moves to the hoisted block in Step 5, not into the external file — replace it in place with nothing, i.e. delete this exact line from the middle of the code before writing the rest to the external file)

Everything else — every function, every event listener, all ~570 remaining lines — goes into `public/js/game-detail.js` completely unchanged, in their original relative order.

- [ ] **Step 5: Extract — rewrite the view**

Replace `views/game-detail.ejs:573-1176` (the whole block, `<script>` through `</script>`) with:

```html
<script>
const PRICES = {
  nt: { 7: <%= game.nt_price_7d %>, 30: <%= game.nt_price_30d %> },
  tr: { 7: <%= game.tr_price_7d || game.nt_price_7d %>, 30: <%= game.tr_price_30d || game.nt_price_30d %> },
  ps4: { 7: <%= game.tr_price_7d || game.nt_price_7d %>, 30: <%= game.tr_price_30d || game.nt_price_30d %> }
};
const BUY_PRICES = { nt: <%= buyNtFinal %>, tr: <%= buyTrFinal %> };
const PROMO = {
  enabled: <%= promo.enabled ? 'true' : 'false' %>,
  discounts: { 7: <%= (promo.discounts && promo.discounts[7]) || 0 %>, 30: <%= (promo.discounts && promo.discounts[30]) || 0 %> },
  deposit: <%= promo.deposit %>
};
const AVAIL = { nt: <%= ntAvail ? 'true' : 'false' %>, tr: <%= trAvail ? 'true' : 'false' %>, ps4: <%= ps4Avail ? 'true' : 'false' %> };
const ALL_UNAVAIL = <%= allUnavail ? 'true' : 'false' %>;
const gameTitle = '<%= game.title.replace(/'/g, "\\'") %>';
const gdSlideCount = <%= gdhGallery.length %>;
</script>
<script src="/js/game-detail.js?v=<%= assetV %>"></script>
```

This hoisted block preserves every EJS expression from the original exactly (including the pre-existing `nt`/`tr`/`ps4` duplication in `PRICES` and the two comments that were between declarations — the comments can be dropped here since they were documentation about the code, which now lives with that code in the external file; do not drop the `computeRentTotal`/`promoPctFor` doc comment from the external file itself in Step 4).

- [ ] **Step 6: Run test to verify it passes**

Run: `node scripts/test-js-extraction-game-detail.js`
Expected: PASS — all 7 assertions.

- [ ] **Step 7: Verify no unintended content change**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
grep -c '<%' public/js/game-detail.js
```

Expected: `0`. If non-zero, an EJS tag was accidentally left in — find it and move it back into the view's hoisted block.

```bash
wc -l public/js/game-detail.js
```

Expected: roughly 594-596 lines (604 original block lines, minus the `<script>`/`</script>` wrapper lines, minus the 5 hoisted declarations' lines, minus the 2 relocated single-line declarations = approximately this range; investigate if wildly different).

- [ ] **Step 8: Run the full existing test suite**

Run every `node scripts/test-*.js`. Expected: PASS on all, no regressions.

- [ ] **Step 9: Commit**

```bash
git add views/game-detail.ejs public/js/game-detail.js scripts/test-js-extraction-game-detail.js
git commit -m "$(cat <<'EOF'
Extract game-detail.ejs's inline JS to public/js/game-detail.js

27.5 KB of page logic was inline and re-sent on every visit. Hoisted the
five server-interpolated consts (PRICES, BUY_PRICES, PROMO, AVAIL,
ALL_UNAVAIL) plus two more found deeper in the code (gameTitle,
gdSlideCount) into a small inline data block, and moved everything else
— unchanged — into an external, cache-eligible file loaded at the exact
same document position, no defer/async.

gameTitle needed one extra step beyond relocation: it was declared
inside updateReserveLinks(), not at page level, so the inner
declaration had to be deleted or it would shadow the hoisted global and
silently negate the change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `index.ejs` (16 KB across 4 separate script blocks)

**Files:**
- Modify: `views/index.ejs` (4 separate `<script>` blocks: lines 99-115, 487-494, 547-563, 753-1018)
- Create: `public/js/index-1.js`, `public/js/index-2.js`, `public/js/index-3.js`, `public/js/index-4.js`
- Test: `scripts/test-js-extraction-index.js` (new)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: 4 files, referenced only by `index.ejs`.

**Why 4 files, not 1:** these blocks sit at 4 different points in the page with real HTML between each pair (364, 51, and 179 non-blank lines respectively) — verified by direct inspection before this plan was written. Consolidating them into one file loaded at one position would run blocks 2-4's code before the DOM elements between them exist, which is exactly the execution-order change this whole extraction is designed to avoid. Each block gets its own file, loaded at its own original position.

Blocks 1-3 (99-115, 487-494, 547-563) have zero server interpolation — verified by direct reading, not just the earlier grep count — so they move to their external files completely unchanged, and their inline `<script>...</script>` is replaced outright by `<script src="...">`. Block 4 (753-1018) has one pair of interpolated consts, `_rentPromo` and `_buyPromo`, at lines 961-962.

- [ ] **Step 1: Capture the current blocks**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
sed -n '99,115p'  views/index.ejs > /tmp/idx1-before.txt
sed -n '487,494p' views/index.ejs > /tmp/idx2-before.txt
sed -n '547,563p' views/index.ejs > /tmp/idx3-before.txt
sed -n '753,1018p' views/index.ejs > /tmp/idx4-before.txt
```

- [ ] **Step 2: Write the failing test**

Create `scripts/test-js-extraction-index.js`:

```js
// Run: node scripts/test-js-extraction-index.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const viewSrc = fs.readFileSync(path.join(REPO_ROOT, 'views', 'index.ejs'), 'utf8');

console.log('\nindex.ejs — 4 inline blocks extracted to public/js/index-1..4.js');

for (const n of [1, 2, 3, 4]) {
  ok('public/js/index-' + n + '.js exists', () => {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'public', 'js', 'index-' + n + '.js')), 'missing index-' + n + '.js');
  });
  ok('index-' + n + '.js has no leftover EJS tags', () => {
    const js = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'index-' + n + '.js'), 'utf8');
    assert.ok(!js.includes('<%'), 'an EJS tag was left in index-' + n + '.js');
  });
  ok('index.ejs requests index-' + n + '.js with the version query, in document order', () => {
    assert.ok(
      new RegExp('<script src="\\/js\\/index-' + n + '\\.js\\?v=<%=\\s*assetV\\s*%>"><\\/script>').test(viewSrc),
      'index.ejs does not request /js/index-' + n + '.js with ?v=<%= assetV %>'
    );
  });
}

ok('the 4 script tags still appear in their original relative order', () => {
  const positions = [1, 2, 3, 4].map(n => viewSrc.indexOf('/js/index-' + n + '.js'));
  assert.ok(positions.every(p => p !== -1), 'not all 4 script references found');
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] > positions[i - 1], 'index-' + (i + 1) + '.js appears before index-' + i + '.js — order changed');
  }
});

ok('index-4.js still defines the promo-aware functions', () => {
  const js = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'index-4.js'), 'utf8');
  assert.ok(js.includes('_rentPromo') || js.includes('_buyPromo') === false, 'index-4.js should NOT redeclare _rentPromo/_buyPromo — they stay hoisted in the view');
});

ok('the hoisted _rentPromo/_buyPromo data block is still present before index-4.js', () => {
  assert.ok(/const _rentPromo\s*=/.test(viewSrc), '_rentPromo is no longer declared inline in index.ejs');
  assert.ok(/const _buyPromo\s*=/.test(viewSrc), '_buyPromo is no longer declared inline in index.ejs');
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node scripts/test-js-extraction-index.js`
Expected: FAIL — none of the 4 files exist yet.

- [ ] **Step 4: Extract blocks 1-3 (no interpolation, verbatim)**

For each of the three blocks, copy the content **between** the `<script>` and `</script>` tags (not the tags themselves) into its own file:
- `views/index.ejs:100-114` (inside the 99-115 tags) → `public/js/index-1.js`, unchanged
- `views/index.ejs:488-493` (inside the 487-494 tags) → `public/js/index-2.js`, unchanged
- `views/index.ejs:548-562` (inside the 547-563 tags) → `public/js/index-3.js`, unchanged

Replace each block's `<script>...</script>` pair in the view with:

```html
<script src="/js/index-1.js?v=<%= assetV %>"></script>
```

(and the equivalent for `index-2.js`, `index-3.js` at their own positions).

- [ ] **Step 5: Extract block 4 (has interpolation)**

Take `views/index.ejs:753-1018`. Remove the two lines:
```
const _rentPromo = { enabled: <%- promo.enabled ? 'true' : 'false' %>, discounts: { 10: <%= (promo.discounts && promo.discounts[10]) || 0 %>, 15: <%= (promo.discounts && promo.discounts[15]) || 0 %>, 30: <%= (promo.discounts && promo.discounts[30]) || 0 %> } };
const _buyPromo  = { enabled: <%- promo.buy_promo_enabled ? 'true' : 'false' %>, pct: <%= promo.buy_promo_pct || 0 %> };
```
and the `// Promo config from server` comment immediately above them. Everything else in the block moves unchanged into `public/js/index-4.js`.

Replace `views/index.ejs:753-1018` with:

```html
<script>
// Promo config from server
const _rentPromo = { enabled: <%- promo.enabled ? 'true' : 'false' %>, discounts: { 10: <%= (promo.discounts && promo.discounts[10]) || 0 %>, 15: <%= (promo.discounts && promo.discounts[15]) || 0 %>, 30: <%= (promo.discounts && promo.discounts[30]) || 0 %> } };
const _buyPromo  = { enabled: <%- promo.buy_promo_enabled ? 'true' : 'false' %>, pct: <%= promo.buy_promo_pct || 0 %> };
</script>
<script src="/js/index-4.js?v=<%= assetV %>"></script>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node scripts/test-js-extraction-index.js`
Expected: PASS — all assertions.

- [ ] **Step 7: Verify no unintended content change**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
for f in public/js/index-1.js public/js/index-2.js public/js/index-3.js public/js/index-4.js; do
  echo "$f: $(grep -c '<%' "$f") leftover EJS tags (expect 0)"
done
```

- [ ] **Step 8: Run the full existing test suite**

Run every `node scripts/test-*.js`. Expected: PASS on all, no regressions.

- [ ] **Step 9: Commit**

```bash
git add views/index.ejs public/js/index-1.js public/js/index-2.js public/js/index-3.js public/js/index-4.js scripts/test-js-extraction-index.js
git commit -m "$(cat <<'EOF'
Extract index.ejs's 4 inline script blocks to public/js/index-1..4.js

The homepage's ~16 KB of JS was spread across 4 separate <script> tags
at different points in the page, with real HTML between each pair (up
to 364 lines). Kept as 4 separate files rather than one, each loaded at
its own original position with no defer/async, so execution order
relative to the DOM between them is unchanged. Only block 4 carried
server-interpolated data (_rentPromo, _buyPromo); it stays as a small
inline hoist plus an external file, same pattern as game-detail.ejs.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `upcoming-detail.ejs` (15.5 KB)

**Files:**
- Modify: `views/upcoming-detail.ejs:391-741` (leave lines 383-390 — the pre-existing data-only block and `RENTAL_DURATIONS` — untouched)
- Create: `public/js/upcoming-detail.js`
- Test: `scripts/test-js-extraction-upcoming-detail.js` (new)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `public/js/upcoming-detail.js`, referenced only by `upcoming-detail.ejs`.

The block at `views/upcoming-detail.ejs:391-741` has two interpolated consts, both page-level (not function-local, unlike game-detail's `gameTitle`): `ALL_FULL` at line 606 and `gpSlideCount` at line 691, both physically mid-block rather than at the top.

- [ ] **Step 1: Capture the current block**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
sed -n '391,741p' views/upcoming-detail.ejs > /tmp/upd-before.txt
wc -l /tmp/upd-before.txt
```

Expected: 351 lines.

- [ ] **Step 2: Write the failing test**

Create `scripts/test-js-extraction-upcoming-detail.js`:

```js
// Run: node scripts/test-js-extraction-upcoming-detail.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const viewSrc = fs.readFileSync(path.join(REPO_ROOT, 'views', 'upcoming-detail.ejs'), 'utf8');
const jsPath = path.join(REPO_ROOT, 'public', 'js', 'upcoming-detail.js');

console.log('\nupcoming-detail.ejs — inline logic extracted to public/js/upcoming-detail.js');

ok('public/js/upcoming-detail.js exists', () => {
  assert.ok(fs.existsSync(jsPath), 'public/js/upcoming-detail.js was not created');
});

ok('the extracted file has no leftover EJS tags', () => {
  const js = fs.readFileSync(jsPath, 'utf8');
  assert.ok(!js.includes('<%'), 'an EJS tag was left in the extracted file');
});

ok('the extracted file still defines gpGo (gallery slider)', () => {
  const js = fs.readFileSync(jsPath, 'utf8');
  assert.ok(js.includes('function gpGo'), 'gpGo not found in the extracted file');
});

ok('the pre-existing data block (GAME_TITLE, NT_PRICES, etc.) is untouched', () => {
  assert.ok(/const GAME_TITLE\s*=/.test(viewSrc), 'the pre-existing GAME_TITLE data block was removed — it was out of scope for this task');
  assert.ok(/const RENTAL_DURATIONS\s*=/.test(viewSrc), 'the pre-existing RENTAL_DURATIONS line was removed — it was out of scope for this task');
});

ok('ALL_FULL and gpSlideCount are still hoisted inline as globals', () => {
  assert.ok(/const ALL_FULL\s*=/.test(viewSrc), 'ALL_FULL is no longer declared inline');
  assert.ok(/const gpSlideCount\s*=/.test(viewSrc), 'gpSlideCount is no longer declared inline');
});

ok('the view loads the extracted file via a versioned <script src> at the right position', () => {
  assert.ok(
    /<script src="\/js\/upcoming-detail\.js\?v=<%=\s*assetV\s*%>"><\/script>/.test(viewSrc),
    'upcoming-detail.ejs does not request /js/upcoming-detail.js with ?v=<%= assetV %>'
  );
});

ok('the view no longer carries the big inline block', () => {
  assert.ok(!/function gpGo/.test(viewSrc), 'gpGo is still inline in the view');
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node scripts/test-js-extraction-upcoming-detail.js`
Expected: FAIL — the file doesn't exist yet.

- [ ] **Step 4: Extract**

Take lines 391-741 of `views/upcoming-detail.ejs`. Remove the two lines `const ALL_FULL = <%= allFull ? 'true' : 'false' %>;` (currently at line 606) and `const gpSlideCount = <%= gpGallery.length %>;` (currently at line 691) from wherever they sit in the body; everything else moves unchanged, in original order, into `public/js/upcoming-detail.js`.

- [ ] **Step 5: Rewrite the view**

Replace `views/upcoming-detail.ejs:391-741` with:

```html
<script>
const ALL_FULL = <%= allFull ? 'true' : 'false' %>;
const gpSlideCount = <%= gpGallery.length %>;
</script>
<script src="/js/upcoming-detail.js?v=<%= assetV %>"></script>
```

Lines 383-390 (the `GAME_TITLE`/`NT_PRICES`/`TR_PRICES`/`NT_SLOTS`/`TR_SLOTS`/`RENTAL_DURATIONS` block) stay exactly as they are, immediately above this — out of scope, already minimal.

- [ ] **Step 6: Run test to verify it passes**

Run: `node scripts/test-js-extraction-upcoming-detail.js`
Expected: PASS — all assertions.

- [ ] **Step 7: Verify no unintended content change**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
grep -c '<%' public/js/upcoming-detail.js
```

Expected: `0`.

- [ ] **Step 8: Run the full existing test suite**

Run every `node scripts/test-*.js`. Expected: PASS on all, no regressions.

- [ ] **Step 9: Commit**

```bash
git add views/upcoming-detail.ejs public/js/upcoming-detail.js scripts/test-js-extraction-upcoming-detail.js
git commit -m "$(cat <<'EOF'
Extract upcoming-detail.ejs's inline JS to public/js/upcoming-detail.js

15.5 KB of reservation-page logic was inline. Hoisted the two
server-interpolated consts (ALL_FULL, gpSlideCount — both page-level
despite sitting mid-block, unlike game-detail.ejs's gameTitle) and
moved the rest unchanged into an external file at the same document
position. The pre-existing GAME_TITLE/NT_PRICES/etc. data block just
above stays inline, untouched — it already held nothing but server data.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `psplus-rent.ejs` (8.2 KB)

**Files:**
- Modify: `views/psplus-rent.ejs:213-392` (leave line 212's `RENTAL_DURATIONS` one-liner untouched)
- Create: `public/js/psplus-rent.js`
- Test: `scripts/test-js-extraction-psplus-rent.js` (new)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `public/js/psplus-rent.js`, referenced only by `psplus-rent.ejs`.

The block at `views/psplus-rent.ejs:213-392` has three interpolated consts, all clustered near the top (lines 214-224): `PRICES`, `PROMO`, `AVAIL`. This is the simplest of the five files — same shape as `game-detail.ejs`'s top cluster, but with no deep, scattered, or function-local values to find.

- [ ] **Step 1: Capture the current block**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
sed -n '213,392p' views/psplus-rent.ejs > /tmp/pr-before.txt
wc -l /tmp/pr-before.txt
```

Expected: 180 lines.

- [ ] **Step 2: Write the failing test**

Create `scripts/test-js-extraction-psplus-rent.js`:

```js
// Run: node scripts/test-js-extraction-psplus-rent.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const viewSrc = fs.readFileSync(path.join(REPO_ROOT, 'views', 'psplus-rent.ejs'), 'utf8');
const jsPath = path.join(REPO_ROOT, 'public', 'js', 'psplus-rent.js');

console.log('\npsplus-rent.ejs — inline logic extracted to public/js/psplus-rent.js');

ok('public/js/psplus-rent.js exists', () => {
  assert.ok(fs.existsSync(jsPath), 'public/js/psplus-rent.js was not created');
});

ok('the extracted file has no leftover EJS tags', () => {
  const js = fs.readFileSync(jsPath, 'utf8');
  assert.ok(!js.includes('<%'), 'an EJS tag was left in the extracted file');
});

ok('the extracted file still defines onTypeChange and promoPctFor', () => {
  const js = fs.readFileSync(jsPath, 'utf8');
  assert.ok(js.includes('function onTypeChange'), 'onTypeChange not found in the extracted file');
  assert.ok(js.includes('function promoPctFor'), 'promoPctFor not found in the extracted file');
});

ok('PRICES, PROMO, AVAIL are still hoisted inline as globals', () => {
  for (const name of ['PRICES', 'PROMO', 'AVAIL']) {
    assert.ok(new RegExp('const ' + name + '\\s*=').test(viewSrc), 'expected `const ' + name + ' =` still declared inline');
  }
});

ok('the pre-existing RENTAL_DURATIONS line is untouched', () => {
  assert.ok(/const RENTAL_DURATIONS\s*=/.test(viewSrc), 'RENTAL_DURATIONS was removed — it was out of scope for this task');
});

ok('the view loads the extracted file via a versioned <script src> at the right position', () => {
  assert.ok(
    /<script src="\/js\/psplus-rent\.js\?v=<%=\s*assetV\s*%>"><\/script>/.test(viewSrc),
    'psplus-rent.ejs does not request /js/psplus-rent.js with ?v=<%= assetV %>'
  );
});

ok('the view no longer carries the big inline block', () => {
  assert.ok(!/function onTypeChange/.test(viewSrc), 'onTypeChange is still inline in the view');
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node scripts/test-js-extraction-psplus-rent.js`
Expected: FAIL — the file doesn't exist yet.

- [ ] **Step 4: Extract**

Take lines 213-392 of `views/psplus-rent.ejs`. Remove these three declarations from the top (currently lines 214-224):
```
const PRICES = {
  nt: { 7: <%= prices.nt_price_7d %>, 30: <%= prices.nt_price_30d %> },
  tr: { 7: <%= prices.tr_price_7d %>, 30: <%= prices.tr_price_30d %> }
};
const PROMO = {
  enabled: <%= promo.enabled ? 'true' : 'false' %>,
  discounts: { 7: <%= (promo.discounts && promo.discounts[7]) || 0 %>, 30: <%= (promo.discounts && promo.discounts[30]) || 0 %> },
  deposit: <%= promo.deposit %>
};
const AVAIL = { nt: <%= ntAvail ? 'true' : 'false' %>, tr: <%= trAvail ? 'true' : 'false' %> };
```
Everything else (including `function promoPctFor(days) {...}`, which sits between `PROMO` and `AVAIL` in the original and has no EJS in it) moves unchanged into `public/js/psplus-rent.js`, in original relative order.

- [ ] **Step 5: Rewrite the view**

Replace `views/psplus-rent.ejs:213-392` with:

```html
<script>
const PRICES = {
  nt: { 7: <%= prices.nt_price_7d %>, 30: <%= prices.nt_price_30d %> },
  tr: { 7: <%= prices.tr_price_7d %>, 30: <%= prices.tr_price_30d %> }
};
const PROMO = {
  enabled: <%= promo.enabled ? 'true' : 'false' %>,
  discounts: { 7: <%= (promo.discounts && promo.discounts[7]) || 0 %>, 30: <%= (promo.discounts && promo.discounts[30]) || 0 %> },
  deposit: <%= promo.deposit %>
};
const AVAIL = { nt: <%= ntAvail ? 'true' : 'false' %>, tr: <%= trAvail ? 'true' : 'false' %> };
</script>
<script src="/js/psplus-rent.js?v=<%= assetV %>"></script>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node scripts/test-js-extraction-psplus-rent.js`
Expected: PASS — all assertions.

- [ ] **Step 7: Verify no unintended content change**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
grep -c '<%' public/js/psplus-rent.js
```

Expected: `0`.

- [ ] **Step 8: Run the full existing test suite**

Run every `node scripts/test-*.js`. Expected: PASS on all, no regressions.

- [ ] **Step 9: Commit**

```bash
git add views/psplus-rent.ejs public/js/psplus-rent.js scripts/test-js-extraction-psplus-rent.js
git commit -m "$(cat <<'EOF'
Extract psplus-rent.ejs's inline JS to public/js/psplus-rent.js

8.2 KB of PS Plus rental logic was inline. Hoisted the three
server-interpolated consts (PRICES, PROMO, AVAIL — all clustered near
the top, the simplest case of the five files in this phase) and moved
the rest unchanged into an external file at the same document position.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `order-status.ejs` (8.8 KB across 3 separate script blocks)

**Files:**
- Modify: `views/order-status.ejs` (3 separate `<script>` blocks: lines 491-513, 523-624, 626-663)
- Create: `public/js/order-status-1.js`, `public/js/order-status-2.js`, `public/js/order-status-3.js`
- Test: `scripts/test-js-extraction-order-status.js` (new)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: 3 files, referenced only by `order-status.ejs`.

**Why 3 files, not 1:** between block 1 (491-513) and block 2 (523-624) sits a real DOM element, `#ordPoll` (lines 517-521), that block 2's polling logic reads via `data-ref`/`data-key`/`data-state` attributes — confirmed by direct inspection. Blocks 2 and 3 are adjacent with nothing but a blank line between them, but block 1 cannot be merged with what follows it.

Block 1 (`491-513`) is a self-contained IIFE — the simplest shape of any block in this phase — with one interpolated value, `order.ref`, embedded **inside a string literal** rather than as a standalone declaration: `var key = 'ord_paid_seen_<%= order.ref %>';`. This is the second (and last) case in this phase, alongside `game-detail.ejs`'s `gameTitle`, that needs one intentional one-line rewrite rather than a pure move — because the interpolation sits mid-string, it cannot be hoisted without introducing a variable to hold the pre-built key. Blocks 2 (`523-624`) and 3 (`626-663`) have zero interpolation and move verbatim.

- [ ] **Step 1: Capture the current blocks**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
sed -n '491,513p' views/order-status.ejs > /tmp/os1-before.txt
sed -n '523,624p' views/order-status.ejs > /tmp/os2-before.txt
sed -n '626,663p' views/order-status.ejs > /tmp/os3-before.txt
```

- [ ] **Step 2: Write the failing test**

Create `scripts/test-js-extraction-order-status.js`:

```js
// Run: node scripts/test-js-extraction-order-status.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const viewSrc = fs.readFileSync(path.join(REPO_ROOT, 'views', 'order-status.ejs'), 'utf8');

console.log('\norder-status.ejs — 3 inline blocks extracted to public/js/order-status-1..3.js');

for (const n of [1, 2, 3]) {
  ok('public/js/order-status-' + n + '.js exists', () => {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'public', 'js', 'order-status-' + n + '.js')), 'missing order-status-' + n + '.js');
  });
  ok('order-status-' + n + '.js has no leftover EJS tags', () => {
    const js = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'order-status-' + n + '.js'), 'utf8');
    assert.ok(!js.includes('<%'), 'an EJS tag was left in order-status-' + n + '.js');
  });
  ok('order-status.ejs requests order-status-' + n + '.js with the version query', () => {
    assert.ok(
      new RegExp('<script src="\\/js\\/order-status-' + n + '\\.js\\?v=<%=\\s*assetV\\s*%>"><\\/script>').test(viewSrc),
      'order-status.ejs does not request /js/order-status-' + n + '.js with ?v=<%= assetV %>'
    );
  });
}

ok('the 3 script tags still appear in their original relative order', () => {
  const positions = [1, 2, 3].map(n => viewSrc.indexOf('/js/order-status-' + n + '.js'));
  assert.ok(positions.every(p => p !== -1), 'not all 3 script references found');
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] > positions[i - 1], 'order-status-' + (i + 1) + '.js appears before order-status-' + i + '.js — order changed');
  }
});

ok('the #ordPoll data element still sits between block 1 and block 2', () => {
  const idx1 = viewSrc.indexOf('/js/order-status-1.js');
  const idxPoll = viewSrc.indexOf('id="ordPoll"');
  const idx2 = viewSrc.indexOf('/js/order-status-2.js');
  assert.ok(idx1 !== -1 && idxPoll !== -1 && idx2 !== -1, 'could not find all three anchors');
  assert.ok(idx1 < idxPoll && idxPoll < idx2, '#ordPoll is no longer positioned between block 1 and block 2 — this element is read by data attribute, its position relative to the scripts must not change');
});

ok('block 1 hoists the paid-seen key instead of building it from a raw EJS interpolation inline', () => {
  assert.ok(/const ORD_PAID_SEEN_KEY\s*=\s*'ord_paid_seen_<%=\s*order\.ref\s*%>'/.test(viewSrc), 'ORD_PAID_SEEN_KEY is not declared as expected');
  const js1 = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'order-status-1.js'), 'utf8');
  assert.ok(/var key = ORD_PAID_SEEN_KEY;/.test(js1), 'order-status-1.js should reference the hoisted ORD_PAID_SEEN_KEY global, not rebuild the key itself');
});

console.log('\n' + passed + ' assertions passed\n');
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node scripts/test-js-extraction-order-status.js`
Expected: FAIL — none of the 3 files exist yet.

- [ ] **Step 4: Extract block 1 (the one-line rewrite)**

Take `views/order-status.ejs:491-513` (the IIFE). Inside it, the line
```
  var key = 'ord_paid_seen_<%= order.ref %>';
```
becomes
```
  var key = ORD_PAID_SEEN_KEY;
```
in the extracted file. Every other line of the IIFE moves unchanged into `public/js/order-status-1.js`.

- [ ] **Step 5: Extract blocks 2 and 3 (no interpolation, verbatim)**

- `views/order-status.ejs:524-623` (inside the 523-624 tags) → `public/js/order-status-2.js`, unchanged
- `views/order-status.ejs:627-662` (inside the 626-663 tags) → `public/js/order-status-3.js`, unchanged

- [ ] **Step 6: Rewrite the view**

Replace `views/order-status.ejs:491-513` with:

```html
<script>
const ORD_PAID_SEEN_KEY = 'ord_paid_seen_<%= order.ref %>';
</script>
<script src="/js/order-status-1.js?v=<%= assetV %>"></script>
```

Then, leaving the `#ordPoll` div and everything between it and the original block 2 exactly as-is, replace `views/order-status.ejs:523-624` (originally starting right after `#ordPoll`) with:

```html
<script src="/js/order-status-2.js?v=<%= assetV %>"></script>
```

And replace `views/order-status.ejs:626-663` with:

```html
<script src="/js/order-status-3.js?v=<%= assetV %>"></script>
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node scripts/test-js-extraction-order-status.js`
Expected: PASS — all assertions.

- [ ] **Step 8: Verify no unintended content change**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
for f in public/js/order-status-1.js public/js/order-status-2.js public/js/order-status-3.js; do
  echo "$f: $(grep -c '<%' "$f") leftover EJS tags (expect 0)"
done
```

- [ ] **Step 9: Run the full existing test suite**

Run every `node scripts/test-*.js`. Expected: PASS on all, no regressions.

- [ ] **Step 10: Commit**

```bash
git add views/order-status.ejs public/js/order-status-1.js public/js/order-status-2.js public/js/order-status-3.js scripts/test-js-extraction-order-status.js
git commit -m "$(cat <<'EOF'
Extract order-status.ejs's 3 inline script blocks to public/js/order-status-1..3.js

8.8 KB of order-tracking logic was inline, split across 3 <script>
blocks with a real DOM element (#ordPoll, read by data attribute)
sitting between the first and second. Kept as 3 separate files, each at
its original position, so that positional relationship is unchanged.

Block 1's single interpolation (order.ref) sits inside a string literal
rather than as a standalone declaration, so it needed one explicit
rewrite — hoisting it to a named ORD_PAID_SEEN_KEY constant the moved
IIFE now reads — rather than a pure relocation. This is the second and
last such case in this phase, alongside game-detail.ejs's gameTitle.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full-suite browser verification

**Files:**
- No new files — this task is verification only, covering the spec's Verification section across all 5 completed extractions.

**Interfaces:**
- Consumes: all 5 previous tasks' completed, committed work.
- Produces: nothing further — this is the plan's final task.

- [ ] **Step 1: Syntax and full test-suite check**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
node -c server.js && echo "server.js OK"
for f in scripts/test-*.js; do node "$f" > /tmp/t.out 2>&1 || { echo "FAIL: $f"; cat /tmp/t.out; }; done
echo "done"
```

Expected: `server.js OK`, and no `FAIL:` lines printed.

- [ ] **Step 2: Local boot check**

```bash
cd "C:\Users\michael\Desktop\claude code\playstation-hub"
PORT=4596 timeout 15 node server.js
```

Expected: starts cleanly, prints the "running at" banner, no uncaught exceptions.

- [ ] **Step 3: Browser pass on each of the 5 pages**

Using the project's browser tools against a local boot (`PORT=4596 node server.js`, or the project's existing scratch-copy convention if any of these pages need seeded data), for each page:

- **`game-detail.ejs`** — open a game detail page, change rental type and duration, confirm the price box updates correctly, confirm no console errors, confirm the gallery slider (`gdGo`) advances on click.
- **`index.ejs`** — load the homepage and confirm each of the 4 extracted blocks' actual behavior: block 1 (`index-1.js`) is the hero slideshow — confirm it auto-advances (or is static with 1 slide) and `window.heroSlide`/`window.heroGoTo` still work if the page exposes manual controls; block 2 (`index-2.js`) is collapsible-section toggling — find a collapsible section (e.g. an FAQ or "How It Works" block using `toggleCollapsible`) and confirm clicking it still expands/collapses; block 3 (`index-3.js`) is the promo countdown timer — if a `#promoCountdown` element is present (only when a promo with an end date is active), confirm it shows a live "Ends in Xd Xh" countdown rather than blank or a JS error; block 4 (`index-4.js`) is the reserve-modal/promo pricing logic — confirm no console errors on load.
- **`upcoming-detail.ejs`** — open a Coming Soon reservation page, change type/duration, confirm the reservation summary updates, confirm the gallery slider (`gpGo`) advances.
- **`psplus-rent.ejs`** — open a PS Plus rental page, change type, confirm price updates, confirm no console errors.
- **`order-status.ejs`** — open an order status page for an order in the `reserved`/paid state; confirm the "already paid" modal behavior from block 1 still works (shows once, `localStorage`-gated, confirm via `read_network_requests`/`javascript_tool` that `ORD_PAID_SEEN_KEY` matches the pattern `ord_paid_seen_<the order's actual ref>`).

For every page, confirm via the browser's network panel that each `/js/*.js?v=...` request returns `Cache-Control: public, max-age=31536000, immutable` (Phase 1's header logic already covers this — this step confirms it applies to these new URLs too, not that new caching code is needed).

- [ ] **Step 4: Report**

Summarize for the human partner: confirmation that all 5 pages behave identically to before, the measured KB moved from inline to cached, and that this closes Phase 2 of the three-phase performance plan (Phase 3, the `/requests` TTFB investigation, remains deferred).

---

## Deploy Note

Same process as Phase 1: commit each task, push once all 6 tasks are done (or incrementally — each task's commit is independently safe to deploy), then verify live `Cache-Control` and correct page behavior against `playstation-hub-production.up.railway.app` (or the custom domain, once it's confirmed working) exactly as Phase 1's deploy was verified.
