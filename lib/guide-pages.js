// SEO guides: /how-it-works, the Trophy account guide, and PS Plus Deluxe vs
// renting. Prices, the deposit, the late fee, and the live promo offers come
// from the caller. Policy sentences come from lib/policy-copy.js so they
// cannot drift from /faq. Anything still unconfirmed is not in here.
const seo = require('./seo');
const policy = require('./policy-copy');
const gameDiscount = require('./game-discount');

const UPDATED = '2026-10-25';
const UPDATED_LABEL = '25 October 2026';

// The owner's confirmed sign-in rule: QR, no password shared, customers must
// not change the password or other account details.
const SAFETY = 'You sign in by QR code. We never share a password, and changing the password or other account details isn\'t allowed.';

const PATHS = {
  how: '/how-it-works',
  trophy: '/guides/trophy-vs-non-trophy-vs-ps4-primary',
  psplus: '/guides/ps-plus-deluxe-vs-renting',
  index: '/guides'
};

const MESSENGER = {
  how: 'Hi! I\'m new to renting. Can you help me pick a game?',
  trophy: 'Hi! Which account type should I pick?',
  psplus: 'Hi! PS Plus Deluxe or a single game — which fits me?'
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pack(parts) {
  const list = (parts || []).filter(Boolean);
  return {
    parts: list,
    text: list.map(p => p.text).join(''),
    html: list.map(part => {
      const text = esc(part.text);
      if (!part.href) return text;
      const ext = /^https?:/i.test(part.href) ? ' target="_blank" rel="noopener"' : '';
      return '<a href="' + esc(part.href) + '"' + ext + ' style="color:var(--ps-blue);">' + text + '</a>';
    }).join('')
  };
}

function para() {
  const parts = [];
  function add(bit) {
    if (bit == null || bit === false || bit === '') return;
    if (typeof bit === 'string') parts.push({ text: bit });
    else if (Array.isArray(bit.parts)) bit.parts.forEach(add);
    else parts.push(bit);
  }
  for (let i = 0; i < arguments.length; i++) add(arguments[i]);
  return pack(parts);
}

function link(text, href) {
  return { text, href };
}

function wordCount(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length;
}

function peso(n, fallback) {
  if (n == null || n === '') return fallback;
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function money(n) {
  return '₱' + n;
}

function weeklyPrice(game, prefix, promo) {
  const base = Number(game && game[prefix + '_price_7d']) || 0;
  if (!base) return 0;
  return gameDiscount.applyPct(base, gameDiscount.discountPct(game, 7, promo));
}

function isSingle(game) {
  return !!(game && game.title && !seo.isPsplusDeluxeTitle(game.title));
}

function singles(games) {
  return (games || []).filter(isSingle);
}

function gameHref(game) {
  return '/game/' + seo.slug(game.title);
}

function findTitle(games, title) {
  const want = String(title || '').toLowerCase();
  return singles(games).find(g => String(g.title).toLowerCase() === want) || null;
}

function gameLink(games, title, label) {
  const g = findTitle(games, title);
  if (!g) return null;
  return link(label || g.title, gameHref(g));
}

function monthlyClause(monthlyPromo) {
  if (monthlyPromo && Number(monthlyPromo.pct) > 0) {
    return 'Monthly is ' + Number(monthlyPromo.pct) + '% off right now (current promo, can end).';
  }
  return 'A percent off applies only while a monthly promo is running.';
}

function loyaltySentence(offers) {
  const rows = offers || [];
  const punch = rows.find(o => o && (o.kind === 'punch' || o.id === 'loyalty-punch'));
  const rebook = rows.find(o => o && (o.kind === 'rebook' || o.id === 'loyalty-rebook'));
  const bits = [];
  if (punch && punch.text) bits.push(String(punch.text).trim().replace(/\.+$/, ''));
  if (rebook && rebook.text) bits.push(String(rebook.text).trim().replace(/\.+$/, ''));
  return bits.length ? bits.join('. ') + '.' : '';
}

function messenger(text) {
  return 'http://m.me/PlaystationHub00?text=' + encodeURIComponent(text);
}

// null when the PS Plus list is empty (absence is then unknown).
function listedOnPsplus(names, title) {
  if (!names || !names.length) return null;
  const t = String(title || '').toLowerCase().trim();
  if (t.length < 4) return null;
  return names.some(n => {
    const s = String(n || '').toLowerCase().trim();
    if (s.length < 4) return false;
    return s === t || s.includes(t) || t.includes(s);
  });
}

function gtaTarget(games, upcoming) {
  const re = /grand theft auto vi|\bgta vi\b/i;
  const soon = (upcoming || []).find(x => x && re.test(x.title) && x.id != null);
  if (soon) return link('GTA VI', '/upcoming/' + seo.slug(soon.title) + '-' + soon.id);
  const live = singles(games).find(x => re.test(x.title));
  if (live) return link('GTA VI', gameHref(live));
  return null;
}

function priceStats(games, promo) {
  const rows = singles(games);
  const nt = rows.map(g => weeklyPrice(g, 'nt', promo)).filter(n => n > 0);
  const tr = rows.map(g => weeklyPrice(g, 'tr', promo)).filter(n => n > 0);
  const ps4 = rows.filter(g => String(g.platform || '').includes('PS4') && weeklyPrice(g, 'nt', promo) > 0);
  ps4.sort((a, b) => weeklyPrice(a, 'nt', promo) - weeklyPrice(b, 'nt', promo) || String(a.title).localeCompare(String(b.title)));
  return {
    entry: nt.length ? Math.min.apply(null, nt) : 0,
    top: nt.length ? Math.max.apply(null, nt) : 0,
    trophyFrom: tr.length ? Math.min.apply(null, tr) : 0,
    ps4Example: ps4[0] || null
  };
}

function plusPrices(raw) {
  const p = raw || {};
  return {
    ntW: Number(p.nt_price_7d) || 0,
    ntM: Number(p.nt_price_30d) || 0,
    trW: Number(p.tr_price_7d) || 0,
    trM: Number(p.tr_price_30d) || 0
  };
}

function rangeLabel(min, max) {
  if (!min) return '';
  if (!max || min === max) return money(min);
  return money(min) + '–' + money(max);
}

function swapParts(games, upcoming) {
  const tier = policy.SWAP_TIER;
  const gta = gtaTarget(games, upcoming);
  const at = tier.indexOf('GTA VI');
  if (!gta || at < 0) return para(policy.SWAP_LINE + ' ' + tier);
  return para(
    policy.SWAP_LINE + ' ' + tier.slice(0, at),
    gta,
    tier.slice(at + 'GTA VI'.length)
  );
}

function faq(q, packed, exact) {
  return { q, text: packed.text, html: packed.html, exact: !!exact };
}

function step(n, name, icon, packed) {
  return { id: 'step-' + n, n, name, icon, text: packed.text, html: packed.html };
}

function crumbsLd(items) {
  return seo.breadcrumb(items);
}

// The two policy sentences, then a short closer, with the product name linked.
function onlineAnswer() {
  const exception = policy.ONLINE_EXCEPTION;
  const nameAt = exception.indexOf('PS Plus Deluxe');
  return para(
    policy.ONLINE_WITHOUT + ' ',
    exception.slice(0, nameAt),
    link('PS Plus Deluxe', '/ps-plus'),
    exception.slice(nameAt + 'PS Plus Deluxe'.length) + ' Message us on Messenger if you are not sure.'
  );
}

function preferredGames(games, titles) {
  const out = [];
  (titles || []).forEach(title => {
    const g = findTitle(games, title);
    if (g && !out.some(x => x.title === g.title)) out.push(g);
  });
  return out;
}

function buildHow(ctx) {
  const dep = peso(ctx.deposit, 100);
  const late = peso(ctx.lateFee, 20);
  const promo = ctx.promo || null;
  const stats = priceStats(ctx.games, promo);
  const monthly = monthlyClause(ctx.monthlyPromo);
  const loyalty = loyaltySentence(ctx.loyaltyOffers);
  const example = gameLink(ctx.games, 'Ghost of Yotei')
    || gameLink(ctx.games, 'Elden Ring')
    || gameLink(ctx.games, 'Battlefield 6')
    || gameLink(ctx.games, 'Spider-Man');
  const onlineGame = gameLink(ctx.games, 'Battlefield 6');
  const answer = para(
    'Renting a PS5 game at PlayStation Hub is done online: pick a game, choose Non-Trophy, Trophy or PS4 Primary, pay by GCash, Maya or PayPal, then send us your console\'s sign-in QR and play. ' +
    policy.SWAP_LINE + ' Return it with a screenshot.'
  );
  const step1Fixed = example
    ? para(
      'Browse the ',
      link('game list', '/browse'),
      ' and open the title you want. Each listing shows the price, how many slots are free, and which account types are open. If it is sold out, join the free waitlist on the game page and you keep your place until a slot opens. For example, rent ',
      example,
      '.'
    )
    : para(
      'Browse the ',
      link('game list', '/browse'),
      ' and open the title you want. Each listing shows the price, how many slots are free, and which account types are open. If it is sold out, join the free waitlist on the game page and you keep your place until a slot opens.'
    );
  const steps = [
    step(1, 'Pick a game', '🔎', step1Fixed),
    step(2, 'Choose your account type and how long', '🏆', para(
      'Choose Non-Trophy, Trophy or PS4 Primary, then Weekly (7 days) or Monthly (30 days). Non-Trophy is the cheapest, with no deposit and a free 3-hour trial. Trophy and PS4 Primary include a ',
      money(dep) + ' refundable deposit, and PS4 Primary is only for games that support PS4. Monthly works out cheaper per day. See the ',
      link('Trophy vs Non-Trophy vs PS4 Primary', PATHS.trophy),
      ' guide.'
    )),
    step(3, 'Enter your Facebook name and get your order page', '✍️', para(
      'Type the name on your Facebook account so the order is yours, then tap Rent. The order page opens with your own reference number. Keep that page open. You will need the reference when you send the receipt.'
    )),
    step(4, 'Pay by GCash, Maya or PayPal', '💳', para(
      'Read the exact amount on the order page. Local customers usually pay with a GCash or Maya QR, mostly arranged on Messenger. International customers pay with PayPal. Then upload your receipt on the order page or send it on Messenger.'
    )),
    step(5, 'Send your sign-in QR', '📱', para(
      'On PS5, select your profile picture, then Switch User, Add User, and Get Started. On PS4, press the PS button, then Power, Switch User, New User, and Create a User. Photograph the QR code and send it on Messenger right away. It expires in about 10 minutes. You never share a password. See ',
      link('how to get your sign-in QR', '/how-to-sign-in'),
      '.'
    )),
    step(6, 'Play', '🎮', para(
      'Download the game and play it on your console. ',
      policy.ONLINE_WITHOUT + ' ',
      policy.ONLINE_EXCEPTION.replace('PS Plus Deluxe', '').length
        ? policy.ONLINE_EXCEPTION.slice(0, policy.ONLINE_EXCEPTION.indexOf('PS Plus Deluxe'))
        : '',
      link('PS Plus Deluxe', '/ps-plus'),
      policy.ONLINE_EXCEPTION.slice(policy.ONLINE_EXCEPTION.indexOf('PS Plus Deluxe') + 'PS Plus Deluxe'.length),
      onlineGame ? ' An online game such as ' : '',
      onlineGame || '',
      onlineGame ? ' is rented on its own.' : ''
    )),
    { groupLabel: 'While you play' },
    step(7, 'Swap games for free', '🔁', para(
      policy.SWAP_LINE + ' ' + policy.SWAP_TIER + ' On Non-Trophy you can upgrade to Trophy by paying the price difference plus the ',
      money(dep) + ' security deposit.'
    )),
    step(8, 'Need more time? Extend at the same price', '⏱️', para(
      'Extend any rental at the same price when you want more time. ' + policy.lateFeeSentence(dep, late)
    )),
    { groupLabel: 'When you\'re done' },
    step(9, 'Return: sign out and send a screenshot', '📸', para(
      'When the rental ends, Trophy accounts disable Console Sharing first, and PS4 Primary accounts deactivate Primary first. Then sign out. On PS5 that is Settings, Users and Accounts, Other, Sign Out. On PS4 that is Settings, Account Management, Sign Out. Send a screenshot of the signed-out account. That frees the slot for the next player.'
    )),
    step(10, 'Get your deposit back in about a minute', '💸', para(
      'On Trophy and PS4 Primary, once we verify the screenshot, the ',
      money(dep) + ' deposit is refunded the way you paid, by GCash or Maya, or PayPal, in about a minute. Non-Trophy has no deposit, so there is nothing to refund.'
    ))
  ];
  const howSteps = steps.filter(s => s.id);
  const entryBit = stats.entry
    ? ' Weekly rentals start at ' + money(stats.entry) + ' on Non-Trophy, and the free 3-hour trial is Non-Trophy only.'
    : ' The free 3-hour trial is Non-Trophy only.';
  const faqs = [
    faq('How do I rent PS5 games online?', para(
      'Pick a game, choose Non-Trophy, Trophy or PS4 Primary, and Weekly (7 days) or Monthly (30 days). Enter your Facebook name to open an order page. Pay by GCash, Maya or PayPal, upload the receipt or send it on Messenger, then send your console\'s sign-in QR.'
    )),
    faq('Can you rent PS5 games?', para(
      'Yes. PlayStation Hub rents digital PS5 and PS4 games in the Philippines. You play on your own console for 7 or 30 days, with no discs or meetups.' + entryBit + ' Message us on Messenger if you want help choosing.'
    )),
    faq('Where can I rent PS5 games in the Philippines?', para(
      'Online, at PlayStation Hub. You browse the catalogue on the site, pay by GCash, Maya or PayPal, and sign in by QR from home. There are no discs, no meetups and no store visit. Message us on Messenger if you want help picking a game.'
    )),
    faq('How do I pay for a rental?', para(
      'Your order page shows the exact amount. Local customers usually pay with a GCash or Maya QR, mostly arranged on Messenger. International customers pay with PayPal. After paying, upload your receipt on the order page or send it on Messenger.'
    )),
    faq('Do I need to give you my PSN password?', para(
      'No. We never share a password. On PS5, select your profile picture, then Switch User, Add User, and Get Started. On PS4, press the PS button, then Power, Switch User, New User, and Create a User. Send the QR on Messenger right away. It expires in about 10 minutes.'
    )),
    faq('How long does a rental last?', para(
      'Choose Weekly (7 days) or Monthly (30 days). Monthly works out cheaper per day. ' + monthly + ' Need more time when your week or month is ending? You can extend at the same price instead of returning early.'
    )),
    faq('Can I change games during my rental?', swapParts(ctx.games, ctx.upcoming), true),
    faq('Can I extend my rental?', para(
      'Yes. You can extend your rental at the same price, so there is no extra charge for wanting more time with a game. On Trophy and PS4 Primary, extending also avoids a late return. Message us on Messenger before the rental ends and we will sort it out.'
    )),
    faq('How do I return the account when my rental ends?', para(
      'Trophy accounts disable Console Sharing first, and PS4 Primary accounts deactivate Primary first. Then sign out and send a screenshot of the signed-out account. That frees the slot. If you paid a ',
      money(dep) + ' deposit on Trophy or PS4 Primary, we verify the screenshot and refund it in about a minute.'
    )),
    faq('When do I get my deposit back?', para(
      'Right after you return the account. Trophy accounts disable Console Sharing first, and PS4 Primary accounts deactivate Primary first, then sign out. Send a screenshot of the signed-out account. Once we verify it, your ',
      money(dep) + ' deposit is refunded the way you paid, by GCash or Maya, or PayPal, in about a minute. Non-Trophy has no deposit.'
    )),
    faq('Can I cancel and get a refund?', para(
      'Yes, within 12 hours. You can cancel and get your rental fee refunded only within 12 hours after your rental starts, paid back the way you paid. After that, the rental fee can\'t be refunded. Any ',
      money(dep) + ' deposit is separate and comes back when you return the account.'
    )),
    faq('What if the game I want is sold out?', para(
      'Join the waitlist for free. You keep your place until a slot opens, and we message you when one does. You can also browse what is available now. Free game changes let you start on another game and swap later, with a 2-day cooldown, if a slot is free.'
    )),
    faq('Can I try a game before I pay?', para(policy.TRIAL_ANSWER), true),
    faq('Can I play online with a rented game?', onlineAnswer())
  ];
  const url = seo.canonicalUrl(PATHS.how);
  const loyaltyPara = loyalty
    ? para(loyalty + ' See ', link('current promos', '/promos'), ' for what is on. These are separate from an extension, which costs the same price as the rental.')
    : null;
  return {
    key: 'how',
    pageKey: 'how-it-works',
    navActive: 'how',
    title: 'How to Rent PS5 Games in the Philippines | PlayStation Hub',
    description: 'How to rent PS5 and PS4 games online in the Philippines: pick a game, pay by GCash, Maya or PayPal, sign in by QR, swap free, return with a screenshot.',
    h1: 'How to rent PS5 games in the Philippines (step by step)',
    kicker: 'Order online',
    canonicalPath: PATHS.how,
    updated: UPDATED,
    updatedLabel: UPDATED_LABEL,
    answer: answer,
    showAccountBox: true,
    deposit: dep,
    crumbs: [
      { name: 'Home', href: '/' },
      { name: 'How it works', href: PATHS.how }
    ],
    sections: [
      {
        h2: 'Can you rent PS5 games? Yes. Here\'s the short version',
        id: 'short-version',
        paras: [para('Yes. PlayStation Hub rents digital PS5 and PS4 games online in the Philippines. You play on your own console. There are no discs and no meetups.')],
        bullets: [
          para('Order on the site. Most local payments are arranged on Messenger, and we reply fastest there.'),
          para('Choose ', link('Non-Trophy, Trophy or PS4 Primary', PATHS.trophy), '. PS4 Primary is the Trophy-style account for games that support PS4, at the same price as Trophy.'),
          para('Pay with GCash or Maya locally, or PayPal if you are outside the Philippines.')
        ]
      },
      {
        h2: 'How to rent a PS5 game, step by step',
        id: 'steps',
        paras: [],
        steps
      },
      {
        h2: 'What you need before you start',
        id: 'what-you-need',
        paras: [para(
          'You need your own PS5 or PS4, plus an internet connection so the game can download and so you can send the sign-in QR. Message us on Messenger if you want help picking a game. We reply fastest there. ',
          policy.ONLINE_WITHOUT + ' ' + policy.ONLINE_EXCEPTION + ' ',
          link('Compare PS Plus Deluxe with renting one game', PATHS.psplus),
          '.'
        )]
      },
      {
        h2: 'Payments: GCash, Maya or PayPal',
        id: 'payments',
        paras: [para(
          'The order page shows the exact amount. Local customers usually pay with a GCash or Maya QR, mostly arranged on Messenger. International customers pay with PayPal. Upload the receipt on the order page, or send it on Messenger.'
        )]
      },
      {
        h2: 'Swapping, extending and returning',
        id: 'swapping',
        paras: [
          swapParts(ctx.games, ctx.upcoming),
          para('Extend any rental at the same price. ' + policy.lateFeeSentence(dep, late)),
          para('When the rental ends, Trophy accounts disable Console Sharing first and PS4 Primary accounts deactivate Primary first, then sign out and send a screenshot of the signed-out account. On PS5, sign out is Settings, then Users and Accounts, then Other, then Sign Out. On PS4, it is Settings, then Account Management, then Sign Out. On Trophy and PS4 Primary, the ', money(dep) + ' deposit is refunded the way you paid, in about a minute, once we verify that screenshot. Non-Trophy has no deposit.')
        ]
      },
      {
        h2: 'Changed your mind? The 12-hour cancellation window',
        id: 'cancellation',
        paras: [para(
          'You can cancel and get your rental fee refunded only within 12 hours after your rental starts. It goes back the way you paid: GCash or Maya, or PayPal. After that, the rental fee can\'t be refunded. Any ',
          money(dep) + ' deposit is separate and comes back when you return the account.'
        )]
      },
      {
        h2: 'Is renting safe?',
        id: 'safe',
        paras: [para(
          SAFETY + ' The steps for the QR are on ',
          link('how to sign in', '/how-to-sign-in'),
          '.'
        )]
      },
      {
        h2: 'Sold out? Join the free waitlist',
        id: 'waitlist',
        paras: [para(
          'Sold-out games have a free waitlist. Join it from the game page and you keep your place until a slot opens. We message you when a slot opens. ',
          link('Browse what is free now', '/browse'),
          '.'
        )]
      },
      {
        h2: 'Buying instead of renting',
        id: 'buying',
        paras: [para(
          'You can buy a game instead. Bought games are permanent. There is nothing to return and no rental end date. The order still starts with your Facebook name and a payment. See ',
          link('Buy', '/buy'),
          '.'
        )]
      }
    ],
    faqs,
    faqHeading: 'How renting PS5 games works: FAQ',
    loyalty: loyaltyPara,
    ctas: [
      { href: '/browse', label: 'Pick a game' },
      { href: messenger(MESSENGER.how), label: 'Questions? Message us', outline: true },
      { href: '/faq', label: 'Rental FAQ', outline: true }
    ],
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: 'How to rent PS5 games in the Philippines (step by step)',
        description: answer.text,
        supply: [
          { '@type': 'HowToSupply', name: 'PS5 or PS4 console' },
          { '@type': 'HowToSupply', name: 'Internet connection' }
        ],
        tool: [{ '@type': 'HowToTool', name: 'Messenger' }],
        step: howSteps.map(s => ({
          '@type': 'HowToStep',
          position: s.n,
          name: s.name,
          text: s.text,
          url: url + '#' + s.id
        }))
      },
      seo.faqPage(faqs),
      crumbsLd([
        { name: 'Home', item: seo.ORIGIN },
        { name: 'How it works', item: url }
      ]),
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'How to rent PS5 games in the Philippines (step by step)',
        description: answer.text,
        url,
        dateModified: UPDATED,
        inLanguage: 'en'
      }
    ]
  };
}

