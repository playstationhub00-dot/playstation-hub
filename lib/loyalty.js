// Loyalty offers over the rental ledger. The ledger has no customer id that
// means a person — each row is one rental — so a person is every row whose
// name matches once case and extra whitespace are folded, plus any names or
// single rows an admin has linked. Nothing here writes to the database.
//
// A paid rental is a row with status renting or done whose payments add up
// to more than zero. An explicit empty payments list is an unpaid Quick Add
// (the price is what they owe, not what they paid). A missing payments list
// on an older row is the price itself, which is how those rows were stored
// before payments existed. Purchases and reservations are not rentals.
// Extensions live on the same row, so they never add a second punch.
//
// Punch card: walk the paid rentals in start-date order. Each one is one
// punch, or two when trophy rentals count double and the row is account_type
// 'tr'. Every Nth punch (default 5) earns one free rental of reward_days
// (default 7). Progress is punches mod N, and a multiple lands on 0 of N
// toward the next one.
//
// Rebook: a paid rental earns ₱rebook_amount off when its start date is 0 to
// rebook_within_days calendar days after the previous paid rental's end date
// (the previous one is the paid rental with the latest end on or before this
// start). Separately, if their latest rental that has already ended is still
// inside that window and they have not started another, the discount is open
// until end + within days, inclusive. Asia/Manila dates are YYYY-MM-DD
// strings the caller passes in; this file does not read the clock except
// manilaToday(), which matches lib/orders.js.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DEFAULT_SETTINGS = Object.freeze({
  punch_enabled: true,
  punch_every: 5,
  reward_days: 7,
  rebook_enabled: true,
  rebook_amount: 50,
  rebook_within_days: 7,
  trophy_double: false
});

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeSettings(raw) {
  const s = raw || {};
  return {
    punch_enabled: s.punch_enabled !== false,
    punch_every: clampInt(s.punch_every, DEFAULT_SETTINGS.punch_every, 1, 100),
    reward_days: clampInt(s.reward_days, DEFAULT_SETTINGS.reward_days, 1, 365),
    rebook_enabled: s.rebook_enabled !== false,
    rebook_amount: clampInt(s.rebook_amount, DEFAULT_SETTINGS.rebook_amount, 0, 100000),
    rebook_within_days: clampInt(s.rebook_within_days, DEFAULT_SETTINGS.rebook_within_days, 0, 365),
    trophy_double: s.trophy_double === true
  };
}

function settingsFromForm(body) {
  body = body || {};
  return normalizeSettings({
    punch_enabled: body.punch_enabled === 'on',
    punch_every: body.punch_every,
    reward_days: body.reward_days,
    rebook_enabled: body.rebook_enabled === 'on',
    rebook_amount: body.rebook_amount,
    rebook_within_days: body.rebook_within_days,
    trophy_double: body.trophy_double === 'on'
  });
}

function normalizeName(raw) {
  return String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ').toLowerCase();
}

function displayNameOf(raw) {
  return String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
}

