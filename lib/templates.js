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

// Substitutes {token} against a value map, leaving unknown tokens as written.
// Shared by the top-level render and by the conditional sub-lines it splices in
// (deposit_line, late_fee_line) — those are template text too, so their own
// tokens need a pass of their own; the top-level replace does not recurse.
function fill(text, vals) {
  return String(text || '').replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(vals, key) ? vals[key] : whole
  );
}

function render(templateText, customer, templates, opts) {
  if (!templateText) return '';
  const o = opts || {};
  const deposit = o.deposit != null ? o.deposit : 100;
  const lateFeePerDay = o.lateFeePerDay != null ? o.lateFeePerDay : 20;
  const daysOverdue = o.daysOverdue != null ? Math.max(0, Number(o.daysOverdue) || 0) : 0;
  const c = customer || {};
  const type = c.account_type;

  // The deduction is capped at the deposit: a rental 30 days late owes the
  // deposit, not more. Non-Trophy has no deposit to draw from, so nothing is
  // deducted and the whole late-fee sentence drops out — same rule as
  // deposit_line, which is why a Non-Trophy message says nothing about money.
  const depositDeducted = hasDeposit(type) ? Math.min(deposit, lateFeePerDay * daysOverdue) : 0;
  const depositLeft = Math.max(0, deposit - depositDeducted);

  const feeVals = {
    deposit: String(deposit),
    late_fee_per_day: String(lateFeePerDay),
    deposit_deducted: String(depositDeducted),
    deposit_left: String(depositLeft),
    days_overdue: String(daysOverdue)
  };

  const depositLine = hasDeposit(type) ? fill(templates.deposit_line, feeVals) : '';

  // Only when actually overdue, so the due-today/tomorrow messages stay silent
  // about penalties. Once the deposit is fully consumed the wording changes from
  // a warning into a statement of fact — two templates rather than one, because
  // "you'll lose X" and "there is nothing left" are different messages.
  const lateFeeLine = (hasDeposit(type) && daysOverdue > 0)
    ? fill(templates[depositLeft > 0 ? 'late_fee_line' : 'late_fee_zero_line'], feeVals)
    : '';

  // A link to this customer's own order page, where the review prompt lives.
  // Only web orders carry a ref and key, so customers added by hand — and every
  // record predating the web flow — get an empty string, which collapses
  // review_line to nothing rather than sending them a broken link.
  const reviewLink = (c.order_ref && c.order_key)
    ? (templates.website_link || '') + '/order/' + c.order_ref + '?k=' + c.order_key
    : '';
  const reviewLine = reviewLink ? fill(templates.review_line, { review_link: reviewLink }) : '';

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
    late_fee_per_day: String(lateFeePerDay),
    deposit_deducted: String(depositDeducted),
    deposit_left: String(depositLeft),
    return_steps: returnStepsFor(templates, type),
    deposit_line: depositLine,
    late_fee_line: lateFeeLine,
    review_link: reviewLink,
    review_line: reviewLine,
    reviews_link: templates.reviews_link || '',
    website: templates.website_link || ''
  };

  // Only replace tokens we actually know — an unrecognised {token} is left as
  // written so a typo in a template is visible instead of silently blank.
  return fill(templateText, values).replace(/\s+$/, '');
}

function renderFor(kind, customer, templates, opts) {
  return render(templates[kind] || '', customer, templates, opts);
}

const TOKENS = Object.freeze([
  'name', 'game', 'type', 'days', 'price', 'end_date', 'days_overdue',
  'deposit', 'late_fee_per_day', 'deposit_deducted', 'deposit_left',
  'return_steps', 'deposit_line', 'late_fee_line', 'review_link', 'review_line',
  'reviews_link', 'website'
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

{deposit_line}

{review_line}`,

  expiry_overdue:
`👋 Hi {name} — your rental is overdue.

🎮 {game} ({type})
📅 Ended: {end_date} ({days_overdue} days ago)

Still want it? Just reply and we can extend it for you — no need to sign out or sign back in.

If you're done, please return the account now so the next renter can use it:
{return_steps}

{late_fee_line}`,

  late_fee_line:
`⚠️ Late returns cost ₱{late_fee_per_day}/day out of your ₱{deposit} deposit.
You're {days_overdue} day(s) late, so ₱{deposit_deducted} has been deducted — ₱{deposit_left} left. Return the account now to keep the rest.`,

  late_fee_zero_line:
`⚠️ Late returns cost ₱{late_fee_per_day}/day out of your ₱{deposit} deposit.
At {days_overdue} days late the full ₱{deposit} has been used up, so there's no deposit refund left on this rental. Please still return the account so we can close it out.`,

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
  // Points at the customer's own order page rather than the Facebook page: a
  // review left there is tied to a real paid order, so it earns the "Verified
  // renter" badge and appears on the game pages where people hesitate.
  review_line: '⭐ How did it go? A quick review really helps us — takes 10 seconds:\n{review_link}',
  reviews_link: 'https://facebook.com/PlaystationHub00/reviews',
  website_link: 'https://playstation-hub.com'
});

module.exports = { DEFAULT_TEMPLATES, TOKENS, TYPE_LABELS, hasDeposit, returnStepsFor, render, renderFor };