function buildTrophy(ctx) {
  const dep = peso(ctx.deposit, 100);
  const late = peso(ctx.lateFee, 20);
  const promo = ctx.promo || null;
  const stats = priceStats(ctx.games, promo);
  const monthly = monthlyClause(ctx.monthlyPromo);
  const loyalty = loyaltySentence(ctx.loyaltyOffers);
  const example = stats.ps4Example;
  const exampleNt = example ? weeklyPrice(example, 'nt', promo) : 0;
  const exampleTr = example ? weeklyPrice(example, 'tr', promo) : 0;
  const yotei = gameLink(ctx.games, 'Ghost of Yotei', 'rent Ghost of Yotei');
  const requiem = gameLink(ctx.games, 'Resident Evil Requiem');
  const firstLight = gameLink(ctx.games, '007 First Light');
  const cheap = stats.entry ? findCheapest(ctx.games, promo) : null;
  const answer = para(
    'At PlayStation Hub, Trophy and PS4 Primary let you play our rented game on your own PSN profile, so your trophies count. Both cost the same and include a ',
    money(dep) + ' refundable deposit. PS4 Primary is only for games that support PS4. Non-Trophy is cheapest: you play on our account, with no deposit, no late fees, and a free 3-hour trial.'
  );
  const priceNt = stats.entry ? 'Cheapest (weekly from ' + money(stats.entry) + ')' : 'Cheapest. See each game page.';
  const priceTr = stats.trophyFrom ? 'Costs more (weekly from ' + money(stats.trophyFrom) + ')' : 'Costs more. See each game page.';
  const pricePs4 = stats.trophyFrom ? 'Same as Trophy (weekly from ' + money(stats.trophyFrom) + ')' : 'Same as Trophy. See each game page.';
  const rows = [
    row('Price', priceNt, priceTr, pricePs4),
    row('Deposit', 'None', money(dep) + ' refundable', money(dep) + ' refundable'),
    row('Whose profile you play on', 'Our account', 'Your own PSN profile', 'Your own PSN profile'),
    row('Trophies', 'Will not appear on your profile', 'Count on your profile', 'Count on your profile'),
    row('Console', 'PS5 or PS4, on our account', 'PS5 setup: Console Sharing and Offline Play', 'PS4, only for games that support PS4'),
    row('Console activation', 'On PS5, leave Console Sharing and Offline Play disabled. On PS4, choose Do Not Activate if prompted', 'Settings → Users and Accounts → Other → Console Sharing and Offline Play → Enable', 'Settings → Account Management → Activate as Your Primary PS4 → Activate'),
    row('Late fees', 'None', money(late) + ' per late day, from the deposit', money(late) + ' per late day, from the deposit'),
    row('Free 3-hour trial', 'Yes. Non-Trophy only, for any game available at the time, including PS Plus Deluxe', 'Not offered', 'Not offered'),
    row('Game swaps', 'Unlimited, 2-day cooldown, same price tier', 'Same', 'Same'),
    row('Switch account type', 'Upgrade to Trophy: the price difference plus the ' + money(dep) + ' deposit', 'n/a', 'n/a'),
    row('Sign-in', 'QR code. No password is shared', 'QR code. No password is shared', 'QR code. No password is shared'),
    row('Online multiplayer', 'Your own PS Plus, or add our PS Plus Deluxe rental', 'Your own PS Plus, or add our PS Plus Deluxe rental', 'Your own PS Plus, or add our PS Plus Deluxe rental'),
    row('Saves', 'Played on our account', 'On your own profile', 'On your own profile')
  ];
  if (example && exampleNt && exampleTr) {
    rows.splice(1, 0, row(
      'Example (' + example.title + ', weekly)',
      money(exampleNt),
      money(exampleTr),
      money(exampleTr)
    ));
  }
  const ps4Links = statsPs4Links(ctx.games, promo);
  const trophyExamples = [yotei, requiem, firstLight].filter(Boolean);
  const faqs = [
    faq('What is a Trophy account rental?', para(
      'A Trophy rental lets you play our game on your own PSN profile on PS5, so trophies land on your account. On our account, open Settings, Users and Accounts, Other, Console Sharing and Offline Play, then Enable, and switch back to your profile. It costs more than Non-Trophy and includes a ',
      money(dep) + ' refundable deposit.'
    )),
    faq('What\'s the difference between Trophy and Non-Trophy?', para(
      'Trophy means you play on your own profile, your trophies count, and you pay a ',
      money(dep) + ' refundable deposit. Non-Trophy means you play on our account. It is the cheapest option, with no deposit and no late fees, but trophies will not appear on your profile.'
    )),
    faq('What is a PS4 Primary rental?', para(
      'PS4 Primary is the Trophy-style option for PS4. Go to Settings, Account Management, Activate as Your Primary PS4, then Activate, and play on your own profile so your trophies count. It costs the same as Trophy, includes the ',
      money(dep) + ' refundable deposit, and is only for games that support PS4.'
    )),
    faq('Why does PS4 Primary cost the same as Trophy?', para(
      'Because both work the same way. You activate the console with our account so you can play on your own account. On PS5 that setting is Console Sharing and Offline Play. On PS4 it is Activate as Your Primary PS4. Same idea, same price, same ',
      money(dep) + ' refundable deposit.'
    )),
    faq('Do I pay a deposit on every account type?', para(
      'No. Trophy and PS4 Primary include a ',
      money(dep) + ' refundable deposit. Non-Trophy has no deposit. When you return a Trophy or PS4 Primary account, disable Console Sharing or deactivate Primary first, then send a screenshot of it signed out. Once we verify it, the deposit goes back the way you paid, in about a minute.'
    )),
    faq('What happens if I return the account late?', para(
      'On Trophy and PS4 Primary, a late return costs ',
      money(late) + ' for each late day, deducted from your ',
      money(dep) + ' deposit. Non-Trophy rentals have no late fees, because no deposit is collected. Need more time? You can extend any rental at the same price instead of returning late.'
    )),
    faq('Can I try a game before I rent?', para(
      'Yes, on Non-Trophy. The free 3-hour trial (Non-Trophy) covers any game, PS Plus Deluxe included, as long as it\'s available at the time. It is not available on Trophy or PS4 Primary. Message us on Messenger and we will set it up for you.'
    )),
    faq('Can I switch from Non-Trophy to Trophy later?', para(
      'Yes. You can switch from Non-Trophy to Trophy by paying the price difference plus the ',
      money(dep) + ' refundable security deposit. Start on Non-Trophy, and upgrade if you want trophies on your profile. Message us on Messenger when you are ready to switch.'
    )),
    faq('Can I change games on any account type?', para(
      policy.SWAP_LINE + ' ' + policy.SWAP_TIER + ' This works on Non-Trophy, Trophy and PS4 Primary rentals.'
    )),
    faq('Do I have to give you my PSN password?', para(
      'No. We never share a password. On PS5, select your profile picture, then Switch User, Add User, and Get Started. On PS4, press the PS button, then Power, Switch User, New User, and Create a User. Send the QR on Messenger right away. It expires in about 10 minutes.'
    )),
    faq('Can I play online with a rented account?', onlineAnswer()),
    faq('Which account type should I choose?', para(
      'Choose Non-Trophy if you want the lowest price, no deposit, no late fees and a free 3-hour trial. Choose Trophy on PS5 if you want trophies on your own profile. On PS4, choose PS4 Primary when the game supports PS4. You can upgrade from Non-Trophy later.'
    ))
  ];
  const url = seo.canonicalUrl(PATHS.trophy);
  const h1 = 'Trophy vs Non-Trophy vs PS4 Primary: which rental account is right for you?';
  return {
    key: 'trophy',
    pageKey: 'trophy-guide',
    navActive: '',
    title: 'Trophy vs Non-Trophy vs PS4 Primary Guide | PlayStation Hub',
    description: trophyDescription(dep),
    h1,
    kicker: 'Account types',
    canonicalPath: PATHS.trophy,
    updated: UPDATED,
    updatedLabel: UPDATED_LABEL,
    answer,
    showAccountBox: false,
    deposit: dep,
    crumbs: [
      { name: 'Home', href: '/' },
      { name: 'Guides', href: PATHS.index },
      { name: 'Trophy vs Non-Trophy vs PS4 Primary', href: PATHS.trophy }
    ],
    sections: [
      {
        h2: 'The quick comparison',
        id: 'comparison',
        paras: [],
        table: {
          caption: 'Trophy vs Non-Trophy vs PS4 Primary at PlayStation Hub (PS5 and PS4 rentals, Philippines). Prices are the current weekly prices on this site.',
          columns: ['', 'Non-Trophy', 'Trophy', 'PS4 Primary'],
          rows
        },
        note: para(
          'Monthly rentals cost less per day. See each game page for current prices. ' + monthly + ' ' + policy.ONLINE_WITHOUT + ' ' + policy.ONLINE_EXCEPTION
        )
      },
      {
        h2: 'What is a Trophy account?',
        id: 'trophy',
        paras: [
          para('A Trophy rental plays on your own PSN profile, so trophies and saves stay with you. It costs more than Non-Trophy and includes a ', money(dep) + ' refundable deposit.'),
          para('On PS5, the setup on our account is Settings, then Users and Accounts, then Other, then Console Sharing and Offline Play, then Enable. Console Sharing and Offline Play is the PS5 setting that lets you play our game on your own profile. You then switch back to your profile. The full QR steps are on ', link('how to sign in', '/how-to-sign-in'), '.')
        ],
        bullets: trophyExamples.length ? [para('Trophy examples: ', joinLinks(trophyExamples), '.')] : []
      },
      {
        h2: 'What is a Non-Trophy account?',
        id: 'non-trophy',
        paras: [
          para('Non-Trophy is played on our account. It is the cheapest option. There is no deposit and there are no late fees. Trophies will not appear on your profile.'),
          para('On PS5, leave Console Sharing and Offline Play disabled. On PS4, choose Do Not Activate if you are prompted. ' + policy.TRIAL_ANSWER),
          cheap ? para('A lower weekly price on the catalogue right now is ', link(cheap.title, gameHref(cheap)), ' at ' + money(weeklyPrice(cheap, 'nt', promo)) + ' for 7 days on Non-Trophy.') : null
        ].filter(Boolean)
      },
      {
        h2: 'What is PS4 Primary?',
        id: 'ps4-primary',
        paras: [
          para('PS4 Primary is a Trophy-style account for games that support PS4. You play on your own profile, so trophies count. It costs the same as Trophy because both need the console activated to play on your own account, and the ', money(dep) + ' refundable deposit applies.'),
          para('On PS4, the setup is Settings, then Account Management, then Activate as Your Primary PS4, then Activate. That is Sony\'s name for making a PS4 the primary console for the account. It is only offered when the game supports PS4. Non-Trophy accounts choose Do Not Activate if prompted.')
        ],
        bullets: ps4Links.length ? [para('Games on PS4 or PS4/PS5 that you can rent this way include ', joinLinks(ps4Links), '.')] : []
      },
      {
        h2: 'Deposits, late fees and refunds by account type',
        id: 'deposits',
        paras: [
          para('Trophy and PS4 Primary include a ', money(dep) + ' refundable deposit. Non-Trophy has no deposit and no late fees. ' + policy.lateFeeSentence(dep, late)),
          para('Trophy accounts disable Console Sharing first: Settings, then Users and Accounts, then Other, then Console Sharing and Offline Play, then Disable. PS4 Primary accounts deactivate Primary first: Settings, then Account Management, then Activate as Your Primary PS4, then Deactivate. Then sign out. On PS5 that is Settings, then Users and Accounts, then Other, then Sign Out. On PS4 that is Settings, then Account Management, then Sign Out. Send a screenshot of the signed-out account as return proof. Once we verify it, the deposit is refunded the way you paid (GCash or Maya, or PayPal), in about a minute. You can cancel and get the rental fee refunded only within 12 hours after the rental starts. After that, the rental fee can\'t be refunded.')
        ]
      },
      {
        h2: 'Switching games and switching account type',
        id: 'switching',
        paras: [
          swapParts(ctx.games, ctx.upcoming),
          para('You can switch from Non-Trophy to Trophy by paying the price difference plus the ', money(dep) + ' security deposit. Any rental can also be extended at the same price. The full order is on ', link('how renting works', PATHS.how), '.')
        ]
      },
      {
        h2: 'Is it safe? Do I share my password?',
        id: 'safe',
        paras: [para(SAFETY + ' See ', link('how to sign in with a QR', '/how-to-sign-in'), '.')]
      },
      {
        h2: 'Which one should you pick?',
        id: 'which',
        boxes: [
          { title: 'I just want the story', text: para('Choose Non-Trophy. It is the lowest price, with no deposit, no late fees, and a free 3-hour trial before you pay.') },
          { title: 'I\'m going for platinum', text: para('Choose Trophy on PS5 so trophies land on your own PSN profile. The ', money(dep) + ' deposit comes back after you return the account.') },
          { title: 'I\'m on PS4', text: para('Choose PS4 Primary when the game supports PS4. It costs the same as Trophy, and trophies count on your profile.') }
        ]
      }
    ],
    faqs,
    faqHeading: 'Trophy vs Non-Trophy vs PS4 Primary FAQ',
    loyalty: loyalty ? para(loyalty + ' See ', link('current promos', '/promos'), '.') : null,
    ctas: [
      { href: '/browse', label: 'Pick a game' },
      { href: messenger(MESSENGER.trophy), label: 'Not sure? Ask us on Messenger', outline: true },
      { href: '/faq', label: 'Rental FAQ', outline: true }
    ],
    also: para('PS Plus Deluxe also comes as Non-Trophy, Trophy or PS4 Primary. See ', link('PS Plus Deluxe', '/ps-plus'), ' and ', link('how renting works', PATHS.how), '.'),
    jsonLd: [
      articleLd({
        h1, description: answer.text, url,
        inLanguage: 'en-PH',
        about: 'PS5 and PS4 game rental account types'
      }),
      seo.faqPage(faqs),
      crumbsLd([
        { name: 'Home', item: seo.ORIGIN },
        { name: 'Guides', item: seo.canonicalUrl(PATHS.index) },
        { name: 'Trophy vs Non-Trophy vs PS4 Primary', item: url }
      ])
    ]
  };
}

