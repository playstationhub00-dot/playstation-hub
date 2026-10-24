#!/usr/bin/env node
// Rename mistyped game titles in the production data.
//
// The four URL families (Assasins, Calisto, Berseker, Triology) are also
// renamed when the server boots, in the catalogue blob only. This script is
// the full pass: those four, plus NBA2K27, Silent Hill Townfall, and
// afdordable, including orders and the request board. It is not part of boot.
//
// Game names, upcoming titles, reviews and customer game_title fields live in
// MongoDB, database `pshub`, collection `state`, document `_id: "db"`, field
// `data`. scripts/preload.js copies that blob into games.json when the server
// boots. Orders (`orders.game_title`) and the request board
// (`game_requests.title`) are their own collections. None of this is in git.
// Order and game ids are never changed.
//
// Dry-run is the default. Nothing is written unless you pass --apply.
//
//   node scripts/rename-game-titles.js
//   node scripts/rename-game-titles.js --file /path/to/games.json
//   node scripts/rename-game-titles.js --apply
//
// --file reads a games.json blob (or a mongo state document shaped
// { _id: "db", data: { ... } }) instead of connecting. Without --file the
// script uses MONGODB_URI, same as scripts/preload.js.
//
// What it changes
//   Resident Evil Remake Triology  -> Resident Evil Remake Trilogy
//   Khazan The First Berseker       -> Khazan The First Berserker
//   Assasins Creed Shadows          -> Assassins Creed Shadows
//   (any "w/ DLC" or other suffix on that title is kept)
//   Calisto Protocol                -> Callisto Protocol
//   Silent Hill TownFall            -> Silent Hill: Townfall
//   NBA2K27                         -> NBA 2K27
//   afdordable (in review text)     -> affordable
//   The same misspellings inside descriptions and games_list lines.
//
// What it does not change
//   Slugs stored on a document (request board URLs are /requests#req-<slug>).
//   Prices, order state, accounts, images.
//   A person's name, even if it contains a similar string.
//
// Idempotent: titles that are already correct are skipped. A second --apply
// reports 0 changes.
//
// Restart required after a Mongo --apply. A running server holds games.json
// in memory and the next save overwrites the state document with that copy.
// Stop the app, run --apply, then start it so preload.js loads the corrected
// blob. Old /game/, /upcoming/, and /bundle/ URLs 301 to the corrected
// public slug (lib/title-fixes.js). The Silent Hill slug does not change.
// NBA2K27 stays at /game/nba2k27 until this script renames the title.

const fs = require('fs');
const path = require('path');
const fixes = require('../lib/title-fixes');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] || null);
}

function unwrap(doc) {
  if (doc && doc.data && typeof doc.data === 'object' && !Array.isArray(doc.data)
      && (doc.data.games || doc.data.upcoming || doc.data.reviews || doc.data.customers)) {
    return { wrapped: true, state: doc.data };
  }
  return { wrapped: false, state: doc || {} };
}

function wrap(original, wrapped, state) {
  if (!wrapped) return state;
  return Object.assign({}, original, { data: state });
}

async function fixCollection(db, name, field) {
  const col = db.collection(name);
  const docs = await col.find({}).toArray();
  const changes = [];
  for (const doc of docs) {
    if (!doc || typeof doc[field] !== 'string') continue;
    const next = fixes.fixString(doc[field]);
    if (next === doc[field]) continue;
    changes.push({ path: name + '/' + String(doc._id) + '.' + field, from: doc[field], to: next });
    if (process.argv.includes('--apply')) {
      await col.updateOne({ _id: doc._id }, { $set: { [field]: next } });
    }
  }
  return changes;
}

function printChanges(changes) {
  changes.forEach(c => {
    console.log('  ' + c.path);
    console.log('    - ' + c.from);
    console.log('    + ' + c.to);
  });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const file = argValue('--file');
  let changes = [];

  if (file) {
    const abs = path.resolve(file);
    const original = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const { wrapped, state } = unwrap(original);
    const result = fixes.applyToState(state);
    changes = result.changes;
    printChanges(changes);
    if (apply) {
      fs.writeFileSync(abs, JSON.stringify(wrap(original, wrapped, result.state)));
    }
  } else {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error('No --file and no MONGODB_URI. Nothing was changed.');
      console.error('Usage: node scripts/rename-game-titles.js [--file games.json] [--apply]');
      process.exit(1);
    }
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    try {
      const db = client.db('pshub');
      const doc = await db.collection('state').findOne({ _id: 'db' });
      if (!doc || !doc.data) {
        console.error('No state document at pshub.state _id "db". Nothing was changed.');
        process.exit(1);
      }
      const result = fixes.applyToState(doc.data);
      changes = result.changes.map(c => ({ path: 'state.data.' + c.path, from: c.from, to: c.to }));
      if (apply && result.changes.length) {
        await db.collection('state').updateOne({ _id: 'db' }, { $set: { data: result.state } });
      }
      const requests = await fixCollection(db, 'game_requests', 'title');
      const orders = await fixCollection(db, 'orders', 'game_title');
      changes = changes.concat(requests, orders);
      printChanges(changes);
    } finally {
      await client.close();
    }
  }

  const n = changes.length;
  if (apply) {
    console.log('applied: ' + n + ' change' + (n === 1 ? '' : 's') + '.');
    if (!file && n) {
      console.log('Restart the app so it reloads this blob. A running server will overwrite state on its next save.');
    }
  } else {
    console.log('dry-run: ' + n + ' change' + (n === 1 ? '' : 's') + '. Re-run with --apply to write. No files were modified.');
  }
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
