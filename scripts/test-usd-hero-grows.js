// Run: node scripts/test-usd-hero-grows.js
//
// The title banner shared by Coming soon pages and released game pages
// (.usd-hero in public/css/style.css) grows with its content. Its content is
// pinned to the bottom and anything outside it is hidden, so a fixed height
// cut the badge row (COMING SOON · PS5 · genre) off at the top once the
// PlayStation tagline and rating were added under the title.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8').replace(/\r\n/g, '\n');
// The body of the first `sel { … }` rule at the start of a line within `text`.
const rule = (text, sel) => {
  const m = new RegExp('(?:^|\\n)\\s*' + sel.replace(/\./g, '\\.') + ' \\{([^}]*)\\}').exec(text);
  assert.ok(m, sel + ' rule found');
  return m[1];
};
const prop = (body, name) => {
  const m = new RegExp('(?:^|;)\\s*' + name + ':\\s*([^;]+);').exec(body);
  return m ? m[1].trim() : null;
};
// The phone rules live in the @media (max-width: 600px) block that styles .usd-hero.
const phoneStart = css.search(/@media \(max-width: 600px\) \{\n\s*\.usd-hero \{/);
assert.ok(phoneStart !== -1, 'the phone block for the banner is there');
const phone = css.slice(phoneStart, css.indexOf('\n}\n', phoneStart));

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

ok('on computers the banner has a minimum height, not a fixed one', () => {
  const hero = rule(css, '.usd-hero');
  assert.strictEqual(prop(hero, 'height'), null);
  assert.strictEqual(prop(hero, 'min-height'), '210px');
  assert.strictEqual(prop(hero, 'overflow'), 'hidden', 'the background art is still kept inside it');
  const inner = rule(css, '.usd-hero-in');
  assert.strictEqual(prop(inner, 'height'), null);
  assert.strictEqual(prop(inner, 'min-height'), '210px');
  assert.strictEqual(prop(inner, 'justify-content'), 'flex-end', 'short content still sits at the bottom');
});
ok('on phones too', () => {
  assert.strictEqual(prop(rule(phone, '.usd-hero'), 'height'), null);
  assert.strictEqual(prop(rule(phone, '.usd-hero'), 'min-height'), '205px');
  assert.strictEqual(prop(rule(phone, '.usd-hero-in'), 'min-height'), '205px');
});
ok('one rule for both pages: no separate growing rule for the released game page', () => {
  assert.ok(!/\.usd-hero\.gdh-hero/.test(css));
});

console.log('\n' + passed + ' assertions passed\n');
