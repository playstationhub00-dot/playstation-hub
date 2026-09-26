// The PS Plus Deluxe game list: how a refresh from PlayStation's feed
// (lib/psplus-feed.js) is merged, checked, compared with what the site has,
// and applied without ever losing the owner's own choices. Pure functions —
// lib/psplus-catalog-store.js saves the result, server.js wires the routes.
//
// See docs/superpowers/specs/2026-09-27-psplus-catalog-design.md.

// The lists stored as catalog games. PlayStation's monthly list is not one of
// them: the owner's own month entries are the only source of Monthly tags.
const STORED_LISTS = Object.freeze(['catalog', 'classics', 'ubisoft']);

// Set by the owner in the admin and never overwritten by a refresh.
const OWNER_FIELDS = Object.freeze(['hidden', 'hidden_note', 'cover_override', 'rent_game_id', 'rent_override']);
const OWNER_DEFAULTS = Object.freeze({ hidden: false, hidden_note: '', cover_override: '', rent_game_id: null, rent_override: false });

// A list that shrinks by this much or more in one refresh gets a warning.
const BIG_DROP = 0.3;

// ── Names ─────────────────────────────────────────────────────────────

const ENTITIES = { '&amp;': '&', '&#39;': "'", '&#039;': "'", '&apos;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>' };

// Trailing noise, stripped repeatedly until none is left, since PlayStation
// stacks them in any order ("… - Digital Standard Edition PlayStation®Hits").
const SUFFIXES = [
  /(?:\s+[-–|])?\s+PS[45]\s*&\s*PS[45]$/i,                          // " PS4 & PS5", " - PS5 & PS4", " | PS4 & PS5"
  /\s+PS[45]$/i,                                                    // " PS5"
  /(?:\s+[-–])?\s*PlayStation\s*Hits$/i,                            // " PlayStation Hits", " – PlayStation Hits"
  /(?:\s+[-–]|:)?\s+(?:Digital\s+)?Standard(?:\s+Digital)?\s+Edition$/i, // " - Digital Standard Edition", ": Standard Edition"
  /\s+-\s+Standard$/i,                                              // " - Standard"
  /\s+full game$/i                                                  // " full game"
];

