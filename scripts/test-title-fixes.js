// Run: node scripts/test-title-fixes.js
//
// Game titles and one review typo live in the production data blob, not in
// source. These rules are what the manual migration applies, and what the
// public routes use to keep an old slug working after a rename.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const fixes = require('../lib/title-fixes');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

console.log('\nfixString');

ok('renames the listed catalogue titles and leaves correct ones alone', () => {
  assert.strictEqual(fixes.fixString('Resident Evil Remake Triology'), 'Resident Evil Remake Trilogy');
  assert.strictEqual(fixes.fixString('Khazan The First Berseker'), 'Khazan The First Berserker');
  assert.strictEqual(fixes.fixString('Assasins Creed Shadows'), 'Assassins Creed Shadows');
  assert.strictEqual(fixes.fixString('Assasins Creed Shadows w/ DLC'), 'Assassins Creed Shadows w/ DLC');
  assert.strictEqual(fixes.fixString('Calisto Protocol'), 'Callisto Protocol');
  assert.strictEqual(fixes.fixString('Silent Hill TownFall'), 'Silent Hill: Townfall');
  assert.strictEqual(fixes.fixString('NBA2K27'), 'NBA 2K27');
  assert.strictEqual(fixes.fixString("Assassin's Creed Shadows"), "Assassin's Creed Shadows");
  assert.strictEqual(fixes.fixString('Silent Hill: Townfall'), 'Silent Hill: Townfall');
  assert.strictEqual(fixes.fixString('NBA 2K27'), 'NBA 2K27');
  assert.strictEqual(fixes.fixString('Silent Hill f'), 'Silent Hill f');
});

ok('fixes the same typos inside review text, including afdordable', () => {
  assert.strictEqual(
    fixes.fixString('Prices are afdordable and Assasins Creed Shadows is great'),
    'Prices are affordable and Assassins Creed Shadows is great'
  );
  assert.strictEqual(fixes.fixString('already affordable'), 'already affordable');
});

ok('applyToState renames titles and review text without touching slugs, and a second pass is a no-op', () => {
  const state = {
    games: [{ id: 1, title: 'NBA2K27', slug: 'leave-me' }],
    upcoming: [{ id: 3, title: 'Silent Hill TownFall' }],
    reviews: [{ text: 'Very afdordable', game_rented: 'Resident Evil Remake Triology' }],
    customers: [{ game_title: 'Khazan The First Berseker', fb_name: 'Afdordable Fan' }]
  };
  const first = fixes.applyToState(state);
  assert.strictEqual(first.state.games[0].title, 'NBA 2K27');
  assert.strictEqual(first.state.games[0].slug, 'leave-me');
  assert.strictEqual(first.state.upcoming[0].title, 'Silent Hill: Townfall');
  assert.strictEqual(first.state.reviews[0].text, 'Very affordable');
  assert.strictEqual(first.state.reviews[0].game_rented, 'Resident Evil Remake Trilogy');
  assert.strictEqual(first.state.customers[0].game_title, 'Khazan The First Berserker');
  assert.strictEqual(first.state.customers[0].fb_name, 'Afdordable Fan', 'a person\'s name is not a review');
  assert.ok(first.changes.length >= 5);
  const second = fixes.applyToState(first.state);
  assert.strictEqual(second.changes.length, 0);
  assert.deepStrictEqual(second.state, first.state);
});

