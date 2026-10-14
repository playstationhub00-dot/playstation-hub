// Public facts the support assistant is allowed to say.
//
// Prices, the deposit, and which payment methods are switched on all live in
// admin (price categories, site_settings.promo, payment_methods). This module
// reads those plain objects and returns only what a stranger in chat is
// allowed to hear. It never sees another customer's order, name, or PSID —
// callers that have those records must reduce them to counts before they
// get here (see waitlistSummary and publicGame).

const gameDiscount = require('./game-discount');
const plain = require('../public/js/support-plain');

function toPlainText(text) {
  return plain.toPlainText(text);
}

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
    priceGuide: 'weeklyNow and monthlyNow are what checkout charges. weekly and monthly are the price-category amounts before the promo. A percent above 0 is already subtracted inside the Now price. Quote the Now price. When you mention the percent, also say the category amount it came off. Do not subtract the percent again.',
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

// Closed-class words only. Shared shop words (trophy, deposit, weekly, slot)
// are used in both languages, so they must not decide the reply.
const FIL_WORDS = new Set('po opo magkano presyo halaga paano pano meron mayroon wala gusto pwede pede puwede bayad salamat kamusta musta kumusta sige hindi naman kasi yung ung mga saan bakit kailan ako ikaw lang talaga laro ba ang ng sa oo din rin sana natin namin kayo mo ko ito iyan yun daw raw pala nga ano ninyo niyo kaya para nang dun doon dito diyan na di kausap'.split(' '));
const EN_WORDS = new Set('the a an what how much is are do does did can could you your please pls want need hello hi hey thanks thank for and or with this that where when why which who difference between available human about from have has tell me my i we our just like also there here'.split(' '));

