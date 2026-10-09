# Readable Tier Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tier tags (New Games, Deluxe, Special, Regular, PS Plus) readable on any cover: solid colour, white capitals, no inherited text glow.

**Architecture:** CSS only. The tags keep their classes (`.tier-pill` + `.tier-<colour>` from `lib/tier-style.js`); only their rules in `public/css/style.css` change. `text-shadow: none` on `.tier-pill` stops the card body's (`.gc2-body`) dark text glow from reaching the tag's letters.

**Tech Stack:** Plain CSS; test is `node scripts/test-*.js`.

Spec: `docs/superpowers/specs/2026-10-09-browse-filters-tiers-design.md` → "The tier pill" → "Pill look (owner's follow-up, option A)".

## Global Constraints

- Work directly on `main`; **push only when the owner says "push"**.
- Commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- `public/css/style.css` is CRLF — the edit script keeps it; verify with `file`. New files LF.
- Look: solid tag, white uppercase text, `letter-spacing: 0.6px`, `box-shadow: 0 2px 6px rgba(0,0,0,.45)`, `text-shadow: none`.
- Fills: blue `#2563EB`, purple `#7C3AED`, coral `#C2410C`, grey `#57534E`, teal `#0F766E`, pink `#DB2777` (white text); PS Plus gold `#F0A500` with `#1A1200` text.
- Colour names, admin choices, the automatic-by-name rule and all HTML are unchanged.
- Known unrelated failure: `scripts/test-requests-page.js`. Report it, do not fix it.
- The edit script lives in `.superpowers/tmp-edits/` (git-ignored); never commit it; remove the folder at the end.

---

### Task 1: Solid, readable tier tags

**Files:**
- Create: `scripts/test-tier-pill-look.js`
- Modify (via the edit script): `public/css/style.css` (the "Tier pill" block, 11 lines)

**Interfaces:**
- Consumes: classes `.tier-pill`, `.usd-tier-pill`, `.tier-blue|purple|coral|grey|teal|pink|gold` already used by `views/partials/game-card.ejs`, `views/game-detail.ejs`, `views/partials/admin/games/categories.ejs`, `views/partials/browse-filter-option.ejs` (`.tier-dot`) and `public/js/browse.js` (PS Plus cards).
- Produces: nothing new.

- [ ] **Step 1: Write the test**

Create `scripts/test-tier-pill-look.js`:

````js
// Run: node scripts/test-tier-pill-look.js
//
// The tier tag's look (public/css/style.css): a solid fill with white capitals
// that ignores the card body's dark text glow, and colours that keep the text
// readable (WCAG contrast 4.5:1 or more).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const rule = sel => {
  const m = new RegExp('(?:^|\\n)' + sel.replace(/\./g, '\\.') + ' \\{([^}]*)\\}').exec(css);
  assert.ok(m, sel + ' rule found');
  return m[1];
};
const prop = (sel, name) => {
  const m = new RegExp('(?:^|;)\\s*' + name + ':\\s*([^;]+);').exec(rule(sel));
  return m ? m[1].trim() : null;
};

// WCAG relative luminance and contrast ratio for #rrggbb colours.
function lum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = v => (v === '#fff' ? '#ffffff' : v);

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

ok('the tag never inherits the card body\'s text glow', () => {
  assert.ok(/text-shadow:\s*0 1px 3px/.test(rule('.gc2-body')), 'the card body still has its glow');
  assert.strictEqual(prop('.tier-pill', 'text-shadow'), 'none');
});
ok('white capitals with a little spacing and a lift off bright covers', () => {
  assert.strictEqual(prop('.tier-pill', 'color'), '#fff');
  assert.strictEqual(prop('.tier-pill', 'text-transform'), 'uppercase');
  assert.strictEqual(prop('.tier-pill', 'letter-spacing'), '0.6px');
  assert.strictEqual(prop('.tier-pill', 'box-shadow'), '0 2px 6px rgba(0,0,0,.45)');
});
ok('the solid colours from the spec', () => {
  const want = { blue: '#2563EB', purple: '#7C3AED', coral: '#C2410C', grey: '#57534E', teal: '#0F766E', pink: '#DB2777', gold: '#F0A500' };
  Object.keys(want).forEach(c => assert.strictEqual(prop('.tier-' + c, 'background'), want[c], c));
  ['blue', 'purple', 'coral', 'grey', 'teal', 'pink'].forEach(c => assert.strictEqual(prop('.tier-' + c, 'color'), '#fff', c));
  assert.strictEqual(prop('.tier-gold', 'color'), '#1A1200');
});
ok('every tag\'s text stays readable (contrast 4.5:1 or more)', () => {
  ['blue', 'purple', 'coral', 'grey', 'teal', 'pink', 'gold'].forEach(c => {
    const r = contrast(hex(prop('.tier-' + c, 'background')), hex(prop('.tier-' + c, 'color')));
    assert.ok(r >= 4.5, c + ' contrast ' + r.toFixed(2));
  });
});