function buildPsplus(ctx) {
  const dep = peso(ctx.deposit, 100);
  const promo = ctx.promo || null;
  const stats = priceStats(ctx.games, promo);
  const plus = plusPrices(ctx.psplusPrices);
  const monthly = monthlyClause(ctx.monthlyPromo);
  const loyalty = loyaltySentence(ctx.loyaltyOffers);
  const names = ctx.psplusNames || [];
  const popular = (ctx.popularTitles || []).map(t => String(t || '').trim()).filter(Boolean).slice(0, 3);
  const singlesWanted = preferredGames(ctx.games, [
    '007 First Light', 'Resident Evil Requiem', 'Marvel\'s Wolverine', 'Ghost of Yotei', 'Battlefield 6', 'Elden Ring'
  ]).slice(0, 3);
  const absent = singlesWanted.filter(g => listedOnPsplus(names, g.title) === false);
  const knownList = names.length > 0;
  const entry = stats.entry;
  const top = stats.top;
  const answer = para(psplusAnswer(plus, entry));
  const description = psplusDescription(plus, entry);
  const deluxeWeek = plus.ntW ? money(plus.ntW) : 'See the PS Plus Deluxe page';
  const deluxeMonth = plus.ntM ? money(plus.ntM) + '. The PS Plus Deluxe page does not show a monthly promo label.' : 'See the PS Plus Deluxe page';
  const deluxeTrophy = (plus.trW || plus.trM)
    ? [plus.trW ? money(plus.trW) + '/week' : '', plus.trM ? money(plus.trM) + '/month' : ''].filter(Boolean).join(', ')
    : 'See the PS Plus Deluxe page';
  const singleWeek = entry ? rangeLabel(entry, top) + ', depends on the game' : 'Shown on each game page';
  const singleTrophy = stats.trophyFrom ? 'From ' + money(stats.trophyFrom) + '/week' : 'Shown on each game page';
  const rows = [
    row('Weekly price (Non-Trophy)', deluxeWeek, singleWeek),
    row('Monthly price (Non-Trophy)', deluxeMonth, 'Shown on each game page. ' + monthly),
    row('Trophy price', deluxeTrophy, singleTrophy),
    row(money(dep) + ' refundable deposit', 'Trophy and PS4 Primary', 'Trophy and PS4 Primary'),
    row('What you can play', 'The games listed on our PS Plus Deluxe page', 'One game, with swaps to the same price tier'),
    row('Own profile and trophies', 'Trophy or PS4 Primary', 'Trophy or PS4 Primary'),
    row('Game changes', policy.SWAP_LINE, policy.SWAP_LINE + ' ' + policy.SWAP_TIER),
    row('Free 3-hour trial', 'Non-Trophy only, when it is available', 'Non-Trophy only, when it is available'),
    row('Online multiplayer', 'Included. The rental runs on a PS Plus subscription.', 'Needs your own PS Plus subscription'),
    row('Best for', 'The catalogue on our PS Plus Deluxe page, with online play included', entry ? 'One game, from ' + money(entry) + ' a week' : 'One game')
  ];
  const maths = mathsLines(plus, stats);
  const popularPara = popular.length
    ? para('Our PS Plus Deluxe page lists the games on our accounts, including ', joinNames(popular), '. The list changes, so check that page for the current games.')
    : para('Our ', link('PS Plus Deluxe page', '/ps-plus'), ' lists the games on our accounts. The list changes, so check that page for the current games.');
  const releasePara = singlesWanted.length
    ? para(
      knownList && absent.length === singlesWanted.length
        ? 'These single-game rentals are not in our PS Plus Deluxe list, so they are rented on their own: '
        : 'These are rented as their own games: ',
      joinLinks(singlesWanted.map(g => link(g.title, gameHref(g)))),
      '.'
    )
    : null;
  const faqs = [
    faq('Is PS Plus available in the Philippines?', para(
      'PlayStation Hub rents PS Plus Deluxe in the Philippines by the week or the month. You pay by GCash, Maya or PayPal, and you sign in by QR code. We never share a password. The current price and the games on our accounts are on the PS Plus Deluxe page.'
    )),
    faq('How much is PS Plus Deluxe in the Philippines?', psplusPriceAnswer(plus, dep)),
    faq('Can I rent a PS Plus account?', para(
      'Yes. PlayStation Hub rents PS Plus Deluxe weekly or monthly on Non-Trophy, Trophy or PS4 Primary, and online play is included. ' + SAFETY
    )),
    faq('Is PS Plus Deluxe worth it?', worthAnswer(plus, entry, popular)),
    faq('Is renting PS Plus Deluxe cheaper than renting single games?', cheaperAnswer(plus, entry)),
    faq('Can I earn trophies on a PS Plus Deluxe rental?', para(
      'Yes, choose Trophy. You play on your own PSN profile, so trophies and progress count. Trophy is ',
      plus.trW ? money(plus.trW) + ' a week' : 'priced on the PS Plus Deluxe page',
      plus.trM ? ' or ' + money(plus.trM) + ' a month' : '',
      ' plus a ',
      money(dep) + ' refundable deposit, refunded the way you paid. Non-Trophy is cheaper, and you play on our account, so trophies will not appear on your profile.'
    )),
    faq('Do I need my own PS Plus to play online?', para(
      'Not with our PS Plus Deluxe rental. It runs on a PS Plus subscription, so online play is included. ' + policy.ONLINE_WITHOUT + ' Or add our PS Plus Deluxe rental.'
    )),
    faq('What games are on PS Plus Deluxe?', popular.length
      ? para('Our PS Plus Deluxe page lists what is on our accounts, including ' + popular[0] + '. The list is updated from time to time, and some games leave. Open that page before you rent. Message us on Messenger if you want help choosing.')
      : para('Our PS Plus Deluxe page lists what is on our accounts. The list is updated from time to time, and some games leave. Open that page before you rent so you see the current games. Message us if you want help choosing.')),
    faq('How do I rent PS Plus Deluxe?', para(
      'Open the PS Plus Deluxe page, pick Non-Trophy, Trophy or PS4 Primary and Weekly or Monthly, then pay by GCash, Maya or PayPal. Send the sign-in QR on Messenger right away. It expires in about 10 minutes. Trophy accounts disable Console Sharing first, and PS4 Primary accounts deactivate Primary first, then sign out and send a screenshot.'
    )),
    faq('Can I try PS Plus Deluxe for free first?', para(
      'Yes, on Non-Trophy. The free 3-hour trial (Non-Trophy) covers any game, PS Plus Deluxe included, as long as it\'s available at the time. It is not offered on Trophy or PS4 Primary. Message us on Messenger and we will set it up.'
    ))
  ];
  if (knownList && absent.length) {
    faqs.splice(4, 0, faq('Are new releases on PS Plus Deluxe?', para(
      'These current single-game rentals are not in our PS Plus Deluxe list, so you would rent them on their own: ' +
      absent.map(g => g.title).join(', ') + '. Check the PS Plus Deluxe page for the current list, because it changes.'
    )));
  }
  const url = seo.canonicalUrl(PATHS.psplus);
  const h1 = 'PS Plus Deluxe vs renting games: which is better for you?';
  return {
    key: 'psplus',
    pageKey: 'psplus-vs-renting',
    navActive: '',
    title: 'PS Plus Deluxe vs Renting (Philippines) | PlayStation Hub',
    description,
    h1,
    kicker: 'PS Plus Deluxe',
    canonicalPath: PATHS.psplus,
    updated: UPDATED,
    updatedLabel: UPDATED_LABEL,
    answer,
    showAccountBox: false,
    deposit: dep,
    crumbs: [
      { name: 'Home', href: '/' },
      { name: 'Guides', href: PATHS.index },
      { name: 'PS Plus Deluxe vs renting games', href: PATHS.psplus }
    ],
    sections: [
      {
        h2: 'Renting PS Plus Deluxe in the Philippines',
        id: 'available',
        paras: [para(
          'PlayStation Hub rents PS Plus Deluxe by the week or the month. You pay by GCash, Maya or PayPal and sign in by QR. The games on our accounts are listed on the ',
          link('PS Plus Deluxe page', '/ps-plus'),
          '. ',
          popularPara
        )]
      },
      {
        h2: 'The quick answer: which should you pick?',
        id: 'which',
        boxes: [
          { title: 'Pick PS Plus Deluxe if…', text: para('You want the games on our PS Plus Deluxe page, or you want online play included. The rental runs on a PS Plus subscription, so online play is included. The free 3-hour trial on Non-Trophy covers it when a slot is available.') },
          { title: 'Rent a single game if…', text: para(entry ? 'You want one game, and you want the lowest weekly price we list right now, from ' + money(entry) + ' on Non-Trophy. ' : 'You want one game. ', 'A single-game rental does not include PS Plus. The free 3-hour trial is Non-Trophy only.') }
        ]
      },
      {
        h2: 'PS Plus Deluxe vs renting one game: side by side',
        id: 'compare',
        table: {
          caption: 'PS Plus Deluxe rental vs single-game rental at PlayStation Hub. Prices are the current prices on this site (' + UPDATED_LABEL + ').',
          columns: ['What you\'re comparing', 'PS Plus Deluxe rental', 'Single-game rental'],
          rows
        },
        note: loyalty ? para(loyalty + ' See ', link('current promos', '/promos'), '. An extension is separate: it costs the same price as the rental.') : null
      },
      {
        h2: 'What it costs at PlayStation Hub',
        id: 'cost',
        paras: [
          para('PS Plus Deluxe, Non-Trophy: ', plus.ntW ? money(plus.ntW) + ' for 7 days' : 'see the PS Plus Deluxe page', plus.ntM ? ' and ' + money(plus.ntM) + ' for 30 days' : '', '. Trophy: ', deluxeTrophy, '. PS4 Primary costs the same as Trophy, plus a ', money(dep) + ' refundable deposit on Trophy and PS4 Primary.'),
          para('Single-game weekly prices', entry ? ' run from ' + money(entry) : ' are on each game page', top && top !== entry ? ' to ' + money(top) : '', ' on Non-Trophy. Trophy weekly prices', stats.trophyFrom ? ' start at ' + money(stats.trophyFrom) : ' are on each game page', '. ' + monthly + ' That monthly line is about single-game pages. This guide does not apply it to PS Plus Deluxe.')
        ],
        bullets: maths
      },
      releasePara ? {
        h2: 'Single games you rent on their own',
        id: 'single-games',
        paras: [releasePara, para('Browse ', link('new releases for rent', '/browse?tab=new'), ' or the full ', link('game list', '/browse'), '.')]
      } : null,
      {
        h2: 'Trophies and account types',
        id: 'accounts',
        bullets: [
          para('Non-Trophy is played on our account. It is the cheapest, with no deposit, no late fees, and the free 3-hour trial.'),
          para('Trophy is your own PSN profile, so trophies count. It includes a ', money(dep) + ' refundable deposit.'),
          para('PS4 Primary is the Trophy-style account for games that support PS4, at the same price as Trophy, with the same deposit.')
        ],
        paras: [para('The full comparison is the ', link('Trophy vs Non-Trophy vs PS4 Primary', PATHS.trophy), ' guide.')]
      },
      {
        h2: 'Playing online',
        id: 'online',
        bullets: [
          para('PS Plus Deluxe rental: online play is included. It runs on a PS Plus subscription.'),
          para('Single-game rentals: ' + policy.ONLINE_WITHOUT + ' Or add our ', link('PS Plus Deluxe', '/ps-plus'), ' rental.')
        ]
      },
      {
        h2: 'How to rent either one',
        id: 'how',
        paras: [para(
          'Pick the game or PS Plus Deluxe, choose Non-Trophy, Trophy or PS4 Primary, and Weekly or Monthly. Pay by GCash, Maya or PayPal. On PS5, select your profile picture, then Switch User, Add User, and Get Started. On PS4, press the PS button, then Power, Switch User, New User, and Create a User. Photograph the QR code and send it on Messenger right away. It expires in about 10 minutes. ' + SAFETY + ' The full order is on ',
          link('how renting works', PATHS.how),
          ', and the QR steps are on ',
          link('how to sign in', '/how-to-sign-in'),
          '. You can extend either rental at the same price. When you finish, Trophy accounts disable Console Sharing first and PS4 Primary accounts deactivate Primary first, then sign out and send a screenshot of the signed-out account.'
        )]
      }
    ].filter(Boolean),
    faqs,
    faqHeading: 'PS Plus Deluxe vs renting: FAQ',
    loyalty: null,
    disclaimer: 'PlayStation Hub is an independent rental shop, not affiliated with Sony Interactive Entertainment.',
    ctas: [
      { href: '/ps-plus', label: 'Rent PS Plus Deluxe' },
      { href: '/browse?tab=new', label: 'Browse new releases', outline: true },
      { href: messenger(MESSENGER.psplus), label: 'Not sure? Message us', outline: true }
    ],
    also: para('Questions about the rental itself are on the ', link('rental FAQ', '/faq'), '.'),
    jsonLd: [
      articleLd({
        h1, description: answer.text, url,
        inLanguage: 'en',
        about: [
          { '@type': 'Thing', name: 'PlayStation Plus Deluxe' },
          { '@type': 'Thing', name: 'Video game rental' }
        ]
      }),
      seo.faqPage(faqs),
      crumbsLd([
        { name: 'Home', item: seo.ORIGIN },
        { name: 'Guides', item: seo.canonicalUrl(PATHS.index) },
        { name: 'PS Plus Deluxe vs renting games', item: url }
      ])
    ]
  };
}

