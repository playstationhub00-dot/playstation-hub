// The questions on /faq and the homepage. Both the HTML and the FAQPage
// JSON-LD are built from these arrays, so a question cannot appear in one
// and not the other. Answers are limited to policies Michael confirmed
// (2026-10-20). Nothing here is still marked for confirmation.

const policy = require('./policy-copy');

function peso(n, fallback) {
  if (n == null || n === '') return fallback;
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function faqItems({ hasPromos, paymentSentence, monthlyPromoOn, monthlyPct, deposit, lateFee }) {
  const pay = paymentSentence || 'GCash or Maya for local customers · PayPal for international customers';
  const dep = peso(deposit, 100);
  const late = peso(lateFee, 20);
  const pct = Number(monthlyPct) || 0;
  const monthlyBit = monthlyPromoOn && pct
    ? ' Monthly is ' + pct + '% off while the monthly promo is on.'
    : '';
  const items = [];
  if (hasPromos) {
    items.push({
      q: 'Are there any promos right now?',
      text: 'Yes. Current promos lists what is on, with the dates and the terms.',
      paragraphs: [[
        { text: 'Yes. ' },
        { text: 'Current promos', href: '/promos' },
        { text: ' lists what is on, with the dates and the terms.' }
      ]]
    });
  }
  const rentSteps = [
    'Pick a game under Rent, or choose Buy if you want it permanently.',
    'Choose Non-Trophy, Trophy, or PS4 Primary. PS4 Primary is only offered for games that support PS4, and it costs the same as a PS5 Trophy rental.',
    'For a rental, choose Weekly (7 days) or Monthly (30 days).' + monthlyBit,
    'Enter the name on your Facebook account and place the order. You get an order page with a reference number.',
    'Pay the amount on that page. GCash or Maya for local customers, PayPal for international customers. Most local payments are a QR arranged on Messenger.',
    'On PS5, select your profile picture, then Switch User, Add User, and Get Started. On PS4, press the PS button, then Power, Switch User, New User, and Create a User. A QR code appears. Take a photo and send it on Messenger right away. It expires in about 10 minutes. You never share a password.',
    'When a rental ends, Trophy accounts disable Console Sharing first, and PS4 Primary accounts deactivate Primary first. Then sign out and send a screenshot of the signed-out account. On PS5, sign out is Settings, Users and Accounts, Other, Sign Out. On PS4, it is Settings, Account Management, Sign Out.'
  ];
  items.push({
    q: 'How does renting work?',
    open: true,
    steps: rentSteps,
    text: rentSteps.map((s, i) => (i + 1) + '. ' + s).join(' ')
  });
  items.push({
    q: 'How long can I rent?',
    text: 'Weekly is 7 days. Monthly is 30 days.' + monthlyBit + ' You can extend a weekly or monthly rental at the same price you paid. You can also buy a game outright — that one stays yours.'
  });
  items.push({
    q: 'What is the difference between Trophy, Non-Trophy, and PS4 Primary?',
    text: 'Non-Trophy is the cheapest. You play on the shop account. There is no deposit. Trophy uses your own profile, so trophies and saves stay with you. It costs more than Non-Trophy, and it includes a ₱' + dep + ' refundable deposit. PS4 Primary is the Trophy-style account for games that support PS4, including PS4-only games. It costs the same as a PS5 Trophy rental. You play on your own profile, so trophies and saves stay with you, and the ₱' + dep + ' refundable deposit applies here too. The deposit is refunded when the account is returned with proof. Non-Trophy has no deposit.'
  });
  items.push({
    q: 'Can I change games during my rental?',
    text: policy.SWAP_LINE + ' ' + policy.SWAP_TIER
  });
  items.push({
    q: 'How do I pay?',
    text: pay + '. Local payment is a GCash or Maya QR, and most of those are arranged on Messenger. International customers pay with PayPal.'
  });
  items.push({
    q: 'How do I get into the game?',
    text: 'On PS5, select your profile picture, then Switch User, Add User, and Get Started. On PS4, press the PS button, then Power, Switch User, New User, and Create a User. A QR code appears. Take a photo and send it on Messenger right away. It expires in about 10 minutes. You never share a password. The full steps, including how to return the account, are on How to Sign In, and the order itself is on How It Works.',
    paragraphs: [[
      { text: 'On PS5, select your profile picture, then Switch User, Add User, and Get Started. On PS4, press the PS button, then Power, Switch User, New User, and Create a User. A QR code appears. Take a photo and send it on Messenger right away. It expires in about 10 minutes. You never share a password. The full steps, including how to return the account, are on ' },
      { text: 'How to Sign In', href: '/how-to-sign-in' },
      { text: ', and the order itself is on ' },
      { text: 'How It Works', href: '/how-it-works' },
      { text: '.' }
    ]]
  });
  items.push({
    q: 'Can I try a game before I pay?',
    text: policy.TRIAL_ANSWER
  });
  items.push({
    q: 'Do I need PS Plus to play online?',
    text: policy.ONLINE_ANSWER
  });
  items.push({
    q: 'When do I get the deposit back?',
    text: 'The ₱' + dep + ' deposit on Trophy and PS4 Primary is refunded when the account is returned with proof. Trophy accounts disable Console Sharing first, and PS4 Primary accounts deactivate Primary first. Then sign out and send a screenshot of the signed-out account. On PS5, sign out is Settings, Users and Accounts, Other, Sign Out. On PS4, it is Settings, Account Management, Sign Out. Once we verify it, the deposit goes back the way you paid (GCash or Maya, or PayPal), which takes about a minute. Non-Trophy has no deposit.'
  });
  items.push({
    q: 'What happens if I return the account late?',
    text: policy.lateFeeSentence(dep, late) + ' Return on time and you get the full deposit back. You can extend the rental at the same price instead.'
  });
  items.push({
    q: 'Can I get a refund on my rental fee?',
    text: 'Yes, within 12 hours. You can cancel and get your rental fee refunded only within 12 hours after your rental starts. It goes back the way you paid: GCash or Maya, or PayPal. After that, the rental fee can\'t be refunded. Any ₱' + dep + ' deposit is separate and comes back once you return the account.'
  });
  items.push({
    q: 'What if I buy instead of rent?',
    text: 'Bought games are permanent. There is nothing to return and no rental end date.'
  });
  items.push({
    q: 'What if the game is sold out?',
    text: 'Sold-out games have a free waitlist. Join it from the game page and you keep your place until a slot opens.'
  });
  items.push({
    q: 'How do I reach you?',
    text: 'Email playstationhub00@gmail.com, message us on Messenger, or visit the Facebook page. We reply fastest on Messenger.',
    paragraphs: [[
      { text: 'Email ' },
      { text: 'playstationhub00@gmail.com', href: 'mailto:playstationhub00@gmail.com' },
      { text: ', message us on ' },
      { text: 'Messenger', href: 'http://m.me/PlaystationHub00' },
      { text: ', or visit the ' },
      { text: 'Facebook page', href: 'https://facebook.com/PlaystationHub00' },
      { text: '. We reply fastest on Messenger.' }
    ]]
  });
  items.forEach(item => {
    if (!item.paragraphs) item.paragraphs = [[{ text: item.text }]];
  });
  return items;
}

function homeItems({ deposit, lateFee }) {
  const dep = Number(deposit) || 0;
  const late = Number(lateFee) || 0;
  const items = [
    {
      q: 'Do I need to give you my PSN password?',
      text: 'No, and we never ask for it. On PS5, select your profile picture, then Switch User, Add User, and Get Started. On PS4, press the PS button, then Power, Switch User, New User, and Create a User. A QR code appears. Take a photo and send it on Messenger right away. It expires in about 10 minutes. Your password never leaves your hands.'
    },
    {
      q: 'Can I try a game before I pay?',
      text: policy.TRIAL_ANSWER
    }
  ];
  if (dep) {
    items.push({
      q: 'When do I get my ₱' + dep + ' deposit back?',
      text: 'As soon as you return the account at the end of your rental. The ₱' + dep + ' refundable deposit applies to Trophy and PS4 Primary. Non-Trophy has no deposit and no late fee. On Trophy and PS4 Primary, a late return costs ₱' + late + ' per late day, deducted from the deposit. Return on time and you get the full amount back.'
    });
  }
  items.push({
    q: 'What happens when my rental ends?',
    text: 'Trophy accounts disable Console Sharing first, and PS4 Primary accounts deactivate Primary first. Then sign out and send us a screenshot of the signed-out account. On PS5, sign out is Settings, Users and Accounts, Other, Sign Out. On PS4, it is Settings, Account Management, Sign Out. That frees the slot for the next person, and releases your deposit if you paid one. You can extend the rental at the same price.'
  });
  items.push({
    q: 'What if there are no slots left for the game I want?',
    text: 'You can join the line for free and we will message you the moment one opens, or pay a small priority fee to move ahead of everyone on the free list. Either way you keep your place — you can see exactly where you are in the queue.'
  });
  items.forEach(item => {
    if (!item.paragraphs) item.paragraphs = [[{ text: item.text }]];
  });
  return items;
}

module.exports = { faqItems, homeItems };
