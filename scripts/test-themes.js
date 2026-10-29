// Run: node scripts/test-themes.js
//
// Theme resolution, Manila schedules, the boot migration, contrast, and the
// admin save. No server and no database — the HTTP save is test-themes-admin.js.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const themes = require('../lib/themes');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const AT_HALLOWEEN = new Date('2026-10-29T08:00:00.000Z'); // 16:00 Manila
const AT_END = new Date('2026-10-31T16:00:00.000Z'); // 1 Nov 2026 00:00 Manila
const JUST_BEFORE_END = new Date('2026-10-31T15:59:00.000Z');
const AT_CHRISTMAS = new Date('2026-12-10T04:00:00.000Z'); // 12:00 Manila
const AT_CHRISTMAS_END = new Date('2026-12-25T16:00:00.000Z'); // 26 Dec 2026 00:00 Manila
const AT_QUIET = new Date('2026-11-15T04:00:00.000Z');

function seeded() {
  return themes.seed(new Date('2026-10-29T02:00:00.000Z')); // 10:00 Manila
}

console.log('\ncontrast');

ok('every preset clears WCAG AA on body text, buttons, accent text and badges', () => {
  themes.CATALOG.forEach(preset => {
    themes.keyPairs(preset).forEach(pair => {
      const ratio = themes.contrast(pair[1], pair[2]);
      assert.ok(ratio >= 4.5, preset.id + ' ' + pair[0] + ' ' + pair[1] + ' on ' + pair[2] + ' = ' + ratio.toFixed(2));
    });
  });
  themes.promoStripPairs().forEach(pair => {
    const ratio = themes.contrast(pair[1], pair[2]);
    assert.ok(ratio >= 4.5, pair[0] + ' = ' + ratio.toFixed(2));
  });
});

ok('the cached stylesheet does not name the live preset; snow stops when motion is reduced', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/themes.css'), 'utf8');
  assert.ok(css.includes('prefers-reduced-motion'));
  assert.ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/.test(css));
  assert.ok(!css.includes('data-theme="halloween"'));
  const inline = themes.cssVars(themes.PRESETS.halloween);
  assert.ok(inline.startsWith(':root{'));
  assert.ok(inline.includes('--theme-btn:#FF7A00'));
  assert.ok(inline.includes('--ps-blue:#FF8F26'));
  assert.ok(!inline.includes('<') && !inline.includes('url('));
});

console.log('\nschedule');

ok('Manila wall times are UTC+8, and the end minute is not included', () => {
  assert.strictEqual(themes.parseManila('2026-11-01T00:00').toISOString(), '2026-10-31T16:00:00.000Z');
  assert.strictEqual(themes.manilaWall(AT_END), '2026-11-01T00:00');
  const row = seeded();
  assert.strictEqual(themes.resolve(row, JUST_BEFORE_END).id, 'halloween');
  assert.strictEqual(themes.resolve(row, AT_END).id, 'classic');
  assert.ok(themes.resolve(row, JUST_BEFORE_END).why.includes('Halloween is live'));
  assert.ok(themes.resolve(row, AT_END).why.includes('no theme schedule'));
});

ok('Halloween runs from the seed instant through 1 Nov, then Christmas, then the base theme', () => {
  const row = seeded();
  assert.strictEqual(row.presets.halloween.start, '2026-10-29T10:00');
  assert.strictEqual(row.presets.halloween.end, themes.HALLOWEEN_END);
  assert.strictEqual(row.presets.christmas.start, themes.CHRISTMAS_START);
  assert.strictEqual(row.presets.christmas.end, themes.CHRISTMAS_END);
  assert.strictEqual(row.presets.halloween.line1, 'Dare to Play');
  assert.strictEqual(row.presets.halloween.highlight, 'After Dark');
  assert.strictEqual(row.presets.christmas.line1, 'Unwrap a');
  assert.strictEqual(row.presets.christmas.highlight, 'New Adventure');
  const halloween = themes.resolve(row, AT_HALLOWEEN);
  assert.strictEqual(halloween.id, 'halloween');
  assert.strictEqual(halloween.headline.line1, 'Dare to Play');
  assert.strictEqual(halloween.decor, 'halloween');
  assert.strictEqual(halloween.logo, 'light');
  assert.strictEqual(halloween.promo.show, false);
  const christmas = themes.resolve(row, AT_CHRISTMAS);
  assert.strictEqual(christmas.id, 'christmas');
  assert.strictEqual(christmas.garland, true);
  assert.strictEqual(christmas.headline.highlight, 'New Adventure');
  assert.strictEqual(themes.resolve(row, AT_CHRISTMAS_END).id, 'classic');
  assert.strictEqual(themes.resolve(row, AT_QUIET).id, 'classic');
  assert.strictEqual(themes.resolve(row, AT_QUIET).headline, null);
});