function row(label, a, b, c) {
  const cells = [a, b];
  if (c != null) cells.push(c);
  return {
    label,
    cells: cells.map(value => (value && value.html) ? value : para(String(value)))
  };
}

function joinLinks(links) {
  const parts = [];
  links.forEach((item, i) => {
    if (i > 0 && i === links.length - 1) parts.push({ text: ' and ' });
    else if (i > 0) parts.push({ text: ', ' });
    parts.push(item);
  });
  return pack(parts);
}

function joinNames(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + ' and ' + names[1];
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

function findCheapest(games, promo) {
  let best = null;
  let bestPrice = 0;
  singles(games).forEach(g => {
    const n = weeklyPrice(g, 'nt', promo);
    if (!n) return;
    if (!best || n < bestPrice || (n === bestPrice && String(g.title).localeCompare(String(best.title)) < 0)) {
      best = g;
      bestPrice = n;
    }
  });
  return best;
}

function statsPs4Links(games, promo) {
  return singles(games)
    .filter(g => String(g.platform || '').includes('PS4'))
    .sort((a, b) => String(a.title).localeCompare(String(b.title)))
    .slice(0, 6)
    .map(g => link(g.title, gameHref(g)));
}

function mathsLines(plus, stats) {
  const lines = [];
  if (plus.ntW && stats.top) {
    if (plus.ntW === stats.top) {
      lines.push(para('One week of a single game at ' + money(stats.top) + ' matches one week of PS Plus Deluxe on Non-Trophy, also ' + money(plus.ntW) + '. Rent the single game when that is the title you want.'));
    } else {
      lines.push(para('One week of PS Plus Deluxe on Non-Trophy is ' + money(plus.ntW) + '. A single game at the top weekly price on the catalogue is ' + money(stats.top) + '.'));
    }
  }
  if (plus.ntW && stats.entry && stats.entry < plus.ntW) {
    const two = stats.entry * 2;
    lines.push(para('One catalogue game at ' + money(stats.entry) + ' for the week is less than PS Plus Deluxe at ' + money(plus.ntW) + '. Two of those ' + money(stats.entry) + ' games, rented separately, would be ' + money(two) + ' before any promo.'));
  }
  lines.push(para('Playing an online game you rent on its own, without your own PS Plus: add the PS Plus Deluxe rental. Online play is included on that rental. This page does not add the two prices together.'));
  return lines;
}

function trophyDescription(dep) {
  let text = 'Trophy, Non-Trophy or PS4 Primary? Compare price, the ' + money(dep) + ' deposit, trophies, late fees and the free 3-hour trial for PS5 & PS4 rentals in the Philippines.';
  if (text.length > 155) text = text.replace(' in the Philippines', '');
  return text;
}

function psplusAnswer(plus, entry) {
  let lead;
  if (plus.ntW && plus.ntM) lead = 'PS Plus Deluxe at PlayStation Hub is ' + money(plus.ntW) + ' a week or ' + money(plus.ntM) + ' a month on Non-Trophy';
  else if (plus.ntW) lead = 'PS Plus Deluxe at PlayStation Hub is ' + money(plus.ntW) + ' a week on Non-Trophy';
  else if (plus.ntM) lead = 'PS Plus Deluxe at PlayStation Hub is ' + money(plus.ntM) + ' a month on Non-Trophy';
  else lead = 'PlayStation Hub rents PS Plus Deluxe by the week or the month on Non-Trophy';
  return lead + ', and online play is included because the rental runs on a PS Plus subscription. For one game, rent that title on its own' +
    (entry ? ' from ' + money(entry) + ' a week' : '') +
    '. A single-game rental does not include PS Plus.';
}

function psplusDescription() {
  return 'Compare renting PS Plus Deluxe with one PS5 or PS4 game in the Philippines. See weekly prices, online play, and pay by GCash, Maya or PayPal.';
}

function psplusPriceAnswer(plus, dep) {
  if (!(plus.ntW || plus.ntM || plus.trW || plus.trM)) {
    return para(
      'PlayStation Hub rents PS Plus Deluxe by the week or the month. Trophy and PS4 Primary add a ',
      money(dep) + ' refundable deposit, and PS4 Primary costs the same as Trophy. The current figures are on the PS Plus Deluxe page. Non-Trophy has no deposit.'
    );
  }
  const bits = ['PlayStation Hub rents PS Plus Deluxe'];
  if (plus.ntW || plus.ntM) {
    bits.push(' for ');
    if (plus.ntW) bits.push(money(plus.ntW) + ' a week');
    if (plus.ntW && plus.ntM) bits.push(' or ');
    if (plus.ntM) bits.push(money(plus.ntM) + ' a month');
    bits.push(' on Non-Trophy');
  }
  if (plus.trW || plus.trM) {
    bits.push(', or ');
    if (plus.trW) bits.push(money(plus.trW) + ' a week');
    if (plus.trW && plus.trM) bits.push(' or ');
    if (plus.trM) bits.push(money(plus.trM) + ' a month');
    bits.push(' on Trophy');
  }
  bits.push('. Trophy and PS4 Primary add a ' + money(dep) + ' refundable deposit. PS4 Primary costs the same as Trophy.');
  return para(bits.join(''));
}

function worthAnswer(plus, entry, popular) {
  const names = popular.length ? ' such as ' + popular[0] : '';
  return para(
    'It fits when you want the games on our PS Plus Deluxe page' + names + ', with online play included. ',
    entry ? 'If you want one game, a single rental starts at ' + money(entry) + ' a week on Non-Trophy, and that rental does not include PS Plus.' : 'If you want one game, rent it on its own. A single-game rental does not include PS Plus. Message us on Messenger if you are choosing between them.',
    plus.ntW ? ' Deluxe on Non-Trophy is ' + money(plus.ntW) + ' a week.' : ''
  );
}

function cheaperAnswer(plus, entry) {
  if (plus.ntW && entry) {
    return para(
      'It depends how many games you will play. A week of PS Plus Deluxe on Non-Trophy is ',
      money(plus.ntW) + '. Single games start at ' + money(entry) + ' a week. For one game, especially one you want on its own, rent that game. For more than one game that is on our PS Plus Deluxe page, compare the Deluxe week with renting each game alone.'
    );
  }
  return para('Compare the weekly price on the PS Plus Deluxe page with the weekly price on the game page. For one game, rent that game. A single-game rental does not include PS Plus. This page does not compare monthly prices either.');
}

function articleLd({ h1, description, url, inLanguage, about }) {
  const aboutValue = typeof about === 'string' ? about : about;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: h1,
    description,
    author: { '@type': 'Organization', name: 'PlayStation Hub' },
    publisher: {
      '@type': 'Organization',
      name: 'PlayStation Hub',
      logo: { '@type': 'ImageObject', url: seo.ORIGIN + '/logo.svg' }
    },
    datePublished: UPDATED,
    dateModified: UPDATED,
    mainEntityOfPage: url,
    inLanguage,
    about: aboutValue
  };
}

