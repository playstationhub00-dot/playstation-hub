// Run: node scripts/test-traffic.js
//
// Traffic periods, bot filtering, and UTM campaigns from the shop visit log.
// Nothing here is a GA4 number.
const assert = require('assert');
const traffic = require('../lib/traffic');
const funnel = require('../lib/visitor-funnel');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const NOW = Date.parse('2026-11-11T03:00:00.000Z');
const NONE = new Set();

function row(extra) {
  return Object.assign({
    date: '2026-11-11', time: '2026-11-11T03:00:00.000Z', path: '/', page: 'Home',
    session_id: 's', ip: 'x'
  }, extra);
}

console.log('\nperiods');

ok('today, 7 days and the previous 7 days share one calendar', () => {
  const s = traffic.spans(NOW);
  assert.strictEqual(s.today.from, '2026-11-11');
  assert.strictEqual(s.today.inWindow('2026-11-11'), true);
  assert.strictEqual(s.today.inWindow('2026-11-10'), false);
  assert.strictEqual(s.today.prior('2026-11-10'), true);
  assert.strictEqual(s.week.from, '2026-11-04');
  assert.strictEqual(s.week.inWindow('2026-11-04'), true);
  assert.strictEqual(s.week.inWindow('2026-11-03'), false);
  assert.strictEqual(s.week.prior('2026-11-03'), true);
  assert.strictEqual(s.week.prior('2026-10-28'), true);
  assert.strictEqual(s.week.prior('2026-10-27'), false);
  assert.ok(s.week.compareLabel.includes('to'));
  assert.ok(!s.week.compareLabel.includes('\u2014'));
  assert.strictEqual(s.month.from, '2026-10-12');
  assert.strictEqual(s.all.prior, null);
});

ok('a custom range is inclusive and rejects a backwards or junk range', () => {
  const c = traffic.customSpan('2026-11-01', '2026-11-07');
  assert.strictEqual(c.inWindow('2026-11-01'), true);
  assert.strictEqual(c.inWindow('2026-11-07'), true);
  assert.strictEqual(c.inWindow('2026-11-08'), false);
  assert.strictEqual(c.prior('2026-10-25'), true);
  assert.strictEqual(c.prior('2026-10-31'), true);
  assert.strictEqual(c.prior('2026-11-01'), false);
  assert.strictEqual(traffic.customSpan('2026-11-08', '2026-11-01'), null);
  assert.strictEqual(traffic.customSpan('nope', '2026-11-01'), null);
  assert.strictEqual(traffic.daySpan('2026-02-31'), null);
  assert.strictEqual(traffic.daySpan('2026-11-11').inWindow('2026-11-11'), true);
});

console.log('\nbot filter, pages, recent visits');

const visitors = [
  row({ session_id: 'real', path: '/', page: 'Home', time: '2026-11-11T01:00:00.000Z' }),
  row({ session_id: 'real', path: '/browse', page: 'Browse', time: '2026-11-11T01:05:00.000Z' }),
  row({ session_id: 'camp', path: '/', page: 'Home', time: '2026-11-11T02:00:00.000Z', utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'fb_newgames_nov' }),
  row({ session_id: 'camp', path: '/game/nba', page: 'NBA', time: '2026-11-11T02:04:00.000Z' }),
  row({ session_id: 'poll', path: '/order/PH-1/state', page: '/order/PH-1/state', time: '2026-11-11T02:10:00.000Z' }),
  row({ session_id: 'poll', path: '/order/PH-1/state', page: '/order/PH-1/state', time: '2026-11-11T02:11:00.000Z' }),
  row({ session_id: 'poll', path: '/order/PH-1/state', page: '/order/PH-1/state', time: '2026-11-11T02:12:00.000Z' }),
  row({ session_id: 'repeat', path: '/game/nba', page: 'NBA', time: '2026-11-11T02:20:00.000Z' }),
  row({ session_id: 'repeat', path: '/game/nba', page: 'NBA', time: '2026-11-11T02:21:00.000Z' }),
  row({ session_id: 'repeat', path: '/game/nba', page: 'NBA', time: '2026-11-11T02:22:00.000Z' }),
  row({ session_id: 'scan', path: '/Dockerfile', page: '/Dockerfile', time: '2026-11-11T02:30:00.000Z' }),
  row({ session_id: 'scan', path: '/env', page: '/env', time: '2026-11-11T02:31:00.000Z' }),
  row({ session_id: 'old', path: '/', page: 'Home', date: '2026-11-03', time: '2026-11-03T01:00:00.000Z' })
];

