// Traffic tab numbers from the shop's own visit log. No Google Analytics
// figures are invented here: a GA4 measurement tag in the page footer is not
// a Data API feed, and this module never emits a GA4 count.
//
// Periods match the windows the dashboard already used (UTC dates on the
// visit rows): today is that calendar day, 7 days is every row on or after
// the day seven 24-hour stretches ago, and so on.

const seo = require('./seo');
const ordersLib = require('./orders');
const filter = require('./visitor-filter');

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ymdFromMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(ymd, n) {
  const t = Date.parse(ymd + 'T00:00:00Z');
  if (!Number.isFinite(t)) return '';
  return new Date(t + n * DAY).toISOString().slice(0, 10);
}

function cleanDay(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const t = Date.parse(s + 'T00:00:00Z');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toISOString().slice(0, 10) === s ? s : '';
}

function fmtDay(ymd) {
  const parts = String(ymd || '').split('-');
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!m || !d) return '';
  return d + ' ' + MONTHS[m - 1];
}

function fmtRange(from, to) {
  if (!from) return '';
  if (!to || from === to) return fmtDay(from);
  return fmtDay(from) + ' to ' + fmtDay(to);
}

function spanExact(day, label, priorDay, compareLabel) {
  return {
    key: 'day',
    from: day,
    to: day,
    label,
    compareLabel,
    inWindow: d => d === day,
    prior: priorDay ? (d => d === priorDay) : null
  };
}

function spanFrom(from, label, priorFrom, compareLabel) {
  return {
    key: 'range',
    from,
    to: '',
    label,
    compareLabel,
    inWindow: d => !!d && d >= from,
    prior: priorFrom ? (d => !!d && d >= priorFrom && d < from) : null
  };
}

function spans(nowMs) {
  const t = Number.isFinite(nowMs) ? nowMs : Date.now();
  const today = ymdFromMs(t);
  const weekFrom = ymdFromMs(t - 7 * DAY);
  const monthFrom = ymdFromMs(t - 30 * DAY);
  const yearFrom = ymdFromMs(t - 365 * DAY);
  const yest = addDays(today, -1);
  return {
    today: Object.assign(spanExact(today, 'Today', yest, 'vs yesterday (' + fmtDay(yest) + ')'), { key: 'today' }),
    week: Object.assign(spanFrom(
      weekFrom,
      '7 days',
      ymdFromMs(t - 14 * DAY),
      'vs previous 7 days (' + fmtRange(ymdFromMs(t - 14 * DAY), addDays(weekFrom, -1)) + ')'
    ), { key: 'week' }),
    month: Object.assign(spanFrom(
      monthFrom,
      '30 days',
      ymdFromMs(t - 60 * DAY),
      'vs previous 30 days (' + fmtRange(ymdFromMs(t - 60 * DAY), addDays(monthFrom, -1)) + ')'
    ), { key: 'month' }),
    year: Object.assign(spanFrom(
      yearFrom,
      'Past year',
      ymdFromMs(t - 730 * DAY),
      'Past year, vs the year before (' + fmtRange(ymdFromMs(t - 730 * DAY), addDays(yearFrom, -1)) + ')'
    ), { key: 'year' }),
    all: {
      key: 'all',
      from: '',
      to: '',
      label: 'All time',
      compareLabel: 'All time. No earlier period to compare.',
      inWindow: () => true,
      prior: null
    }
  };
}

function customSpan(fromRaw, toRaw) {
  const from = cleanDay(fromRaw);
  const to = cleanDay(toRaw);
  if (!from || !to || from > to) return null;
  const len = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY) + 1;
  if (len > 400) return null;
  const priorTo = addDays(from, -1);
  const priorFrom = addDays(from, -len);
  return {
    key: 'custom',
    from,
    to,
    label: fmtRange(from, to),
    compareLabel: 'vs previous ' + len + ' day' + (len === 1 ? '' : 's') + ' (' + fmtRange(priorFrom, priorTo) + ')',
    inWindow: d => !!d && d >= from && d <= to,
    prior: d => !!d && d >= priorFrom && d <= priorTo
  };
}

function daySpan(day) {
  const clean = cleanDay(day);
  if (!clean) return null;
  const prior = addDays(clean, -1);
  return spanExact(clean, fmtDay(clean), prior, 'Showing ' + fmtDay(clean) + ', vs ' + fmtDay(prior));
}

function dated(inWindow, date) {
  return !!date && inWindow(date);
}

function probeCount(visitors, inWindow) {
  return (visitors || []).filter(v => v && dated(inWindow, v.date) && filter.isProbePath(v.path)).length;
}

function humanPage(v) {
  return v && !filter.isSystemPath(v.path) && !filter.isProbePath(v.path) && !filter.isOrderStatePath(v.path);
}

function topPages(visitors, inWindow, limit) {
  const counts = new Map();
  (visitors || []).forEach(v => {
    if (!humanPage(v) || !dated(inWindow, v.date)) return;
    const key = v.page || v.path || '';
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit || 5);
}

function recentFor(visitors, inWindow, limit) {
  const cap = limit || 40;
  const out = [];
  const rows = visitors || [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i];
    if (!humanPage(v) || !dated(inWindow, v.date)) continue;
    const page = v.page || v.path || '';
    const sid = v.session_id || '';
    const last = out[out.length - 1];
    if (last && last.page === page && last.session_id === sid && last.date === v.date) {
      last.times += 1;
      continue;
    }
    if (out.length >= cap) break;
    out.push({
      page,
      path: v.path || '',
      date: v.date || '',
      time: v.time || '',
      session_id: sid,
      times: 1
    });
  }
  return out;
}

