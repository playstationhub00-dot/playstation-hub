// USD/PHP rate handling for the PayPal panel's dollar estimate.
//
// Pure functions only — the fetch itself lives in server.js beside the other
// outbound calls. Everything here decides whether a rate is usable and which
// one to use, so the whole fallback chain is testable without a network.
//
// See docs/superpowers/specs/2026-09-03-paypal-international-payments-design.md.

// A garbage filter, not a market prediction. The band is deliberately wide:
// its only job is to stop a broken API response, an HTML error page or a
// redirect body from rendering "$0.02" or "$4,000" on a checkout panel.
const RATE_MIN = 30;
const RATE_MAX = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

// Strings are rejected, including numeric ones — a rate arrives from the API
// as a number or not at all. Accepting '62.58' would mean accepting whatever
// else a malformed payload happened to put in that field.
function isSaneRate(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= RATE_MIN && n <= RATE_MAX;
}

// Stale at exactly the threshold, and stale whenever the timestamp is missing
// or unparseable — an unknown age is never treated as fresh.
function isStale(fetchedAt, now, maxAgeMs) {
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return true;
  const limit = Number.isFinite(Number(maxAgeMs)) ? Number(maxAgeMs) : DAY_MS;
  return (Number(now) - t) >= limit;
}

// Rounds to the NEAREST cent, not up. This is labelled an estimate on the page
// and the peso figure is what is actually charged, so there is no
// under-recovery to guard against — inflating it would only make the estimate
// less accurate.
function pesosToUsd(pesos, rate) {
  const p = Number(pesos);
  if (!Number.isFinite(p) || p <= 0 || !isSaneRate(rate)) return 0;
  return Math.round((p / rate) * 100) / 100;
}

// The fallback chain in one place. 'live' only for a cache that is both fresh
// AND sane — freshness alone must not qualify a rate, since a recently-cached
// 0 is still 0. Everything else falls through to the manual rate, which is
// coerced because it arrives from an HTML settings form as a string. If that
// is unusable too, RATE_MIN is returned so the caller always has a number and
// the panel can still render.
function pickRate(cache, manualRate, now) {
  const c = cache || {};
  if (isSaneRate(c.rate) && !isStale(c.fetched_at, now, DAY_MS)) {
    return { rate: c.rate, source: 'live' };
  }
  const manual = Number(manualRate);
  if (isSaneRate(manual)) return { rate: manual, source: 'manual' };
  return { rate: RATE_MIN, source: 'manual' };
}

module.exports = { RATE_MIN, RATE_MAX, DAY_MS, isSaneRate, isStale, pesosToUsd, pickRate };
