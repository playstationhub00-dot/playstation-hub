// One MongoClient for the whole app, connected once and reused forever — the
// officially recommended MongoDB Node driver pattern. The driver's own
// background server monitoring already detects and recovers from a dropped
// connection; pinging before every call (the approach this replaces, which
// used to live inline in server.js as _getMongoDb) duplicated that work at
// the cost of an extra round-trip on every single call. That was the actual
// cause of every MongoDB-backed page (orders, game requests, admin sessions)
// rendering slower and far more inconsistently than the pages that never
// touch it — see docs/superpowers/specs/2026-09-22-requests-page-ttfb-design.md.
function createConnection(env, MongoClientCtor) {
  let client = null;
  let connectPromise = null;

  async function getDb() {
    const uri = (env || {}).MONGODB_URI;
    if (!uri) return null;
    if (!client) {
      // Two requests arriving before the first connect() resolves must not
      // each start their own MongoClient — the second construction would
      // silently leak the first's half-open connection. Sharing one
      // in-flight promise makes every concurrent caller await the SAME
      // connect attempt instead of racing.
      if (!connectPromise) {
        const c = new MongoClientCtor(uri, { serverSelectionTimeoutMS: 8000 });
        connectPromise = c.connect()
          .then(() => {
            client = c;
            console.log('[mongo] Connected to MongoDB Atlas');
            return c;
          })
          .catch(e => {
            // A failed initial connect must not leave connectPromise pointing
            // at a rejected promise forever — the next getDb() call needs to
            // retry construction from scratch, not reuse a dead attempt.
            connectPromise = null;
            throw e;
          });
      }
      await connectPromise;
    }
    return client.db('pshub');
  }

  // Exposed for the caller that already resets on a real operation failure
  // (server.js's syncToMongo) — that behaviour is kept, just retargeted at
  // this module instead of a module-level variable in server.js.
  function reset() {
    client = null;
    connectPromise = null;
  }

  return { getDb, reset };
}

module.exports = { createConnection };
