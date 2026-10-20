// The questions on /faq and the homepage. Both the HTML and the FAQPage
// JSON-LD are built from these arrays, so a question cannot appear in one
// and not the other. Wording is limited to facts already published on the
// site: durations, account types, the ₱100 deposit, and how payment works.
// Nothing here claims a free or unlimited game change during a rental.

function faqItems({ hasPromos, paymentSentence }) {
  const pay = paymentSentence || 'GCash or Maya for local customers · PayPal for international customers';
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
    'Choose Non-Trophy, Trophy, or PS4 Primary. PS4 Primary is only offered for games that support PS4.',
    'For a rental, choose Weekly (7 days) or Monthly (30 days). Monthly is 10% off.',
    'Enter the name on your Facebook account and place the order. You get an order page with a reference number.',
    'Pay the amount on that page. GCash or Maya for local customers, PayPal for international customers. Most local payments are a QR arranged on Messenger.',
    'Your console shows a sign-in QR. Send that code and the shop account signs into your console. You never share a password.',
    'When a rental ends, return the account with proof.'
  ];
  items.push({
    q: 'How does renting work?',
    open: true,
    steps: rentSteps,
    text: rentSteps.map((s, i) => (i + 1) + '. ' + s).join(' ')
  });
  items.push({
    q: 'How long can I rent?',
    text: 'Weekly is 7 days. Monthly is 30 days, and monthly is 10% off. You can also buy a game outright — that one stays yours.'
  });
  items.push({
    q: 'What is the difference between Trophy, Non-Trophy, and PS4 Primary?',
    text: 'Non-Trophy is the cheapest. You play on the shop account. There is no deposit. Trophy uses your own profile, so trophies and saves stay with you. It costs more than Non-Trophy, and it includes a ₱100 refundable deposit. PS4 Primary is the Trophy-style account for games that support PS4, including PS4-only games. You play on your own profile, so trophies and saves stay with you, and the ₱100 refundable deposit applies here too. The deposit is refunded when the account is returned with proof. Non-Trophy has no deposit.'
  });
  items.push({
    q: 'How do I pay?',
    text: pay + '. Local payment is a GCash or Maya QR, and most of those are arranged on Messenger. International customers pay with PayPal.'
  });
  items.push({
    q: 'How do I get into the game?',
    text: 'Your console shows a sign-in QR code. You send that code and the shop account signs into your console. You never share a password. The steps are on How to Sign In, and the order itself is on How It Works.',
    paragraphs: [[
      { text: 'Your console shows a sign-in QR code. You send that code and the shop account signs into your console. You never share a password. The steps are on ' },
      { text: 'How to Sign In', href: '/how-to-sign-in' },
      { text: ', and the order itself is on ' },
      { text: 'How It Works', href: '/how-it-works' },
      { text: '.' }
    ]]
  });
  items.push({
    q: 'When do I get the deposit back?',
    text: 'The ₱100 deposit is refunded when the account is returned with proof. Non-Trophy has no deposit.'
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
      text: 'No, and we never ask for it. You bring up the sign-in screen on your own console and send us the code from it — that signs our account into your console. Your password never leaves your hands.'
    },
    {
      q: 'Can I try a game before I pay?',
      text: 'Yes — three hours free, on our account, before you commit to renting or buying. Message us and we will set it up.'
    }
  ];
  if (dep) {
    items.push({
      q: 'When do I get my ₱' + dep + ' deposit back?',
      text: 'As soon as you return the account at the end of your rental. It only applies to Trophy accounts. If you return late, ₱' + late + ' a day comes out of it — return on time and you get the full amount back.'
    });
  }
  items.push({
    q: 'What happens when my rental ends?',
    text: 'You sign our account out of your console and send us a quick screenshot to confirm. That frees the slot for the next person, and releases your deposit if you paid one.'
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
