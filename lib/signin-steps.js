// Customer sign-in and return steps for /how-to-sign-in, the order page, and
// the HowTo JSON-LD on that page. One list per console, in poster order.
// apply() is the one-time boot migration: a stored guide that still has the
// old PS5 path, or that otherwise differs from these steps, is replaced once.
// The migrations flag then stops a later boot from putting the poster back
// over an edit made in admin.

const STEPS = [
  { console: 'ps5', text: 'On your PS5, select your profile picture, then choose Switch User → Add User → Get Started.' },
  { console: 'ps5', text: 'A QR code appears. Take a photo of it and send it to us on Messenger right away. It expires in about 10 minutes.' },
  { console: 'ps5', text: 'Trophy accounts: on our account, go to Settings → Users and Accounts → Other → Console Sharing and Offline Play → Enable.' },
  { console: 'ps5', text: 'When you return a Trophy account, disable Console Sharing first: Settings → Users and Accounts → Other → Console Sharing and Offline Play → Disable.' },
  { console: 'ps5', text: 'Sign out on every account type: Settings → Users and Accounts → Other → Sign Out. Send us a screenshot of the signed-out account.' },
  { console: 'ps4', text: 'On your PS4, press the PS button, then Power → Switch User → New User → Create a User. Follow the prompts until the QR code appears.' },
  { console: 'ps4', text: 'Take a photo of the QR code and send it to us on Messenger right away. It expires in about 10 minutes.' },
  { console: 'ps4', text: 'PS4 Primary accounts: go to Settings → Account Management → Activate as Your Primary PS4 → Activate. Non-Trophy accounts: choose Do Not Activate if you are prompted.' },
  { console: 'ps4', text: 'When you return a PS4 Primary account, deactivate Primary first: Settings → Account Management → Activate as Your Primary PS4 → Deactivate.' },
  { console: 'ps4', text: 'Sign out on every account type: Settings → Account Management → Sign Out. Send us a screenshot of the signed-out account.' }
];

const MIGRATION_ID = 'signin-poster-steps-2026-10-25';

// Phrases that only appear on the retired PS5 path. A hand-edited list can
// carry these without matching the original three-step default.
const OUTDATED_PS5 = ['Sign in with PS App', 'Users and Accounts → Users'];

const PREVIOUS_STEPS = [
  { console: 'ps5', text: 'On your PS5, go to Settings → Users and Accounts → Users' },
  { console: 'ps5', text: 'Select your profile, then choose "Sign in with PS App" so the QR code appears on screen' },
  { console: 'ps5', text: 'Take a photo of the QR code and send it to us' },
  { console: 'ps4', text: 'On your PS4, go to Settings → Login Settings → Sign In' },
  { console: 'ps4', text: 'Choose "Sign in with QR Code" so the QR code appears on screen' },
  { console: 'ps4', text: 'Take a photo of the QR code and send it to us' }
];

function textsFor(steps, consoleName) {
  return (steps || [])
    .filter(s => s && s.console === consoleName)
    .slice()
    .sort((a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0))
    .map(s => String(s.text || '').trim());
}

function matchesCatalog(steps, catalog) {
  if (!Array.isArray(steps) || !steps.length) return false;
  if (steps.some(s => !s || (s.console !== 'ps5' && s.console !== 'ps4'))) return false;
  return ['ps5', 'ps4'].every(consoleName => {
    const want = catalog.filter(s => s.console === consoleName).map(s => s.text);
    const got = textsFor(steps, consoleName);
    return want.length === got.length && want.every((text, i) => got[i] === text);
  });
}

function ps5HasOutdatedPath(steps) {
  return textsFor(steps, 'ps5').some(text => OUTDATED_PS5.some(marker => text.includes(marker)));
}

function nextStepId(state, steps) {
  let n = Number(state && state.nextSigninStepId);
  if (!Number.isFinite(n) || n < 1) n = 1;
  (Array.isArray(steps) ? steps : []).forEach(step => {
    const id = Number(step && step.id);
    if (Number.isFinite(id) && id >= n) n = id + 1;
  });
  return n;
}

function posterRecords(startId, createdAt) {
  let id = startId;
  const rows = STEPS.map(step => {
    const rank = STEPS.filter(item => item.console === step.console).indexOf(step);
    return {
      id: id++,
      console: step.console,
      rank,
      text: step.text,
      image: null,
      created_at: createdAt
    };
  });
  return { rows, nextId: id };
}

// One boot write. write is false when the flag is already stored, or when
// migrations is not a list. Otherwise the flag is recorded, and the stored
// steps are replaced when a PS5 row still uses the old menu or the list is
// not already the poster.
function apply(state, nowIso) {
  const safe = state && typeof state === 'object' ? state : {};
  const existingMigrations = safe.migrations;
  const stepsIn = safe.signin_steps;
  if (existingMigrations != null && !Array.isArray(existingMigrations)) {
    return {
      write: false,
      replaced: false,
      signin_steps: stepsIn,
      nextSigninStepId: safe.nextSigninStepId,
      migrations: existingMigrations
    };
  }
  const migrations = Array.isArray(existingMigrations) ? existingMigrations.slice() : [];
  if (migrations.indexOf(MIGRATION_ID) !== -1) {
    return {
      write: false,
      replaced: false,
      signin_steps: stepsIn,
      nextSigninStepId: safe.nextSigninStepId,
      migrations
    };
  }
  const steps = Array.isArray(stepsIn) ? stepsIn : [];
  const createdAt = nowIso || new Date().toISOString();
  migrations.push(MIGRATION_ID);
  if (!ps5HasOutdatedPath(steps) && matchesCatalog(steps, STEPS)) {
    return {
      write: true,
      replaced: false,
      signin_steps: steps,
      nextSigninStepId: nextStepId(safe, steps),
      migrations
    };
  }
  const built = posterRecords(nextStepId(safe, steps), createdAt);
  return {
    write: true,
    replaced: true,
    signin_steps: built.rows,
    nextSigninStepId: built.nextId,
    migrations
  };
}

function howToBlocks(stepsByConsole) {
  const specs = [
    {
      key: 'ps5',
      name: 'How to sign in on a PS5 and return the account',
      description: 'Show the PS5 sign-in QR, send the photo on Messenger, enable Console Sharing for a Trophy account, and sign out when the rental ends.'
    },
    {
      key: 'ps4',
      name: 'How to sign in on a PS4 and return the account',
      description: 'Show the PS4 sign-in QR, send the photo on Messenger, activate Primary for a PS4 Primary account, and sign out when the rental ends.'
    }
  ];
  const grouped = stepsByConsole || {};
  return specs.map(spec => {
    const steps = grouped[spec.key] || [];
    return {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: spec.name,
      description: spec.description,
      step: steps.map((s, i) => ({
        '@type': 'HowToStep',
        position: i + 1,
        name: 'Step ' + (i + 1),
        text: s.text
      }))
    };
  }).filter(block => block.step.length);
}

module.exports = {
  STEPS, PREVIOUS_STEPS, MIGRATION_ID, OUTDATED_PS5,
  matchesCatalog, ps5HasOutdatedPath, apply, howToBlocks
};