// PlayStation's store names carry platform and edition noise the site doesn't
// need: "Arcade Paradise PS4™ & PS5™", "Days Gone Standard Edition",
// "Ghost of Tsushima DIRECTOR'S CUT (PlayStation Plus)".
function displayName(raw) {
  let s = String(raw || '').replace(/&(amp|#39|#039|apos|quot|lt|gt);/g, m => ENTITIES[m]);
  // A mark glued between two words becomes a space ("Far Cry®3" → "Far Cry 3").
  s = s.replace(/[™®©](?=[A-Za-z0-9])/g, ' ').replace(/[™®©]/g, '');
  // Full-width characters ("PS4＆PS5") to plain ones — after the marks above,
  // which NFKC would otherwise spell out as "TM".
  s = s.normalize('NFKC');
  s = s.replace(/\s*[([](?:PS4\s*&\s*PS5|PS5|PS4|PlayStation\s*Plus|Standard\s+Edition)[)\]]/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  let prev;
  do {
    prev = s;
    SUFFIXES.forEach(re => { s = s.replace(re, '').trim(); });
  } while (s !== prev);
  return s;
}

// Loose key for "is this the same game": lowercase, accents folded, every run
// of punctuation a single space. "Ghost of Tsushima DIRECTOR'S CUT" and the
// owner's "Ghost of Tsushima Director's Cut" give the same key.
function matchKey(name) {
  return displayName(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// ── Refresh ───────────────────────────────────────────────────────────

// One game per PlayStation concept across the stored lists. The same concept
// can appear twice in one list (two language versions) and in several lists
// (every Ubisoft+ game is also in the Game Catalog): the first occurrence's
// data is kept and the memberships are unioned. Lists that did not read OK are
// skipped. Returns games keyed 'c:<conceptId>', in feed order.
function mergeFeed(results) {
  const byKey = new Map();
  STORED_LISTS.forEach(list => {
    const r = results && results[list];
    if (!r || !r.ok) return;
    r.games.forEach(g => {
      const key = 'c:' + g.concept_id;
      let game = byKey.get(key);
      if (!game) {
        game = Object.assign({ key, name: displayName(g.name_raw) }, g, { lists: [] });
        byKey.set(key, game);
      }
      if (!game.lists.includes(list)) game.lists.push(list);
    });
  });
  return [...byKey.values()];
}

// How many stored PlayStation games are in each list.
function storedCounts(stored) {
  const counts = { catalog: 0, classics: 0, ubisoft: 0 };
  (stored || []).forEach(g => {
    if (!g || g.source !== 'feed') return;
    (g.lists || []).forEach(l => { if (l in counts) counts[l] += 1; });
  });
  return counts;
}

// Per stored list: 'failed' (couldn't read it), 'blocked' (read, but empty —
// almost always PlayStation's site misbehaving, never applied), 'warn' (lost
// 30% or more at once — shown, still applicable) or 'ok'.
function listSafety(counts, results) {
  const out = {};
  STORED_LISTS.forEach(list => {
    const r = results && results[list];
    const stored = (counts && counts[list]) || 0;
    if (!r || !r.ok) {
      out[list] = { state: 'failed', stored, incoming: 0, reason: (r && r.reason) || 'missing' };
      return;
    }
    const incoming = new Set(r.games.map(g => g.concept_id)).size;
    let state = 'ok';
    if (incoming === 0) state = 'blocked';
    else if (stored > 0 && incoming <= stored * (1 - BIG_DROP)) state = 'warn';
    out[list] = { state, stored, incoming, reason: '' };
  });
  return out;
}

// The lists a refresh may apply: read OK and not empty.
function appliedLists(safety) {
  return STORED_LISTS.filter(l => safety[l] && (safety[l].state === 'ok' || safety[l].state === 'warn'));
}

const FEED_FIELDS = ['concept_id', 'name_raw', 'name', 'image_url', 'platforms', 'genres', 'release_date', 'store_url'];

function sameArray(a, b) {
  return (a || []).length === (b || []).length && (a || []).every((x, i) => x === (b || [])[i]);
}

// A stored game's lists after the refresh: its memberships in lists that were
// held back stay exactly as they were; in applied lists it is a member only if
// the incoming feed says so.
function nextLists(storedGame, incomingGame, applied) {
  return STORED_LISTS.filter(l => applied.includes(l)
    ? !!(incomingGame && incomingGame.lists.includes(l))
    : (storedGame.lists || []).includes(l));
}

// Compares the stored games with a merged feed. Hand-added games are never
// part of the comparison.
//   added     — incoming games the site doesn't have
//   leaving   — stored PlayStation games left in no list at all
//   updated   — [{ before, after }] where a feed field or a membership changed
//   unchanged — count
function diffCatalog(stored, incoming, applied) {
  const inByKey = new Map((incoming || []).map(g => [g.key, g]));
  const feedStored = (stored || []).filter(g => g && g.source === 'feed');
  const storedKeys = new Set(feedStored.map(g => g.key));
  const added = (incoming || []).filter(g => !storedKeys.has(g.key));
  const leaving = [];
  const updated = [];
  let unchanged = 0;
  feedStored.forEach(s => {
    const inc = inByKey.get(s.key);
    const lists = nextLists(s, inc, applied);
    if (!lists.length) { leaving.push(s); return; }
    const after = Object.assign({}, s, inc ? pick(inc, FEED_FIELDS) : {}, { lists });
    const changed = !sameArray(s.lists, lists) || FEED_FIELDS.some(f =>
      Array.isArray(s[f]) || Array.isArray(after[f]) ? !sameArray(s[f], after[f]) : s[f] !== after[f]);
    if (changed) updated.push({ before: s, after });
    else unchanged += 1;
  });
  return { added, leaving, updated, unchanged };
}

function pick(obj, fields) {
  const out = {};
  fields.forEach(f => { if (f in obj) out[f] = obj[f]; });
  return out;
}

// What Apply writes: full documents to upsert and keys to delete. The owner's
// fields on an existing game are carried over untouched; a new game starts
// with the defaults and first_seen_at = now (the "Newest added" sort).
function applyPlan(stored, incoming, applied, nowIso) {
  const diff = diffCatalog(stored, incoming, applied);
  const upserts = [];
  diff.added.forEach(g => {
    upserts.push(Object.assign({}, OWNER_DEFAULTS, pick(g, FEED_FIELDS), {
      key: g.key, source: 'feed', lists: g.lists.slice(), first_seen_at: nowIso, updated_at: nowIso
    }));
  });
  diff.updated.forEach(({ before, after }) => {
    upserts.push(Object.assign({}, after, pick(before, OWNER_FIELDS), {
      key: before.key, source: 'feed', first_seen_at: before.first_seen_at || nowIso, updated_at: nowIso
    }));
  });
  return { upserts, removals: diff.leaving.map(g => g.key), diff };
}

// Everything the admin's Refresh preview needs, from the four fetched lists.
// `incoming` and `applied` are kept with the preview so Apply can re-plan
// against whatever is stored at the moment it is pressed.
function buildPreview(stored, results) {
  const safety = listSafety(storedCounts(stored), results);
  const applied = appliedLists(safety);
  const onlyApplied = {};
  applied.forEach(l => { onlyApplied[l] = results[l]; });
  const incoming = mergeFeed(onlyApplied);
  const diff = diffCatalog(stored, incoming, applied);
  const seen = new Set();
  const monthlyNames = [];
  const monthly = results && results.monthly;
  if (monthly && monthly.ok) {
    monthly.games.forEach(g => {
      const name = displayName(g.name_raw);
      const k = matchKey(name);
      if (!k || seen.has(k)) return;
      seen.add(k);
      monthlyNames.push(name);
    });
  }
  return { safety, applied, incoming, diff, monthlyNames };
}

module.exports = {
  STORED_LISTS, OWNER_FIELDS, OWNER_DEFAULTS, BIG_DROP,
  displayName, matchKey, mergeFeed, storedCounts, listSafety, appliedLists,
  diffCatalog, applyPlan, buildPreview
};
