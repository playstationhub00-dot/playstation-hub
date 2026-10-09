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
