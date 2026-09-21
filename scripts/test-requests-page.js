// Run: node scripts/test-requests-page.js
//
// Renders the REAL views/requests.ejs with stub locals, so a template error
// in the redesigned stocked-strip / two-column-grid markup shows up here
// rather than in the browser. No test framework in this project by
// design — exits non-zero on the first failed assertion.
//
// Covers the reshuffle: the stocked strip moved from dead last (below every
// voting row) to right after the request form, and the voting rows sit in a
// two-column grid instead of one long column. Both are purely structural —
// this checks the rendered HTML string, not visual layout (that's the
// browser-verification pass, done once by hand against this same template).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const VIEW = path.join(__dirname, '..', 'views', 'requests.ejs');
const src = fs.readFileSync(VIEW, 'utf8');

function initials(name) {
  return String(name || '').trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function votingRow(slug, title, voteCount) {
  return {
    slug, title, cover_image: '',
    voters: Array.from({ length: voteCount }, (_, k) => ({ fb_name: 'Voter ' + (k + 1) }))
  };
}

function stockedRow(slug, title, hasGameId) {
  return { slug, title, cover_image: '', game_id: hasGameId === false ? null : 1 };
}

function render(voting, stocked) {
  return ejs.render(src, {
    settings: { title: 'PlayStation Hub', favicon_path: '/favicon.svg' },
    assetV: 'test',
    msg: null,
    prefillTitle: '',
    votingRequests: voting,
    stockedRequests: stocked,
    initials,
    reviews: [], reviewStats: null, recommend: null, reviewBadge: null, reviewDisplayName: null,
    announcements: [], announcement: null
  }, { filename: VIEW });
}

console.log('\nrequests.ejs — the stocked strip and the voting grid');

ok('renders with nothing at all — no stocked strip, no grid, the empty-state copy', () => {
  const html = render([], []);
  assert.ok(html.includes('No requests yet'), 'first-ever-visitor copy is gone');
  assert.strictEqual((html.match(/req-stocked-card/g) || []).length, 0, 'a stocked card rendered with no stocked requests');
  assert.strictEqual((html.match(/class="req-row"/g) || []).length, 0, 'a voting row rendered with no voting requests');
});

ok('renders one of each cleanly', () => {
  const html = render([votingRow('solo-vote', 'Solo Voting Game', 3)], [stockedRow('solo-stock', 'Solo Stocked Game')]);
  assert.ok(html.includes('Solo Voting Game'));
  assert.ok(html.includes('Solo Stocked Game'));
});

ok('the stocked section appears before the voting section in the HTML', () => {
  // This is the actual fix: the stocked strip used to render dead last,
  // below every voting row. A byte-offset check on the real rendered output
  // is the most direct way to prove the reorder actually happened.
  const html = render([votingRow('v1', 'Voting Game', 1)], [stockedRow('s1', 'Stocked Game')]);
  const stockedAt = html.indexOf('req-stocked-strip');
  const votingAt = html.indexOf('class="req-list"');
  assert.ok(stockedAt !== -1 && votingAt !== -1, 'both sections must render');
  assert.ok(stockedAt < votingAt, 'the stocked strip must come before the voting grid, not after it');
});

ok('the real 11-voting / 4-stocked shape from the bug report renders every row', () => {
  const voting = Array.from({ length: 11 }, (_, i) => votingRow('v' + i, 'Requested Game ' + i, 11 - i));
  const stocked = [
    stockedRow('s1', 'Elden Ring Nightreign'),
    stockedRow('s2', 'God of War Ragnarök'),
    stockedRow('s3', 'A Stocked Game With No Rent Link', false),
    stockedRow('s4', 'Split Fiction')
  ];
  const html = render(voting, stocked);
  assert.strictEqual((html.match(/class="req-row"/g) || []).length, 11);
  assert.strictEqual((html.match(/req-stocked-card/g) || []).length, 4);
  assert.ok(html.includes('you asked, we stocked 4'));
  // The Rent button stays conditional on game_id, same guard as before the
  // redesign — a stocked request whose game record didn't resolve must not
  // get a dead link.
  assert.strictEqual((html.match(/req-btn-rent/g) || []).length, 3, 'exactly the 3 stocked rows with a game_id should get a Rent button');
});

ok('the voting rows sit inside the two-column grid container', () => {
  const voting = [votingRow('v1', 'One', 1), votingRow('v2', 'Two', 1)];
  const html = render(voting, []);
  const listOpen = html.indexOf('class="req-list"');
  const firstRow = html.indexOf('class="req-row"');
  assert.ok(listOpen !== -1 && listOpen < firstRow, 'voting rows must be inside .req-list, not siblings of it');
});

ok('no stocked games at all renders no stocked heading and no empty strip shell', () => {
  const html = render([votingRow('v1', 'Only Voting', 1)], []);
  assert.ok(!html.includes('req-stocked-strip'), 'the strip container must not render when there is nothing to put in it');
  assert.ok(!html.includes('Now available'));
});

ok('no voting games but some stocked shows the "all caught up" empty copy', () => {
  const html = render([], [stockedRow('s1', 'Only Stocked')]);
  assert.ok(html.includes('Every requested game has been stocked'));
});

console.log('\n' + passed + ' assertions passed\n');
