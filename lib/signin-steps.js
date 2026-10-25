// Customer sign-in and return steps for /how-to-sign-in, the order page, and
// the HowTo JSON-LD on that page. One list per console, in poster order.
// PREVIOUS_STEPS is the menu path this replaced. server.js rewrites a stored
// list only when it is still that old default, so an edited guide is left alone.

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

// Empty, or still the old default menu path: write the poster steps.
// Anything else was edited in admin and stays as the owner left it.
function syncDecision(existing) {
  const rows = Array.isArray(existing) ? existing : [];
  if (!rows.length || matchesCatalog(rows, PREVIOUS_STEPS)) {
    return { replace: true, steps: STEPS };
  }
  return { replace: false, steps: null };
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

module.exports = { STEPS, PREVIOUS_STEPS, matchesCatalog, syncDecision, howToBlocks };
