// Visitor logs, bot/webhook skip counters, message taps and search misses.
//
// These used to live inside the one Mongo state document, so every new row
// re-uploaded the whole log. They are their own collections now: one small
// insert (or a $inc on the day's counter) instead of a full replacement.
// The admin pages still read the same row shape from lowdb; this module is
// the durable copy and the boot-time move out of the state document.
const crypto = require('crypto');

const CAPS = { visitors: 200000, message_taps: 50000, search_misses: 20000 };
const COLLECTIONS = {
  visitors: 'analytics_visitors',
  message_taps: 'analytics_message_taps',
  search_misses: 'analytics_search_misses',
  skips: 'analytics_skips'
};
// Long enough that the admin "all time" window stays the row cap, not the
// clock. The TTL only stops a failed cap-delete from growing forever.
const RETENTION_MS = 3 * 366 * 24 * 60 * 60 * 1000;
const CHUNK = 500;
const ROW_KINDS = ['visitors', 'message_taps', 'search_misses'];

function migrationId(kind, row, index) {
  return crypto.createHash('sha256')
    .update(kind + '\n' + index + '\n' + JSON.stringify(row))
    .digest('hex');
}

function hasAnalytics(state) {
  if (!state) return false;
  if (Array.isArray(state.visitors) && state.visitors.length) return true;
  if (Array.isArray(state.message_taps) && state.message_taps.length) return true;
  if (Array.isArray(state.search_misses) && state.search_misses.length) return true;
  const skips = state.visitor_skips;
  if (skips && typeof skips === 'object') {
    for (const key of Object.keys(skips)) {
      if (Number(skips[key]) > 0) return true;
    }
  }
  return false;
}

function trimAnalytics(state) {
  const next = Object.assign({}, state || {});
  next.visitors = [];
  next.visitor_skips = {};
  next.message_taps = [];
  next.search_misses = [];
  return next;
}

function selectHydration(local, remote) {
  const patch = {};
  const src = remote || {};
  const have = local || {};
  if (src.visitors && src.visitors.length && !(have.visitors && have.visitors.length)) patch.visitors = src.visitors;
  if (src.message_taps && src.message_taps.length && !(have.message_taps && have.message_taps.length)) patch.message_taps = src.message_taps;
  if (src.search_misses && src.search_misses.length && !(have.search_misses && have.search_misses.length)) patch.search_misses = src.search_misses;
  const localSkips = have.visitor_skips || {};
  const remoteSkips = src.visitor_skips || {};
  if (!Object.keys(localSkips).length && Object.keys(remoteSkips).length) patch.visitor_skips = remoteSkips;
  return patch;
}

