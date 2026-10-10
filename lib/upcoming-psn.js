// Coming soon → "Update from PlayStation": the rules. Which of PlayStation's
// announced games are new to the site, which Coming soon dates moved, what a
// ticked game becomes as an upcoming record, and what the owner's ticks mean.
// lib/upcoming-psn-feed.js reads PlayStation; server.js wires the routes.
// Nothing here touches the network, the disk or the database — buildRecord's
// downloads are functions handed in by the caller.
// See docs/superpowers/specs/2026-10-10-upcoming-from-playstation-design.md.
const { titleCandidates } = require('./psn-game');

const MAX_TITLE = 150;
const MAX_SKIPPED = 200;
const MAX_SCREENSHOTS = 6;
const MAX_NUMBER = 1000000;
const PRICE_FIELDS = Object.freeze(['nt_price_7d', 'nt_price_30d', 'tr_price_7d', 'tr_price_30d', 'non_trophy_slots', 'trophy_slots']);
// PlayStation's genre words → the site's, where they differ. The store page
// says "Role Playing Games", the search index "Role Playing Game (RPG)".
const GENRE_MAP = Object.freeze({ sport: 'Sports', sports: 'Sports' });
const RPG = /^role[\s-]*playing game/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MANILA_OFFSET_MS = 8 * 3600 * 1000; // UTC+8 all year, no daylight saving

// "Call of Duty®: Modern Warfare® 4" → "Call of Duty: Modern Warfare 4";
// "Fable Standard Edition" → "Fable". Other edition names stay.
function cleanTitle(s) {
  return String(s == null ? '' : s)
    .replace(/[®™©]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[-–:]?\s*standard edition$/i, '')
    .trim();
}

// The same game under slightly different names gets the same key:
// "Grand Theft Auto VI: Ultimate Edition" = "Grand Theft Auto VI Ultimate Edition"
// = "Grand Theft Auto VI". '' for a blank title, which never matches.
function matchKey(s) {
  const candidates = titleCandidates(cleanTitle(s));
  return candidates[candidates.length - 1]
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function mapGenre(genres) {
  const first = (Array.isArray(genres) ? genres : [])
    .map(g => String(g == null ? '' : g).trim())
    .find(Boolean);
  if (!first) return '';
  if (RPG.test(first)) return 'RPG';
  return GENRE_MAP[first.toLowerCase()] || first;
}

// A release timestamp (ms) → the Philippine calendar date, 'YYYY-MM-DD'.
function manilaDate(ms) {
  return new Date(Number(ms) + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

// ['PS5', 'PS4'] → 'PS4/PS5' — the three values the add form uses — or ''.
function platformOf(platforms) {
  const list = Array.isArray(platforms) ? platforms : [];
  const ps5 = list.includes('PS5');
  const ps4 = list.includes('PS4');
  if (ps5 && ps4) return 'PS4/PS5';
  return ps5 ? 'PS5' : ps4 ? 'PS4' : '';
}

// '2026-10-15' → 'Oct 15, 2026'; 'TBA' and blanks stay readable.
function dateLabel(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return ymd === 'TBA' ? 'TBA' : '—';
  return MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
}

function plural(n, one) {
  return n + ' ' + one + (n === 1 ? '' : 's');
}

// The gold button's words. public/js/admin-upcoming-psn.js has the same rule
// for live updates; scripts/test-upcoming-psn.js checks the two agree.
function applyLabel(adds, dates) {
  if (adds && dates) return 'Add ' + plural(adds, 'game') + ' · update ' + plural(dates, 'date');
  if (adds) return 'Add ' + plural(adds, 'game');
  if (dates) return 'Update ' + plural(dates, 'date');
  return 'Add selected';
}

function wholeNumber(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_NUMBER) : 0;
}

function sameConcept(a, b) {
  return a != null && b != null && String(a) !== '' && String(a) === String(b);
}

// The upcoming game added last (newest created_at, then highest id) lends its
// prices and slots to the next batch; all 0 when there is none.
function defaultsFrom(upcoming) {
  const list = (upcoming || []).filter(Boolean);
  const newest = list.slice().sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || '')) || (Number(b.id) || 0) - (Number(a.id) || 0))[0];
  const values = {};
  PRICE_FIELDS.forEach(k => { values[k] = newest ? wholeNumber(newest[k]) : 0; });
  return { values, fromTitle: newest ? String(newest.title || '') : '' };
}

