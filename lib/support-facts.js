// Public facts the support assistant is allowed to say.
//
// Prices, the deposit, and which payment methods are switched on all live in
// admin (price categories, site_settings.promo, payment_methods). This module
// reads those plain objects and returns only what a stranger in chat is
// allowed to hear. It never sees another customer's order, name, or PSID —
// callers that have those records must reduce them to counts before they
// get here (see waitlistSummary and publicGame).

const gameDiscount = require('./game-discount');

function peso(n) {
  return '₱' + (Number(n) || 0).toLocaleString('en-US');
}

function sitePct(promo, days) {
  return gameDiscount.sitePct(promo, days);
}

function quotedPrices(game, promo) {
  function one(field, days) {
    return gameDiscount.applyPct(Number(game && game[field]) || 0, gameDiscount.discountPct(game, days, promo));
  }
  return {
    nonTrophyWeekly: one('nt_price_7d', 7),
    nonTrophyMonthly: one('nt_price_30d', 30),
    trophyWeekly: one('tr_price_7d', 7),
    trophyMonthly: one('tr_price_30d', 30)
  };
}

// One row per price category, with the running site promo already taken off.
// A game can carry its own % instead — lookup_game quotes that title, this
// sheet does not, because a category has no per-game override.
function pricingSheet(categories, promo) {
  const pct7 = sitePct(promo, 7);
  const pct30 = sitePct(promo, 30);
  return (categories || []).filter(c => c && String(c.name || '').trim()).map(c => ({
    name: String(c.name).trim(),
    nonTrophy: {
      weekly: Number(c.nt_price_7d) || 0,
      monthly: Number(c.nt_price_30d) || 0,
      weeklyNow: gameDiscount.applyPct(c.nt_price_7d, pct7),
      monthlyNow: gameDiscount.applyPct(c.nt_price_30d, pct30)
    },
    trophy: {
      weekly: Number(c.tr_price_7d) || 0,
      monthly: Number(c.tr_price_30d) || 0,
      weeklyNow: gameDiscount.applyPct(c.tr_price_7d, pct7),
      monthlyNow: gameDiscount.applyPct(c.tr_price_30d, pct30)
    }
  }));
}

function paymentFacts(methods) {
  const enabled = (methods || []).filter(m => m && m.enabled && m.key).map(m => String(m.key));
  return {
    gcash: enabled.includes('gcash'),
    maya: enabled.includes('maya'),
    paypal: enabled.includes('paypal'),
    enabledKeys: enabled
  };
}