function build(key, ctx) {
  const input = ctx || {};
  if (key === 'how' || key === 'how-it-works') return buildHow(input);
  if (key === 'trophy' || key === 'trophy-guide') return buildTrophy(input);
  if (key === 'psplus' || key === 'psplus-vs-renting') return buildPsplus(input);
  throw new Error('unknown guide ' + key);
}

function collectText(model) {
  const bits = [model.title, model.description, model.h1, model.answer && model.answer.text, model.disclaimer];
  (model.sections || []).forEach(sec => {
    bits.push(sec.h2);
    (sec.paras || []).forEach(p => bits.push(p && p.text));
    (sec.bullets || []).forEach(p => bits.push(p && p.text));
    (sec.boxes || []).forEach(b => { bits.push(b.title); if (b.text) bits.push(b.text.text); });
    if (sec.table) {
      bits.push(sec.table.caption);
      (sec.table.rows || []).forEach(r => {
        bits.push(r.label);
        (r.cells || []).forEach(c => bits.push(c.text));
      });
    }
    if (sec.note) bits.push(sec.note.text);
    (sec.steps || []).forEach(s => { bits.push(s.groupLabel); bits.push(s.name); bits.push(s.text); });
  });
  (model.faqs || []).forEach(f => { bits.push(f.q); bits.push(f.text); });
  if (model.loyalty) bits.push(model.loyalty.text);
  if (model.also) bits.push(model.also.text);
  return bits.filter(Boolean).join('\n');
}

