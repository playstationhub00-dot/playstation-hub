// Extending a rental: how many extra days, from when, and for how much.
//
// This used to be three fields edited by hand on the customer form — days, end
// date, price — with nothing connecting them and no message saying an extension
// had happened. The money side already understood it (lib/payments.js files a
// price rise as a 'extension' payment dated today); what was missing was
// everything around that.
//
// Pure: no dates read from the clock unless a caller declines to supply one, no
// database, no settings. The route hands in the price tier and today's date.

const rentPricing = require('./rent-pricing');

const DAY_MS = 86400000;

function isDay(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
}

function addDays(ymd, n) {
  const t = Date.parse(ymd + 'T00:00:00Z');
  if (isNaN(t)) return null;
  return new Date(t + n * DAY_MS).toISOString().slice(0, 10);
}

// The new return date. Counted from whichever is LATER: the date their rental
// currently ends, or today.
//
// From their own end date, someone with three days left who buys a week ends up
// with ten — they keep what they already paid for. But once that date has
// passed, counting from it would hand back days that are already gone: a week
// bought today on a rental that ended three days ago would expire in four. So
// an expired rental restarts from today.
function nextEnd(currentEnd, days, today) {
  const d = Number(days);
  if (!Number.isInteger(d) || d < 1) return null;
  const from = isDay(currentEnd) && isDay(today) && currentEnd > today ? currentEnd
    : isDay(today) ? today
    : isDay(currentEnd) ? currentEnd
    : null;
  if (!from) return null;
  return addDays(from, d);
}

// The whole extension, priced and dated. `tier` is the promo-adjusted
// {7, 30} pair the rest of the app prices from, so extra days cost what the
// same days would cost on a fresh rental — including any running promo.
// Returns null when there is nothing sane to charge and no override to fall
// back on, rather than quietly recording a free week.
function build(input) {
  const src = input || {};
  const d = Number(src.days);
  if (!Number.isInteger(d) || d < 1) return null;

  const endDate = nextEnd(src.currentEnd, d, src.today);
  if (!endDate) return null;

  const hasOverride = src.override !== null && src.override !== undefined
    && String(src.override).trim() !== '' && Number(src.override) >= 0;
  const priced = rentPricing.amountForDays(d, src.tier || {});
  if (!hasOverride && !priced) return null;

  return {
    days: d,
    amount: hasOverride ? Math.round(Number(src.override)) : priced.amount,
    endDate,
    fromEnd: isDay(src.currentEnd) ? src.currentEnd : '',
    prorated: hasOverride ? false : priced.prorated,
    overridden: hasOverride
  };
}

// The row kept on the customer, mirroring how swap_history records a game swap.
// Totals are stored rather than recomputed later so the history still reads
// correctly after any later hand-edit of days or price.
function record(input) {
  const src = input || {};
  const days = Number(src.days) || 0;
  const amount = Number(src.amount) || 0;
  return {
    at: src.at || new Date().toISOString(),
    days,
    amount,
    from_end_date: src.fromEnd || '',
    end_date: src.endDate || '',
    days_total: (Number(src.prevDays) || 0) + days,
    price_total: (Number(src.prevPrice) || 0) + amount
  };
}

module.exports = { nextEnd, build, record };
