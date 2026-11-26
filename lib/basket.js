// Multi-game basket totals. Prices come from lib/rent-pricing (the same list
// price a single rental uses). A voucher is accepted or rejected by
// lib/vouchers; this module does not add codes or change those rules.
// MONTHLY10 therefore still applies to monthly lines only, and the deposit
// is never discounted. The basket keeps centavos (10% of ₱699 is ₱69.90).
// A single-game checkout still uses vouchers.quote's whole-peso rounding.

const rentPricing = require('./rent-pricing');
const vouchers = require('./vouchers');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function formatPeso(n) {
  const v = round2(n);
  const body = Number.isInteger(v) ? String(v) : v.toFixed(2);
  const parts = body.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function typeName(type) {
  return type === 'tr' ? 'Trophy' : type === 'ps4' ? 'PS4 Primary' : 'Non-Trophy';
}

function planName(days) {
  return Number(days) === 30 ? 'Monthly' : 'Weekly';
}

function priceLines(games, selections, depositEach) {
  const list = Array.isArray(games) ? games : [];
  const byId = new Map(list.map(g => [String(g && g.id), g]));
  const seen = new Set();
  const lines = [];
  const errors = [];
  (selections || []).forEach(sel => {
    const id = sel && sel.game_id != null ? String(sel.game_id) : '';
    const type = ['nt', 'tr', 'ps4'].includes(sel && sel.account_type) ? sel.account_type : '';
    const days = parseInt(sel && sel.days, 10);
    if (!id || !type || (days !== 7 && days !== 30)) {
      errors.push('Pick an account type and Weekly or Monthly.');
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    const game = byId.get(id);
    if (!game) {
      errors.push('That game is no longer listed.');
      return;
    }
    const price = rentPricing.listPrice(game, type, days);
    if (!price) {
      errors.push((game.title || 'That game') + ' has no ' + planName(days).toLowerCase() + ' price for that account.');
      return;
    }
    const deposit = (type === 'tr' || type === 'ps4') ? Math.max(0, Number(depositEach) || 0) : 0;
    lines.push({
      game_id: game.id,
      game_title: game.title,
      account_type: type,
      type_name: typeName(type),
      days,
      plan: planName(days),
      price: round2(price),
      deposit: round2(deposit),
      cover: game.cover_image || ''
    });
  });
  const subtotal = round2(lines.reduce((sum, line) => sum + line.price, 0));
  const deposit = round2(lines.reduce((sum, line) => sum + line.deposit, 0));
  return {
    ok: errors.length === 0 && lines.length > 0,
    errors,
    lines,
    subtotal,
    deposit
  };
}

function noteFor(code, pct, discount, lines) {
  const monthly = lines.filter(line => line.days === 30);
  if (!monthly.length) return code + ' applied.';
  const weekly = lines.some(line => line.days !== 30);
  const from = monthly.length === 1
    ? '₱' + formatPeso(discount) + ' from ' + monthly[0].game_title + ' (₱' + formatPeso(monthly[0].price) + ')'
    : '₱' + formatPeso(discount) + ' across ' + monthly.map(line => line.game_title).join(', ');
  return code + ' applied. ' + pct + '% off monthly lines only — ' + from + '.' +
    (weekly ? ' Weekly lines are unchanged.' : '');
}

function present(priced, extra) {
  const src = extra || {};
  const discount = round2(src.discount || 0);
  const amount = round2(priced.subtotal - discount);
  const total = round2(amount + priced.deposit);
  return {
    ok: true,
    code: src.code || '',
    promo_id: src.promo_id || '',
    pct: Number(src.pct) || 0,
    discount,
    subtotal: priced.subtotal,
    deposit: priced.deposit,
    amount_due: amount,
    total,
    lines: priced.lines,
    note: src.code ? noteFor(src.code, Number(src.pct) || 0, discount, priced.lines) : '',
    labels: {
      subtotal: formatPeso(priced.subtotal),
      discount: formatPeso(discount),
      deposit: formatPeso(priced.deposit),
      amount: formatPeso(amount),
      total: formatPeso(total)
    }
  };
}

function rejected(priced, quoted) {
  const quote = quoted || {};
  const plain = present(priced, {});
  const unknown = quote.error === 'unknown' || quote.error === 'empty';
  return {
    ok: false,
    error: quote.error || 'invalid',
    message: unknown ? 'Code not valid' : (quote.message || 'Code not valid'),
    detail: quote.message || '',
    lines: plain.lines,
    subtotal: plain.subtotal,
    deposit: plain.deposit,
    discount: 0,
    amount_due: plain.amount_due,
    total: plain.total,
    labels: plain.labels
  };
}

// quoted is a successful vouchers.quote result, or a blank code.
// The discount is pct of the monthly lines only, in centavos. Weekly lines
// stay at list price. Deposit is added after the discount and is not reduced.
function fromValidated(priced, quoted) {
  if (!priced || !priced.ok) {
    return {
      ok: false,
      error: 'lines',
      message: (priced && priced.errors && priced.errors[0]) || 'Your basket is empty.'
    };
  }
  const quote = quoted || {};
  const code = vouchers.codeOf(quote.code);
  if (!code) return present(priced, {});
  const monthly = round2(priced.lines.filter(line => line.days === 30).reduce((sum, line) => sum + line.price, 0));
  const pct = Number(quote.pct) || 0;
  const discount = round2(monthly * pct / 100);
  return present(priced, {
    code: quote.code,
    promo_id: quote.promo_id,
    pct,
    discount
  });
}

function applyCode(priced, src) {
  const input = src || {};
  if (!priced || !priced.ok) {
    return {
      ok: false,
      error: 'lines',
      message: (priced && priced.errors && priced.errors[0]) || 'Your basket is empty.'
    };
  }
  const code = vouchers.codeOf(input.code);
  if (!code) return fromValidated(priced, {});
  const monthly = round2(priced.lines.filter(line => line.days === 30).reduce((sum, line) => sum + line.price, 0));
  const days = monthly > 0 ? 30 : 7;
  const base = monthly > 0 ? monthly : priced.subtotal;
  const quoted = vouchers.quote({
    code,
    days,
    base,
    deposit: priced.deposit,
    now: input.now,
    offers: input.offers,
    name: input.name || '',
    priorOrders: input.priorOrders || [],
    identity: input.identity,
    loyaltyBlocked: !!input.loyaltyBlocked
  });
  if (!quoted.ok) return rejected(priced, quoted);
  return fromValidated(priced, quoted);
}

module.exports = {
  round2,
  formatPeso,
  priceLines,
  fromValidated,
  applyCode,
  rejected,
  present
};