ok('top pages leave out order-status polls and scanner paths', () => {
  const pages = traffic.topPages(visitors, d => d === '2026-11-11', 5);
  const names = pages.map(p => p[0]);
  assert.ok(names.includes('Home'));
  assert.ok(names.includes('Browse') || names.includes('NBA'));
  assert.ok(!names.some(n => String(n).includes('/state') || n === '/Dockerfile' || n === '/env'));
  const nba = pages.find(p => p[0] === 'NBA');
  assert.strictEqual(nba[1], 4);
});

ok('recent visits fold a repeated page and drop polls and probes', () => {
  const recent = traffic.recentFor(visitors, d => d === '2026-11-11', 20);
  const nba = recent.find(r => r.page === 'NBA' && r.session_id === 'repeat');
  assert.ok(nba);
  assert.strictEqual(nba.times, 3);
  assert.ok(!recent.some(r => String(r.path).includes('/state') || r.path === '/Dockerfile' || r.path === '/env'));
});

ok('the 14-day chart does not count probes or status polls', () => {
  const days = traffic.chartDays(visitors, NOW, 14);
  const today = days.find(d => d.date === '2026-11-11');
  // 2 real + 2 camp + 3 repeat = 7 human pages. 3 polls and 2 probes are out.
  assert.strictEqual(today.count, 7);
  assert.strictEqual(days.find(d => d.date === '2026-11-03').count, 1);
});

console.log('\nUTM and the shop log');

const orders = [
  { session_id: 'camp', state: 'active', amount_due: 399, deposit_due: 100, created_at: '2026-11-11T02:30:00.000Z' },
  { session_id: 'camp', state: 'awaiting_payment', amount_due: 200, deposit_due: 0, created_at: '2026-11-11T02:40:00.000Z' },
  { session_id: 'real', state: 'cancelled', amount_due: 999, created_at: '2026-11-11T03:00:00.000Z' },
  { session_id: '', state: 'active', amount_due: 150, created_at: '2026-11-11T04:00:00.000Z', ref: 'messenger' }
];

ok('campaigns count visits and join paid revenue without the deposit', () => {
  const summaries = funnel.buildSessionSummaries({
    visitors, taps: [], orderedSessionIds: new Set(['camp']), paidSessionIds: new Set(['camp'])
  });
  const span = traffic.spans(NOW).today;
  const base = funnel.buildWindow({
    summaries, taps: [{ date: '2026-11-11', session_id: 'camp' }, { date: '2026-11-10', session_id: 'x' }],
    misses: [], skips: { '2026-11-11': 4 }, inWindow: span.inWindow, resolveGame: () => null
  });
  const report = traffic.decorate(base, {
    span, summaries, visitors, orders, taps: [{ date: '2026-11-11', session_id: 'camp' }]
  });
  assert.strictEqual(report.ga4, false);
  assert.strictEqual(report.log, 'shop');
  assert.ok(!('ga4Visitors' in report));
  assert.strictEqual(report.kpis.botsHidden, 6, '4 skipped hits plus 2 stored probe rows');
  const camp = report.campaigns.find(c => c.campaign === 'fb_newgames_nov');
  assert.ok(camp);
  assert.strictEqual(camp.visits, 1);
  assert.strictEqual(camp.orders, 2);
  assert.strictEqual(camp.revenue, 399);
  assert.ok(report.sources.some(s => s.label === 'facebook / paid'));
  assert.ok(!report.sources.some(s => s.label === '/Dockerfile' || s.label === '/env'));
  assert.strictEqual(report.kpis.websiteOrders, 2);
  assert.strictEqual(report.kpis.allOrders, 3);
  assert.strictEqual(report.kpis.messenger, 1);
  assert.strictEqual(report.kpis.visitors, summaries.filter(s => s.startDate === '2026-11-11').length);
});

ok('the previous period is a different window, not a second copy of this one', () => {
  const summaries = funnel.buildSessionSummaries({
    visitors, taps: [], orderedSessionIds: NONE, paidSessionIds: NONE
  });
  const span = traffic.spans(NOW).week;
  const base = funnel.buildWindow({
    summaries, taps: [], misses: [], skips: {}, inWindow: span.inWindow, resolveGame: () => null
  });
  const report = traffic.decorate(base, { span, summaries, visitors, orders: [], taps: [] });
  assert.ok(report.kpis.visitors >= 1);
  const priorVisitors = summaries.filter(s => span.prior(s.startDate)).length;
  const thisVisitors = summaries.filter(s => span.inWindow(s.startDate)).length;
  assert.notStrictEqual(priorVisitors, thisVisitors);
  assert.strictEqual(report.kpis.visitors, thisVisitors);
});

console.log('\n' + passed + ' assertions passed\n');
