// Run: node scripts/test-game-psn-view.js
const assert = require('assert');
const v = require('../lib/game-psn-view');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const PSN = {
  description: 'First paragraph.\n\nSecond paragraph.', tagline: 'Dig deep.', genres: ['Action', 'Adventure'],
  release_date: '2026-02-27', publisher: 'Zzyzx Games', voices: ['English', 'Japanese', 'German', 'French', 'Italian'],
  age_rating: 'ESRB Mature', rating: { avg: 4.88, count: 103548 },
  screenshots: ['https://image.api.playstation.com/s1.jpg', 'https://image.api.playstation.com/s2.jpg'],
  videos: ['https://vulcan.dl.playstation.net/t1.mp4']
};

console.log('\nno PlayStation data');
ok('a game without psn renders as before', () => {
  assert.deepStrictEqual(v.buildGamePsnView({ title: 'X', description: 'Mine', gallery: ['/a.png'] }),
    { hasPsn: false, media: [], hideGallery: false, tagline: '', rating: null, about: '', aboutParas: [], readMore: false, info: [], genre: '' });
  assert.strictEqual(v.buildGamePsnView(null).hasPsn, false);
  assert.strictEqual(v.buildGamePsnView({ psn: 'junk' }).hasPsn, false);
});

console.log('\nmedia');
ok('videos come first, then PlayStation screenshots; videos use the first screenshot as poster', () => {
  const r = v.buildGamePsnView({ platform: 'PS5', psn: PSN });
  assert.deepStrictEqual(r.media, [
    { type: 'video', src: 'https://vulcan.dl.playstation.net/t1.mp4', poster: 'https://image.api.playstation.com/s1.jpg' },
    { type: 'image', src: 'https://image.api.playstation.com/s1.jpg' },
    { type: 'image', src: 'https://image.api.playstation.com/s2.jpg' }
  ]);
  assert.strictEqual(r.hideGallery, true);
});
ok("the owner's own gallery replaces PlayStation's screenshots", () => {
  const r = v.buildGamePsnView({ gallery: ['/uploads/a.png', '', '/uploads/b.png'], psn: PSN });
  assert.deepStrictEqual(r.media.map(m => m.src), ['https://vulcan.dl.playstation.net/t1.mp4', '/uploads/a.png', '/uploads/b.png']);
  assert.strictEqual(r.media[0].poster, '/uploads/a.png');
});
ok('with no screenshots the poster falls back to the cover; with no media nothing is hidden', () => {
  const r = v.buildGamePsnView({ cover_image: '/c.png', psn: Object.assign({}, PSN, { screenshots: [] }) });
  assert.strictEqual(r.media[0].poster, '/c.png');
  const none = v.buildGamePsnView({ psn: Object.assign({}, PSN, { screenshots: [], videos: [] }) });
  assert.deepStrictEqual(none.media, []);
  assert.strictEqual(none.hideGallery, false);
});

console.log('\nowner wins');
ok("the owner's description, genre and release date beat PlayStation's", () => {
  const r = v.buildGamePsnView({ platform: 'PS5', description: 'Mine only.', genre: 'RPG / Co-op', release_date: '2025-12-01', psn: PSN });
  assert.strictEqual(r.about, 'Mine only.');
  const byLabel = Object.fromEntries(r.info.map(x => [x.label, x.value]));
  assert.strictEqual(byLabel['Genre'], 'RPG / Co-op');
  assert.strictEqual(byLabel['Release date'], 'Dec 1, 2025');
});
ok('empty owner fields fall back to PlayStation', () => {
  const r = v.buildGamePsnView({ platform: 'PS5', description: '', genre: '', release_date: '', psn: PSN });
  assert.strictEqual(r.about, 'First paragraph.\n\nSecond paragraph.');
  assert.deepStrictEqual(r.aboutParas, ['First paragraph.', 'Second paragraph.']);
  const byLabel = Object.fromEntries(r.info.map(x => [x.label, x.value]));
  assert.strictEqual(byLabel['Genre'], 'Action / Adventure');
  assert.strictEqual(r.genre, 'Action / Adventure');
  assert.strictEqual(byLabel['Release date'], 'Feb 27, 2026');
});

console.log('\ninfo, rating, read more');
ok('rows appear in order, only when known; voices are shortened; size only when typed', () => {
  const r = v.buildGamePsnView({ platform: 'PS5', size_gb: 54.3, psn: PSN });
  assert.deepStrictEqual(r.info.map(x => x.label), ['Release date', 'Genre', 'Publisher', 'Size', 'Platform', 'Voice', 'Age rating']);
  const by = Object.fromEntries(r.info.map(x => [x.label, x.value]));
  assert.strictEqual(by['Size'], '54.3 GB');
  assert.strictEqual(by['Voice'], 'English, Japanese, German +2');
  const bare = v.buildGamePsnView({ platform: 'PS4', psn: { description: 'x' } });
  assert.deepStrictEqual(bare.info, [{ label: 'Platform', value: 'PS4' }]);
  assert.strictEqual(v.fmtSize(60), '60 GB');
  assert.strictEqual(v.fmtSize(0), '');
});
ok('rating text and count', () => {
  assert.deepStrictEqual(v.buildGamePsnView({ psn: PSN }).rating, { text: '★ 4.9', count: '103,548' });
  assert.strictEqual(v.buildGamePsnView({ psn: Object.assign({}, PSN, { rating: null }) }).rating, null);
});
ok('read more only for long overviews', () => {
  assert.strictEqual(v.buildGamePsnView({ psn: PSN }).readMore, false);
  assert.strictEqual(v.buildGamePsnView({ psn: Object.assign({}, PSN, { description: 'x'.repeat(v.READ_MORE_CHARS + 1) }) }).readMore, true);
});
ok('dates format and reject junk', () => {
  assert.strictEqual(v.fmtDate('2026-02-27'), 'Feb 27, 2026');
  assert.strictEqual(v.fmtDate('2026-02-27T05:00:00Z'), 'Feb 27, 2026');
  assert.strictEqual(v.fmtDate('TBA'), '');
  assert.strictEqual(v.fmtDate('2026-13-01'), '');
});

console.log('\n' + passed + ' assertions passed\n');