console.log('\n' + passed + ' assertions passed\n');
````

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/test-tier-pill-look.js` → FAIL `null !== 'none'` (the tag has no `text-shadow` rule yet).

- [ ] **Step 3: Apply the CSS edit**

Create `.superpowers/tmp-edits/edit-tier-look.js`:

````js
// Tier tags: solid colour, white capitals, no inherited text glow (run from the
// repo root). public/css/style.css is CRLF — this keeps its line endings.
const fs = require('fs');
const FILE = 'public/css/style.css';
const FROM = `/* Tier pill: a game's price category on cards, the game page and Browse
   (lib/tier-style.js). Light fill + darkest text of the same hue. */
.tier-pill { display: inline-block; align-self: flex-start; font-size: 0.62rem; font-weight: 800; letter-spacing: 0.3px; line-height: 1.4; padding: 0.12rem 0.55rem; border-radius: 20px; white-space: nowrap; }
.usd-tier-pill { font-size: 0.72rem; align-self: center; }
.tier-blue { background: #B5D4F4; color: #042C53; }
.tier-purple { background: #CECBF6; color: #26215C; }
.tier-coral { background: #F5C4B3; color: #4A1B0C; }
.tier-grey { background: #D3D1C7; color: #2C2C2A; }
.tier-teal { background: #9FE1CB; color: #04342C; }
.tier-pink { background: #F4C0D1; color: #4B1528; }
.tier-gold { background: #FAC775; color: #412402; }
`;
const TO = `/* Tier pill: a game's price category on cards, the game page and Browse
   (lib/tier-style.js). A solid tag with white capitals, like the card's
   "Last slot" / "Just added" badges. text-shadow: none matters: the card body
   (.gc2-body) puts a dark glow on its text for the cover art, and inherited by
   the tag it smeared the letters. Every fill keeps white text at 4.5:1 or more. */
.tier-pill { display: inline-block; align-self: flex-start; font-size: 0.6rem; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; line-height: 1.4; padding: 0.16rem 0.55rem; border-radius: 20px; white-space: nowrap; color: #fff; text-shadow: none; box-shadow: 0 2px 6px rgba(0,0,0,.45); }
.usd-tier-pill { font-size: 0.7rem; align-self: center; }
.tier-blue { background: #2563EB; color: #fff; }
.tier-purple { background: #7C3AED; color: #fff; }
.tier-coral { background: #C2410C; color: #fff; }
.tier-grey { background: #57534E; color: #fff; }
.tier-teal { background: #0F766E; color: #fff; }
.tier-pink { background: #DB2777; color: #fff; }
.tier-gold { background: #F0A500; color: #1A1200; }
`;

let s = fs.readFileSync(FILE, 'utf8');
const crlf = s.includes('\r\n');
if (crlf) s = s.replace(/\r\n/g, '\n');
const n = s.split(FROM).length - 1;
if (n !== 1) throw new Error(FILE + ': expected the tier pill block once, found ' + n);
s = s.replace(FROM, () => TO);
fs.writeFileSync(FILE, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log('edited');
````

Run from the repo root: `node .superpowers/tmp-edits/edit-tier-look.js` → `edited`.
Then: `file public/css/style.css` → still `with CRLF line terminators`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node scripts/test-tier-pill-look.js` → `4 assertions passed`.
Run: `node scripts/test-tier-pill.js && node scripts/test-browse-page.js` → `10 assertions passed`, `16 assertions passed`.
Run the whole suite: `fail=0; for f in scripts/test-*.js; do node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fail=$((fail+1)); }; done; echo "failed: $fail"` → only `FAIL scripts/test-requests-page.js`, `failed: 1`.

- [ ] **Step 5: Commit and clean up**

```bash
git add scripts/test-tier-pill-look.js public/css/style.css
git commit -m "Tier tags: solid colour, white capitals, no inherited text glow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
rm -rf .superpowers/tmp-edits && git status --short
```
Expected `git status`: nothing except possibly the unrelated untracked `docs/superpowers/plans/2026-08-31-noslot-fall-in-line-priority.md`.