function manilaToday(now) {
  const at = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
  if (isNaN(at.getTime())) return '';
  return new Date(at.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(ymd, n) {
  const parts = String(ymd || '').split('-').map(Number);
  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return '';
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const ap = String(a || '').split('-').map(Number);
  const bp = String(b || '').split('-').map(Number);
  if (!ap[0] || !bp[0]) return null;
  return Math.round((Date.UTC(bp[0], bp[1] - 1, bp[2]) - Date.UTC(ap[0], ap[1] - 1, ap[2])) / 86400000);
}

function formatYmd(ymd) {
  const parts = String(ymd || '').split('-').map(Number);
  if (!parts[0] || !parts[1] || !parts[2] || !MONTHS[parts[1] - 1]) return '';
  return MONTHS[parts[1] - 1] + ' ' + parts[2] + ', ' + parts[0];
}

function formatManila(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const manila = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  let hour = manila.getUTCHours();
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  const minute = String(manila.getUTCMinutes()).padStart(2, '0');
  return MONTHS[manila.getUTCMonth()] + ' ' + manila.getUTCDate() + ', ' + manila.getUTCFullYear()
    + ', ' + hour + ':' + minute + ' ' + ampm;
}

function paymentSum(row) {
  if (!row) return 0;
  if (!Array.isArray(row.payments)) return Number(row.price) || 0;
  return row.payments.reduce((sum, p) => sum + (Number(p && p.amount) || 0), 0);
}

function isPaidRental(row) {
  if (!row) return false;
  if (row.status !== 'renting' && row.status !== 'done') return false;
  return paymentSum(row) > 0;
}

function blankIdentity() {
  return { aliases: {}, rows: {} };
}

function identityOf(identity) {
  const src = identity || {};
  return {
    aliases: Object.assign({}, src.aliases || {}),
    rows: Object.assign({}, src.rows || {})
  };
}

// Follow alias chains. null means the chain loops, which a save must refuse.
function canonicalName(identity, name) {
  const aliases = (identity && identity.aliases) || {};
  let key = normalizeName(name);
  const seen = new Set();
  while (aliases[key]) {
    if (seen.has(key)) return null;
    seen.add(key);
    const next = normalizeName(aliases[key]);
    if (!next) break;
    key = next;
  }
  return key;
}

function rowKey(identity, row) {
  const pinned = ((identity && identity.rows) || {})[String(row && row.id)];
  if (pinned) {
    const pinnedKey = canonicalName(identity, pinned);
    if (pinnedKey) return pinnedKey;
  }
  return canonicalName(identity, row && row.customer_name) || '';
}

function mergeNames(identity, fromRaw, intoRaw) {
  const from = normalizeName(fromRaw);
  const intoLabel = normalizeName(intoRaw);
  if (!from || !intoLabel) return { ok: false, error: 'blank' };
  const into = canonicalName(identity, intoRaw);
  if (!into) return { ok: false, error: 'cycle' };
  if (from === into) return { ok: false, error: 'same' };
  const next = identityOf(identity);
  next.aliases[from] = into;
  if (canonicalName(next, from) == null) return { ok: false, error: 'cycle' };
  Object.keys(next.aliases).forEach(k => {
    if (k !== from && normalizeName(next.aliases[k]) === from) next.aliases[k] = into;
  });
  Object.keys(next.rows).forEach(id => {
    if (normalizeName(next.rows[id]) === from || canonicalName(identity, next.rows[id]) === from) {
      next.rows[id] = into;
    }
  });
  return { ok: true, identity: next };
}

function linkNameToRow(identity, name, rowId, customers) {
  const row = (customers || []).find(c => c && Number(c.id) === Number(rowId));
  if (!row) return { ok: false, error: 'no_row' };
  const into = rowKey(identity, row);
  if (!into) return { ok: false, error: 'blank' };
  return mergeNames(identity, name, into);
}

function linkRowToName(identity, rowId, name) {
  const id = parseInt(rowId, 10);
  const into = canonicalName(identity, name);
  if (!id || !into) return { ok: false, error: 'blank' };
  const next = identityOf(identity);
  next.rows[String(id)] = into;
  return { ok: true, identity: next };
}

function removeLink(identity, body) {
  const next = identityOf(identity);
  body = body || {};
  if (body.alias) delete next.aliases[normalizeName(body.alias)];
  if (body.row_id != null && String(body.row_id) !== '') delete next.rows[String(parseInt(body.row_id, 10))];
  return next;
}

function punchWeight(row, settings) {
  if (settings.trophy_double && row.account_type === 'tr') return 2;
  return 1;
}

function compareRentals(a, b) {
  const as = a.start_date || '';
  const bs = b.start_date || '';
  if (as !== bs) return as < bs ? -1 : 1;
  return (Number(a.id) || 0) - (Number(b.id) || 0);
}

function windowUsed(redemptions, prevId, pairKey) {
  return (redemptions || []).some(r => r && r.kind === 'rebook' && (
    r.opportunity_key === pairKey || r.opportunity_key === 'open:' + prevId
  ));
}

function rebookFor(paid, redemptions, settings, today) {
  const within = settings.rebook_within_days;
  const opportunities = [];
  paid.forEach(row => {
    let prev = null;
    paid.forEach(other => {
      if (!other || other === row || !other.end_date || !row.start_date) return;
      if (other.end_date > row.start_date) return;
      if (!prev || other.end_date > prev.end_date || (other.end_date === prev.end_date && (Number(other.id) || 0) > (Number(prev.id) || 0))) {
        prev = other;
      }
    });
    if (!prev) return;
    const gap = daysBetween(prev.end_date, row.start_date);
    if (gap == null || gap < 0 || gap > within) return;
    const key = prev.id + '->' + row.id;
    const used = windowUsed(redemptions, prev.id, key);
    opportunities.push({
      key,
      prev_id: prev.id,
      rental_id: row.id,
      game_title: row.game_title || '',
      start_date: row.start_date,
      expires: addDays(prev.end_date, within),
      amount: settings.rebook_amount,
      available: settings.rebook_enabled && !used
    });
  });

  let last = null;
  paid.forEach(row => {
    if (!row.end_date || !today || row.end_date > today) return;
    if (!last || row.end_date > last.end_date || (row.end_date === last.end_date && (Number(row.id) || 0) > (Number(last.id) || 0))) {
      last = row;
    }
  });

  let eligible = false;
  let expires = '';
  if (last) {
    expires = addDays(last.end_date, within);
    const startedAfter = opportunities.some(o => o.prev_id === last.id);
    const used = windowUsed(redemptions, last.id, 'open:' + last.id);
    const gap = daysBetween(last.end_date, today);
    eligible = settings.rebook_enabled && !startedAfter && !used && gap != null && gap >= 0 && gap <= within;
    if (eligible) {
      opportunities.push({
        key: 'open:' + last.id,
        prev_id: last.id,
        rental_id: null,
        game_title: '',
        start_date: '',
        expires,
        amount: settings.rebook_amount,
        available: true
      });
    }
  }

  const unredeemed = opportunities.filter(o => o.available).length;
  return {
    eligible,
    expires: eligible ? expires : '',
    amount: settings.rebook_amount,
    unredeemed,
    opportunities
  };
}

function bestDisplayName(rows) {
  const counts = new Map();
  rows.forEach(row => {
    const shown = displayNameOf(row.customer_name);
    if (!shown) return;
    counts.set(shown, (counts.get(shown) || 0) + 1);
  });
  let best = '';
  let n = 0;
  counts.forEach((count, name) => {
    if (count > n) { best = name; n = count; }
  });
  return best || 'Unnamed customer';
}

function build(customers, opts) {
  opts = opts || {};
  const settings = normalizeSettings(opts.settings || DEFAULT_SETTINGS);
  const identity = identityOf(opts.identity);
  const today = opts.today || manilaToday(new Date());
  const redemptions = Array.isArray(opts.redemptions) ? opts.redemptions : [];
  const groups = new Map();
  (customers || []).forEach(row => {
    if (!row) return;
    const key = rowKey(identity, row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const profiles = [];
  groups.forEach((rows, key) => {
    const paid = rows.filter(isPaidRental).slice().sort(compareRentals);
    if (!paid.length) return;
    let punches = 0;
    paid.forEach(row => { punches += punchWeight(row, settings); });
    const every = settings.punch_every;
    const earned = Math.floor(punches / every);
    const progress = punches % every;
    const mine = redemptions.filter(r => r && (canonicalName(identity, r.profile_key) || normalizeName(r.profile_key)) === key);
    const redeemedIndexes = new Set();
    mine.forEach(r => {
      if (r.kind === 'punch' && r.reward_index >= 1 && r.reward_index <= earned) redeemedIndexes.add(r.reward_index);
    });
    const redeemedPunch = redeemedIndexes.size;
    const availablePunch = settings.punch_enabled ? Math.max(0, earned - redeemedPunch) : 0;
    const rebook = rebookFor(paid, mine, settings, today);
    const hasReward = availablePunch > 0 || (settings.rebook_enabled && (rebook.eligible || rebook.unredeemed > 0));
    const names = [];
    rows.forEach(row => {
      const n = normalizeName(row.customer_name);
      if (n && names.indexOf(n) === -1) names.push(n);
    });
    const name = bestDisplayName(rows);
    profiles.push({
      key,
      name,
      names,
      rows: rows.slice(),
      rowIds: rows.map(r => r.id),
      rentals: paid,
      rentalCount: paid.length,
      punches,
      every,
      progress,
      toNext: progress === 0 ? every : every - progress,
      earned,
      availablePunch,
      redeemedPunch,
      rebook,
      hasReward,
      settings,
      redemptions: mine.slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))),
      search: ''
    });
  });

  profiles.forEach(p => {
    const games = p.rows.map(r => (r.game_title || '') + ' ' + (r.order_ref || '')).join(' ');
    p.search = [p.name, p.key].concat(p.names).concat([games]).join(' ').toLowerCase();
  });
  profiles.sort((a, b) => (b.hasReward - a.hasReward) || a.name.localeCompare(b.name));

  const byName = {};
  const byRowId = {};
  profiles.forEach(p => {
    byName[p.key] = p;
    p.names.forEach(n => { byName[n] = p; });
    p.rowIds.forEach(id => { byRowId[String(id)] = p; });
  });
  Object.keys(identity.aliases).forEach(alias => {
    const dest = canonicalName(identity, alias);
    if (dest && byName[dest]) byName[alias] = byName[dest];
  });

  function profileFor(query) {
    query = query || {};
    let profile = null;
    if (query.rowId != null && String(query.rowId) !== '') profile = byRowId[String(query.rowId)] || null;
    if (!profile && query.name) {
      const key = canonicalName(identity, query.name);
      profile = (key && byName[key]) || null;
    }
    return profile;
  }

  function rewardFor(query) {
    const profile = profileFor(query);
    if (!profile || !profile.hasReward) return null;
    const parts = [];
    if (profile.availablePunch > 0) {
      parts.push(profile.availablePunch + ' free rental' + (profile.availablePunch === 1 ? '' : 's'));
    }
    if (profile.settings.rebook_enabled && (profile.rebook.eligible || profile.rebook.unredeemed > 0)) {
      parts.push('₱' + profile.rebook.amount + ' rebook');
    }
    return { title: parts.join(' · ') || 'Reward available', key: profile.key };
  }

  const links = Object.keys(identity.aliases).map(from => ({
    type: 'alias', from, into: identity.aliases[from]
  })).concat(Object.keys(identity.rows).map(id => ({
    type: 'row', rowId: Number(id), into: identity.rows[id]
  })));

  return { profiles, byName, byRowId, profileFor, rewardFor, settings, identity, links, today };
}

function parseChoice(choice) {
  const s = String(choice || '');
  if (s.indexOf('punch:') === 0) return { kind: 'punch', reward_index: parseInt(s.slice(6), 10) };
  if (s.indexOf('rebook:') === 0) return { kind: 'rebook', opportunity_key: s.slice(7) };
  return null;
}

function readAmount(raw, fallback) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

function planRedemption(profile, input, nowIso) {
  input = input || {};
  if (!profile) return { ok: false, error: 'no_profile' };
  const choice = parseChoice(input.choice);
  if (!choice) return { ok: false, error: 'bad_choice' };
  const rentalId = parseInt(input.rental_id, 10);
  const rentalOk = Number.isFinite(rentalId) && rentalId > 0;
  const orderRef = String(input.order_ref || '').trim().slice(0, 40);
  if (!rentalOk && !orderRef) return { ok: false, error: 'need_target' };
  if (rentalOk && !(profile.rows || []).some(r => Number(r.id) === rentalId)) {
    return { ok: false, error: 'not_their_rental' };
  }
  const settings = profile.settings || normalizeSettings(DEFAULT_SETTINGS);
  const at = nowIso || new Date().toISOString();
  const note = String(input.note || '').trim().slice(0, 200);
  const base = {
    kind: choice.kind,
    profile_key: profile.key,
    reward_index: null,
    opportunity_key: '',
    rental_id: rentalOk ? rentalId : null,
    order_ref: orderRef,
    amount: 0,
    days: null,
    at,
    by: 'admin',
    note
  };

  if (choice.kind === 'punch') {
    if (!settings.punch_enabled) return { ok: false, error: 'punch_off' };
    const index = choice.reward_index;
    if (!(index >= 1 && index <= profile.earned)) return { ok: false, error: 'no_reward' };
    const taken = (profile.redemptions || []).some(r => r && r.kind === 'punch' && r.reward_index === index);
    if (taken) return { ok: false, error: 'already' };
    base.reward_index = index;
    base.days = settings.reward_days;
    base.amount = readAmount(input.amount, 0);
    return { ok: true, record: base };
  }

  if (!settings.rebook_enabled) return { ok: false, error: 'rebook_off' };
  const opp = (profile.rebook.opportunities || []).find(o => o.key === choice.opportunity_key && o.available);
  if (!opp) return { ok: false, error: 'no_reward' };
  base.opportunity_key = opp.key;
  base.amount = readAmount(input.amount, opp.amount);
  if (!base.rental_id && opp.rental_id) base.rental_id = opp.rental_id;
  return { ok: true, record: base };
}

function nextPunchOffer(profile) {
  if (!profile || !profile.settings || !profile.settings.punch_enabled || profile.availablePunch < 1) return null;
  for (let i = 1; i <= profile.earned; i++) {
    const taken = (profile.redemptions || []).some(r => r && r.kind === 'punch' && r.reward_index === i);
    if (!taken) {
      const days = profile.settings.reward_days;
      return {
        choice: 'punch:' + i,
        kind: 'punch',
        days,
        label: 'Apply free ' + days + '-day rental'
      };
    }
  }
  return null;
}

function nextRebookOffer(profile) {
  if (!profile || !profile.settings || !profile.settings.rebook_enabled || !profile.rebook) return null;
  const list = profile.rebook.opportunities || [];
  const open = list.find(o => o && o.available && String(o.key).indexOf('open:') === 0);
  const pick = open || list.find(o => o && o.available);
  if (!pick) return null;
  const label = String(pick.key).indexOf('open:') === 0
    ? ('Apply ₱' + pick.amount + ' off (open until ' + formatYmd(pick.expires) + ')')
    : ('Apply ₱' + pick.amount + ' rebook discount');
  return {
    choice: 'rebook:' + pick.key,
    kind: 'rebook',
    amount: pick.amount,
    expires: pick.expires || '',
    label
  };
}

// What Quick Add shows while the owner is typing a name. `profile` is the
// same object the Loyalty tab uses (already folded through aliases and
// pinned rows). A name with no paid rentals is a new customer.
function addFormStatus(profile, settings) {
  settings = normalizeSettings((profile && profile.settings) || settings || DEFAULT_SETTINGS);
  const offers = [];
  const punch = nextPunchOffer(profile);
  const rebook = nextRebookOffer(profile);
  if (punch) offers.push(punch);
  if (rebook) offers.push(rebook);
  const base = {
    known: !!profile,
    blank: false,
    name: profile ? profile.name : '',
    rentalCount: profile ? profile.rentalCount : 0,
    punches: profile ? profile.punches : 0,
    progress: profile ? profile.progress : 0,
    every: settings.punch_every,
    toNext: profile ? profile.toNext : settings.punch_every,
    rewardDays: settings.reward_days,
    availablePunch: profile ? profile.availablePunch : 0,
    punchEnabled: settings.punch_enabled,
    rebookEnabled: settings.rebook_enabled,
    rebookOpen: !!(profile && profile.rebook && profile.rebook.eligible),
    rebookAmount: settings.rebook_amount,
    rebookExpires: (profile && profile.rebook && profile.rebook.eligible) ? profile.rebook.expires : '',
    offers,
    lines: [],
    headline: ''
  };
  if (!settings.punch_enabled && !settings.rebook_enabled) {
    base.headline = 'Loyalty offers are off';
    base.lines = [base.headline];
    return base;
  }
  if (!profile) {
    base.headline = settings.punch_enabled ? 'New customer, 0 punches' : 'New customer';
    if (settings.punch_enabled) {
      base.lines.push('New customer, 0 punches');
      base.lines.push('0 paid rentals · 0/' + settings.punch_every + ' toward a free ' + settings.reward_days + '-day rental');
    } else {
      base.lines.push('New customer');
    }
    if (settings.rebook_enabled) base.lines.push('No rebook discount open');
    return base;
  }
  if (settings.punch_enabled) {
    const rentals = profile.rentalCount + ' paid rental' + (profile.rentalCount === 1 ? '' : 's');
    const punches = profile.punches + ' punch' + (profile.punches === 1 ? '' : 'es');
    base.lines.push(rentals + ' · ' + punches);
    base.lines.push(profile.progress + '/' + profile.every + ' toward a free ' + settings.reward_days + '-day rental');
    if (profile.availablePunch > 0) {
      base.lines.push(profile.availablePunch + ' free rental' + (profile.availablePunch === 1 ? '' : 's') + ' available');
    }
  } else {
    base.lines.push(profile.rentalCount + ' paid rental' + (profile.rentalCount === 1 ? '' : 's'));
  }
  if (settings.rebook_enabled && profile.rebook && profile.rebook.eligible) {
    base.lines.push('₱' + profile.rebook.amount + ' rebook discount open until ' + formatYmd(profile.rebook.expires));
  } else if (settings.rebook_enabled && profile.rebook && profile.rebook.unredeemed > 0) {
    base.lines.push('₱' + profile.rebook.amount + ' rebook discount available');
  } else if (settings.rebook_enabled) {
    base.lines.push('No rebook discount open');
  }
  base.headline = base.lines[0] || '';
  return base;
}

function offerByChoice(profile, choice) {
  const status = addFormStatus(profile, profile && profile.settings);
  return (status.offers || []).find(o => o.choice === String(choice || '')) || null;
}

// Price of the rental being added, after one reward. A free rental of exactly
// reward_days is ₱0. Any other length keeps its price and subtracts the value
// of that free rental. A rebook discount subtracts its amount. Neither goes
// below zero. The deposit is not part of amountDue.
function adjustedRent(amountDue, offer, opts) {
  opts = opts || {};
  const amount = Math.max(0, parseInt(amountDue, 10) || 0);
  if (!offer) return { amountDue: amount, credited: 0 };
  if (offer.kind === 'punch') {
    if (parseInt(opts.days, 10) === parseInt(offer.days, 10)) {
      return { amountDue: 0, credited: amount };
    }
    const week = Math.max(0, parseInt(opts.weekValue, 10) || 0);
    const next = Math.max(0, amount - week);
    return { amountDue: next, credited: amount - next };
  }
  if (offer.kind === 'rebook') {
    const off = Math.max(0, parseInt(offer.amount, 10) || 0);
    const next = Math.max(0, amount - off);
    return { amountDue: next, credited: amount - next };
  }
  return { amountDue: amount, credited: 0 };
}

function prepareApply(profile, choice, pricing) {
  pricing = pricing || {};
  const offer = offerByChoice(profile, choice);
  if (!offer) return { ok: false, error: 'unavailable' };
  if (pricing.mode && pricing.mode !== 'rent') return { ok: false, error: 'not_rental' };
  if (offer.kind === 'punch'
      && parseInt(pricing.days, 10) !== parseInt(offer.days, 10)
      && !(parseInt(pricing.weekValue, 10) > 0)) {
    return { ok: false, error: 'no_credit' };
  }
  const adjusted = adjustedRent(pricing.amountDue, offer, {
    days: pricing.days,
    weekValue: pricing.weekValue
  });
  return {
    ok: true,
    offer,
    amountDue: adjusted.amountDue,
    credited: adjusted.credited
  };
}

function customerCopy(profile) {
  if (!profile || !profile.rentalCount) return { show: false, punchLine: '', rewardLine: '', rebookLine: '', headline: '' };
  const settings = profile.settings || normalizeSettings(DEFAULT_SETTINGS);
  if (!settings.punch_enabled && !settings.rebook_enabled) {
    return { show: false, punchLine: '', rewardLine: '', rebookLine: '', headline: '' };
  }
  let punchLine = '';
  let rewardLine = '';
  let rebookLine = '';
  if (settings.punch_enabled) {
    const rentals = profile.rentalCount + ' paid rental' + (profile.rentalCount === 1 ? '' : 's');
    punchLine = rentals + ' · ' + profile.progress + '/' + profile.every
      + ' toward a free ' + settings.reward_days + '-day rental';
    if (profile.availablePunch > 0) {
      const n = profile.availablePunch;
      rewardLine = 'You have ' + n + ' free ' + settings.reward_days + '-day rental'
        + (n === 1 ? '' : 's') + ' waiting — message us to use ' + (n === 1 ? 'it' : 'them') + '.';
    }
  }
  if (settings.rebook_enabled && profile.rebook && profile.rebook.eligible) {
    rebookLine = '₱' + profile.rebook.amount + ' off a new rental until ' + formatYmd(profile.rebook.expires) + '.';
  } else if (settings.rebook_enabled && profile.rebook && profile.rebook.unredeemed > 0) {
    rebookLine = '₱' + profile.rebook.amount + ' off is ready on a rental you started soon after the last one — message us to use it.';
  }
  if (!punchLine && !rewardLine && !rebookLine) {
    return { show: false, punchLine: '', rewardLine: '', rebookLine: '', headline: '' };
  }
  return { show: true, headline: 'Loyalty', punchLine, rewardLine, rebookLine };
}

module.exports = {
  DEFAULT_SETTINGS,
  normalizeSettings,
  settingsFromForm,
  normalizeName,
  manilaToday,
  addDays,
  daysBetween,
  formatYmd,
  formatManila,
  isPaidRental,
  canonicalName,
  mergeNames,
  linkNameToRow,
  linkRowToName,
  removeLink,
  build,
  planRedemption,
  customerCopy,
  addFormStatus,
  offerByChoice,
  adjustedRent,
  prepareApply
};
