// Runs before server.js starts (via npm prestart).
// Downloads saved data from MongoDB Atlas and writes it to games.json
// so lowdb picks it up on startup.
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.log('[preload] No MONGODB_URI — skipping restore');
  process.exit(0);
}

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..');
const gamesJsonPath = path.join(dataDir, 'games.json');

(async () => {
  let client;
  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const doc = await client.db('pshub').collection('state').findOne({ _id: 'db' });
    if (doc && doc.data) {
      fs.writeFileSync(gamesJsonPath, JSON.stringify(doc.data));
      console.log('[preload] ✅ Data restored from MongoDB →', gamesJsonPath);
    } else {
      console.log('[preload] No saved data found in MongoDB — using defaults');
    }
  } catch (e) {
    console.log('[preload] ⚠️ MongoDB restore failed:', e.message);
  } finally {
    if (client) await client.close();
    process.exit(0);
  }
})();
