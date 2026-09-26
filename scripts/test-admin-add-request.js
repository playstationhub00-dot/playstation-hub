// Run: node scripts/test-admin-add-request.js
//
// POST /admin/requests/add: logs a game someone asked for over Messenger,
// never through the public /requests form, as an already-fulfilled request —
// so it counts toward "you asked, we stocked" and shows under Now available
// like any request the owner actually stocked.
//
// Two halves:
//   1. Source-level checks that the route is wired the way this test's
//      behavioral half assumes (same style as scripts/test-release-wiring.js).
//   2. A behavioral test running the exact lib/requests.js call sequence the
//      route makes, against a fake in-memory Mongo collection, proving the
//      composition actually produces a stocked, linked, voted-for request —
//      not just that the right function names appear in the diff.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const requests = require('../lib/requests');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }
async function okAsync(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
function block(startMarker) {
  const i = SRC.indexOf(startMarker);
  assert.ok(i >= 0, 'server.js still has ' + startMarker);
  const next = SRC.indexOf('\napp.', i + startMarker.length);
  return SRC.slice(i, next > 0 ? next : undefined);
}
const ROUTE = block("app.post('/admin/requests/add', requireAuth,");

console.log('\nwiring');

ok('the route requires auth, like every other admin request action', () => {
  assert.ok(ROUTE.includes("requireAuth, async (req, res) =>"));
});

ok('a missing title or Facebook name is rejected before touching the database', () => {
  assert.ok(ROUTE.includes("if (!title || !fb_name) return res.redirect('/admin?tab=games&msg=request_add_missing');"));
});

ok('creates the request, falls back to the existing slug, and adds a vote only on the exists branch', () => {
  assert.ok(ROUTE.includes('gameRequests.createRequest('));
  assert.ok(ROUTE.includes("created.reason !== 'exists'"));
  assert.ok(ROUTE.includes('gameRequests.addVote(slug'));
});

ok("always ends by marking the request 'stocked' with the chosen game_id", () => {
  assert.ok(ROUTE.includes("gameRequests.setStatus(slug, 'stocked', { game_id: validGameId });"));
});

ok('inherits the linked game\'s cover only when the request has none yet', () => {
  assert.ok(ROUTE.includes('if (validGameId) {'));
  assert.ok(ROUTE.includes('!existing.cover_image'));
  assert.ok(ROUTE.includes('gameRequests.setCoverImage(slug'));
});

ok('the toolbar form in the admin Requests panel posts here', () => {
  const partial = fs.readFileSync(path.join(ROOT, 'views', 'partials', 'admin', 'games', 'requests.ejs'), 'utf8');
  assert.ok(partial.includes('action="/admin/requests/add"'));
  assert.ok(partial.includes('name="title"'));
  assert.ok(partial.includes('name="fb_name"'));
  assert.ok(partial.includes('name="game_id"'));
});

ok('the toasts and their tab routing are registered', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'views', 'admin.ejs'), 'utf8');
  ['request_added', 'request_add_missing', 'request_add_error'].forEach(m => {
    assert.ok(admin.includes(m + ":'games'"), m + ' tab routing');
    assert.ok(new RegExp(m + ":'[^']+'").test(admin), m + ' toast text');
  });
});