ok('applySlugTitles fixes the four URL families and leaves NBA2K27, Townfall, slugs, and names alone', () => {
  const state = {
    games: [
      { id: 1, title: 'NBA2K27', slug: 'nba2k27' },
      { id: 2, title: 'Calisto Protocol', slug: 'leave-me' },
      { id: 3, title: 'Assasins Creed Shadows w/ DLC' }
    ],
    upcoming: [{ id: 4, title: 'Khazan The First Berseker' }, { id: 5, title: 'Silent Hill TownFall' }],
    reviews: [{ text: 'afdordable Assasins', game_rented: 'Resident Evil Remake Triology' }],
    customers: [{ game_title: 'Calisto Protocol', fb_name: 'Afdordable Fan' }]
  };
  const first = fixes.applySlugTitles(state);
  assert.strictEqual(first.state.games[0].title, 'NBA2K27');
  assert.strictEqual(first.state.games[0].slug, 'nba2k27');
  assert.strictEqual(first.state.games[1].title, 'Callisto Protocol');
  assert.strictEqual(first.state.games[1].slug, 'leave-me');
  assert.strictEqual(first.state.games[2].title, 'Assassins Creed Shadows w/ DLC');
  assert.strictEqual(first.state.upcoming[0].title, 'Khazan The First Berserker');
  assert.strictEqual(first.state.upcoming[1].title, 'Silent Hill TownFall');
  assert.strictEqual(first.state.reviews[0].text, 'afdordable Assassins');
  assert.strictEqual(first.state.reviews[0].game_rented, 'Resident Evil Remake Trilogy');
  assert.strictEqual(first.state.customers[0].game_title, 'Callisto Protocol');
  assert.strictEqual(first.state.customers[0].fb_name, 'Afdordable Fan');
  const second = fixes.applySlugTitles(first.state);
  assert.strictEqual(second.changes.length, 0);
  assert.deepStrictEqual(second.state, first.state);
});

console.log('\nredirectSlug');

ok('old game slugs redirect and corrected slugs do not', () => {
  assert.strictEqual(fixes.redirectSlug('resident-evil-remake-triology'), 'resident-evil-remake-trilogy');
  assert.strictEqual(fixes.redirectSlug('khazan-the-first-berseker'), 'khazan-the-first-berserker');
  assert.strictEqual(fixes.redirectSlug('assasins-creed-shadows'), 'assassins-creed-shadows');
  assert.strictEqual(fixes.redirectSlug('assasins-creed-shadows-w-dlc'), 'assassins-creed-shadows-w-dlc');
  assert.strictEqual(fixes.redirectSlug('assassin-s-creed-shadows'), 'assassins-creed-shadows');
  assert.strictEqual(fixes.redirectSlug('assassin-s-creed-shadows-w-dlc'), 'assassins-creed-shadows-w-dlc');
  assert.strictEqual(fixes.redirectSlug('assassin-s-creed-black-flag-resynced'), null);
  assert.strictEqual(fixes.redirectSlug('calisto-protocol'), 'callisto-protocol');
  assert.strictEqual(fixes.redirectSlug('callisto-protocol'), null);
  assert.strictEqual(fixes.redirectSlug('assassins-creed-shadows'), null);
  assert.strictEqual(fixes.redirectSlug('nba2k27'), 'nba-2k27');
  assert.strictEqual(fixes.redirectSlug('silent-hill-townfall'), null);
  assert.strictEqual(fixes.redirectSlug('resident-evil-remake-trilogy'), null);
  assert.strictEqual(fixes.redirectSlug('nba-2k27'), null);
});

ok('publicSlug corrects the four tokens and leaves NBA2K27 and Black Flag alone', () => {
  assert.strictEqual(fixes.publicSlug('Assasins Creed Shadows'), 'assassins-creed-shadows');
  assert.strictEqual(fixes.publicSlug('Assassins Creed Shadows'), 'assassins-creed-shadows');
  assert.strictEqual(fixes.publicSlug("Assassin's Creed Shadows"), 'assassins-creed-shadows');
  assert.strictEqual(fixes.publicSlug('Assasins Creed Shadows w/ DLC'), 'assassins-creed-shadows-w-dlc');
  assert.strictEqual(fixes.publicSlug("Assassin's Creed Black Flag Resynced"), 'assassin-s-creed-black-flag-resynced');
  assert.strictEqual(fixes.publicSlug('Calisto Protocol'), 'callisto-protocol');
  assert.strictEqual(fixes.publicSlug('Callisto Protocol'), 'callisto-protocol');
  assert.strictEqual(fixes.publicSlug('Khazan The First Berseker'), 'khazan-the-first-berserker');
  assert.strictEqual(fixes.publicSlug('Khazan The First Berserker'), 'khazan-the-first-berserker');
  assert.strictEqual(fixes.publicSlug('Resident Evil Remake Triology'), 'resident-evil-remake-trilogy');
  assert.strictEqual(fixes.publicSlug('NBA2K27'), 'nba2k27');
  assert.strictEqual(fixes.publicSlug('NBA 2K27'), 'nba-2k27');
  assert.strictEqual(fixes.publicSlug('Callisto Protocol'), fixes.publicSlug('Calisto Protocol'));
});

