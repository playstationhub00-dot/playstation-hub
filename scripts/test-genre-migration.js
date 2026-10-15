// Run: node scripts/test-genre-migration.js
//
// The genre list is applied once, on boot, to the games already in the
// database. These checks run the pure step: matching slugs, a missing slug,
// and a second pass that leaves an admin edit alone.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const genre = require('../lib/genre-migration');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

ok('slugs follow the public title rule, including apostrophes and ō', () => {
  assert.strictEqual(genre.slugify("Dragon's Dogma 2: Dark Arisen"), 'dragon-s-dogma-2-dark-arisen');
  assert.strictEqual(genre.slugify('Marvel Tōkon: Fighting Souls'), 'marvel-t-kon-fighting-souls');
  assert.strictEqual(genre.slugify("Assassin's Creed Black Flag Resynced"), 'assassin-s-creed-black-flag-resynced');
  assert.strictEqual(genre.slugify('Assasins Creed Shadows w/ DLC'), 'assasins-creed-shadows-w-dlc');
  assert.strictEqual(genre.slugify(null), '');
  assert.strictEqual(Object.keys(genre.GENRES).length, 29);
});

ok('sets genre only on the listed slugs and leaves every other field alone', () => {
  const dog = {
    id: 7, title: "Dragon's Dogma 2: Dark Arisen", genre: 'Action',
    platform: 'PS5', nt_price_7d: 349, description: 'keep'
  };
  const other = { id: 8, title: 'Silent Hill f', genre: 'Horror', cover_image: '/a.webp' };
  const state = { games: [dog, other, null, { title: 12, genre: 'Nope' }] };
  const logs = [];
  const result = genre.apply(state, msg => logs.push(msg));
  assert.strictEqual(result.write, true);
  assert.strictEqual(result.games[0].genre, 'RPG');
  assert.strictEqual(result.games[0].platform, 'PS5');
  assert.strictEqual(result.games[0].nt_price_7d, 349);
  assert.strictEqual(result.games[0].description, 'keep');
  assert.notStrictEqual(result.games[0], dog);
  assert.strictEqual(result.games[1], other);
  assert.strictEqual(result.games[1].genre, 'Horror');
  assert.strictEqual(dog.genre, 'Action', 'the input record is not mutated');
  assert.deepStrictEqual(result.changed, [{ id: 7, slug: 'dragon-s-dogma-2-dark-arisen', from: 'Action', to: 'RPG' }]);
  assert.ok(result.missing.indexOf('tekken-8') !== -1);
  assert.ok(logs.some(l => l.indexOf('missing slug tekken-8') !== -1));
  assert.ok(result.migrations.indexOf(genre.ID) !== -1);
});

ok('a missing slug does not throw, and the games that are present are still updated', () => {
  const result = genre.apply({
    games: [{ id: 1, title: 'Tekken 8', genre: 'Action', renters: 8 }]
  });
  assert.strictEqual(result.games[0].genre, 'Fighting');
  assert.strictEqual(result.games[0].renters, 8);
  assert.strictEqual(result.missing.length, 28);
  assert.strictEqual(result.write, true);
});

ok('the marker stops a second run from overwriting an admin edit', () => {
  const first = genre.apply({
    games: [{ id: 1, title: 'Saros', genre: 'Action' }]
  });
  assert.strictEqual(first.games[0].genre, 'Shooter');
  const edited = {
    games: [Object.assign({}, first.games[0], { genre: 'Adventure' })],
    migrations: first.migrations
  };
  const second = genre.apply(edited);
  assert.strictEqual(second.write, false);
  assert.strictEqual(second.games[0].genre, 'Adventure');
  assert.strictEqual(second.games, edited.games);
});

ok('a genre that is already correct is not rewritten, but the marker is still stored', () => {
  const game = { id: 3, title: 'Tekken 7', genre: 'Fighting' };
  const result = genre.apply({ games: [game] });
  assert.strictEqual(result.write, true);
  assert.strictEqual(result.changed.length, 0);
  assert.strictEqual(result.games[0], game);
  assert.ok(result.migrations.indexOf(genre.ID) !== -1);
});

ok('a bad games or migrations value is left untouched', () => {
  const badGames = { games: { title: 'Tekken 8' }, migrations: [] };
  const a = genre.apply(badGames);
  assert.strictEqual(a.write, false);
  assert.strictEqual(a.games, badGames.games);
  const badMark = { games: [{ id: 1, title: 'Tekken 8', genre: 'Action' }], migrations: 'nope' };
  const b = genre.apply(badMark);
  assert.strictEqual(b.write, false);
  assert.strictEqual(b.games[0].genre, 'Action');
  assert.strictEqual(b.migrations, 'nope');
});

ok('boot runs the migration through the Mongo save hook and does not rename titles', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const hook = server.indexOf('db.write = function()');
  const call = server.indexOf('genreMigration.apply(');
  assert.ok(hook > 0 && call > hook, 'apply runs after db.write syncs to MongoDB');
  assert.ok(server.indexOf("require('./lib/genre-migration')") > 0);
  const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'genre-migration.js'), 'utf8');
  assert.ok(!lib.includes('title-fixes') && !lib.includes('rename-game-titles'));
});

console.log('\n' + passed + ' assertions passed\n');
