// Run: node scripts/test-upcoming-psn.js
//
// The rules behind Coming soon → "Update from PlayStation" (lib/upcoming-psn.js):
// title clean-up and matching, the preview's four groups, the apply form and
// plan, and the record a ticked game becomes. Pure — no network, disk or server.
const assert = require('assert');
const u = require('../lib/upcoming-psn');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const feed = (id, title, release_date, extra) => Object.assign({
  concept_id: String(id), title, raw_title: title, release_date, platform: 'PS5',
  genres: ['Action'], publisher: 'Pub', image_url: 'https://image.api.playstation.com/' + id + '.png'
}, extra || {});

async function main() {
  console.log('\ntitles');
  ok('cleanTitle drops marks and a trailing Standard Edition, keeps other editions', () => {
    assert.strictEqual(u.cleanTitle('Call of Duty®: Modern Warfare® 4'), 'Call of Duty: Modern Warfare 4');
    assert.strictEqual(u.cleanTitle('God of War Laufey™'), 'God of War Laufey');
    assert.strictEqual(u.cleanTitle('Fable Standard Edition'), 'Fable');
    assert.strictEqual(u.cleanTitle('Grand Theft Auto VI: Ultimate Edition'), 'Grand Theft Auto VI: Ultimate Edition');
    assert.strictEqual(u.cleanTitle('  Two   Spaces  '), 'Two Spaces');
  });
  ok('matchKey treats punctuation, marks, accents and edition words as the same game', () => {
    assert.strictEqual(u.matchKey('Grand Theft Auto VI: Ultimate Edition'), u.matchKey('Grand Theft Auto VI Ultimate Edition'));
    assert.strictEqual(u.matchKey('Grand Theft Auto VI Ultimate Edition'), u.matchKey('Grand Theft Auto VI'));
    assert.strictEqual(u.matchKey('Fable Standard Edition'), u.matchKey('Fable'));
    assert.strictEqual(u.matchKey('Marvel’s Wolverine'), u.matchKey("Marvel's Wolverine"));
    assert.strictEqual(u.matchKey('MARVEL Tōkon'), u.matchKey('Marvel Tokon'));
    assert.strictEqual(u.matchKey('Call of Duty®: Modern Warfare® 4'), 'callofdutymodernwarfare4');
    assert.notStrictEqual(u.matchKey('Madden NFL 26'), u.matchKey('College Football 26'));
    assert.strictEqual(u.matchKey(''), '');
  });
  ok('genre map, platform, Manila date, date label, button words', () => {
    assert.strictEqual(u.mapGenre(['Role Playing Games', 'Action']), 'RPG');
    assert.strictEqual(u.mapGenre(['Role Playing Game (RPG)']), 'RPG');
    assert.strictEqual(u.mapGenre(['Role-Playing Games']), 'RPG');
    assert.strictEqual(u.mapGenre(['Sport']), 'Sports');
    assert.strictEqual(u.mapGenre(['', 'Horror']), 'Horror');
    assert.strictEqual(u.mapGenre([]), '');
    assert.strictEqual(u.platformOf(['PS4', 'PS5']), 'PS4/PS5');
    assert.strictEqual(u.platformOf(['PS5']), 'PS5');
    assert.strictEqual(u.platformOf(['PS4', 'PS VR2']), 'PS4');
    assert.strictEqual(u.platformOf(['PS VR2']), '');
    assert.strictEqual(u.manilaDate(Date.UTC(2026, 9, 14, 15, 59)), '2026-10-14', '23:59 in Manila');
    assert.strictEqual(u.manilaDate(Date.UTC(2026, 9, 14, 16, 0)), '2026-10-15', 'midnight in Manila');
    assert.strictEqual(u.dateLabel('2026-10-15'), 'Oct 15, 2026');
    assert.strictEqual(u.dateLabel('TBA'), 'TBA');
    assert.strictEqual(u.dateLabel(''), '—');
    assert.strictEqual(u.applyLabel(3, 1), 'Add 3 games · update 1 date');
    assert.strictEqual(u.applyLabel(1, 0), 'Add 1 game');
    assert.strictEqual(u.applyLabel(0, 2), 'Update 2 dates');
    assert.strictEqual(u.applyLabel(0, 0), 'Add selected');
  });

  console.log('\npreview');
  const upcoming = [
    { id: 1, title: 'Grand Theft Auto VI Ultimate Edition', release_date: '2026-11-19', created_at: '2026-09-01T00:00:00.000Z', nt_price_7d: 349, nt_price_30d: 1099, tr_price_7d: 449, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1 },
    { id: 2, title: 'Phantom Blade Zero', release_date: '2026-10-29', created_at: '2026-08-01T00:00:00.000Z', nt_price_7d: 1 },
    { id: 3, title: "Dragon's Dogma 2: Dark Arisen", release_date: 'TBA', created_at: '2026-07-01T00:00:00.000Z' },
    { id: 4, title: 'Renamed By Owner', psn_concept_id: '500', release_date: '2027-01-01', created_at: '2026-06-01T00:00:00.000Z' }
  ];
  const games = [
    { id: 10, title: 'Fable' },
    { id: 11, title: 'Old Game With Psn', psn: { concept_id: '700' } }
  ];
  const feedGames = [
    feed(100, 'Grand Theft Auto VI: Ultimate Edition', '2026-11-19'),
    feed(101, 'Phantom Blade Zero', '2026-11-12'),
    feed(102, "Dragon's Dogma 2: Dark Arisen", '2027-03-01'),
    feed(500, 'PlayStation Name', '2027-01-01'),
    feed(103, 'Fable Standard Edition', '2027-02-23'),
    feed(700, 'Something Else Entirely', '2027-02-01'),
    feed(104, 'Castlevania: Belmont\'s Curse', '2026-10-15', { genres: ['Role Playing Games'] }),
    feed(105, 'Wandering Sword', '2027-01-21'),
    feed(104, 'Castlevania: Belmont\'s Curse', '2026-10-15'),
    feed(106, 'Castlevania: Belmont’s Curse', '2026-10-15')
  ];
  const preview = u.buildPreview({ upcoming, games, feedGames, skipped: ['105'] });
  ok('new games are the ones matching nothing; skipped ones are kept apart', () => {
    assert.deepStrictEqual(preview.fresh.map(g => g.concept_id), ['104']);
    assert.strictEqual(preview.fresh[0].genre, 'RPG');
    assert.deepStrictEqual(preview.skippedBefore.map(g => g.concept_id), ['105']);
  });
  ok('a repeated concept id or the same game under another id is listed once', () => {
    const all = preview.fresh.concat(preview.skippedBefore).map(g => g.concept_id);
    assert.ok(!all.includes('106'));
    assert.strictEqual(all.filter(id => id === '104').length, 1);
  });
  ok('date changes: moved and TBA → date; same date and concept-id match without change are not', () => {
    assert.deepStrictEqual(preview.dateChanges, [
      { id: 2, title: 'Phantom Blade Zero', from: '2026-10-29', to: '2026-11-12', concept_id: '101' },
      { id: 3, title: "Dragon's Dogma 2: Dark Arisen", from: 'TBA', to: '2027-03-01', concept_id: '102' }
    ]);
  });
  ok('already on the site: Coming soon (by key or concept id) and the catalogue (by key or psn concept id), site titles', () => {
    assert.deepStrictEqual(preview.already, ['Grand Theft Auto VI Ultimate Edition', 'Phantom Blade Zero', "Dragon's Dogma 2: Dark Arisen", 'Renamed By Owner', 'Fable', 'Old Game With Psn']);
  });
  ok('defaults come from the newest upcoming game', () => {
    assert.deepStrictEqual(preview.defaults, { nt_price_7d: 349, nt_price_30d: 1099, tr_price_7d: 449, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1 });
    assert.strictEqual(preview.defaultsFrom, 'Grand Theft Auto VI Ultimate Edition');
    const empty = u.buildPreview({ upcoming: [], games: [], feedGames: [], skipped: [] });
    assert.deepStrictEqual(empty.defaults, { nt_price_7d: 0, nt_price_30d: 0, tr_price_7d: 0, tr_price_30d: 0, non_trophy_slots: 0, trophy_slots: 0 });
    assert.strictEqual(empty.defaultsFrom, '');
  });
  ok('previewView adds labels, the up-to-date flag and the button words', () => {
    const v = u.previewView(preview, { token: 'abc', checkedAt: '2026-10-10T13:41:00.000Z' });
    assert.strictEqual(v.token, 'abc');
    assert.strictEqual(v.checkedLabel, '9:41 PM');
    assert.strictEqual(v.fresh[0].dateLabel, 'Oct 15, 2026');
    assert.strictEqual(v.dateChanges[1].fromLabel, 'TBA');
    assert.strictEqual(v.dateChanges[1].toLabel, 'Mar 1, 2027');
    assert.strictEqual(v.upToDate, false);
    assert.strictEqual(v.applyText, 'Add 1 game · update 2 dates');
    const none = u.previewView(u.buildPreview({ upcoming, games, feedGames: [], skipped: [] }), { token: 't', checkedAt: 'x' });
    assert.strictEqual(none.upToDate, true);
    assert.strictEqual(none.checkedLabel, '');
  });

  console.log('\napply');
  ok('readForm keeps digit concept ids, whole-number ids, trimmed titles and safe numbers', () => {
    const f = u.readForm({
      add: ['104', '105', '104', 'x1', '../2'], date: ['2', '3', 'zz', '-1'],
      title_104: '  Castlevania:   Belmont\'s Curse ', title_105: '   ',
      nt_price_7d: '349', nt_price_30d: '-5', tr_price_7d: 'abc', tr_price_30d: '1299.9', non_trophy_slots: '3', trophy_slots: '99999999'
    });
    assert.deepStrictEqual(f.add, ['104', '105']);
    assert.deepStrictEqual(f.dates, [2, 3]);
    assert.deepStrictEqual(f.titles, { 104: "Castlevania: Belmont's Curse" });
    assert.deepStrictEqual(f.prices, { nt_price_7d: 349, nt_price_30d: 0, tr_price_7d: 0, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1000000 });
    const single = u.readForm({ add: '104', date: '2' });
    assert.deepStrictEqual([single.add, single.dates], [['104'], [2]]);
    assert.deepStrictEqual(u.readForm(undefined).add, []);
  });
  ok('planApply adds ticked games with the owner\'s title, applies ticked date changes, remembers unticked ones', () => {
    const form = u.readForm({ add: ['105'], date: ['2'], title_105: 'Wandering Sword (PS5)' });
    const plan = u.planApply({ preview, form, upcoming, games, skipped: ['105', '900'] });
    assert.deepStrictEqual(plan.adds.map(g => [g.concept_id, g.title]), [['105', 'Wandering Sword (PS5)']]);
    assert.deepStrictEqual(plan.dateUpdates, [{ id: 2, release_date: '2026-11-12', concept_id: '101' }]);
    assert.deepStrictEqual(plan.skipped, ['900', '104'], 'ticked 105 leaves the list; unticked 104 joins it');
  });
  ok('planApply re-checks against what is stored now', () => {
    const form = u.readForm({ add: ['104', '105', '999'], date: ['3', '4'] });
    const nowUpcoming = upcoming.filter(x => x.id !== 3).concat([{ id: 9, title: 'Castlevania Belmonts Curse', release_date: '2026-10-15' }]);
    const plan = u.planApply({ preview, form, upcoming: nowUpcoming, games, skipped: [] });
    assert.deepStrictEqual(plan.adds.map(g => g.concept_id), ['105'], '104 was added by hand meanwhile; 999 was never offered');
    assert.deepStrictEqual(plan.dateUpdates, [], 'game 3 was deleted meanwhile; game 4 had no change offered');
  });
  ok('planApply never adds the same game twice in one batch, and keeps the newest 200 skipped ids', () => {
    const twin = { fresh: [feed(1, 'Same Game', '2027-01-01'), feed(2, 'Same Game: Deluxe Edition', '2027-01-01')], skippedBefore: [], dateChanges: [] };
    const plan = u.planApply({ preview: twin, form: u.readForm({ add: ['1', '2'] }), upcoming: [], games: [], skipped: [] });
    assert.deepStrictEqual(plan.adds.map(g => g.concept_id), ['1']);
    const many = Array.from({ length: 250 }, (_, i) => String(1000 + i));
    const kept = u.planApply({ preview: { fresh: [feed(5, 'X', '2027-01-01')], skippedBefore: [], dateChanges: [] }, form: u.readForm({}), upcoming: [], games: [], skipped: many }).skipped;
    assert.strictEqual(kept.length, 200);
    assert.strictEqual(kept[kept.length - 1], '5');
    assert.strictEqual(kept[0], '1051');
  });

  console.log('\nrecords');
  const prices = { nt_price_7d: 349, nt_price_30d: 1099, tr_price_7d: 449, tr_price_30d: 1299, non_trophy_slots: 3, trophy_slots: 1 };
  ok('newUpcomingRecord has the add form\'s fields plus psn_concept_id', () => {
    const r = u.newUpcomingRecord(feed(104, 'Castlevania', '2026-10-15', { platform: 'PS4/PS5' }), { prices, description: 'D', genre: 'RPG', cover_image: '/uploads/c.webp', gallery: ['/uploads/s1.webp'], nowIso: '2026-10-10T00:00:00.000Z' });
    assert.deepStrictEqual(r, {
      title: 'Castlevania', platform: 'PS4/PS5', genre: 'RPG', release_date: '2026-10-15', description: 'D',
      cover_image: '/uploads/c.webp', gallery: ['/uploads/s1.webp'], rank: 0, non_trophy_slots: 3, trophy_slots: 1,
      nt_price_7d: 349, nt_price_30d: 1099, tr_price_7d: 449, tr_price_30d: 1299, buy_nt_price: 0, buy_tr_price: 0,
      psn_concept_id: '104', created_at: '2026-10-10T00:00:00.000Z'
    });
  });
  await okAsync('buildRecord: store page description and genre, cover, first 6 screenshots in order', async () => {
    const saved = [];
    const shots = Array.from({ length: 9 }, (_, i) => 'https://image.api.playstation.com/s' + i + '.jpg');
    const { record, complete } = await u.buildRecord(feed(104, 'Castlevania', '2026-10-15'), {
      prices, nowIso: 'now',
      fetchInfo: async id => ({ ok: true, psn: { description: 'Whip it. (' + id + ')', genres: ['Role Playing Games'], screenshots: shots } }),
      saveImage: async url => { saved.push(url); return '/uploads/' + url.split('/').pop() + '.webp'; }
    });
    assert.strictEqual(complete, true);
    assert.strictEqual(record.description, 'Whip it. (104)');
    assert.strictEqual(record.genre, 'RPG');
    assert.strictEqual(record.cover_image, '/uploads/104.png.webp');
    assert.deepStrictEqual(record.gallery, ['s0', 's1', 's2', 's3', 's4', 's5'].map(s => '/uploads/' + s + '.jpg.webp'));
    assert.strictEqual(saved.length, 7);
  });
  await okAsync('buildRecord: a failed page, a thrown error or failed images leave pieces out, never the game', async () => {
    const a = await u.buildRecord(feed(1, 'A', '2027-01-01'), { prices, nowIso: 'now', fetchInfo: async () => ({ ok: false, reason: 'timeout' }), saveImage: async () => '' });
    assert.strictEqual(a.complete, false);
    assert.strictEqual(a.record.description, '');
    assert.strictEqual(a.record.genre, 'Action', 'falls back to the index genre');
    assert.strictEqual(a.record.cover_image, '');
    const b = await u.buildRecord(feed(2, 'B', '2027-01-01'), {
      prices, nowIso: 'now',
      fetchInfo: async () => { throw new Error('boom'); },
      saveImage: async () => { throw new Error('boom'); }
    });
    assert.strictEqual(b.complete, false);
    assert.deepStrictEqual(b.record.gallery, []);
    const c = await u.buildRecord(feed(3, 'C', '2027-01-01', { image_url: '' }), { prices, nowIso: 'now', fetchInfo: async () => ({ ok: true, psn: { description: 'x', screenshots: [] } }), saveImage: async () => '/uploads/x.webp' });
    assert.strictEqual(c.complete, false, 'no cover');
  });
  await okAsync('mapLimit keeps order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const out = await u.mapLimit([5, 1, 4, 2, 3], 2, async n => {
      running++; peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, n * 3));
      running--;
      return n * 10;
    });
    assert.deepStrictEqual(out, [50, 10, 40, 20, 30]);
    assert.strictEqual(peak, 2);
    assert.deepStrictEqual(await u.mapLimit([], 3, async n => n), []);
  });

  console.log('\n' + passed + ' assertions passed\n');
}

main().catch(e => { console.error(e); process.exit(1); });