ok('a schedule beats the base theme, and the later start wins an overlap', () => {
  const row = seeded();
  row.base = 'blue';
  assert.strictEqual(themes.resolve(row, AT_HALLOWEEN).id, 'halloween');
  assert.strictEqual(themes.resolve(row, AT_QUIET).id, 'blue');
  assert.ok(themes.resolve(row, AT_QUIET).why.includes('base theme'));
  row.presets.halloween.end = '2026-12-15T00:00';
  const overlapAt = new Date('2026-12-04T16:00:00.000Z'); // 5 Dec 2026 00:00 Manila, inside both
  const won = themes.resolve(row, overlapAt);
  assert.strictEqual(won.id, 'christmas');
  assert.ok(won.why.includes('started later'));
  assert.strictEqual(won.overlap, 'Halloween');
});

ok('an unknown base and an unknown preview fall back to Hub Classic', () => {
  const quiet = themes.resolve({ base: 'nope' }, AT_QUIET, '</style><script>');
  assert.strictEqual(quiet.id, 'classic');
  assert.strictEqual(quiet.preview, false);
  assert.ok(!quiet.css.includes('script'));
  const preview = themes.resolve(seeded(), AT_HALLOWEEN, 'sale');
  assert.strictEqual(preview.id, 'sale');
  assert.strictEqual(preview.preview, true);
  assert.strictEqual(preview.promo.show, true);
  assert.ok(preview.why.includes('Preview of Sale Mode'));
  assert.ok(preview.why.includes('Halloween'));
});

ok('Sale Mode shows the promo strip on its own; on and off apply to every theme', () => {
  const row = seeded();
  row.base = 'sale';
  assert.strictEqual(themes.resolve(row, AT_QUIET).promo.show, true);
  row.promo.mode = 'off';
  assert.strictEqual(themes.resolve(row, AT_QUIET).promo.show, false);
  row.promo.mode = 'on';
  assert.strictEqual(themes.resolve(row, AT_HALLOWEEN).promo.show, true);
  assert.strictEqual(themes.resolve(row, AT_HALLOWEEN).id, 'halloween');
});

ok('every preset picks the light logo, including on brand yellow', () => {
  themes.IDS.forEach(id => {
    const view = themes.resolve({ base: id }, AT_QUIET);
    assert.strictEqual(view.id, id);
    assert.strictEqual(view.logo, 'light');
  });
});

console.log('\nmigration');

ok('the first boot seeds, and a second boot does not write', () => {
  const now = new Date('2026-10-29T02:00:00.000Z');
  const first = themes.apply({ migrations: ['genre-by-slug-2026-10-14'], site_settings: {} }, now);
  assert.strictEqual(first.write, true);
  assert.ok(first.migrations.indexOf(themes.MIGRATION_ID) !== -1);
  assert.strictEqual(first.themes.presets.halloween.start, '2026-10-29T10:00');
  const second = themes.apply({
    migrations: first.migrations,
    site_settings: { themes: first.themes }
  }, new Date('2027-01-01T00:00:00.000Z'));
  assert.strictEqual(second.write, false);
  assert.strictEqual(second.themes.presets.halloween.start, '2026-10-29T10:00');
});