// A minimal in-memory Mongo collection: enough of insertOne/findOne/updateOne
// to drive lib/requests.js's real functions, including the unique-slug
// collision (11000) createRequest relies on.
function fakeCollection() {
  const docs = new Map();
  return {
    async insertOne(doc) {
      if (docs.has(doc.slug)) { const e = new Error('dup'); e.code = 11000; throw e; }
      docs.set(doc.slug, Object.assign({}, doc));
    },
    async findOne(filter) {
      const d = docs.get(filter.slug);
      return d ? Object.assign({}, d) : null;
    },
    async find(filter) {
      const all = [...docs.values()];
      const rows = filter && filter.status && filter.status.$in
        ? all.filter(d => filter.status.$in.includes(d.status))
        : all;
      return { toArray: async () => rows.map(d => Object.assign({}, d)) };
    },
    async updateOne(filter, update) {
      const d = docs.get(filter.slug);
      if (!d) return { matchedCount: 0 };
      if (update.$set) Object.assign(d, update.$set);
      if (update.$push) {
        Object.keys(update.$push).forEach(k => {
          d[k] = (d[k] || []).concat([update.$push[k]]);
        });
      }
      return { matchedCount: 1 };
    },
    async findOneAndUpdate(filter, update, opts) {
      const d = docs.get(filter.slug);
      if (!d) return null;
      if (filter.voters && filter.voters.$not) {
        const clauses = filter.voters.$not.$elemMatch.$or;
        const dup = (d.voters || []).some(v => clauses.some(c =>
          (c.session_id && v.session_id === c.session_id) ||
          (c.fb_name && new RegExp(c.fb_name.$regex, 'i').test(v.fb_name))
        ));
        if (dup) return null;
      }
      if (update.$push) {
        Object.keys(update.$push).forEach(k => { d[k] = (d[k] || []).concat([update.$push[k]]); });
      }
      if (update.$set) Object.assign(d, update.$set);
      return opts && opts.returnDocument === 'after' ? Object.assign({}, d) : { value: Object.assign({}, d) };
    }
  };
}

console.log('\nbehavior — the exact call sequence the route makes');

(async () => {
  await okAsync('a brand-new title ends up stocked, linked, with the Messenger customer as its voter', async () => {
    const col = fakeCollection();
    requests.init(async () => ({ collection: () => col }));

    const created = await requests.createRequest({ title: 'Ghost of Yotei', fb_name: 'Ana Cruz', session_id: null, cover_image: '' });
    assert.strictEqual(created.ok, true);
    await requests.setStatus(created.doc.slug, 'stocked', { game_id: 42 });

    const row = await requests.getBySlug('ghost-of-yotei');
    assert.strictEqual(row.status, 'stocked');
    assert.strictEqual(row.game_id, 42);
    assert.strictEqual(row.voters.length, 1);
    assert.strictEqual(row.voters[0].fb_name, 'Ana Cruz');
  });

  await okAsync('a title someone already requested gets the Messenger customer\'s vote added, then is stocked', async () => {
    const col = fakeCollection();
    requests.init(async () => ({ collection: () => col }));

    const first = await requests.createRequest({ title: 'Tekken 8', fb_name: 'Ben Reyes', session_id: null, cover_image: '' });
    assert.strictEqual(first.ok, true);

    // Simulates the route's exists branch: createRequest fails with 'exists',
    // so it adds a vote for the Messenger customer instead of creating a duplicate.
    const second = await requests.createRequest({ title: 'Tekken 8', fb_name: 'Cai Lim', session_id: null, cover_image: '' });
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.reason, 'exists');
    await requests.addVote(second.slug, { fb_name: 'Cai Lim', session_id: null });
    await requests.setStatus(second.slug, 'stocked', { game_id: 7 });

    const row = await requests.getBySlug('tekken-8');
    assert.strictEqual(row.status, 'stocked');
    assert.strictEqual(row.game_id, 7);
    assert.deepStrictEqual(row.voters.map(v => v.fb_name), ['Ben Reyes', 'Cai Lim']);
  });

  await okAsync('no linked game leaves game_id null rather than throwing', async () => {
    const col = fakeCollection();
    requests.init(async () => ({ collection: () => col }));

    const created = await requests.createRequest({ title: 'Silent Hill f', fb_name: 'Dee Santos', session_id: null, cover_image: '' });
    await requests.setStatus(created.doc.slug, 'stocked', { game_id: null });

    const row = await requests.getBySlug('silent-hill-f');
    assert.strictEqual(row.status, 'stocked');
    assert.strictEqual(row.game_id, null);
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