function chartDays(visitors, nowMs, days) {
  const t = Number.isFinite(nowMs) ? nowMs : Date.now();
  const n = days || 14;
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = ymdFromMs(t - i * DAY);
    let count = 0;
    (visitors || []).forEach(v => {
      if (v && v.date === date && humanPage(v)) count++;
    });
    out.push({ date, label: fmtDay(date), count });
  }
  return out;
}

function countsAsOrder(o) {
  if (!o || !o.state) return false;
  if (o.state === 'cancelled' || o.state === 'waitlisted') return false;
  return true;
}

function orderDay(o) {
  return String(o && o.created_at || '').slice(0, 10);
}

function sessionsIn(summaries, inWindow) {
  return (summaries || []).filter(s => s && dated(inWindow, s.startDate));
}

function pctDelta(now, prev) {
  if (!prev) return null;
  return Math.round(((now - prev) / prev) * 100);
}

function conversionOf(sessions) {
  const landed = sessions.length;
  if (!landed) return null;
  const paid = sessions.filter(s => s.paid).length;
  return Math.round((paid / landed) * 1000) / 10;
}

function ptsDelta(now, prev) {
  if (now == null || prev == null) return null;
  return Math.round((now - prev) * 10) / 10;
}

function earliest(rows) {
  let best = null;
  (rows || []).forEach(r => {
    if (!best || String(r.time || '') < String(best.time || '')) best = r;
  });
  return best;
}

function sourceRows(sessions) {
  const rows = [];
  sessions.forEach(s => {
    const first = earliest(s.rows);
    if (first) rows.push(first);
  });
  const list = seo.trafficSources(rows);
  const total = list.reduce((sum, r) => sum + r.count, 0);
  return list.map(r => ({
    label: r.label,
    count: r.count,
    pct: total ? Math.round((r.count / total) * 100) : 0
  }));
}

function ordersBySession(orders) {
  const map = new Map();
  (orders || []).forEach(o => {
    if (!o || !o.session_id || !countsAsOrder(o)) return;
    const cur = map.get(o.session_id) || { orders: 0, revenue: 0 };
    cur.orders += 1;
    if (ordersLib.isPaid(o.state)) cur.revenue += Number(o.amount_due) || 0;
    map.set(o.session_id, cur);
  });
  return map;
}

function campaignsFor(sessions, orders) {
  const bySession = ordersBySession(orders);
  const camps = new Map();
  sessions.forEach(s => {
    const first = earliest(s.rows);
    const name = first ? String(first.utm_campaign || '').trim() : '';
    if (!name) return;
    const cur = camps.get(name) || { campaign: name, visits: 0, orders: 0, revenue: 0 };
    cur.visits += 1;
    const hit = bySession.get(s.sessionId || (first && first.session_id) || '');
    if (hit) {
      cur.orders += hit.orders;
      cur.revenue += hit.revenue;
    }
    camps.set(name, cur);
  });
  return [...camps.values()]
    .sort((a, b) => b.visits - a.visits || b.orders - a.orders || a.campaign.localeCompare(b.campaign))
    .slice(0, 8);
}

function orderSplit(orders, inWindow) {
  let all = 0;
  let website = 0;
  (orders || []).forEach(o => {
    if (!countsAsOrder(o) || !dated(inWindow, orderDay(o))) return;
    all += 1;
    if (o.session_id) website += 1;
  });
  return { all, website };
}

function tapCount(taps, inWindow) {
  return (taps || []).filter(t => t && dated(inWindow, t.date)).length;
}

function kpisFor({ sessions, priorSessions, visitors, orders, taps, inWindow, prior }) {
  const visitorsNow = sessions.length;
  const visitorsPrev = prior ? priorSessions.length : 0;
  const conv = conversionOf(sessions);
  const convPrev = prior ? conversionOf(priorSessions) : null;
  const split = orderSplit(orders, inWindow);
  const messenger = tapCount(taps, inWindow);
  const messengerPrev = prior ? tapCount(taps, prior) : null;
  return {
    visitors: visitorsNow,
    visitorsDelta: prior ? pctDelta(visitorsNow, visitorsPrev) : null,
    conversion: conv,
    conversionDelta: ptsDelta(conv, convPrev),
    websiteOrders: split.website,
    allOrders: split.all,
    messenger,
    messengerDelta: prior ? messenger - messengerPrev : null,
    botsHidden: 0
  };
}

// Adds the Traffic-tab fields onto one funnel window. `span` is a period from
// spans(), customSpan(), or daySpan(). ga4 stays false: this is the shop log.
function decorate(base, input) {
  const src = input || {};
  const span = src.span || { label: '', compareLabel: '', inWindow: () => true, prior: null };
  const inWindow = span.inWindow;
  const prior = span.prior;
  const sessions = sessionsIn(src.summaries, inWindow);
  const priorSessions = prior ? sessionsIn(src.summaries, prior) : [];
  const kpis = kpisFor({
    sessions,
    priorSessions,
    visitors: src.visitors,
    orders: src.orders,
    taps: src.taps,
    inWindow,
    prior
  });
  const skipped = Number(base && base.skipped) || 0;
  kpis.botsHidden = skipped + probeCount(src.visitors, inWindow);
  return Object.assign({}, base, {
    label: span.label || '',
    compareLabel: span.compareLabel || '',
    ga4: false,
    log: 'shop',
    kpis,
    sources: sourceRows(sessions),
    campaigns: campaignsFor(sessions, src.orders),
    topPages: topPages(src.visitors, inWindow, 5),
    recent: recentFor(src.visitors, inWindow, 40)
  });
}

module.exports = {
  spans, customSpan, daySpan, cleanDay, fmtDay, fmtRange,
  probeCount, topPages, recentFor, chartDays, decorate,
  sourceRows, campaignsFor
};
