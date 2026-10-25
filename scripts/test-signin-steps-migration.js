// Run: node scripts/test-signin-steps-migration.js
//
// The live guide was hand-edited, so it was not the old three-step default and
// the first sync left it alone. This boot migration replaces that list once,
// records a flag, and then leaves a later admin edit in place.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const signin = require('../lib/signin-steps');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

function row(id, consoleName, rank, text, image) {
  return { id, console: consoleName, rank, text, image: image || null, created_at: '2026-08-16T00:00:00.000Z' };
}

// What is on the live site: the old PS5 menu, plus the owner's extra photo
// step, and a PS4 list that was only partly rewritten.
const LIVE = [
  row(1, 'ps5', 0, 'On your PS5, go to Settings → Users and Accounts → Users', '/uploads/old-ps5.webp'),
  row(2, 'ps5', 1, 'Select your profile, then choose "Sign in with PS App" so the QR code appears on screen'),
  row(3, 'ps5', 2, 'Take a photo of the QR code and send it to us'),
  row(4, 'ps5', 3, 'Send us the picture of the QR code with the code shown'),
  row(5, 'ps4', 0, 'Hold the PS button, then Power, then Switch User'),
  row(6, 'ps4', 1, 'Choose New User, then Create a User'),
  row(7, 'ps4', 2, 'Take a photo of the QR code and send it to us')
];

function grouped(rows) {
  const sortByRank = (a, b) => a.rank - b.rank;
  return {
    ps5: rows.filter(s => s.console === 'ps5').sort(sortByRank),
    ps4: rows.filter(s => s.console === 'ps4').sort(sortByRank)
  };
}

