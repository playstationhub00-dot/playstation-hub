// Where the PS Plus Deluxe game list lives: its own MongoDB collection, one
// document per game, NOT the lowdb blob — server.js rewrites that blob in
// full on every save of anything, and ~500 games would add ~250 KB to every
// customer edit for data that changes about once a month.
//
// Pages read from an in-memory copy (all()), filled once at boot by load() and
// updated only after a write succeeds. With no MONGODB_URI (local dev) the
// store runs from memory alone.
//
//   psplus_catalog       { _id: key, key, source: 'feed'|'manual', …game }
//   psplus_catalog_meta  { _id: 'meta', last_refreshed_at, locale }
const { OWNER_FIELDS, OWNER_DEFAULTS, STORED_LISTS } = require('./psplus-catalog');

const KEY_RE = /^(c|m):\d+$/;

let _getDb = null;
let _cache = [];
let _meta = { last_refreshed_at: '', locale: '' };

function init(getDbFn) { _getDb = getDbFn; }

async function _db() {
  if (!_getDb) throw new Error('lib/psplus-catalog-store: init(getDb) was never called');
  return _getDb();
}

function isKey(key) { return KEY_RE.test(String(key || '')); }

function _fromDoc(doc) {
  const g = Object.assign({}, doc);
  delete g._id;
  return g;
}
function _toDoc(game) { return Object.assign({ _id: game.key }, game); }

function _setCache(games) { _cache = games.map(g => Object.assign({}, g)); }

async function load() {
  const db = await _db();
  if (!db) return false;
  const docs = await db.collection('psplus_catalog').find({}).toArray();
  const meta = await db.collection('psplus_catalog_meta').findOne({ _id: 'meta' });
  _setCache(docs.map(_fromDoc));
  if (meta) _meta = { last_refreshed_at: meta.last_refreshed_at || '', locale: meta.locale || '' };
  return true;
}

function all() { return _cache.map(g => Object.assign({}, g)); }
function get(key) { const g = _cache.find(x => x.key === key); return g ? Object.assign({}, g) : null; }
function meta() { return Object.assign({}, _meta); }

// A refresh's Apply: upsert whole documents, delete the leavers, record when.
// Throws if the database write fails, in which case the cache is untouched.
async function applyChanges({ upserts, removals, meta }) {
  const ups = upserts || [];
  const rem = removals || [];
  const db = await _db();
  if (db) {
    const ops = ups.map(g => ({ replaceOne: { filter: { _id: g.key }, replacement: _toDoc(g), upsert: true } }))
      .concat(rem.map(key => ({ deleteOne: { filter: { _id: key } } })));
    if (ops.length) await db.collection('psplus_catalog').bulkWrite(ops, { ordered: false });
    if (meta) {
      await db.collection('psplus_catalog_meta').replaceOne({ _id: 'meta' }, Object.assign({ _id: 'meta' }, meta), { upsert: true });
    }
  }
  const byKey = new Map(_cache.map(g => [g.key, g]));
  rem.forEach(key => byKey.delete(key));
  ups.forEach(g => byKey.set(g.key, Object.assign({}, g)));
  _cache = [...byKey.values()];
  if (meta) _meta = { last_refreshed_at: meta.last_refreshed_at || '', locale: meta.locale || '' };
  return true;
}

// The owner's own choices on one game. Only OWNER_FIELDS are ever written, so
// nothing PlayStation sends can be changed from here. False when there is no
// such game.
async function setOwnerFields(key, patch) {
  if (!isKey(key)) return false;
  const current = _cache.find(g => g.key === key);
  if (!current) return false;
  const clean = {};
  OWNER_FIELDS.forEach(f => { if (patch && f in patch) clean[f] = patch[f]; });
  if (!Object.keys(clean).length) return false;
  const db = await _db();
  if (db) {
    const r = await db.collection('psplus_catalog').updateOne({ _id: key }, { $set: clean });
    if (!r || r.matchedCount === 0) return false;
  }
  Object.assign(current, clean);
  return true;
}

// A game on the owner's accounts that PlayStation's feed doesn't list.
// Refreshes never touch it. Returns the stored game.
async function addManual({ name, list, platforms, cover_override }, nowIso) {
  const title = String(name || '').trim();
  if (!title || !STORED_LISTS.includes(list)) return null;
  const next = _cache.filter(g => /^m:\d+$/.test(g.key)).reduce((n, g) => Math.max(n, Number(g.key.slice(2))), 0) + 1;
  const now = nowIso || new Date().toISOString();
  const game = Object.assign({}, OWNER_DEFAULTS, {
    key: 'm:' + next, source: 'manual', concept_id: '', name: title, name_raw: title, lists: [list],
    image_url: '', platforms: ['PS5', 'PS4'].filter(p => (platforms || []).includes(p)), genres: [], release_date: '',
    store_url: '', first_seen_at: now, updated_at: now, cover_override: cover_override || ''
  });
  const db = await _db();
  if (db) await db.collection('psplus_catalog').replaceOne({ _id: game.key }, _toDoc(game), { upsert: true });
  _cache.push(Object.assign({}, game));
  return Object.assign({}, game);
}

// Only hand-added games can be removed by hand; PlayStation's leave on refresh.
async function removeManual(key) {
  if (!/^m:\d+$/.test(String(key || ''))) return false;
  if (!_cache.some(g => g.key === key)) return false;
  const db = await _db();
  if (db) await db.collection('psplus_catalog').deleteOne({ _id: key });
  _cache = _cache.filter(g => g.key !== key);
  return true;
}

// Tests only: start from a known state.
function _reset(games, metaDoc) {
  _setCache(games || []);
  _meta = Object.assign({ last_refreshed_at: '', locale: '' }, metaDoc || {});
}

module.exports = { init, isKey, load, all, get, meta, applyChanges, setOwnerFields, addManual, removeManual, _reset };