function slug(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function faqBundle(input) {
  const src = input || {};
  const promo = src.promo || {};
  const siteUrl = String(src.siteUrl || 'https://www.playstation-hub.com').replace(/\/$/, '');
  const page = String(src.pageUsername || 'PlaystationHub00').replace(/^@/, '');
  const prices = src.psplusPrices || null;
  const slots = src.psplusSlots || {};
  const pct7 = sitePct(promo, 7);
  const pct30 = sitePct(promo, 30);
  let psplus = null;
  if (prices) {
    psplus = {
      nonTrophyWeekly: gameDiscount.applyPct(prices.nt_price_7d, pct7),
      nonTrophyMonthly: gameDiscount.applyPct(prices.nt_price_30d, pct30),
      trophyWeekly: gameDiscount.applyPct(prices.tr_price_7d, pct7),
      trophyMonthly: gameDiscount.applyPct(prices.tr_price_30d, pct30),
      slots: {
        nonTrophy: Number(slots.nt_slots) || 0,
        trophy: Number(slots.tr_slots) || 0,
        ps4Primary: Number(slots.ps4_slots) || 0
      },
      path: '/ps-plus'
    };
  }
  return {
    siteUrl,
    orderUrl: siteUrl + '/browse',
    messengerUrl: 'https://m.me/' + page,
    pricing: pricingSheet(src.categories, promo),
    weeklyDiscountPct: pct7,
    monthlyDiscountPct: pct30,
    deposit: Number(promo.deposit) || 0,
    lateFeePerDay: Number(promo.late_fee_per_day) || 0,
    payments: paymentFacts(src.paymentMethods),
    psplus,
    ps4Primary: 'PS4 Primary is a Trophy-style account: the refundable deposit applies, and it is priced like Non-Trophy. It is only offered on games that run on PS4 (platform PS4 or PS4/PS5).',
    ordering: 'Order on the website: pick a game, choose Non-Trophy, Trophy, or PS4 Primary when the game supports PS4, then Weekly or Monthly, then pay.',
    trial: 'There is a 3-hour free trial on our account before you commit. Message us which game you want to try.'
  };
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Questions arrive as "Hogwarts Legacy slots?" or "meron ba Elden Ring".
// Those extra words are not part of the title, so they are lifted off before
// the match. Kept here rather than in the model prompt because the scripted
// fallback (no API key yet) has to find the same game.
const SEARCH_FILLER = /\b(how|much|magkano|presyo|halaga|slots?|available|availability|price|prices|rent|rental|weekly|monthly|trophy|nontrophy|primary|meron|ba|po|pls|please|open|full|waitlist|game|games|about|what|whats|is|the|for|an|do|you|have|has|any|check|status|of)\b/g;

function searchGames(games, query) {
  const raw = norm(query);
  const stripped = raw.replace(SEARCH_FILLER, ' ').replace(/\s+/g, ' ').trim();
  const q = stripped.length >= 2 ? stripped : raw;
  if (q.length < 2) return [];
  const words = q.split(' ').filter(w => w.length > 1);
  const qFlat = q.replace(/ /g, '');
  const matched = (games || []).filter(g => {
    const t = norm(g && g.title);
    if (!t) return false;
    if (t.includes(q) || q.includes(t)) return true;
    const tFlat = t.replace(/ /g, '');
    if (tFlat.length > 3 && qFlat.includes(tFlat)) return true;
    return words.length > 0 && words.every(w => t.includes(w));
  });
  // A question that names the longer title ("Part II") should not be answered
  // with the shorter one that also shares those words.
  matched.sort((a, b) => {
    const ta = norm(a.title);
    const tb = norm(b.title);
    const score = (t) => (q.includes(t) ? 1000 + t.length : t.length);
    return score(tb) - score(ta);
  });
  return matched.slice(0, 3);
}

// Counts only. buildQueue() rows carry a masked name; that name must not
// survive into anything the model or the widget is shown.
function waitlistSummary(queue) {
  function count(rows) {
    if (Array.isArray(rows)) return rows.length;
    return Number(rows) || 0;
  }
  const q = queue || {};
  return {
    nonTrophy: count(q.nt != null ? q.nt : q.nonTrophy),
    trophy: count(q.tr != null ? q.tr : q.trophy),
    ps4Primary: count(q.ps4 != null ? q.ps4 : q.ps4Primary)
  };
}

function showsPs4(game) {
  return !!(game && (game.platform === 'PS4' || game.platform === 'PS4/PS5'));
}

// A card a customer can be told. Built field-by-field on purpose: spreading
// the game record would copy whatever else is hanging off it.
function publicGame(game, avail, waitlist, promo) {
  const a = avail || {};
  const w = waitlist || {};
  const ps4 = showsPs4(game);
  const card = {
    title: String(game && game.title || ''),
    platform: String(game && game.platform || ''),
    path: '/game/' + slug(game && game.title),
    slots: {
      nonTrophy: Number(a.ntSlots) || 0,
      trophy: Number(a.trSlots) || 0
    },
    waitlist: {
      nonTrophy: Number(w.nonTrophy) || 0,
      trophy: Number(w.trophy) || 0
    },
    prices: quotedPrices(game, promo)
  };
  if (ps4) {
    card.slots.ps4Primary = Number(a.ps4Slots) || 0;
    card.waitlist.ps4Primary = Number(w.ps4Primary) || 0;
    card.ps4Primary = 'Trophy-style account at the Non-Trophy price. Refundable deposit applies. Offered because this game runs on PS4.';
  }
  return card;
}

// Asked for a person, or the message is about money that only Michael should
// judge. Kept as a rule in front of the model so a payment-proof chat cannot
// depend on the model remembering to hand off.
const HUMAN_RE = /\b(human|live agent|real person|talk to (a )?(human|person|someone|michael|admin|the owner)|kausap|customer service|message the owner)\b|\b(agent|staff|owner|admin)\b/i;
const PROOF_RE = /\b(proof of payment|payment proof|resibo|gcash screenshot|screenshot of (my )?payment|bayad ko|disputes?|refund|reklamo|chargeback|wrong amount|overcharg\w*|double charg\w*|scam|hindi dumating|i (already |have )?paid|paid na|already paid)\b/i;

function handoffReason(text) {
  const t = String(text || '');
  if (PROOF_RE.test(t)) return 'payment_or_dispute';
  if (HUMAN_RE.test(t)) return 'asked_for_human';
  return null;
}

function clip(text, max) {
  const s = String(text == null ? '' : text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function abuseReason(text) {
  const s = String(text == null ? '' : text);
  if (!s.trim()) return 'empty';
  if (s.length > 1000) return 'too_long';
  if (/(.)\1{40,}/.test(s)) return 'spam';
  const urls = s.match(/https?:\/\//gi);
  if (urls && urls.length > 3) return 'too_many_links';
  return null;
}

const HANDOFF_TEXT = {
  asked_for_human: 'Sige — flagged for Michael, and the bot is paused on this chat. Sit tight, he’ll take it from here.',
  payment_or_dispute: 'Payment proofs and disputes go to Michael, not the bot. I’ve flagged this chat and paused auto-replies so he can check it.',
  cannot_help: 'Di ko kaya ito sagutin ng tama, so I’m passing you to Michael. The bot is paused until he picks this up.',
  attachment: 'Got your photo. I’m pausing the bot and flagging this for Michael — he checks payment proofs himself.'
};

function handoffText(reason) {
  return HANDOFF_TEXT[reason] || HANDOFF_TEXT.cannot_help;
}

function priceBlurb(facts) {
  const f = facts || {};
  const lines = ['Here are today’s prices, straight from the shop:'];
  const tiers = (f.pricing || []).slice(0, 6);
  if (!tiers.length) {
    lines.push('Open a game on the site for its Weekly and Monthly price — nothing is stored as a flat tier right now.');
  } else {
    tiers.forEach(t => {
      lines.push(
        t.name + ': Non-Trophy ' + peso(t.nonTrophy.weeklyNow) + '/week, ' + peso(t.nonTrophy.monthlyNow) + '/month'
        + ' · Trophy ' + peso(t.trophy.weeklyNow) + '/week, ' + peso(t.trophy.monthlyNow) + '/month'
      );
    });
  }
  if (f.monthlyDiscountPct > 0) lines.push('Monthly rentals are ' + f.monthlyDiscountPct + '% off right now.');
  if (f.weeklyDiscountPct > 0) lines.push('Weekly rentals are ' + f.weeklyDiscountPct + '% off right now.');
  if (f.deposit) lines.push('Trophy and PS4 Primary add a ' + peso(f.deposit) + ' refundable deposit. Non-Trophy has none.');
  if (f.psplus) {
    lines.push('PS Plus Deluxe: Non-Trophy ' + peso(f.psplus.nonTrophyWeekly) + '/week, ' + peso(f.psplus.nonTrophyMonthly) + '/month.');
  }
  lines.push('Order at ' + (f.orderUrl || '/browse'));
  return lines.join('\n');
}

function howTo(facts) {
  const f = facts || {};
  return [
    'How to rent:',
    '1. Pick a game at ' + (f.orderUrl || '/browse'),
    '2. Choose Non-Trophy, Trophy, or PS4 Primary (PS4 games only).',
    '3. Weekly or Monthly, then pay.',
    '4. Sign in with a code — we never ask for your PSN password.',
    f.deposit ? 'Trophy and PS4 Primary include a ' + peso(f.deposit) + ' refundable deposit.' : 'No deposit on Non-Trophy.',
    'Want a slot check? Send the game title.'
  ].join('\n');
}

function payBlurb(facts) {
  const p = (facts && facts.payments) || {};
  const local = [];
  if (p.gcash) local.push('GCash');
  if (p.maya) local.push('Maya');
  const lines = ['Payment:'];
  lines.push(local.length ? 'In the Philippines: ' + local.join(' or ') + ' QR at checkout.' : 'Local QR (GCash / Maya) shows at checkout once it’s switched on.');
  lines.push(p.paypal ? 'Outside the Philippines: PayPal.' : 'PayPal is for international customers when it’s switched on.');
  lines.push('Place the order on the site: ' + ((facts && facts.orderUrl) || '/browse'));
  return lines.join('\n');
}

function gameBlurb(card, facts) {
  const slots = [];
  slots.push('Non-Trophy: ' + (card.slots.nonTrophy > 0 ? card.slots.nonTrophy + ' open' : 'full'));
  slots.push('Trophy: ' + (card.slots.trophy > 0 ? card.slots.trophy + ' open' : 'full'));
  if (card.slots.ps4Primary != null) {
    slots.push('PS4 Primary: ' + (card.slots.ps4Primary > 0 ? card.slots.ps4Primary + ' open' : 'full'));
  }
  const waiting = (card.waitlist.nonTrophy || 0) + (card.waitlist.trophy || 0) + (card.waitlist.ps4Primary || 0);
  const lines = [
    card.title + (card.platform ? ' (' + card.platform + ')' : ''),
    slots.join(' · ')
  ];
  if (waiting) lines.push(waiting + ' on the waitlist. Join from the game page if it’s full.');
  lines.push(
    'Non-Trophy ' + peso(card.prices.nonTrophyWeekly) + '/week, ' + peso(card.prices.nonTrophyMonthly) + '/month'
    + ' · Trophy ' + peso(card.prices.trophyWeekly) + '/week, ' + peso(card.prices.trophyMonthly) + '/month'
  );
  if (facts && facts.deposit) lines.push('Trophy deposit: ' + peso(facts.deposit) + ', refundable.');
  lines.push('Rent it: ' + ((facts && facts.siteUrl) || '') + card.path);
  return lines.join('\n');
}

// Used when there is no model key, or the model call fails. Same facts the
// model would have been given, so the two paths cannot quote different prices.
function fallbackReply(message, facts, lookup) {
  const text = String(message || '').trim();
  const reason = handoffReason(text);
  if (reason) return { text: handoffText(reason), handoff: true, reason };

  const low = text.toLowerCase();
  if (!low || /^(hi|hello|hey|uy|oi|sup|start|help|menu|kamusta|musta|helo|good morning|good afternoon|good evening)\b/.test(low)) {
    return {
      text: 'Hi! PlayStation Hub — PS4/PS5 digital rentals. Ask a game title, or say “prices” or “how to rent”.',
      handoff: false,
      reason: null
    };
  }
  if (/price|magkano|how much|presyo|halaga|\bcost\b/.test(low)) {
    return { text: priceBlurb(facts), handoff: false, reason: null };
  }
  if (/how.*(rent|order|start)|pano|paano|how to rent|rental guide/.test(low)) {
    return { text: howTo(facts), handoff: false, reason: null };
  }
  if (/gcash|maya|paypal|bayad|payment|how (do i|to) pay/.test(low)) {
    return { text: payBlurb(facts), handoff: false, reason: null };
  }
  if (/deposit|ps4 primary/.test(low)) {
    const f = facts || {};
    return {
      text: (f.ps4Primary || '') + (f.deposit ? ' Deposit is ' + peso(f.deposit) + ', refundable, Trophy and PS4 Primary only.' : '') + ' See a game: ' + (f.orderUrl || '/browse'),
      handoff: false,
      reason: null
    };
  }
  if (typeof lookup === 'function') {
    const hits = lookup(text) || [];
    if (hits.length) return { text: gameBlurb(hits[0], facts), handoff: false, reason: null };
  }
  return {
    text: 'Di ko sure ang tanong. Send a game title, or say “prices” / “how to rent”. If you need a person, say “human”.',
    handoff: false,
    reason: null
  };
}

// Last line of defence before a tool result is shown to the model. Drops
// keys that are only ever customer data. Category "name" is not in this set
// on purpose — that is the tier's public label.
const DROP_KEYS = new Set([
  'fb_name', 'customer_name', 'email', 'phone', 'psid', 'external_id',
  'account_number', 'password', 'receipt', 'sender', 'session_id', 'url_key'
]);

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return value.replace(/\bPH-\d{4,}\b/gi, '[order]');
    return value;
  }
  const out = {};
  Object.keys(value).forEach(k => {
    if (DROP_KEYS.has(k)) return;
    out[k] = scrub(value[k]);
  });
  return out;
}

module.exports = {
  peso, quotedPrices, pricingSheet, paymentFacts, faqBundle, searchGames,
  waitlistSummary, publicGame, handoffReason, handoffText, clip, abuseReason,
  fallbackReply, scrub, slug
};