function replyLanguage(text) {
  const words = String(text || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
  let fil = 0;
  let en = 0;
  words.forEach(w => {
    if (FIL_WORDS.has(w)) fil += 1;
    else if (EN_WORDS.has(w)) en += 1;
  });
  if (fil && en) return 'mix';
  if (fil) return 'fil';
  return 'en';
}

function pick(lang, pack) {
  if (lang === 'fil') return pack.fil;
  if (lang === 'mix') return pack.mix;
  return pack.en;
}

const HANDOFF_TEXT = {
  asked_for_human: {
    en: 'Okay — I flagged Michael, and this chat is paused. He’ll reply here. 🙋',
    fil: 'Sige — na-flag ko si Michael, at naka-pause ang chat na ito. Siya na ang sasagot. 🙋',
    mix: 'Sige — I flagged Michael, and naka-pause na ang chat. He’ll reply here. 🙋'
  },
  payment_or_dispute: {
    en: 'Payment proofs and disputes go to Michael, not the bot. I’ve paused this chat so he can check it. 🧾',
    fil: 'Ang proof of payment at dispute, kay Michael na — hindi sa bot. Naka-pause ito para matingnan niya. 🧾',
    mix: 'Payment proofs and disputes, kay Michael na. Paused na ang bot para matingnan niya. 🧾'
  },
  cannot_help: {
    en: 'I can’t answer that safely, so I’m passing you to Michael. This chat is paused until he picks it up. 🙋',
    fil: 'Di ko kaya itong sagutin ng tama, kaya ipapasa kita kay Michael. Naka-pause ang chat hanggang tingnan niya. 🙋',
    mix: 'Di ko kaya ito sagutin ng tama, so I’m passing you to Michael. Paused ang chat until he picks it up. 🙋'
  },
  attachment: {
    en: 'Got your photo. I’m pausing the bot so Michael can check it. 📷',
    fil: 'Nakuha ko ang photo. Naka-pause ang bot para matingnan ni Michael. 📷',
    mix: 'Got your photo. Naka-pause ang bot para matingnan ni Michael. 📷'
  }
};

function handoffText(reason, lang) {
  const pack = HANDOFF_TEXT[reason] || HANDOFF_TEXT.cannot_help;
  return pick(lang, pack);
}

// weekly / monthly are the price-category amounts. weeklyNow / monthlyNow
// are what POST /order/create charges: the category amount minus the promo
// percent for that duration (0 when the promo is off).
function joinOr(lang, parts) {
  const list = parts.filter(Boolean);
  if (list.length < 2) return list[0] || '';
  const conj = lang === 'fil' ? 'o' : 'or';
  return list.slice(0, -1).join(', ') + ' ' + conj + ' ' + list[list.length - 1];
}

function tierSentence(t, lang) {
  const or = lang === 'fil' ? 'o' : 'or';
  function side(label, prices) {
    const month = peso(prices.monthlyNow) + '/month' + (prices.monthly && prices.monthly !== prices.monthlyNow ? ' (category ' + peso(prices.monthly) + ')' : '');
    return label + ' ' + peso(prices.weeklyNow) + '/week ' + or + ' ' + month;
  }
  return t.name + ': ' + side('Non-Trophy', t.nonTrophy) + '. ' + side('Trophy', t.trophy) + '.';
}

function priceBlurb(facts, lang) {
  const f = facts || {};
  const url = f.orderUrl || '/browse';
  const lines = [pick(lang, {
    en: 'Here’s what checkout charges today. 🎮',
    fil: 'Ito ang singil sa checkout ngayon. 🎮',
    mix: 'Ito ang checkout price ngayon. 🎮'
  })];
  const tiers = (f.pricing || []).slice(0, 4);
  if (!tiers.length) {
    lines.push(pick(lang, {
      en: 'Open a game on the site for its Weekly and Monthly price.',
      fil: 'Buksan ang laro sa site para sa Weekly at Monthly price.',
      mix: 'Open a game sa site para sa Weekly and Monthly price.'
    }));
  } else {
    tiers.forEach(t => lines.push(tierSentence(t, lang)));
  }
  if (f.monthlyDiscountPct > 0) {
    lines.push(pick(lang, {
      en: 'The ' + f.monthlyDiscountPct + '% monthly promo is already taken off the category price.',
      fil: 'Kasama na ang ' + f.monthlyDiscountPct + '% monthly promo sa presyo ng buwan.',
      mix: 'The ' + f.monthlyDiscountPct + '% monthly promo is kasama na sa month price.'
    }));
  }
  if (f.weeklyDiscountPct > 0) {
    lines.push(pick(lang, {
      en: 'The ' + f.weeklyDiscountPct + '% weekly promo is already in the week price.',
      fil: 'Kasama na ang ' + f.weeklyDiscountPct + '% weekly promo sa presyo ng linggo.',
      mix: 'The ' + f.weeklyDiscountPct + '% weekly promo is kasama na sa week price.'
    }));
  }
  if (f.deposit) {
    lines.push(pick(lang, {
      en: 'Trophy and PS4 Primary add a ' + peso(f.deposit) + ' refundable deposit.',
      fil: 'May ' + peso(f.deposit) + ' refundable deposit ang Trophy at PS4 Primary.',
      mix: 'Trophy and PS4 Primary, may ' + peso(f.deposit) + ' refundable deposit.'
    }));
  }
  if (f.psplus) {
    lines.push('PS Plus Deluxe: Non-Trophy ' + peso(f.psplus.nonTrophyWeekly) + '/week ' + (lang === 'fil' ? 'o' : 'or') + ' ' + peso(f.psplus.nonTrophyMonthly) + '/month.');
  }
  lines.push(pick(lang, {
    en: 'Order here: ' + url,
    fil: 'Mag-order dito: ' + url,
    mix: 'Order dito: ' + url
  }));
  return lines.join('\n');
}

function howTo(facts, lang) {
  const f = facts || {};
  const url = f.orderUrl || '/browse';
  const deposit = f.deposit
    ? pick(lang, {
      en: ' Trophy and PS4 Primary include a ' + peso(f.deposit) + ' refundable deposit.',
      fil: ' May ' + peso(f.deposit) + ' refundable deposit ang Trophy at PS4 Primary.',
      mix: ' Trophy and PS4 Primary, may ' + peso(f.deposit) + ' refundable deposit.'
    })
    : '';
  return pick(lang, {
    en: 'Pick a game, choose Non-Trophy, Trophy, or PS4 Primary, then Weekly or Monthly. 🎮 You sign in with a code — we never ask for your PSN password.' + deposit + ' Start here: ' + url,
    fil: 'Pumili ng laro, Non-Trophy, Trophy, o PS4 Primary, tapos Weekly o Monthly. 🎮 Code ang sign-in — hindi namin hihingi ang PSN password mo.' + deposit + ' Dito magsimula: ' + url,
    mix: 'Pick a game, then Non-Trophy, Trophy, or PS4 Primary, tapos Weekly or Monthly. 🎮 Sign-in code lang — we never ask for your PSN password.' + deposit + ' Start here: ' + url
  });
}

function payBlurb(facts, lang) {
  const p = (facts && facts.payments) || {};
  const local = [];
  if (p.gcash) local.push('GCash');
  if (p.maya) local.push('Maya');
  const url = (facts && facts.orderUrl) || '/browse';
  const localEn = local.length ? joinOr('en', local) + ' QR at checkout' : 'GCash or Maya QR once it’s switched on';
  const localFil = local.length ? joinOr('fil', local) + ' QR sa checkout' : 'GCash o Maya QR kapag naka-on na';
  const abroad = p.paypal
    ? pick(lang, { en: 'Outside the Philippines, use PayPal.', fil: 'Sa ibang bansa, PayPal.', mix: 'Abroad, PayPal.' })
    : pick(lang, { en: 'PayPal shows up for international customers when it’s on.', fil: 'Lalabas ang PayPal para sa international kapag naka-on.', mix: 'PayPal shows up abroad when it’s on.' });
  return pick(lang, {
    en: 'In the Philippines, pay by ' + localEn + '. ' + abroad + ' 💳 Order here: ' + url,
    fil: 'Sa Pilipinas, ' + localFil + '. ' + abroad + ' 💳 Mag-order dito: ' + url,
    mix: 'Sa Pilipinas, ' + (local.length ? joinOr('en', local) + ' QR at checkout' : 'GCash or Maya QR') + '. ' + abroad + ' 💳 Order dito: ' + url
  });
}

function slotPhrase(card, lang) {
  function one(label, n) {
    if (lang === 'fil') return label + ' ' + (n > 0 ? 'may ' + n + ' slot' : 'full');
    if (lang === 'mix') return label + ' ' + (n > 0 ? n + ' open' : 'full');
    return label + ' ' + (n > 0 ? n + ' open' : 'full');
  }
  const parts = [one('Non-Trophy', card.slots.nonTrophy), one('Trophy', card.slots.trophy)];
  if (card.slots.ps4Primary != null) parts.push(one('PS4 Primary', card.slots.ps4Primary));
  return parts.join(', ');
}

function gameBlurb(card, facts, lang) {
  const f = facts || {};
  const or = lang === 'fil' ? 'o' : 'or';
  const waiting = (card.waitlist.nonTrophy || 0) + (card.waitlist.trophy || 0) + (card.waitlist.ps4Primary || 0);
  const lines = [
    card.title + (card.platform ? ' (' + card.platform + ')' : '') + ': ' + slotPhrase(card, lang) + '. 🎮'
  ];
  if (waiting) {
    lines.push(pick(lang, {
      en: waiting + ' on the waitlist. Join from the game page if it’s full.',
      fil: waiting + ' ang naka-waitlist. Sumali sa game page kung full.',
      mix: waiting + ' on the waitlist. Sumali sa game page if it’s full.'
    }));
  }
  lines.push(pick(lang, {
    en: 'Checkout is Non-Trophy ' + peso(card.prices.nonTrophyWeekly) + '/week ' + or + ' ' + peso(card.prices.nonTrophyMonthly) + '/month, Trophy ' + peso(card.prices.trophyWeekly) + '/week ' + or + ' ' + peso(card.prices.trophyMonthly) + '/month.',
    fil: 'Sa checkout: Non-Trophy ' + peso(card.prices.nonTrophyWeekly) + '/week ' + or + ' ' + peso(card.prices.nonTrophyMonthly) + '/month, Trophy ' + peso(card.prices.trophyWeekly) + '/week ' + or + ' ' + peso(card.prices.trophyMonthly) + '/month.',
    mix: 'Checkout is Non-Trophy ' + peso(card.prices.nonTrophyWeekly) + '/week ' + or + ' ' + peso(card.prices.nonTrophyMonthly) + '/month, Trophy ' + peso(card.prices.trophyWeekly) + '/week ' + or + ' ' + peso(card.prices.trophyMonthly) + '/month.'
  }));
  if (f.deposit) {
    lines.push(pick(lang, {
      en: 'Trophy deposit is ' + peso(f.deposit) + ', refundable.',
      fil: 'Deposit ng Trophy: ' + peso(f.deposit) + ', refundable.',
      mix: 'Trophy deposit is ' + peso(f.deposit) + ', refundable.'
    }));
  }
  lines.push(pick(lang, {
    en: 'Rent it: ' + (f.siteUrl || '') + card.path,
    fil: 'Mag-rent dito: ' + (f.siteUrl || '') + card.path,
    mix: 'Rent dito: ' + (f.siteUrl || '') + card.path
  }));
  return lines.join(' ');
}

// Used when there is no model key, or the model call fails. Same facts the
// model would have been given, so the two paths cannot quote different prices.
function fallbackReply(message, facts, lookup) {
  const text = String(message || '').trim();
  const lang = replyLanguage(text);
  const reason = handoffReason(text);
  if (reason) return { text: handoffText(reason, lang), handoff: true, reason };

  const low = text.toLowerCase();
  const url = (facts && facts.orderUrl) || '/browse';
  if (!low || /^(hi|hello|hey|uy|oi|sup|start|help|menu|kamusta|musta|helo|good morning|good afternoon|good evening)\b/.test(low)) {
    return {
      text: pick(lang, {
        en: 'Hi! 👋 We rent PS4 and PS5 games. Ask a title, or say “prices”.',
        fil: 'Hi! 👋 Nagre-rent kami ng PS4 at PS5 games. Sabihin ang title, o “presyo”.',
        mix: 'Hi! 👋 PS4/PS5 rentals kami. Ask a title, or sabihin “presyo”.'
      }),
      handoff: false,
      reason: null
    };
  }
  if (/price|magkano|how much|presyo|halaga|\bcost\b/.test(low)) {
    return { text: priceBlurb(facts, lang), handoff: false, reason: null };
  }
  if (/gcash|maya|paypal|bayad|payment|how (do i|to) pay/.test(low)) {
    return { text: payBlurb(facts, lang), handoff: false, reason: null };
  }
  if (/how.*(rent|order|start)|pano|paano|how to rent|rental guide/.test(low)) {
    return { text: howTo(facts, lang), handoff: false, reason: null };
  }
  if (/deposit|ps4 primary/.test(low)) {
    const dep = facts && facts.deposit ? peso(facts.deposit) : '';
    return {
      text: pick(lang, {
        en: 'PS4 Primary is a Trophy-style account at the Non-Trophy price, only for PS4 games.' + (dep ? ' Deposit is ' + dep + ', refundable, for Trophy and PS4 Primary.' : '') + ' 🎮 See a game: ' + url,
        fil: 'Ang PS4 Primary ay Trophy-style account sa presyo ng Non-Trophy, para lang sa PS4 games.' + (dep ? ' Deposit na ' + dep + ', refundable, para sa Trophy at PS4 Primary.' : '') + ' 🎮 Tingnan ang laro: ' + url,
        mix: 'PS4 Primary is a Trophy-style account at the Non-Trophy price, PS4 games lang.' + (dep ? ' Deposit is ' + dep + ', refundable, for Trophy and PS4 Primary.' : '') + ' 🎮 See a game: ' + url
      }),
      handoff: false,
      reason: null
    };
  }
  if (typeof lookup === 'function') {
    const hits = lookup(text) || [];
    if (hits.length) return { text: gameBlurb(hits[0], facts, lang), handoff: false, reason: null };
  }
  return {
    text: pick(lang, {
      en: 'I’m not sure about that. Send a game title, or say “prices”. Need a person? Say “human”. 🙋',
      fil: 'Di ko sure iyan. Sabihin ang title ng laro, o “presyo”. Gusto mo ng tao? Sabihin “human”. 🙋',
      mix: 'Di ko sure iyan. Send a game title, or say “presyo”. Need a person? Say “human”. 🙋'
    }),
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
  fallbackReply, scrub, slug, toPlainText, replyLanguage
};
