// Run: node scripts/test-waitlist-slot-given-rules.js
//
// The rules behind the owner's two new Waitlist actions: "Slot given" closes a
// priority entry, so 'reserved' may now move to 'cancelled'; "Edit name" cleans
// the typed name (lib/names.js cleanFbName) and saves only fb_name, only on an
// order that is still in line (lib/orders.js setName). Runs the real setName
// against a fake Mongo collection that honours the ref + state filter.
// See docs/superpowers/specs/2026-10-24-waitlist-slot-given-and-rename-design.md.
const assert = require('assert');
const orders = require('../lib/orders');
const { cleanFbName } = require('../lib/names');

let passed = 0;
async function ok(desc, fn) { await fn(); passed++; console.log('  ok - ' + desc); }

function fakeDb(docs) {
  return {
    collection() {
      return {
        async findOne(filter) { return docs.find(d => d.ref === filter.ref) || null; },
        async updateOne(filter, update) {
          const d = docs.find(x => x.ref === filter.ref);
          const stateOk = d && (!filter.state || (filter.state.$in ? filter.state.$in.includes(d.state) : filter.state === d.state));
          if (!d || !stateOk) return { matchedCount: 0, modifiedCount: 0 };
          Object.assign(d, update.$set || {});
          return { matchedCount: 1, modifiedCount: 1 };
        }
      };
    }
  };
}

(async () => {
  await ok('a priority entry can be closed (Slot given); a free one already could', async () => {
    assert.strictEqual(orders.canTransition('reserved', 'cancelled'), true);
    assert.strictEqual(orders.canTransition('waitlisted', 'cancelled'), true);
  });

  await ok('cleanFbName trims, collapses spaces and allows 1-80 characters', async () => {
    assert.strictEqual(cleanFbName('  Adrian   Bautista '), 'Adrian Bautista');
    assert.strictEqual(cleanFbName('x'.repeat(80)), 'x'.repeat(80));
    [undefined, null, '', '   ', 'x'.repeat(81)].forEach(v => assert.strictEqual(cleanFbName(v), null, String(v)));
  });

  await ok('setName saves only fb_name on an order still in line', async () => {
    const docs = [
      { ref: 'PH-0301', state: 'waitlisted', fb_name: 'Adrian B', created_at: '2026-10-20T00:00:00Z' },
      { ref: 'PH-0302', state: 'reserved', fb_name: 'Marvin', created_at: '2026-10-22T00:00:00Z' },
      { ref: 'PH-0303', state: 'active', fb_name: 'Ana' }
    ];
    orders.init(() => fakeDb(docs));
    assert.strictEqual(await orders.setName('PH-0301', 'Adrian Bautista'), true);
    assert.deepStrictEqual(docs[0], { ref: 'PH-0301', state: 'waitlisted', fb_name: 'Adrian Bautista', created_at: '2026-10-20T00:00:00Z' });
    assert.strictEqual(await orders.setName('PH-0302', 'Marvin Reyes'), true);
    assert.strictEqual(docs[1].fb_name, 'Marvin Reyes');
    assert.strictEqual(await orders.setName('PH-0303', 'Someone Else'), false, 'not in line');
    assert.strictEqual(docs[2].fb_name, 'Ana');
    assert.strictEqual(await orders.setName('PH-9999', 'Nobody'), false, 'no such order');
    assert.strictEqual(await orders.setName('nope', 'Nobody'), false, 'not a ref');
  });

  console.log('\n' + passed + ' assertions passed\n');
})().catch(e => { console.error(e); process.exit(1); });
