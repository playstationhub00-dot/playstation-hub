// Message templates the owner copies into Messenger. Substitution lives here
// rather than in the view so the conditional rules — which return steps apply,
// whether a deposit line appears at all — are testable without a browser.
//
// Two tokens are conditional on the rental's account type:
//   {return_steps}  PS4 Primary is NOT a variant of Trophy: it deactivates a
//                   primary console rather than disabling console sharing.
//   {deposit_line}  Resolves to an empty string when no deposit was charged,
//                   so a Non-Trophy message has no sentence at all rather than
//                   one reading "P0".

const TYPE_LABELS = { tr: 'Trophy', nt: 'Non-Trophy', ps4: 'PS4 Primary' };

// Trophy and PS4 Primary carry the deposit; Non-Trophy never does. Mirrors the
// same rule in server.js's rent-total math.
function hasDeposit(accountType) {
  return accountType === 'tr' || accountType === 'ps4';
}

function returnStepsFor(templates, accountType) {
  if (accountType === 'tr') return templates.return_steps_tr || '';
  if (accountType === 'ps4') return templates.return_steps_ps4 || '';
  return templates.return_steps_nt || '';
}

function formatDate(ymd) {
  if (!ymd) return '';
  const d = new Date(ymd + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function render(templateText, customer, templates, opts) {
  if (!templateText) return '';
  const o = opts || {};
  const deposit = o.deposit != null ? o.deposit : 100;
  const c = customer || {};
  const type = c.account_type;

  const depositLine = hasDeposit(type)
    ? String(templates.deposit_line || '').replace(/\{deposit\}/g, String(deposit))
    : '';

  const values = {
    name: c.customer_name || '',
    game: c.game_title || '',
    type: TYPE_LABELS[type] || '',
    days: c.days != null ? String(c.days) : '',
    price: c.price != null ? String(c.price) : '',
    end_date: formatDate(c.end_date),
    deposit: String(deposit),
    // Passed in rather than derived from Date.now() here: the caller already
    // knows the day count, and computing it internally would make render()
    // time-dependent and its tests non-deterministic.
    days_overdue: o.daysOverdue != null ? String(o.daysOverdue) : '',
    return_steps: returnStepsFor(templates, type),
    deposit_line: depositLine,
    reviews_link: templates.reviews_link || '',
    website: templates.website_link || ''
  };

  // Only replace tokens we actually know — an unrecognised {token} is left as
  // written so a typo in a template is visible instead of silently blank.
  return String(templateText).replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole
  ).replace(/\s+$/, '');
}

function renderFor(kind, customer, templates, opts) {
  return render(templates[kind] || '', customer, templates, opts);
}

const TOKENS = Object.freeze([
  'name', 'game', 'type', 'days', 'price', 'end_date', 'days_overdue',
  'deposit', 'return_steps', 'deposit_line', 'reviews_link', 'website'
]);

const DEFAULT_TEMPLATES = Object.freeze({
  confirmation:
`✅ You're all set, {name}!

🎮 Game: {game}
👤 Account: {type}
⏱ Duration: {days} days
💰 Paid: ₱{price}
📅 Return by: {end_date}

⚠️ Please don't change the account password or email — it locks everyone out, including you.

⭐ Enjoying it? A quick review really helps us: {reviews_link}
🎮 Browse more games: {website}`,

  expiry_tomorrow:
`👋 Hi {name}! Quick reminder —

Your rental of {game} ({type}) ends TOMORROW, {end_date}.

Want to extend? Just reply and we'll set it up — no need to sign out or sign back in.

If you're done, here's how to return the account:
{return_steps}

{deposit_line}`,

  expiry_today:
`👋 Hi {name} — your rental ends TODAY.

🎮 {game} ({type}) · {days} days
📅 Ends: {end_date}

Would you like to extend your rent today? Just reply and we'll set it up —
no need to sign out or sign back in.

If you're done, here's how to return the account:
{return_steps}

{deposit_line}`,

  expiry_overdue:
`👋 Hi {name} — your rental is overdue.

🎮 {game} ({type})
📅 Ended: {end_date} ({days_overdue} days ago)

Still want it? Just reply and we can extend it for you — no need to sign out or sign back in.

If you're done, please return the account now so the next renter can use it:
{return_steps}

{deposit_line}`,

  return_steps_tr:
`1️⃣ Disable console sharing FIRST:
   Settings → Users and Accounts → Other → Console Sharing and Offline Play → Disable
2️⃣ Then delete the account:
   Settings → Delete Account`,

  return_steps_ps4:
`1️⃣ Deactivate as primary FIRST:
   Settings → Account Management → Activate as Your Primary PS4 → Deactivate
2️⃣ Then delete the account:
   Settings → Delete Account`,

  return_steps_nt:
`Just delete the account from your console:
   Settings → Delete Account`,

  deposit_line: '💰 Your ₱{deposit} deposit comes back once you\'ve signed out — just send us a screenshot.',
  reviews_link: 'https://facebook.com/PlaystationHub00/reviews',
  website_link: 'https://playstation-hub.com'
});

module.exports = { DEFAULT_TEMPLATES, TOKENS, TYPE_LABELS, hasDeposit, returnStepsFor, render, renderFor };
