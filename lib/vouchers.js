// Promo codes that change what checkout charges. A code is a field on a
// catalog promo (Admin → Loyalty → Promos), not a second list. MONTHLY10 is
// seeded once; after that the admin record is the source of truth, so
// editing or deleting it sticks.
//
// Dates are Asia/Manila calendar days, inclusive, same as lib/promos.js.
// An offer that ends on Nov 30 is valid through 23:59:59 that day and dead
// at 00:00 on Dec 1. The deposit is never part of the discount.

const loyalty = require('./loyalty');
const promos = require('./promos');

const MONTHLY10_ID = 'monthly10';

function pesoDiscount(base, pct) {
  const b = Number(base) || 0;
  const p = Number(pct) || 0;
  if (b <= 0 || p <= 0) return 0;
  // 10% of ₱799 is ₱79.90, which rounds to ₱80. Math.round is half away from 0.
  return Math.round(b * p / 100);
}

function codeOf(value) {
  return String(value == null ? '' : value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
}

function monthly10Offer() {
  return {
    id: MONTHLY10_ID,
    title: 'MONTHLY10',
    text: '10% off monthly rentals with code MONTHLY10. One use per customer.',
    terms: 'Works on monthly rentals only. One code per order, so it cannot be combined with another code, the ₱50 comeback discount, or Rewards. The refundable deposit is not discounted. Ends Nov 30, 2026 at 11:59 PM, Philippines time.',
    starts_on: '',
    ends_on: '2026-11-30',
    enabled: true,
    game_id: null,
    badge: '',
    featured: false,
    code: 'MONTHLY10',
    discount_pct: 10,
    duration_days: 30,
    once_per_customer: true,
    exclude_loyalty: true
  };
}

// alreadySeeded means this process (or a previous one) already tried. A
// later delete or edit is left alone. A code that is already stored, even
// under another id, is not duplicated.
function seedMonthly10(stored, alreadySeeded) {
  const list = promos.normalizeList(stored);
  if (alreadySeeded) return { offers: list, seeded: true, added: false };
  if (list.some(o => codeOf(o.code) === 'MONTHLY10')) {
    return { offers: list, seeded: true, added: false };
  }
  list.push(monthly10Offer());
  return { offers: list, seeded: true, added: true };
}

function samePerson(identity, a, b) {
  const book = identity || { aliases: {}, rows: {} };
  const left = loyalty.canonicalName(book, a);
  const right = loyalty.canonicalName(book, b);
  return !!(left && right && left === right);
}

function usedByCustomer(code, name, orders, identity) {
  const key = codeOf(code);
  return (orders || []).some(row => {
    if (!row || codeOf(row.promo_code) !== key) return false;
    if (row.state === 'cancelled' || row.state === 'payment_rejected') return false;
    return samePerson(identity, name, row.fb_name);
  });
}

function endsLabel(ymd) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return '';
  return months[Number(m[2]) - 1] + ' ' + Number(m[3]);
}

function finePrint(offer) {
  const bits = [];
  const pct = Number(offer.discount_pct) || 0;
  if (pct && Number(offer.duration_days) === 30) bits.push(pct + '% off monthly rentals');
  else if (pct && Number(offer.duration_days) === 7) bits.push(pct + '% off weekly rentals');
  else if (pct) bits.push(pct + '% off');
  if (offer.once_per_customer) bits.push('one use per customer');
  const when = endsLabel(offer.ends_on);
  if (when) bits.push('ends ' + when + '.');
  return bits.join(' · ');
}

function findCode(offers, code) {
  const key = codeOf(code);
  if (!key) return null;
  return (offers || []).find(o => o && codeOf(o.code) === key) || null;
}

function monthlyOnlyMessage(code) {
  return codeOf(code) + ' works on monthly rentals only. Switch to Monthly?';
}

function oneCodeMessage(applied) {
  return 'Only one code per order. Remove ' + codeOf(applied) + ' first if you\'d like to use this one instead.';
}

