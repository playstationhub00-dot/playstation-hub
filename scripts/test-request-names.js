// Run: node scripts/test-request-names.js
// One Save on a request renames every name together, including a swap.
const assert = require('assert');
const { planVoterRenames } = require('../lib/requests');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const voters = [
  { fb_name: 'Ana Cruz', at: 'a', session_id: 's1' },
  { fb_name: 'Ben Reyes', at: 'b', session_id: 's2' }
];

ok('renames every posted name and keeps the session id', () => {
  const plan = planVoterRenames(voters, [
    { at: 'a', fb_name: 'Ana C.' },
    { at: 'b', fb_name: 'Ben R.' }
  ]);
  assert.strictEqual(plan.ok, true);
  assert.deepStrictEqual(plan.voters.map(v => v.fb_name), ['Ana C.', 'Ben R.']);
  assert.strictEqual(plan.voters[0].session_id, 's1');
  assert.deepStrictEqual(voters.map(v => v.fb_name), ['Ana Cruz', 'Ben Reyes']);
});

ok('a swap of two names is not a duplicate', () => {
  const plan = planVoterRenames(voters, [
    { at: 'a', fb_name: 'Ben Reyes' },
    { at: 'b', fb_name: 'Ana Cruz' }
  ]);
  assert.strictEqual(plan.ok, true);
  assert.deepStrictEqual(plan.voters.map(v => v.fb_name), ['Ben Reyes', 'Ana Cruz']);
});

ok('a blank name and a repeated name are refused', () => {
  assert.strictEqual(planVoterRenames(voters, [{ at: 'a', fb_name: '  ' }]).reason, 'empty');
  assert.strictEqual(planVoterRenames(voters, [
    { at: 'a', fb_name: 'Same' },
    { at: 'b', fb_name: 'same' }
  ]).reason, 'duplicate');
  assert.strictEqual(planVoterRenames(voters, [{ at: 'missing', fb_name: 'Nope' }]).reason, 'no_voter');
});

console.log('\n' + passed + ' assertions passed\n');