// feedGames: lib/upcoming-psn-feed.js games. Returns
// { fresh, skippedBefore, dateChanges, already, defaults, defaultsFrom } —
// fresh/skippedBefore hold feed games (plus `genre`), dateChanges hold
// { id, title, from, to, concept_id } and already holds the site's titles.
function buildPreview({ upcoming, games, feedGames, skipped }) {
  const ups = (upcoming || []).filter(Boolean);
  const site = (games || []).filter(Boolean);
  const skippedSet = new Set((skipped || []).map(String));
  const seen = new Set();
  const fresh = [];
  const skippedBefore = [];
  const dateChanges = [];
  const already = [];
  (feedGames || []).forEach(g => {
    if (!g || !g.concept_id) return;
    const key = matchKey(g.title);
    if (seen.has('c' + g.concept_id) || (key && seen.has('k' + key))) return;
    seen.add('c' + g.concept_id);
    if (key) seen.add('k' + key);
    const up = ups.find(u => sameConcept(u.psn_concept_id, g.concept_id) || (key && matchKey(u.title) === key));
    if (up) {
      already.push(String(up.title || ''));
      if (up.release_date !== g.release_date) {
        dateChanges.push({ id: up.id, title: String(up.title || ''), from: up.release_date || '', to: g.release_date, concept_id: g.concept_id });
      }
      return;
    }
    const own = site.find(s => sameConcept(s.psn_concept_id, g.concept_id) || sameConcept(s.psn && s.psn.concept_id, g.concept_id) || (key && matchKey(s.title) === key));
    if (own) { already.push(String(own.title || '')); return; }
    const row = Object.assign({}, g, { genre: mapGenre(g.genres) });
    (skippedSet.has(String(g.concept_id)) ? skippedBefore : fresh).push(row);
  });
  const d = defaultsFrom(ups);
  return { fresh, skippedBefore, dateChanges, already, defaults: d.values, defaultsFrom: d.fromTitle };
}

// What the panel template shows: the preview plus labels.
function previewView(preview, { token, checkedAt }) {
  const p = preview || {};
  const withLabel = g => Object.assign({}, g, { dateLabel: dateLabel(g.release_date) });
  const fresh = (p.fresh || []).map(withLabel);
  const skippedBefore = (p.skippedBefore || []).map(withLabel);
  const dateChanges = (p.dateChanges || []).map(c => Object.assign({}, c, { fromLabel: dateLabel(c.from), toLabel: dateLabel(c.to) }));
  const checked = new Date(checkedAt);
  return {
    token,
    checkedLabel: isNaN(checked) ? '' : checked.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }),
    fresh,
    skippedBefore,
    dateChanges,
    already: (p.already || []).slice(),
    defaults: Object.assign({}, p.defaults),
    defaultsFrom: p.defaultsFrom || '',
    upToDate: !fresh.length && !skippedBefore.length && !dateChanges.length,
    applyText: applyLabel(fresh.length, dateChanges.length)
  };
}

function asList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// The apply form's body → { add, dates, titles, prices }. Concept ids are
// digits; upcoming ids are positive whole numbers; anything else is dropped.
function readForm(body) {
  const b = body || {};
  const add = [...new Set(asList(b.add).map(v => String(v).trim()).filter(v => /^\d+$/.test(v)))];
  const dates = [...new Set(asList(b.date).map(v => parseInt(v, 10)).filter(n => Number.isInteger(n) && n > 0))];
  const titles = {};
  add.forEach(id => {
    const t = String(b['title_' + id] == null ? '' : b['title_' + id]).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    if (t) titles[id] = t;
  });
  const prices = {};
  PRICE_FIELDS.forEach(k => { prices[k] = wholeNumber(b[k]); });
  return { add, dates, titles, prices };
}