// The numbers checkout stores. base is the list price for that type and
// duration. The code replaces any automatic percent; it does not stack on
// it, and it does not touch the deposit.
function settle(quote) {
  if (!quote || !quote.ok) return null;
  return {
    amount_due: quote.amount_due,
    deposit_due: quote.deposit,
    promo_code: quote.code,
    promo_discount: quote.discount,
    promo_id: quote.promo_id,
    promo_pct: quote.pct
  };
}

function quote(input) {
  const src = input || {};
  const code = codeOf(src.code);
  const applied = codeOf(src.appliedCode);
  if (applied && code && applied !== code) {
    return { ok: false, error: 'one_code', message: oneCodeMessage(applied), code: applied };
  }
  if (!code) return { ok: false, error: 'empty', message: 'Enter a code.' };

  const offers = promos.normalizeList(src.offers);
  const offer = findCode(offers, code);
  if (!offer) return { ok: false, error: 'unknown', message: 'That code isn\'t valid.' };

  const today = loyalty.manilaToday(src.now == null ? new Date() : src.now);
  if (!offer.enabled) {
    return { ok: false, error: 'disabled', message: offer.code + ' is turned off.', code: offer.code };
  }
  if (offer.ends_on && today > offer.ends_on) {
    const when = endsLabel(offer.ends_on);
    const year = String(offer.ends_on).slice(0, 4);
    return {
      ok: false,
      error: 'expired',
      message: offer.code + ' ended on ' + when + ', ' + year + '.',
      code: offer.code
    };
  }
  if (offer.starts_on && today < offer.starts_on) {
    return { ok: false, error: 'not_started', message: offer.code + ' isn\'t available yet.', code: offer.code };
  }
  if (!promos.isLive(offer, today)) {
    return { ok: false, error: 'unavailable', message: offer.code + ' isn\'t available.', code: offer.code };
  }

  const days = parseInt(src.days, 10);
  const limit = Number(offer.duration_days) || 0;
  if (limit && days !== limit) {
    if (limit === 30) {
      return {
        ok: false,
        error: 'monthly_only',
        message: monthlyOnlyMessage(offer.code),
        action: 'Switch to Monthly?',
        code: offer.code
      };
    }
    return {
      ok: false,
      error: 'duration',
      message: offer.code + ' doesn\'t apply to this rental length.',
      code: offer.code
    };
  }

  const name = String(src.name || '').trim();
  if (name && src.loyaltyBlocked && offer.exclude_loyalty) {
    return {
      ok: false,
      error: 'loyalty',
      message: offer.code + ' can\'t be combined with Rewards or the ₱50 comeback discount.',
      code: offer.code
    };
  }
  if (name && offer.once_per_customer && usedByCustomer(offer.code, name, src.priorOrders, src.identity)) {
    return { ok: false, error: 'used', message: 'You\'ve already used ' + offer.code + '.', code: offer.code };
  }

  const base = Number(src.base) || 0;
  if (base <= 0) return { ok: false, error: 'price', message: 'That rental has no price.', code: offer.code };
  const deposit = Math.max(0, Number(src.deposit) || 0);
  const discount = pesoDiscount(base, offer.discount_pct);
  const amount = base - discount;
  return {
    ok: true,
    provisional: !name,
    code: offer.code,
    promo_id: offer.id,
    pct: Number(offer.discount_pct) || 0,
    duration_days: limit,
    discount,
    base,
    deposit,
    amount_due: amount,
    total: amount + deposit,
    fine: finePrint(offer),
    label: offer.code + ' (−' + (Number(offer.discount_pct) || 0) + '%)'
  };
}

function hintFor(live) {
  const hit = (live || []).find(o => o && codeOf(o.code) && Number(o.duration_days) === 30 && Number(o.discount_pct) > 0);
  if (!hit) return null;
  return { code: codeOf(hit.code), pct: Number(hit.discount_pct) || 0 };
}

module.exports = {
  MONTHLY10_ID,
  pesoDiscount,
  codeOf,
  monthly10Offer,
  seedMonthly10,
  usedByCustomer,
  finePrint,
  monthlyOnlyMessage,
  oneCodeMessage,
  settle,
  quote,
  hintFor
};