function createAnalyticsStore(options) {
  const opts = options || {};
  const getDb = opts.getDb;
  const now = opts.now || Date.now;
  const caps = Object.assign({}, CAPS, opts.caps || {});
  const retentionMs = opts.retentionMs || RETENTION_MS;

  function expireAtFor(row) {
    const parsed = Date.parse(row && row.time);
    const base = Number.isFinite(parsed) ? parsed : now();
    return new Date(base + retentionMs);
  }

  async function db() {
    if (!getDb) return null;
    return getDb();
  }

  async function migrate(state) {
    const copied = { visitors: 0, message_taps: 0, search_misses: 0, skips: 0 };
    const mongo = await db();
    if (!mongo || !state) return { changed: false, copied };

    for (const kind of ROW_KINDS) {
      const rows = Array.isArray(state[kind]) ? state[kind] : [];
      const kept = rows.length > caps[kind] ? rows.slice(rows.length - caps[kind]) : rows;
      if (!kept.length) continue;
      const col = await mongo.collection(COLLECTIONS[kind]);
      for (let offset = 0; offset < kept.length; offset += CHUNK) {
        const slice = kept.slice(offset, offset + CHUNK);
        const ops = slice.map((row, j) => {
          const index = offset + j;
          const body = Object.assign({}, row, { ord: index, expireAt: expireAtFor(row) });
          delete body._id;
          return {
            updateOne: {
              filter: { _id: migrationId(kind, row, index) },
              update: { $setOnInsert: body },
              upsert: true
            }
          };
        });
        await col.bulkWrite(ops, { ordered: false });
      }
      copied[kind] = kept.length;
    }

    const skips = state.visitor_skips && typeof state.visitor_skips === 'object' ? state.visitor_skips : {};
    const days = Object.keys(skips).filter(day => Number(skips[day]) > 0);
    if (days.length) {
      const col = await mongo.collection(COLLECTIONS.skips);
      for (const day of days) {
        // $max, not $set: a counter that already moved forward during a
        // retried boot must not be wound back to the snapshot.
        await col.updateOne(
          { _id: day },
          { $max: { count: Number(skips[day]) }, $setOnInsert: { day } },
          { upsert: true }
        );
      }
      copied.skips = days.length;
    }

    const changed = copied.visitors + copied.message_taps + copied.search_misses + copied.skips > 0;
    return { changed, copied };
  }

  async function addRows(kind, rows) {
    if (!ROW_KINDS.includes(kind) || !rows || !rows.length) return;
    const mongo = await db();
    if (!mongo) return;
    const col = await mongo.collection(COLLECTIONS[kind]);
    const docs = rows.map(row => {
      const body = Object.assign({}, row, { expireAt: expireAtFor(row) });
      if (!body._id) body._id = crypto.randomBytes(12).toString('hex');
      return body;
    });
    if (docs.length === 1) await col.insertOne(docs[0]);
    else await col.insertMany(docs, { ordered: false });
  }

  async function incSkip(day, by) {
    const n = by == null ? 1 : by;
    if (!day || !n) return;
    const mongo = await db();
    if (!mongo) return;
    const col = await mongo.collection(COLLECTIONS.skips);
    await col.updateOne(
      { _id: day },
      { $inc: { count: n }, $setOnInsert: { day } },
      { upsert: true }
    );
  }

  async function dropOlderThan(kind, timeIso) {
    if (!ROW_KINDS.includes(kind) || !timeIso) return;
    const mongo = await db();
    if (!mongo) return;
    const col = await mongo.collection(COLLECTIONS[kind]);
    await col.deleteMany({ time: { $lt: timeIso } });
  }

  function publicRow(doc) {
    const row = Object.assign({}, doc);
    delete row._id;
    delete row.expireAt;
    delete row.ord;
    return row;
  }

  function byAge(a, b) {
    const at = a.time || '';
    const bt = b.time || '';
    if (at < bt) return -1;
    if (at > bt) return 1;
    return (a.ord || 0) - (b.ord || 0);
  }

  async function loadRows(mongo, kind) {
    const col = await mongo.collection(COLLECTIONS[kind]);
    const cursor = col.find({});
    // Newest rows only. Ascending + limit would keep the oldest instead.
    const docs = await cursor.sort({ time: -1 }).limit(caps[kind]).toArray();
    docs.sort(byAge);
    return docs.map(publicRow);
  }

  async function hydrate() {
    const mongo = await db();
    if (!mongo) return null;
    const visitors = await loadRows(mongo, 'visitors');
    const message_taps = await loadRows(mongo, 'message_taps');
    const search_misses = await loadRows(mongo, 'search_misses');
    const skipCol = await mongo.collection(COLLECTIONS.skips);
    const skipDocs = await (await skipCol.find({})).toArray();
    const visitor_skips = {};
    skipDocs.forEach(doc => {
      if (doc && doc._id != null && Number(doc.count) > 0) visitor_skips[doc._id] = Number(doc.count);
    });
    return { visitors, message_taps, search_misses, visitor_skips };
  }

  async function ensureIndexes() {
    const mongo = await db();
    if (!mongo) return;
    for (const kind of ROW_KINDS) {
      const col = await mongo.collection(COLLECTIONS[kind]);
      await col.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
      await col.createIndex({ time: 1 });
    }
  }

  return { migrate, addRows, incSkip, dropOlderThan, hydrate, ensureIndexes };
}

module.exports = {
  createAnalyticsStore,
  trimAnalytics,
  selectHydration,
  hasAnalytics,
  migrationId,
  CAPS,
  COLLECTIONS,
  RETENTION_MS
};
