// Prints the order funnel from an export file.
//
//   1. Admin -> Orders -> "Export orders (JSON)"   (saves orders-export.json)
//   2. node scripts/funnel-report.js orders-export.json
//
// Reads a file and nothing else: no database, no credentials, no network. The
// arithmetic all lives in lib/funnel.js, which is covered by
// scripts/test-funnel.js — this file only formats.
const fs = require('fs');
const funnel = require('../lib/funnel');

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/funnel-report.js <orders-export.json>');
  process.exit(1);
}

let orders;
try {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  orders = Array.isArray(raw) ? raw : (raw.orders || []);
} catch (e) {
  console.error('Could not read ' + file + ': ' + e.message);
  process.exit(1);
}

const STATE_LABEL = {
  awaiting_payment: 'Never sent payment',
  verifying_payment: 'Sent proof, never cleared',
  payment_rejected: 'Payment rejected',
  cancelled: 'Cancelled'
};

function bar(n, of, width) {
  const filled = of > 0 ? Math.round((n / of) * width) : 0;
  return '█'.repeat(filled) + '·'.repeat(Math.max(width - filled, 0));
}
function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }
function mins(t) {
  if (t.median == null) return 'no data';
  if (t.median >= 120) return (t.median / 60).toFixed(1) + ' h';
  return t.median + ' min';
}

const paid = funnel.paidPath(orders);
const f = funnel.build(orders);

console.log('\n═══ ORDER FUNNEL ═══');
console.log(orders.length + ' orders exported · ' + paid.length + ' on the paid path'
  + (orders.length - paid.length ? ' (' + (orders.length - paid.length) + ' free waitlist entries excluded)' : ''));
const dates = paid.map(o => String(o.created_at || '').slice(0, 10)).filter(Boolean).sort();
if (dates.length) console.log('covering ' + dates[0] + ' to ' + dates[dates.length - 1]);
console.log('');

f.stages.forEach((s, i) => {
  const line = '  ' + s.label.padEnd(22) + String(s.count).padStart(5)
    + '  ' + bar(s.count, f.total, 28)
    + '  ' + String(s.pctOfStart).padStart(3) + '% of start';
  console.log(line);
  if (i < f.stages.length - 1) {
    const next = f.stages[i + 1];
    if (next.dropped > 0) {
      console.log('  ' + ' '.repeat(22) + '        ↓ lost ' + next.dropped
        + '  (' + (100 - next.pctOfPrev) + '% of those who got this far)');
    }
  }
});

console.log('\n═══ WHERE THEY DIED ═══');
const deaths = funnel.deathPoints(orders);
if (!deaths.length) {
  console.log('  Nothing stalled — every order either completed or is still moving.');
} else {
  const worst = deaths[0].count;
  deaths.forEach(d => {
    console.log('  ' + (STATE_LABEL[d.state] || d.state).padEnd(28) + String(d.count).padStart(4)
      + '  ' + bar(d.count, worst, 20) + '  ' + peso(d.value) + ' never collected');
  });
  const lost = deaths.reduce((s, d) => s + d.value, 0);
  console.log('  ' + '-'.repeat(28) + '\n  ' + 'Total not collected'.padEnd(28)
    + String(deaths.reduce((s, d) => s + d.count, 0)).padStart(4) + '  ' + ' '.repeat(20) + '  ' + peso(lost));
}

console.log('\n═══ HOW LONG EACH STEP TOOK ═══');
console.log('  (median, over the orders that actually made the move)\n');
const custPay = funnel.timing(orders, 'awaiting_payment', 'verifying_payment');
const w = funnel.ownerWait(orders);
const custQr = funnel.timing(orders, 'awaiting_qr', 'qr_pending');

const rows = [
  ['CUSTOMER  order -> sends payment', custPay],
  ['OWNER     proof -> approved', w.checkPayment],
  ['CUSTOMER  asked -> sends sign-in code', custQr],
  ['OWNER     code -> signed them in', w.signIn]
];
rows.forEach(([label, t]) => {
  console.log('  ' + label.padEnd(38) + mins(t).padStart(9)
    + '   (n=' + t.n + (t.n ? ', ' + t.min + '–' + t.max + ' min' : '') + ')');
});

const ownerTotal = (w.checkPayment.median || 0) + (w.signIn.median || 0);
const custTotal = (custPay.median || 0) + (custQr.median || 0);
if (ownerTotal || custTotal) {
  console.log('\n  Typical wait caused by the customer: ' + Math.round(custTotal) + ' min');
  console.log('  Typical wait caused by you:          ' + Math.round(ownerTotal) + ' min');
}

console.log('\n═══ WHAT TO LOOK AT ═══');
const submitted = f.stages.find(s => s.key === 'submitted');
const confirmed = f.stages.find(s => s.key === 'confirmed');
const notes = [];
if (submitted.dropped > confirmed.dropped) {
  notes.push('The biggest loss is BEFORE anyone pays (' + submitted.dropped + ' orders, '
    + (100 - submitted.pctOfPrev) + '% of starts). That is a checkout problem, not a you problem.');
} else if (confirmed.dropped > 0) {
  notes.push('The biggest loss is AFTER the customer paid (' + confirmed.dropped
    + ' orders waiting on approval). That one is yours to fix.');
}
if (w.checkPayment.median != null && w.checkPayment.median > 30) {
  notes.push('Customers wait a median ' + mins(w.checkPayment) + ' for you to approve a payment. '
    + 'Anything above ~15 min is where people start messaging to ask if it worked.');
}
if (w.signIn.median != null && w.signIn.median > 10) {
  notes.push('Sign-in codes expire after 10 minutes and your median response is ' + mins(w.signIn)
    + ' — some of those codes died before you got to them.');
}
if (!notes.length) notes.push('No obvious bottleneck: losses are spread evenly and your response times are quick.');
notes.forEach(n => console.log('  • ' + n));
console.log('');