ok('the migration script dry-runs unless --apply, and a second apply changes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pshub-titles-'));
  const file = path.join(dir, 'games.json');
  fs.writeFileSync(file, JSON.stringify({
    games: [{ title: 'NBA2K27', slug: 'nba2k27' }],
    reviews: [{ text: 'afdordable' }]
  }));
  const script = path.join(__dirname, 'rename-game-titles.js');
  const dry = spawnSync(process.execPath, [script, '--file', file], { encoding: 'utf8' });
  assert.strictEqual(dry.status, 0, dry.stderr);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).games[0].title, 'NBA2K27');
  const apply = spawnSync(process.execPath, [script, '--file', file, '--apply'], { encoding: 'utf8' });
  assert.strictEqual(apply.status, 0, apply.stderr);
  const changed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(changed.games[0].title, 'NBA 2K27');
  assert.strictEqual(changed.games[0].slug, 'nba2k27');
  assert.strictEqual(changed.reviews[0].text, 'affordable');
  const again = spawnSync(process.execPath, [script, '--file', file, '--apply'], { encoding: 'utf8' });
  assert.strictEqual(again.status, 0, again.stderr);
  assert.ok(/0 changes/.test(again.stdout), again.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok('an upcoming url keeps its id suffix', () => {
  assert.strictEqual(fixes.redirectSlug('khazan-the-first-berseker-12'), 'khazan-the-first-berserker-12');
  assert.strictEqual(fixes.redirectSlug('silent-hill-townfall-3'), null);
  assert.strictEqual(fixes.redirectSlug('elden-ring-2'), null);
});

ok('slugMatches accepts the live slug and the pre-rename slug, either way around', () => {
  assert.strictEqual(fixes.slugMatches('nba2k27', 'nba2k27'), true);
  assert.strictEqual(fixes.slugMatches('nba2k27', 'nba-2k27'), true);
  assert.strictEqual(fixes.slugMatches('nba-2k27', 'nba2k27'), true);
  assert.strictEqual(fixes.slugMatches('resident-evil-remake-triology', 'resident-evil-remake-trilogy'), true);
  assert.strictEqual(fixes.slugMatches('khazan-the-first-berseker-12', 'khazan-the-first-berserker-12'), true);
  assert.strictEqual(fixes.slugMatches('silent-hill-townfall', 'silent-hill-townfall'), true);
  assert.strictEqual(fixes.slugMatches('silent-hill-townfall', 'silent-hill-town-fall'), false);
  assert.strictEqual(fixes.slugMatches('wwe-2k25', 'wwe2k25'), false);
  assert.strictEqual(fixes.slugMatches('tekken-8', 'tekken8'), false);
  assert.strictEqual(fixes.slugMatches('elden-ring-2', 'elden-ring'), false);
  assert.strictEqual(fixes.slugMatches('', 'nba2k27'), false);
});

ok('findBySlug prefers the title that already uses the requested slug', () => {
  const games = [
    { id: 80, slug: 'nba2k27' },
    { id: 2, slug: 'resident-evil-remake-trilogy' }
  ];
  assert.strictEqual(fixes.findBySlug(games, 'nba2k27', g => g.slug).id, 80);
  assert.strictEqual(fixes.findBySlug(games, 'nba-2k27', g => g.slug).id, 80);
  assert.strictEqual(fixes.findBySlug(games, 'resident-evil-remake-triology', g => g.slug).id, 2);
  assert.strictEqual(fixes.findBySlug(games, 'resident-evil-remake-trilogy', g => g.slug).id, 2);
  assert.strictEqual(fixes.findBySlug(games, 'tekken-8', g => g.slug), null);
  const both = [{ id: 80, slug: 'nba2k27' }, { id: 81, slug: 'nba-2k27' }];
  assert.strictEqual(fixes.findBySlug(both, 'nba2k27', g => g.slug).id, 80);
  assert.strictEqual(fixes.findBySlug(both, 'nba-2k27', g => g.slug).id, 81);
});

console.log('\n' + passed + ' assertions passed\n');