ok('a theme Michael already set is not overwritten; missing presets are filled', () => {
  const now = new Date('2026-10-29T02:00:00.000Z');
  const first = themes.apply({
    migrations: [],
    site_settings: {
      themes: {
        base: 'blue',
        promo: { text: 'Keep me', code: 'SAVE', mode: 'off' },
        presets: {
          halloween: { line1: 'Boo', highlight: 'Night', start: '' }
        }
      }
    }
  }, now);
  assert.strictEqual(first.write, true);
  assert.strictEqual(first.themes.base, 'blue');
  assert.strictEqual(first.themes.promo.text, 'Keep me');
  assert.strictEqual(first.themes.promo.code, 'SAVE');
  assert.strictEqual(first.themes.promo.mode, 'off');
  assert.strictEqual(first.themes.presets.halloween.line1, 'Boo');
  assert.strictEqual(first.themes.presets.halloween.highlight, 'Night');
  assert.strictEqual(first.themes.presets.halloween.start, '');
  assert.strictEqual(first.themes.presets.halloween.end, themes.HALLOWEEN_END);
  assert.strictEqual(first.themes.presets.christmas.line1, 'Unwrap a');
  assert.strictEqual(first.themes.presets.christmas.end, '2026-12-26T00:00');
  assert.strictEqual(first.themes.presets.classic.line1, '');
});

ok('a migrations value that is not a list is left untouched', () => {
  const state = { migrations: 'nope', site_settings: { themes: { base: 'sale' } } };
  const result = themes.apply(state, AT_HALLOWEEN);
  assert.strictEqual(result.write, false);
  assert.strictEqual(result.migrations, 'nope');
  assert.strictEqual(result.themes.base, 'sale');
});

console.log('\nadmin save');

ok('saving updates the fields that were posted and leaves the rest', () => {
  const stored = seeded();
  stored.presets.blue.hero_image = '/uploads/keep.webp';
  const next = themes.applyAdminSave(stored, {
    base: 'not-a-theme',
    promo_mode: 'on',
    promo_text: '  Hello there  ',
    halloween_line1: 'Stay',
    halloween_end: 'not-a-date',
    classic_line1: ''
  }, { halloween: '/uploads/../server.js', blue: '/uploads/new-hero.webp' });
  assert.strictEqual(next.base, 'classic');
  assert.strictEqual(next.promo.mode, 'on');
  assert.strictEqual(next.promo.text, 'Hello there');
  assert.strictEqual(next.presets.halloween.line1, 'Stay');
  assert.strictEqual(next.presets.halloween.highlight, 'After Dark');
  assert.strictEqual(next.presets.halloween.end, '');
  assert.strictEqual(next.presets.halloween.start, stored.presets.halloween.start);
  assert.strictEqual(next.presets.halloween.hero_image, '');
  assert.strictEqual(next.presets.blue.hero_image, '/uploads/new-hero.webp');
  assert.strictEqual(next.presets.classic.line1, '');
  assert.strictEqual(next.presets.christmas.end, themes.CHRISTMAS_END);
});

ok('a post that omits a field does not clear it, and the clear box removes the image', () => {
  const stored = seeded();
  stored.presets.halloween.hero_image = '/uploads/hero.webp';
  const partial = themes.applyAdminSave(stored, { promo_mode: 'off' });
  assert.strictEqual(partial.promo.mode, 'off');
  assert.strictEqual(partial.presets.halloween.start, stored.presets.halloween.start);
  assert.strictEqual(partial.presets.halloween.hero_image, '/uploads/hero.webp');
  assert.strictEqual(partial.presets.christmas.line1, 'Unwrap a');
  const cleared = themes.applyAdminSave(stored, { halloween_hero_clear: 'on' });
  assert.strictEqual(cleared.presets.halloween.hero_image, '');
  assert.strictEqual(cleared.presets.halloween.line1, 'Dare to Play');
});

console.log('\n' + passed + ' passed');