ok('the hand-edited live guide is replaced with the poster, including the Messenger photo step', () => {
  const state = {
    signin_steps: LIVE.map(s => Object.assign({}, s)),
    nextSigninStepId: 8,
    migrations: ['genre-by-slug-2026-10-14']
  };
  const result = signin.apply(state, '2026-10-25T00:00:00.000Z');
  assert.strictEqual(result.write, true);
  assert.strictEqual(result.replaced, true);
  assert.deepStrictEqual(result.signin_steps.map(s => s.text), signin.STEPS.map(s => s.text));
  assert.ok(result.signin_steps.some(s => s.text.includes('Messenger') && s.text.includes('10 minutes')));
  assert.ok(!result.signin_steps.some(s => s.text.includes('Sign in with PS App')));
  assert.ok(!result.signin_steps.some(s => s.text.includes('with the code shown')));
  assert.ok(result.signin_steps.every(s => s.image === null));
  assert.deepStrictEqual(result.signin_steps.map(s => s.id), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.strictEqual(result.nextSigninStepId, 18);
  assert.ok(result.migrations.indexOf('genre-by-slug-2026-10-14') !== -1);
  assert.ok(result.migrations.indexOf(signin.MIGRATION_ID) !== -1);
  assert.strictEqual(state.signin_steps[0].text.includes('Users and Accounts → Users'), true, 'input rows are not mutated');
  assert.strictEqual(state.migrations.length, 1);
  const blocks = signin.howToBlocks(grouped(result.signin_steps));
  assert.strictEqual(blocks.length, 2);
  assert.deepStrictEqual(blocks.map(b => b['@type']), ['HowTo', 'HowTo']);
  assert.deepStrictEqual(
    blocks.flatMap(b => b.step.map(s => s.text)),
    signin.STEPS.map(s => s.text)
  );
});

ok('a list that misses the old PS5 phrase is still replaced when it is not the poster', () => {
  const drifted = signin.STEPS.map((s, i) => row(
    i + 1,
    s.console,
    signin.STEPS.filter(x => x.console === s.console).indexOf(s),
    s.console === 'ps4' && s.text.startsWith('On your PS4') ? 'Hold the PS button, then Power, then Switch User' : s.text
  ));
  const result = signin.apply({ signin_steps: drifted, nextSigninStepId: 11, migrations: [] });
  assert.strictEqual(result.replaced, true);
  assert.strictEqual(result.signin_steps.find(s => s.console === 'ps4').text, signin.STEPS.find(s => s.console === 'ps4').text);
});

ok('the original default is replaced too', () => {
  const rows = signin.PREVIOUS_STEPS.map((s, i) => row(
    i + 1,
    s.console,
    signin.PREVIOUS_STEPS.filter(x => x.console === s.console).indexOf(s),
    s.text
  ));
  const result = signin.apply({ signin_steps: rows, nextSigninStepId: 7 });
  assert.strictEqual(result.replaced, true);
  assert.strictEqual(signin.ps5HasOutdatedPath(rows), true);
  assert.deepStrictEqual(result.signin_steps.map(s => s.text), signin.STEPS.map(s => s.text));
});

ok('a guide that is already the poster only records the flag', () => {
  const rows = signin.STEPS.map((s, i) => row(
    i + 1,
    s.console,
    signin.STEPS.filter(x => x.console === s.console).indexOf(s),
    s.text,
    i === 1 ? '/uploads/qr.webp' : null
  ));
  const result = signin.apply({ signin_steps: rows, nextSigninStepId: 11, migrations: [] }, '2026-10-25T00:00:00.000Z');
  assert.strictEqual(result.write, true);
  assert.strictEqual(result.replaced, false);
  assert.strictEqual(result.signin_steps, rows);
  assert.strictEqual(result.signin_steps[1].image, '/uploads/qr.webp');
  assert.strictEqual(result.nextSigninStepId, 11);
  assert.deepStrictEqual(result.migrations, [signin.MIGRATION_ID]);
});

ok('the flag stops a second boot from overwriting an admin edit', () => {
  const first = signin.apply({ signin_steps: LIVE, nextSigninStepId: 8, migrations: [] }, '2026-10-25T00:00:00.000Z');
  const edited = first.signin_steps.map(s => (
    s.console === 'ps5' && s.rank === 0 ? Object.assign({}, s, { text: 'Owner rewrote the first PS5 step' }) : s
  ));
  const second = signin.apply({
    signin_steps: edited,
    nextSigninStepId: first.nextSigninStepId,
    migrations: first.migrations
  });
  assert.strictEqual(second.write, false);
  assert.strictEqual(second.replaced, false);
  assert.strictEqual(second.signin_steps, edited);
  assert.strictEqual(second.signin_steps[0].text, 'Owner rewrote the first PS5 step');
});

ok('an empty guide is seeded once, and a cleared guide stays cleared after the flag', () => {
  const seeded = signin.apply({ signin_steps: [], nextSigninStepId: 1, migrations: [] }, '2026-10-25T00:00:00.000Z');
  assert.strictEqual(seeded.replaced, true);
  assert.strictEqual(seeded.signin_steps.length, signin.STEPS.length);
  const cleared = signin.apply({
    signin_steps: [],
    nextSigninStepId: seeded.nextSigninStepId,
    migrations: seeded.migrations
  });
  assert.strictEqual(cleared.write, false);
  assert.deepStrictEqual(cleared.signin_steps, []);
});

ok('a migrations value that is not a list is left untouched', () => {
  const steps = [row(1, 'ps5', 0, 'Select your profile, then choose "Sign in with PS App"')];
  const result = signin.apply({ signin_steps: steps, migrations: 'nope' });
  assert.strictEqual(result.write, false);
  assert.strictEqual(result.signin_steps, steps);
  assert.strictEqual(result.migrations, 'nope');
});

ok('boot runs the migration once, after the Mongo write hook', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const sync = fs.readFileSync(path.join(__dirname, '..', 'lib', 'state-sync.js'), 'utf8');
  const hook = server.indexOf('db.write = function()');
  const call = server.indexOf('signinStepsLib.apply(');
  assert.ok(hook > 0 && call > hook, 'apply runs after db.write schedules the Mongo sync');
  assert.strictEqual(server.split('signinStepsLib.apply(').length, 2, 'the migration is called once');
  assert.ok(server.includes(".set('signin_steps', poster.signin_steps)"));
  assert.ok(server.includes(".set('migrations', poster.migrations)"));
  assert.ok(server.includes('.write();'));
  assert.ok(!server.includes('syncDecision'), 'the old every-boot sync is gone');
  assert.ok(!sync.includes('signin_steps'), 'sign-in steps stay on the critical sync, not the deferred one');
  const route = server.indexOf("app.get('/how-to-sign-in'");
  const ld = server.indexOf('signinJsonLd: signinStepsLib.howToBlocks(signinSteps)', route);
  assert.ok(ld > route, '/how-to-sign-in builds HowTo JSON-LD from the stored steps');
});

console.log('\n' + passed + ' assertions passed\n');
