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
    pricing: pricingSheet(src.categories, promo),
    weeklyDiscountPct: pct7,
    monthlyDiscountPct: pct30,
    deposit: Number(promo.deposit) || 0,
    lateFeePerDay: Number(promo.late_fee_per_day) || 0,
    // Flat fee in POST /order/reserve for a paid priority reservation.
    // It is not a percent and it is not the Trophy deposit.
    priorityFee: 100,
    trialHours: 3,
    payments: paymentFacts(src.paymentMethods),
    psplus,
    ps4Primary: 'PS4 Primary is a Trophy-style account: the refundable deposit applies, and it is priced like Non-Trophy. It is only offered on games that run on PS4 (platform PS4 or PS4/PS5).',
    ordering: 'Order on the website: pick a game, choose Non-Trophy, Trophy, or PS4 Primary when the game supports PS4, then Weekly or Monthly, then pay.',
    priceGuide: 'weeklyNow and monthlyNow are what checkout charges. weekly and monthly are the price-category amounts before the promo. A percent above 0 is already subtracted inside the Now price. Quote the Now price. When you mention the percent, also say the category amount it came off. Do not subtract the percent again.',
    trial: 'There is a 3-hour free trial on our account before you commit. Say the game in this chat.',
    reservations: 'The waitlist is free. An optional priority fee moves you ahead of that free list and is taken off the rent when a slot opens. A Coming Soon game can reserve a slot: pay the list price in full now (the monthly promo does not apply) and nothing more is due on release. Paying the checkout price is how you order an open slot on a released game. You do not have to pay just to keep a place.'
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

