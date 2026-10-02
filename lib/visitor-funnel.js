// The admin dashboard's visitor funnel, "Most asked-about games" and
// "Searched, nothing found" cards. Pure: server.js reads the lowdb arrays and
// the orders, calls these, and hands the result to views/partials/admin/
// dashboard/site.ejs. Kept apart from lib/funnel.js, which is the ORDER funnel.
const { isSystemPath } = require('./visitor-filter');

const pct = (n, of) => (of > 0 ? Math.round((n / of) * 100) : null);

// One record per session. System paths (/api/*, webhooks) are ignored, which
// also cleans rows recorded before the visitor middleware learned to skip them;
// a session left with no rows disappears.
//   visitors            lowdb 'visitors' rows
//   taps                lowdb 'message_taps' rows
//   orderedSessionIds   Set of session ids that placed an order
//   paidSessionIds      Set of session ids with a paid order
function buildSessionSummaries({ visitors, taps, orderedSessionIds, paidSessionIds }) {
  const rowsBySession = {};
  (visitors || []).forEach(v => {
    if (!v.session_id || isSystemPath(v.path)) return;
    (rowsBySession[v.session_id] = rowsBySession[v.session_id] || []).push(v);
  });
  const tapsBySession = {};
  (taps || []).forEach(t => {
    (tapsBySession[t.session_id] = tapsBySession[t.session_id] || []).push(t);
  });
  return Object.keys(rowsBySession).map(sid => {
    const rows = rowsBySession[sid];
    const sTaps = tapsBySession[sid] || [];
    const ordered = orderedSessionIds.has(sid);
    return {
      // A session belongs to the day it STARTED, so "Landed" is a true total.
      startDate: rows[0].date,
      browsed: rows.some(v => v.path === '/browse'),
      // "OR ordered / OR tapped from a game page" is load-bearing: either can
      // only happen on a game page, so if that page row were ever missing the
      // funnel would otherwise show more orders or taps than game views.
      viewedGame: rows.some(v => v.path.startsWith('/game/')) || ordered || sTaps.some(t => t.game),
      messaged: sTaps.length > 0,
      ordered,
      paid: paidSessionIds.has(sid),
      // No tab-close event exists, so the last row is the closest proxy for
      // "the last thing they looked at".
      exitPath: rows[rows.length - 1].path,
      rows
    };
  });
}

function skippedForWindow(skips, inWindow) {
  return Object.entries(skips || {}).reduce((sum, [day, n]) => sum + (inWindow(day) ? Number(n) || 0 : 0), 0);
}

// Funnel rows. Viewed / Messaged / Ordered are parallel outcomes of a landing,
// so each shows its share of Landed (stage.pctOfPrev); only Paid is a share of
// the row before it (Ordered).
function windowMetrics(sessions, skipped) {
  const landed = sessions.length;
  const count = key => sessions.filter(s => s[key]).length;
  const viewed = count('viewedGame');
  const messaged = count('messaged');
  const ordered = count('ordered');
  const paid = count('paid');
  const browsedCount = count('browsed');
  const exitCounts = {};
  sessions.forEach(s => { exitCounts[s.exitPath] = (exitCounts[s.exitPath] || 0) + 1; });
  return {
    funnel: [
      { label: 'Landed', count: landed, pctOfPrev: null },
      { label: 'Viewed a game', count: viewed, pctOfPrev: pct(viewed, landed) },
      { label: 'Messaged us', count: messaged, pctOfPrev: pct(messaged, landed) },
      { label: 'Ordered on website', count: ordered, pctOfPrev: pct(ordered, landed) },
      { label: 'Paid', count: paid, pctOfPrev: pct(paid, ordered) }
    ],
    exitPages: Object.entries(exitCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([path, n]) => ({ path, count: n })),
    browsed: { count: browsedCount, total: landed, pct: pct(browsedCount, landed) },
    skipped
  };
}

// Top 5 games by Message Us taps. resolveGame(slug) → { title, cover, slots }
// or null for a game that no longer exists (counted under `other`).
function askedForWindow(taps, inWindow, resolveGame) {
  const counts = {};
  let other = 0;
  (taps || []).forEach(t => {
    if (!inWindow(t.date)) return;
    if (!t.game) { other++; return; }
    counts[t.game] = (counts[t.game] || 0) + 1;
  });
  const games = [];
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([slug, n]) => {
    const g = resolveGame(slug);
    if (!g) { other += n; return; }
    games.push({ slug, title: g.title, cover: g.cover || '', slots: g.slots, count: n });
  });
  return { games: games.slice(0, 5), other };
}

// Top 5 searches that found nothing.
function missesForWindow(misses, inWindow) {
  const counts = {};
  (misses || []).forEach(m => { if (inWindow(m.date)) counts[m.q] = (counts[m.q] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([q, n]) => ({ q, count: n }));
}

// Everything one dashboard window shows. inWindow(date) says whether a
// 'YYYY-MM-DD' day belongs to the window; sessions count on their start day.
function buildWindow({ summaries, taps, misses, skips, inWindow, resolveGame }) {
  const sessions = summaries.filter(s => inWindow(s.startDate));
  return Object.assign(windowMetrics(sessions, skippedForWindow(skips, inWindow)), {
    asked: askedForWindow(taps, inWindow, resolveGame),
    misses: missesForWindow(misses, inWindow)
  });
}

module.exports = { buildSessionSummaries, windowMetrics, askedForWindow, missesForWindow, skippedForWindow, buildWindow };
