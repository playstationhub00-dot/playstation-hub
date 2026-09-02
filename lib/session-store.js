// Admin sessions that survive a restart.
//
// Two separate things kill a login when this app redeploys, and fixing either
// one alone changes nothing:
//
//   1. The signing secret was regenerated on every boot when SESSION_SECRET was
//      absent, which invalidates the signature on every existing cookie.
//   2. Sessions lived in express-session's default in-memory store, so the
//      session data itself vanished with the process.
//
// This file handles both. Railway restarts on every deploy, so the owner was
// being logged out several times an hour.
//
// Everything here fails OPEN, never closed: if MongoDB is unreachable, a read
// reports "no session" and the owner simply logs in again — exactly what
// happens today. A session store that threw would take the admin panel down
// with it, which is far worse than the problem it is solving.

const crypto = require('crypto');
const { Store } = require('express-session');

const COLLECTION = 'sessions';

// express-session needs the secret synchronously at boot, before Mongo has
// connected, so it cannot be read from the database. In preference order:
//
//   1. SESSION_SECRET — explicit, and what the owner should set.
//   2. Derived from MONGODB_URI. Stable across restarts without any setup, and
//      not in this public repo. Anyone holding MONGODB_URI already owns the whole
//      database, so deriving from it grants an attacker nothing new.
//   3. Random per boot — the old behaviour, so a machine with neither variable
//      is no worse off than before (it just logs the owner out on restart).
function resolveSecret(env) {
  const e = env || {};
  if (e.SESSION_SECRET) return { secret: e.SESSION_SECRET, source: 'env' };
  if (e.MONGODB_URI) {
    return {
      secret: crypto.createHmac('sha256', 'playstation-hub/session').update(e.MONGODB_URI).digest('hex'),
      source: 'derived'
    };
  }
  return { secret: crypto.randomBytes(32).toString('hex'), source: 'ephemeral' };
}

// getDb is the same connection getter lib/orders.js is handed — one pool for
// the whole app, not a second one just for sessions.
function createStore(getDb) {
  class MongoSessionStore extends Store {
    async _col() {
      if (typeof getDb !== 'function') return null;
      const db = await getDb();
      return db ? db.collection(COLLECTION) : null;
    }

    // Mongo drops the document once `expires` passes, so dead sessions do not
    // pile up. Reads also check expiry themselves, in case this never ran.
    async ensureIndexes() {
      const col = await this._col();
      if (!col) return false;
      await col.createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
      return true;
    }

    get(sid, cb) {
      this._col().then(async col => {
        if (!col) return cb(null, null);
        const row = await col.findOne({ _id: String(sid) });
        if (!row) return cb(null, null);
        if (row.expires && new Date(row.expires) <= new Date()) {
          // Expired but not yet swept. Treat as absent rather than serving it.
          await col.deleteOne({ _id: String(sid) }).catch(() => {});
          return cb(null, null);
        }
        let parsed = null;
        try { parsed = JSON.parse(row.data); } catch (e) { parsed = null; }
        cb(null, parsed);
      }).catch(() => cb(null, null));
    }

    set(sid, sess, cb) {
      this._col().then(async col => {
        if (!col) return cb();
        await col.updateOne(
          { _id: String(sid) },
          { $set: { data: JSON.stringify(sess), expires: expiryOf(sess) } },
          { upsert: true }
        );
        cb();
      }).catch(() => cb());
    }

    destroy(sid, cb) {
      this._col().then(async col => {
        if (col) await col.deleteOne({ _id: String(sid) });
        cb();
      }).catch(() => cb());
    }

    // Called on every request for an existing session. Only pushes the expiry
    // out — rewriting the whole document on each page view would be needless
    // write load on the admin panel.
    touch(sid, sess, cb) {
      this._col().then(async col => {
        if (col) await col.updateOne({ _id: String(sid) }, { $set: { expires: expiryOf(sess) } });
        cb();
      }).catch(() => cb());
    }
  }

  return new MongoSessionStore();
}

// Honours the cookie's own maxAge so the stored copy and the browser's copy
// expire together. Falls back to 8 hours, matching the cookie default.
function expiryOf(sess) {
  const ms = (sess && sess.cookie && sess.cookie.maxAge) || (1000 * 60 * 60 * 8);
  return new Date(Date.now() + ms);
}

module.exports = { createStore, resolveSecret, expiryOf, COLLECTION };