// Released games and Coming Soon titles are different records. A question
// can name either, and the reply has to say which one it found.
function searchCatalog(games, upcoming, query) {
  const live = searchGames(games, query).map(g => Object.assign({}, g, { comingSoon: false }));
  const soon = searchGames(upcoming, query).map(g => Object.assign({}, g, { comingSoon: true }));
  return live.concat(soon).slice(0, 3);
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
  const soon = !!(game && game.comingSoon);
  const ps4 = showsPs4(game) && !soon;
  const waitKnown = waitlist != null;
  const w = waitlist || {};
  const card = {
    title: String(game && game.title || ''),
    platform: String(game && game.platform || ''),
    path: (soon ? '/upcoming/' : '/game/') + slug(game && game.title) + (soon && game.id ? '-' + game.id : ''),
    comingSoon: soon,
    slots: {
      nonTrophy: Number(a.ntSlots) || 0,
      trophy: Number(a.trSlots) || 0
    },
    waitlistKnown: waitKnown,
    // Coming Soon is paid at list price. The monthly promo is a released-game
    // checkout rule and does not change a reservation.
    prices: soon ? {
      nonTrophyWeekly: Number(game.nt_price_7d) || 0,
      nonTrophyMonthly: Number(game.nt_price_30d) || 0,
      trophyWeekly: Number(game.tr_price_7d) || 0,
      trophyMonthly: Number(game.tr_price_30d) || 0
    } : quotedPrices(game, promo)
  };
  if (soon && game.release_date) card.releaseDate = String(game.release_date);
  if (waitKnown) {
    card.waitlist = {
      nonTrophy: Number(w.nonTrophy) || 0,
      trophy: Number(w.trophy) || 0
    };
  }
  if (ps4) {
    card.slots.ps4Primary = Number(a.ps4Slots) || 0;
    if (waitKnown) card.waitlist.ps4Primary = Number(w.ps4Primary) || 0;
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
    en: 'Okay — I paused this chat and flagged an admin. They’ll reply here. 🙋',
    fil: 'Sige po — naka-pause po ang chat na ito at na-flag ko ang admin. Siya na po ang sasagot dito. 🙋',
    mix: 'Sige po — I paused this chat and na-flag ko ang admin. They’ll reply here. 🙋'
  },
  payment_or_dispute: {
    en: 'Payment proofs and disputes go to an admin, not the bot. I’ve paused this chat so they can check it here. 🧾',
    fil: 'Ang proof of payment at dispute, sa admin na po — hindi sa bot. Naka-pause po ito para matingnan dito. 🧾',
    mix: 'Payment proofs and disputes, sa admin na po. Paused na po ang chat para matingnan dito. 🧾'
  },
  cannot_help: {
    en: 'I can’t answer that safely, so I’m passing you to an admin. This chat is paused until they reply here. 🙋',
    fil: 'Di ko po kaya itong sagutin ng tama, kaya ipapasa ko po kayo sa admin. Naka-pause po ang chat hanggang sumagot sila dito. 🙋',
    mix: 'Di ko po kaya ito sagutin ng tama, so I’m passing you to an admin. Paused po ang chat until they reply here. 🙋'
  },
  attachment: {
    en: 'Got your photo. I’m pausing the bot so an admin can check it here. 📷',
    fil: 'Nakuha ko po ang photo. Naka-pause po ang bot para matingnan ng admin dito. 📷',
    mix: 'Got your photo. Naka-pause po ang bot para matingnan ng admin dito. 📷'
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

function pricePair(weekly, monthly, categoryMonthly) {
  const month = peso(monthly) + '/month' + (categoryMonthly && categoryMonthly !== monthly ? ' (category ' + peso(categoryMonthly) + ')' : '');
  return peso(weekly) + '/week | ' + month;
}

function tierBlock(t) {
  const lines = [
    t.name,
    '',
    '- Non-Trophy: ' + pricePair(t.nonTrophy.weeklyNow, t.nonTrophy.monthlyNow, t.nonTrophy.monthly),
    '- Trophy Account: ' + pricePair(t.trophy.weeklyNow, t.trophy.monthlyNow, t.trophy.monthly)
  ];
  return lines.join('\n');
}

function orderBlock(lang, url) {
  return pick(lang, {
    en: 'Order here:\n' + url,
    fil: 'Mag-order po dito:\n' + url,
    mix: 'Order po dito:\n' + url
  });
}

function priceBlurb(facts, lang) {
  const f = facts || {};
  const url = f.orderUrl || '/browse';
  const blocks = [pick(lang, {
    en: 'Here’s what checkout charges today. 🎮',
    fil: 'Ito po ang singil sa checkout ngayon. 🎮',
    mix: 'Ito po ang checkout price ngayon. 🎮'
  })];
  const tiers = (f.pricing || []).slice(0, 4);
  if (!tiers.length) {
    blocks.push(pick(lang, {
      en: 'Open a game on the site for its Weekly and Monthly price.',
      fil: 'Buksan po ang laro sa site para sa Weekly at Monthly price.',
      mix: 'Open a game po sa site para sa Weekly and Monthly price.'
    }));
  } else {
    tiers.forEach(t => blocks.push(tierBlock(t)));
  }
  if (f.monthlyDiscountPct > 0) {
    blocks.push(pick(lang, {
      en: 'The ' + f.monthlyDiscountPct + '% monthly promo is already taken off the category price.',
      fil: 'Kasama na po ang ' + f.monthlyDiscountPct + '% monthly promo sa presyo ng buwan.',
      mix: 'The ' + f.monthlyDiscountPct + '% monthly promo is kasama na po sa month price.'
    }));
  }
  if (f.weeklyDiscountPct > 0) {
    blocks.push(pick(lang, {
      en: 'The ' + f.weeklyDiscountPct + '% weekly promo is already in the week price.',
      fil: 'Kasama na po ang ' + f.weeklyDiscountPct + '% weekly promo sa presyo ng linggo.',
      mix: 'The ' + f.weeklyDiscountPct + '% weekly promo is kasama na po sa week price.'
    }));
  }
  if (f.deposit) {
    blocks.push(pick(lang, {
      en: 'Trophy and PS4 Primary add a ' + peso(f.deposit) + ' refundable deposit.',
      fil: 'May ' + peso(f.deposit) + ' po na refundable deposit ang Trophy at PS4 Primary.',
      mix: 'Trophy and PS4 Primary, may ' + peso(f.deposit) + ' po na refundable deposit.'
    }));
  }
  if (f.psplus) {
    blocks.push('PS Plus Deluxe\n- Non-Trophy: ' + peso(f.psplus.nonTrophyWeekly) + '/week | ' + peso(f.psplus.nonTrophyMonthly) + '/month');
  }
  blocks.push(orderBlock(lang, url));
  return blocks.join('\n\n');
}

function howTo(facts, lang) {
  const f = facts || {};
  const url = f.orderUrl || '/browse';
  const deposit = f.deposit
    ? pick(lang, {
      en: ' Trophy and PS4 Primary include a ' + peso(f.deposit) + ' refundable deposit.',
      fil: ' May ' + peso(f.deposit) + ' po na refundable deposit ang Trophy at PS4 Primary.',
      mix: ' Trophy and PS4 Primary, may ' + peso(f.deposit) + ' po na refundable deposit.'
    })
    : '';
  return pick(lang, {
    en: 'Pick a game, then Non-Trophy, Trophy, or PS4 Primary. 🎮\n\nChoose Weekly or Monthly.\n\nSign-in is a code on your console. We never ask for your PSN password.' + (deposit ? '\n\n' + deposit.trim() : '') + '\n\nStart here:\n' + url,
    fil: 'Pumili po ng laro, Non-Trophy, Trophy, o PS4 Primary. 🎮\n\nTapos Weekly o Monthly.\n\nCode po ang sign-in. Hindi po namin hihingi ang PSN password mo.' + (deposit ? '\n\n' + deposit.trim() : '') + '\n\nDito po magsimula:\n' + url,
    mix: 'Pick a game po, then Non-Trophy, Trophy, or PS4 Primary. 🎮\n\nTapos Weekly or Monthly.\n\nSign-in code lang po. We never ask for your PSN password.' + (deposit ? '\n\n' + deposit.trim() : '') + '\n\nStart po here:\n' + url
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
    ? pick(lang, { en: 'Outside the Philippines, use PayPal.', fil: 'Sa ibang bansa po, PayPal.', mix: 'Abroad po, PayPal.' })
    : pick(lang, { en: 'PayPal shows up for international customers when it’s on.', fil: 'Lalabas po ang PayPal para sa international kapag naka-on.', mix: 'PayPal shows up abroad po when it’s on.' });
  return pick(lang, {
    en: 'In the Philippines, pay by ' + localEn + '. 💳\n\n' + abroad + '\n\n' + orderBlock('en', url),
    fil: 'Sa Pilipinas po, ' + localFil + '. 💳\n\n' + abroad + '\n\n' + orderBlock('fil', url),
    mix: 'Sa Pilipinas po, ' + (local.length ? joinOr('en', local) + ' QR at checkout' : 'GCash or Maya QR') + '. 💳\n\n' + abroad + '\n\n' + orderBlock('mix', url)
  });
}

function asksSlots(text) {
  return /\b(slots?|available|availability|meron|mayroon|sold out|fully booked)\b/i.test(String(text || ''));
}

function slotWord(n) {
  return Number(n) === 1 ? 'slot' : 'slots';
}

function slotStatus(n, lang) {
  const count = Number(n) || 0;
  if (count <= 0) return lang === 'en' ? 'No slots available' : 'Wala pong available slot';
  return count + ' ' + slotWord(count) + ' available';
}

// Fixed layout for “may slot ba?”. The model does not write this. Blank lines
// separate the greeting, the title, each account, the link, and the admin line.
function slotReply(card, facts, lang) {
  const f = facts || {};
  const polite = lang !== 'en';
  const slots = (card && card.slots) || {};
  const prices = (card && card.prices) || {};
  const fee = peso(f.priorityFee || 100);
  const types = [
    { label: 'Non-Trophy', n: slots.nonTrophy || 0, week: prices.nonTrophyWeekly, month: prices.nonTrophyMonthly, deposit: false },
    { label: 'Trophy Account', n: slots.trophy || 0, week: prices.trophyWeekly, month: prices.trophyMonthly, deposit: true }
  ];
  if (slots.ps4Primary != null) {
    types.push({
      label: 'PS4 Primary',
      n: slots.ps4Primary || 0,
      week: prices.nonTrophyWeekly,
      month: prices.nonTrophyMonthly,
      deposit: true
    });
  }
  const anyOpen = types.some(t => t.n > 0);
  const blocks = [];
  blocks.push(polite
    ? (anyOpen ? 'Hello po! Yes po, meron pa po. 🎮' : 'Hello po! Wala na po munang available slot. 🎮')
    : (anyOpen ? 'Hello! Yes, we have slots available. 🎮' : 'Hello! No slots available right now. 🎮'));
  blocks.push((card && card.title ? card.title : 'That game') + (card && card.platform ? ' (' + card.platform + ')' : ''));
  if (!anyOpen) {
    blocks.push(polite
      ? 'Libre pong waitlist. Optional na ' + fee + ' priority fee para mauna, at ibabawas iyan sa rent pag may slot.'
      : 'The waitlist is free. An optional ' + fee + ' priority fee moves you ahead, and it comes off the rent when a slot opens.');
  } else {
    types.forEach(t => {
      const lines = ['- ' + t.label + ': ' + slotStatus(t.n, polite ? 'fil' : 'en')];
      if (t.n > 0) {
        lines.push('  ' + peso(t.week) + '/week | ' + peso(t.month) + '/month');
        if (t.deposit && f.deposit) {
          lines.push('  + ' + peso(f.deposit) + ' security deposit (refundable upon returning the account)');
        }
      } else {
        lines.push(polite
          ? '  Libre pong waitlist, o optional na ' + fee + ' priority fee.'
          : '  Free waitlist, or an optional ' + fee + ' priority fee.');
      }
      blocks.push(lines.join('\n'));
    });
  }
  const url = (f.siteUrl || '') + ((card && card.path) || '');
  blocks.push((polite ? 'Mag-order po dito:\n' : 'Order here:\n') + url);
  return blocks.join('\n\n');
}

function gameBlurb(card, facts, lang) {
  const f = facts || {};
  const prices = (card && card.prices) || {};
  const blocks = [card.title + (card.platform ? ' (' + card.platform + ')' : '')];
  if (card.comingSoon) {
    const when = card.releaseDate ? ' (' + card.releaseDate + ')' : '';
    blocks.push(pick(lang, {
      en: 'Coming Soon' + when + '. You can reserve a slot and pay the list price in full now. Nothing more is due on release. The monthly promo does not apply.',
      fil: 'Coming Soon po ito' + when + '. Puwede po mag-reserve ng slot, bayad nang buo sa list price ngayon. Wala na pong dagdag sa release. Hindi po kasama ang monthly promo.',
      mix: 'Coming Soon po ito' + when + '. You can reserve a slot and pay the list price in full now. Wala nang dagdag po on release.'
    }));
  }
  const lines = [
    '- Non-Trophy: ' + peso(prices.nonTrophyWeekly) + '/week | ' + peso(prices.nonTrophyMonthly) + '/month',
    '- Trophy Account: ' + peso(prices.trophyWeekly) + '/week | ' + peso(prices.trophyMonthly) + '/month'
  ];
  if (f.deposit) lines.push('  + ' + peso(f.deposit) + ' security deposit (refundable upon returning the account)');
  blocks.push(lines.join('\n'));
  const url = (f.siteUrl || '') + (card.path || '');
  blocks.push(pick(lang, {
    en: (card.comingSoon ? 'Reserve it:\n' : 'Rent it:\n') + url,
    fil: (card.comingSoon ? 'Mag-reserve po dito:\n' : 'Mag-rent po dito:\n') + url,
    mix: (card.comingSoon ? 'Reserve po dito:\n' : 'Rent po dito:\n') + url
  }));
  return blocks.join('\n\n');
}

// Used when there is no model key, or the model call fails. Same facts the
// model would have been given, so the two paths cannot quote different prices.
// The model is given prices as JSON numbers, so it often writes "349 weekly"
// and "refundable 100 deposit". Plain-text cleanup does not remove ₱.
// This puts the sign back on shop amounts and on any other bare amount
// (3 or more digits), and leaves percents, day counts, and slot counts alone.
function moneySet(facts) {
  const set = new Set();
  const f = facts || {};
  function add(n) {
    const v = Number(n);
    if (Number.isFinite(v) && v > 0) set.add(v);
  }
  add(f.deposit);
  add(f.lateFeePerDay);
  add(f.priorityFee);
  (f.pricing || []).forEach(t => {
    ['nonTrophy', 'trophy'].forEach(side => {
      const p = t[side] || {};
      add(p.weekly);
      add(p.monthly);
      add(p.weeklyNow);
      add(p.monthlyNow);
    });
  });
  const plus = f.psplus || {};
  add(plus.nonTrophyWeekly);
  add(plus.nonTrophyMonthly);
  add(plus.trophyWeekly);
  add(plus.trophyMonthly);
  return set;
}

const NOT_MONEY_AFTER = /^(?:\s*)(?:%|days?\b|hours?\b|hrs?\b|slots?\b|people\b|persons?\b|open\b|minutes?\b)/i;

function ensurePeso(text, facts) {
  const known = moneySet(facts);
  const s = String(text == null ? '' : text);
  return s.replace(/(^|[^0-9₱A-Za-z#\-])(\d{1,3}(?:,\d{3})+|\d+)(?!\d)/g, (full, pre, num, offset) => {
    const after = s.slice(offset + full.length);
    if (NOT_MONEY_AFTER.test(after)) return full;
    // "₱349" never reaches here (₱ is not a prefix). "₱ 349" does, because
    // the space is the prefix — leave that sign in place.
    if (/₱\s*$/.test(s.slice(0, offset + pre.length))) return full;
    const value = Number(String(num).replace(/,/g, ''));
    if (!value) return full;
    if (value >= 1900 && value <= 2099) return full;
    if (!known.has(value) && String(value).length < 3) return full;
    return pre + '₱' + num;
  });
}

function adminCta(lang) {
  return pick(lang, {
    en: 'Reply ADMIN to talk to a person.',
    fil: 'Reply ADMIN po para makausap ang admin.',
    mix: 'Reply ADMIN po to talk to a person.'
  });
}

function withAdminCta(text, lang) {
  const body = String(text || '').replace(/\n?Reply ADMIN\b[^\n]*/gi, '').trim();
  const line = adminCta(lang || 'en');
  return body ? body + '\n\n' + line : line;
}

function finishReply(message, result) {
  if (!result || result.handoff) return result;
  result.text = withAdminCta(result.text, replyLanguage(message));
  return result;
}

const NOT_A_TITLE = /^(new games|regular|weekly|monthly|week|month|weeks|months|trophy|non trophy|nontrophy|ps plus|plus|prices?|price|deposit|priority|waitlist|reservation|reserve|trial|password|psn|ps4|ps5|primary|admin|human|rental|rent|game|games|slot|slots|new)$/;

function titleHint(text) {
  let t = String(text || '').toLowerCase();
  t = t.replace(SEARCH_FILLER, ' ');
  t = t.replace(/\b(can|i|to|my|your|without|paying|pay|before|free|trial|password|psn|deposit|late|admin|human|please|thanks|po|ba|ang|ng|sa|ako|mo|coming|soon|reserve|reservation|priority|waitlist|want|wanna|like|just|it|this|that|and|or|for|a|an|the|of|me|us|our|on|in|if|when|how|much|what|is|are|do|you|have|has|fee|line|pila)\b/g, ' ');
  t = t.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 3) return '';
  if (NOT_A_TITLE.test(t)) return '';
  if (t.split(' ').length === 1 && t.length < 5) return '';
  return t;
}

function needsLiveGame(text) {
  const hint = titleHint(text);
  if (!hint) return false;
  return /\b(available|availability|slots?|waitlist|meron|mayroon|sold out|fully booked|ilan|how much|magkano|presyo|halaga|price|prices|\bcost\b|reserve|reservation|coming soon)\b/i.test(String(text || ''));
}

function asksPolicy(text) {
  return /\b(waitlist|priority|coming soon|reserve|reservation|without paying|fall in line|pila|trial|try before|subukan|password)\b/i.test(String(text || ''));
}

function unsure(text) {
  return /\b(i don'?t know|i do not know|not sure|di ko (po )?sure|hindi ko alam|di ko alam|no idea)\b/i.test(String(text || ''));
}

function toolFailure(lang) {
  return pick(lang, {
    en: 'I couldn’t check the live list just now, so I won’t guess. 🙋',
    fil: 'Di ko po nacheck ang live list ngayon, kaya di ako maghuhula. 🙋',
    mix: 'Di ko po nacheck ang live list just now, so I won’t guess. 🙋'
  });
}

function reserveReply(facts, lang) {
  const f = facts || {};
  const fee = peso(f.priorityFee || 100);
  return pick(lang, {
    en: 'You can reserve without paying. 🎮\n\nA sold-out game has a free waitlist.\n\nAn optional ' + fee + ' priority fee moves you ahead, and that ' + fee + ' comes off the rent when a slot opens.\n\nA Coming Soon game can reserve a slot: pay the list price in full now, and nothing more is due on release.\n\nAn open slot on a released game is ordered on the site at the checkout price.',
    fil: 'Puwede po mag-reserve nang hindi muna nagbabayad. 🎮\n\nLibre po ang waitlist kapag ubos ang slot.\n\nOptional na ' + fee + ' priority fee para mauna, at ibabawas po iyan sa rent pag may slot.\n\nAng Coming Soon, puwede pong i-reserve: bayad nang buo sa list price ngayon, wala nang dagdag sa release.\n\nAng bukas na slot ng released game, sa site po i-order sa checkout price.',
    mix: 'Puwede po mag-reserve without paying. 🎮\n\nA sold-out game has a free waitlist.\n\nOptional ' + fee + ' priority fee moves you ahead, and ibabawas po iyan sa rent when a slot opens.\n\nComing Soon can reserve a slot: pay the list price in full now, wala nang dagdag po on release.\n\nAn open slot is ordered on the site at the checkout price.'
  });
}

function policyReply(message, facts, lang) {
  const low = String(message || '').toLowerCase();
  const f = facts || {};
  if (/\b(password|psn)\b/.test(low)) {
    return pick(lang, {
      en: 'No. We never ask for your PSN password. 🎮\n\nSign-in is a code on your console, and our account signs in there.',
      fil: 'Hindi po. Hindi po namin hihingi ang PSN password mo. 🎮\n\nCode po ang sign-in sa console mo, at ang account namin ang papasok doon.',
      mix: 'No. We never ask for your PSN password. 🎮\n\nCode po ang sign-in sa console mo, and our account signs in there.'
    });
  }
  if (/\b(trial|try before|subukan)\b/.test(low)) {
    const hours = f.trialHours || 3;
    return pick(lang, {
      en: 'Yes. There is a ' + hours + '-hour free trial on our account before you commit. 🎮\n\nSay which game you want to try.',
      fil: 'Yes po. May ' + hours + ' oras na free trial sa account namin bago ka mag-commit. 🎮\n\nSabihin po kung anong laro.',
      mix: 'Yes po. May ' + hours + '-hour free trial on our account before you commit. 🎮\n\nSay which game you want to try.'
    });
  }
  return reserveReply(f, lang);
}

function missingTitle(lang) {
  return pick(lang, {
    en: 'I couldn’t find that title in the live list, so I won’t guess a slot or a price. 🎮 A sold-out game still has a free waitlist, and a Coming Soon game can reserve a slot without paying the rent up front.',
    fil: 'Wala po sa live list ang title na iyan, kaya di ako maghuhula ng slot o presyo. 🎮 Libre pa rin po ang waitlist kapag ubos, at ang Coming Soon puwede pong i-reserve nang hindi muna binabayaran ang buong rent.',
    mix: 'Wala po sa live list ang title na iyan, so I won’t guess a slot or a price. 🎮 Libre pa rin po ang waitlist if it’s full, and a Coming Soon game can reserve a slot.'
  });
}

function rescueReply(message, facts, modelText, card) {
  const lang = replyLanguage(message);
  const text = String(modelText || '');
  if (asksSlots(message) && card && card.title) return slotReply(card, facts, lang);
  if (card && card.title) {
    const named = text.toLowerCase().includes(String(card.title).toLowerCase());
    if (!named || unsure(text)) return gameBlurb(card, facts, lang);
    return text;
  }
  if (needsLiveGame(message) && unsure(text)) return missingTitle(lang);
  if (asksPolicy(message) && unsure(text)) return policyReply(message, facts, lang);
  return text;
}

async function fallbackReply(message, facts, lookup) {
  const text = String(message || '').trim();
  const lang = replyLanguage(text);
  const reason = handoffReason(text);
  if (reason) return finishReply(text, { text: handoffText(reason, lang), handoff: true, reason });

  const low = text.toLowerCase();
  const url = (facts && facts.orderUrl) || '/browse';
  if (!low || /^(hi|hello|hey|uy|oi|sup|start|help|menu|kamusta|musta|helo|good morning|good afternoon|good evening)\b/.test(low)) {
    return finishReply(text, {
      text: pick(lang, {
        en: 'Hi! 👋 We rent PS4 and PS5 games. Ask a title, or say “prices”.',
        fil: 'Hi po! 👋 Nagre-rent po kami ng PS4 at PS5 games. Sabihin po ang title, o “presyo”.',
        mix: 'Hi po! 👋 PS4/PS5 rentals kami. Ask a title, or sabihin po “presyo”.'
      }),
      handoff: false,
      reason: null
    });
  }
  if (/\b(password|psn password)\b/.test(low) || /\b(trial|try before|subukan)\b/.test(low)) {
    return finishReply(text, { text: policyReply(text, facts, lang), handoff: false, reason: null });
  }
  if (needsLiveGame(text)) {
    if (typeof lookup !== 'function') {
      return finishReply(text, { text: toolFailure(lang), handoff: false, reason: null });
    }
    let hits;
    try { hits = await lookup(text); }
    catch (e) { return finishReply(text, { text: toolFailure(lang), handoff: false, reason: null }); }
    hits = hits || [];
    if (hits.length) {
      const body = asksSlots(text) ? slotReply(hits[0], facts, lang) : gameBlurb(hits[0], facts, lang);
      return finishReply(text, { text: body, handoff: false, reason: null });
    }
    return finishReply(text, { text: missingTitle(lang), handoff: false, reason: null });
  }
  if (asksPolicy(text)) {
    return finishReply(text, { text: policyReply(text, facts, lang), handoff: false, reason: null });
  }
  if (/price|magkano|how much|presyo|halaga|\bcost\b/.test(low)) {
    return finishReply(text, { text: priceBlurb(facts, lang), handoff: false, reason: null });
  }
  if (/gcash|maya|paypal|bayad|payment|how (do i|to) pay/.test(low)) {
    return finishReply(text, { text: payBlurb(facts, lang), handoff: false, reason: null });
  }
  if (/how.*(rent|order|start)|pano|paano|how to rent|rental guide/.test(low)) {
    return finishReply(text, { text: howTo(facts, lang), handoff: false, reason: null });
  }
  if (/deposit|ps4 primary|late fee|late return/.test(low)) {
    const dep = facts && facts.deposit ? peso(facts.deposit) : '';
    const late = facts && facts.lateFeePerDay ? peso(facts.lateFeePerDay) : '';
    return finishReply(text, {
      text: pick(lang, {
        en: 'PS4 Primary is a Trophy-style account at the Non-Trophy price, only for PS4 games. 🎮\n\n' + (dep ? 'Deposit is ' + dep + ', refundable, for Trophy and PS4 Primary.\n\n' : '') + (late ? 'A late return is ' + late + ' a day from that deposit.\n\n' : '') + 'Non-Trophy has no deposit.\n\nSee a game:\n' + url,
        fil: 'Ang PS4 Primary po ay Trophy-style account sa presyo ng Non-Trophy, para lang po sa PS4 games. 🎮\n\n' + (dep ? 'Deposit na ' + dep + ' po, refundable, para sa Trophy at PS4 Primary.\n\n' : '') + (late ? 'Ang late return, ' + late + ' po bawat araw mula sa deposit.\n\n' : '') + 'Walang deposit ang Non-Trophy.\n\nTingnan po ang laro:\n' + url,
        mix: 'PS4 Primary is a Trophy-style account at the Non-Trophy price, PS4 games lang po. 🎮\n\n' + (dep ? 'Deposit is ' + dep + ' po, refundable, for Trophy and PS4 Primary.\n\n' : '') + (late ? 'A late return is ' + late + ' a day from that deposit.\n\n' : '') + 'Non-Trophy has no deposit.\n\nSee a game:\n' + url
      }),
      handoff: false,
      reason: null
    });
  }
  if (typeof lookup === 'function') {
    let hits;
    try { hits = await lookup(text); }
    catch (e) { return finishReply(text, { text: toolFailure(lang), handoff: false, reason: null }); }
    hits = hits || [];
    if (hits.length) return finishReply(text, { text: gameBlurb(hits[0], facts, lang), handoff: false, reason: null });
  }
  return finishReply(text, {
    text: pick(lang, {
      en: 'Send a game title, or say “prices”. 🙋',
      fil: 'Sabihin po ang title ng laro, o “presyo”. 🙋',
      mix: 'Send a game title, or sabihin po “presyo”. 🙋'
    }),
    handoff: false,
    reason: null
  });
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
  fallbackReply, scrub, slug, toPlainText, replyLanguage, ensurePeso,
  searchCatalog, needsLiveGame, asksSlots, asksPolicy, unsure, withAdminCta, adminCta,
  toolFailure, rescueReply, policyReply, slotReply
};