const BANNED = [
  [/always 10% off/i, 'always 10% off'],
  [/100% safe/i, '100% safe'],
  [/\bno risk\b/i, 'no risk'],
  [/can.?t get banned/i, 'can\'t get banned'],
  [/cheapest in ph/i, 'cheapest in PH'],
  [/\bsecondary\b/i, 'secondary'],
  [/game trials/i, 'Game Trials'],
  [/hundreds of games/i, 'hundreds of games'],
  [/not officially/i, 'not officially'],
  [/not currently available/i, 'not currently available'],
  [/bank transfer/i, 'bank transfer'],
  [/qr ph/i, 'QR Ph'],
  [/card checkout/i, 'card checkout'],
  [/carry over/i, 'carry over'],
  [/reservation fee/i, 'reservation fee'],
  [/stored locally/i, 'stored locally']
];

function issues(model) {
  const out = [];
  if (!model.title || model.title.length > 60) out.push('title ' + (model.title || '').length + ' ' + model.title);
  if (!model.description || model.description.length < 140 || model.description.length > 155) {
    out.push('description ' + (model.description || '').length + ' ' + model.description);
  }
  const answerWords = wordCount(model.answer && model.answer.text);
  if (answerWords < 40 || answerWords > 60) out.push('answer ' + answerWords);
  (model.sections || []).forEach(sec => {
    (sec.steps || []).forEach(s => {
      if (!s.id) return;
      const n = wordCount(s.text);
      if (n < 25 || n > 60) out.push('step ' + s.n + ' ' + s.name + ' ' + n + ' :: ' + s.text);
    });
  });
  (model.faqs || []).forEach(f => {
    if (f.exact) return;
    const n = wordCount(f.text);
    if (n < 40 || n > 60) out.push('faq ' + n + ' ' + f.q + ' :: ' + f.text);
  });
  const blob = collectText(model);
  if (/Playstation Hub/.test(blob)) out.push('wrong brand casing');
  BANNED.forEach(([re, label]) => {
    if (re.test(blob)) out.push('banned: ' + label);
  });
  const faqLd = (model.jsonLd || []).find(b => b['@type'] === 'FAQPage');
  if (!faqLd) out.push('missing FAQPage');
  else if (faqLd.mainEntity.length !== model.faqs.length) out.push('faq count');
  else model.faqs.forEach((f, i) => {
    if (faqLd.mainEntity[i].name !== f.q) out.push('faq name ' + f.q);
    if (faqLd.mainEntity[i].acceptedAnswer.text !== f.text) out.push('faq text ' + f.q);
  });
  return out;
}

module.exports = {
  UPDATED, UPDATED_LABEL, PATHS, SAFETY,
  build, issues, wordCount, collectText, monthlyClause
};