// Re-planned against what is stored now, not when the preview was made: a
// ticked game that matches a Coming soon or catalogue game added since is
// skipped, and a date change for a game deleted since is dropped.
// Returns { adds, prices, dateUpdates, skipped }.
function planApply({ preview, form, upcoming, games, skipped }) {
  const p = preview || {};
  const f = form || { add: [], dates: [], titles: {}, prices: {} };
  const ups = (upcoming || []).filter(Boolean);
  const site = (games || []).filter(Boolean);
  const offered = (p.fresh || []).concat(p.skippedBefore || []);
  const ticked = new Set(f.add);
  const taken = new Set();
  const adds = [];
  offered.forEach(g => {
    if (!ticked.has(String(g.concept_id))) return;
    const title = f.titles[g.concept_id] || g.title;
    const keys = [matchKey(title), matchKey(g.title)].filter(Boolean);
    const clash = x => x && (sameConcept(x.psn_concept_id, g.concept_id) || sameConcept(x.psn && x.psn.concept_id, g.concept_id) || keys.includes(matchKey(x.title)));
    if (ups.some(clash) || site.some(clash) || keys.some(k => taken.has(k))) return;
    keys.forEach(k => taken.add(k));
    adds.push(Object.assign({}, g, { title }));
  });
  const dateUpdates = [];
  f.dates.forEach(id => {
    const change = (p.dateChanges || []).find(c => c.id === id);
    const up = ups.find(u => u.id === id);
    if (change && up && up.release_date !== change.to) dateUpdates.push({ id, release_date: change.to, concept_id: change.concept_id });
  });
  const unticked = offered.map(g => String(g.concept_id)).filter(id => !ticked.has(id));
  const keep = (skipped || []).map(String).filter(id => !ticked.has(id));
  unticked.forEach(id => { if (!keep.includes(id)) keep.push(id); });
  return { adds, prices: Object.assign({}, f.prices), dateUpdates, skipped: keep.slice(-MAX_SKIPPED) };
}

// One ticked game → an upcoming record (no id; server.js assigns it), with the
// same fields as /admin/upcoming/add plus psn_concept_id.
function newUpcomingRecord(game, { prices, description, genre, cover_image, gallery, nowIso }) {
  const pr = prices || {};
  return {
    title: game.title,
    platform: game.platform || 'PS5',
    genre: genre || '',
    release_date: game.release_date,
    description: description || '',
    cover_image: cover_image || '',
    gallery: Array.isArray(gallery) ? gallery.slice() : [],
    rank: 0,
    non_trophy_slots: wholeNumber(pr.non_trophy_slots),
    trophy_slots: wholeNumber(pr.trophy_slots),
    nt_price_7d: wholeNumber(pr.nt_price_7d),
    nt_price_30d: wholeNumber(pr.nt_price_30d),
    tr_price_7d: wholeNumber(pr.tr_price_7d),
    tr_price_30d: wholeNumber(pr.tr_price_30d),
    buy_nt_price: 0,
    buy_tr_price: 0,
    psn_concept_id: String(game.concept_id),
    created_at: nowIso
  };
}

// Fetches one game's store page and images through the functions handed in.
// fetchInfo(conceptId) → lib/psn-game fetchGameInfo's { ok, psn };
// saveImage(url) → '/uploads/…' or ''. A failure only leaves that piece out.
// Returns { record, complete } — complete when it got a cover and a description.
async function buildRecord(game, { prices, nowIso, fetchInfo, saveImage }) {
  let info = null;
  try {
    const r = await fetchInfo(game.concept_id);
    if (r && r.ok && r.psn) info = r.psn;
  } catch (e) {
    info = null;
  }
  const save = async url => {
    try { return (await saveImage(url)) || ''; } catch (e) { return ''; }
  };
  const shots = info && Array.isArray(info.screenshots) ? info.screenshots.slice(0, MAX_SCREENSHOTS) : [];
  const [cover, ...gallery] = await Promise.all([game.image_url ? save(game.image_url) : Promise.resolve('')].concat(shots.map(save)));
  const description = info && info.description ? String(info.description) : '';
  const genre = mapGenre(info && Array.isArray(info.genres) && info.genres.length ? info.genres : game.genres);
  const record = newUpcomingRecord(game, { prices, description, genre, cover_image: cover, gallery: gallery.filter(Boolean), nowIso });
  return { record, complete: !!(cover && description) };
}

// fn over items, at most `limit` at a time; results keep the items' order.
async function mapLimit(items, limit, fn) {
  const list = items || [];
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.max(1, Math.min(limit, list.length)); w++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

module.exports = {
  PRICE_FIELDS, MAX_SCREENSHOTS, MAX_SKIPPED,
  cleanTitle, matchKey, mapGenre, manilaDate, platformOf, dateLabel, applyLabel,
  buildPreview, previewView, readForm, planApply, newUpcomingRecord, buildRecord, mapLimit
};
