// Covers resolved for the owner's monthly picks that aren't one of our stored
// PS Plus games (lib/psplus-title-search.js finds them by title). Its own
// collection, keyed by lib/psplus-catalog.js's matchKey(title), so the same
// title typed slightly differently in two different months still reuses one
// resolved cover. Not found is cached too (image_url: ''), so a title that
// genuinely has no match isn't re-searched on every fetch.
let _getDb = null;
let _cache = new Map();

function init(getDbFn) { _getDb = getDbFn; }

async function _db() {
  if (!_getDb) throw new Error('lib/psplus-monthly-covers-store: init(getDb) was never called');
  return _getDb();
}

async function load() {
  const db = await _db();
  if (!db) return false;
  const docs = await db.collection('psplus_monthly_covers').find({}).toArray();
  _cache = new Map(docs.map(d => [d._id, { title: d.title, image_url: d.image_url || '', store_url: d.store_url || '', resolved_at: d.resolved_at || '' }]));
  return true;
}

function all() { return new Map(_cache); }
function get(key) { return _cache.get(key) || null; }

// Saves what searchCover found (or didn't) for one title. Never removes an
// entry — a later successful search for the same key just overwrites it.
async function set(key, { title, image_url, store_url, resolved_at }) {
  const doc = { title: title || '', image_url: image_url || '', store_url: store_url || '', resolved_at: resolved_at || new Date().toISOString() };
  const db = await _db();
  if (db) await db.collection('psplus_monthly_covers').replaceOne({ _id: key }, Object.assign({ _id: key }, doc), { upsert: true });
  _cache.set(key, doc);
  return true;
}

// Tests only.
function _reset(entries) { _cache = new Map(entries || []); }

module.exports = { init, load, all, get, set, _reset };
