// Renter history for one account slot (an account's Trophy, Non-Trophy or PS4
// Primary slot), kept pure so it can be tested: what changed between a slot's
// before and after, how each history line reads, and how many lines a slot
// keeps. server.js saveAccountSlots() stores what diff() returns in the
// slot_history list; GET /admin/accounts/:id/slot/:type/history reads it back
// through historyView().
//
// A slot only ever holds its current renter, and the customer row does not say
// which account it used, so this log is the only record of who had a slot
// before. It starts empty on the day it shipped (slot_history_started_at).

const TYPES = ['trophy', 'non_trophy', 'ps4_primary'];
const KEEP = 100;
const TYPE_LABEL = { trophy: 'Trophy', non_trophy: 'Non-Trophy', ps4_primary: 'PS4 Primary' };
const STATUS_LABEL = { open: 'Open', rented: 'Rented', buyed: 'Bought', maintenance: 'Maintenance', na: 'Not available' };
const OUT_HOWS = ['returned', 'cleared', 'refunded', 'customer_deleted', 'moved'];
const OUT_TEXT = { returned: 'returned', cleared: 'cleared by hand', refunded: 'refunded', customer_deleted: 'customer deleted' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Who is on a slot: the linked customer when there is one, else the name typed
// in the slot popup. null when nobody is.
function renterKey(slot) {
  const s = slot || {};
  if (s.renter_id != null && s.renter_id !== '') return 'id:' + s.renter_id;
  const name = String(s.renter_name || '').trim().toLowerCase();
  return name ? 'name:' + name : null;
}

// Copies only the fields that have a value, so stored lines stay small.
function clean(entry) {
  const out = {};
  Object.keys(entry).forEach(k => {
    const v = entry[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  });
  return out;
}

function moveFields(ctx) {
  if (ctx.how !== 'moved' || !ctx.other) return {};
  return { other_account_id: ctx.other.account_id, other_account_label: ctx.other.account_label, other_slot: ctx.other.slot };
}

function swapFields(ctx) {
  const sw = ctx.swap;
  if (!sw || !sw.from || !sw.to || sw.from === sw.to) return null;
  return { from_game: sw.from, to_game: sw.to };
}

// The history lines one slot change makes. `before` and `after` are the slot
// objects as stored ({ status, renter_id, renter_name, start, end }); `ctx`
// says why it changed:
//   how   — 'new' (someone took it), 'cleared' (the owner changed it in the
//           slot popup), 'returned', 'refunded', 'restored' (refund undone),
//           'customer_deleted', or 'moved' (put on another slot)
//   other — { account_id, account_label, slot } on a move: the slot they came
//           from or went to
//   swap  — { from, to } game titles when the rental's game changed
//   game  — the arriving renter's game, when the customer row is not updated
//           yet (Customers edit saves the row after the slots)
// `gameOf(renter_id)` looks up a linked customer's game title.
// Returns plain objects; the caller adds id, account_id, slot and at.
function diff(before, after, ctx, gameOf) {
  const b = before || {};
  const a = after || {};
  const c = ctx || {};
  const game = id => (id != null && typeof gameOf === 'function' ? (gameOf(id) || '') : '');
  const bk = renterKey(b);
  const ak = renterKey(a);
  const lines = [];

  if (bk !== ak) {
    if (bk) {
      lines.push(clean(Object.assign({
        kind: 'out',
        how: OUT_HOWS.includes(c.how) ? c.how : 'cleared',
        renter_id: b.renter_id, renter_name: b.renter_name,
        game_title: game(b.renter_id), start: b.start, end: b.end
      }, moveFields(c), c.how === 'moved' ? swapFields(c) : null)));
    }
    if (ak) {
      const how = c.how === 'moved' ? 'moved'
        : c.how === 'restored' ? 'restored'
          : (a.status === 'buyed' ? 'bought' : 'new');
      lines.push(clean(Object.assign({
        kind: 'in', how,
        renter_id: a.renter_id, renter_name: a.renter_name,
        game_title: c.game || game(a.renter_id), start: a.start, end: a.end
      }, moveFields(c), c.how === 'moved' ? swapFields(c) : null)));
    }
    // A slot left empty on something other than Open (Maintenance, Not
    // available) says so; leaving it Open is what a renter leaving means.
    if (!ak && b.status !== a.status && !(bk && a.status === 'open')) {
      lines.push(clean({ kind: 'status', status: a.status }));
    }
    return lines;
  }

  if (bk) {
    const sw = swapFields(c);
    if (sw) lines.push(clean(Object.assign({ kind: 'swap', renter_id: a.renter_id, renter_name: a.renter_name }, sw)));
    if (b.status !== a.status) lines.push(clean({ kind: 'status', status: a.status, renter_id: a.renter_id, renter_name: a.renter_name }));
    return lines;
  }

  if (b.status !== a.status) lines.push(clean({ kind: 'status', status: a.status }));
  return lines;
}

// Drops the oldest lines of one slot past `keep`. `list` is the whole
// slot_history list, oldest first; other slots' lines are left alone.
function trim(list, accountId, slot, keep) {
  const max = keep == null ? KEEP : keep;
  const mine = (list || []).filter(e => e.account_id === accountId && e.slot === slot);
  if (mine.length <= max) return list;
  const drop = new Set(mine.slice(0, mine.length - max).map(e => e.id));
  return list.filter(e => !drop.has(e.id));
}

// A YYYY-MM-DD date stays as it is; an ISO time becomes its Manila date.
function manilaDate(v) {
  const s = String(v || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (isNaN(t)) return '';
  return new Date(t + 8 * 3600000).toISOString().slice(0, 10);
}

function shortDate(v) {
  const d = manilaDate(v);
  if (!d) return '';
  const p = d.split('-').map(Number);
  return MONTHS[p[1] - 1] + ' ' + p[2];
}

function longDate(v) {
  const d = manilaDate(v);
  return d ? shortDate(d) + ', ' + d.slice(0, 4) : '';
}

const join = parts => parts.filter(Boolean).join(' · ');

function who(e) {
  return e.renter_name || (e.renter_id != null ? 'Customer #' + e.renter_id : 'Someone');
}

function otherLabel(e) {
  return e.other_account_label ? e.other_account_label + ' · ' + (TYPE_LABEL[e.other_slot] || e.other_slot || '') : '';
}

function swapText(e) {
  return e.from_game && e.to_game ? 'swapped ' + e.from_game + ' → ' + e.to_game : '';
}

function span(e) {
  return e.start ? 'rented ' + shortDate(e.start) + ' → ' + shortDate(e.at) : '';
}

// One stored line → what the popup shows: { date, title, detail, kind }.
function describe(e) {
  const name = who(e);
  let title = '';
  let detail = '';
  if (e.kind === 'in') {
    if (e.how === 'moved') { title = name + ' moved in'; detail = join([otherLabel(e) ? 'from ' + otherLabel(e) : '', swapText(e) || e.game_title]); }
    else if (e.how === 'restored') { title = name + ' came back'; detail = join(['refund undone', e.game_title]); }
    else if (e.how === 'bought') { title = name + ' bought it'; detail = join([e.game_title]); }
    else { title = name + ' started'; detail = join([e.game_title, e.end ? 'ends ' + shortDate(e.end) : '']); }
  } else if (e.kind === 'out') {
    if (e.how === 'moved') { title = name + ' moved'; detail = join([otherLabel(e) ? 'to ' + otherLabel(e) : '', swapText(e), span(e)]); }
    else { title = name + ' left'; detail = join([OUT_TEXT[e.how] || OUT_TEXT.cleared, span(e), e.game_title]); }
  } else if (e.kind === 'swap') {
    title = name + ' swapped game';
    detail = join([e.from_game + ' → ' + e.to_game, 'stayed on this slot']);
  } else {
    title = 'Set to ' + (STATUS_LABEL[e.status] || e.status || '');
    detail = e.renter_name || (e.renter_id != null ? who(e) : 'changed by hand');
  }
  return { date: shortDate(e.at), title, detail, kind: e.kind || 'status' };
}

// The current renter, for the popup's "Now" line. null on an empty slot.
function nowLine(slot, game) {
  const s = slot || {};
  if (!renterKey(s)) return null;
  return {
    title: who(s),
    detail: join([
      game,
      s.status === 'buyed' ? 'bought' : (s.start ? 'since ' + shortDate(s.start) : ''),
      s.status === 'rented' && s.end ? 'ends ' + shortDate(s.end) : ''
    ])
  };
}

// Everything the slot popup's History section needs. `entries` are this
// slot's stored lines, newest first.
function historyView({ entries, slot, game, startedAt }) {
  const list = entries || [];
  return {
    now: nowLine(slot, game),
    lines: list.map(describe),
    total: list.length,
    started: longDate(startedAt)
  };
}

module.exports = {
  TYPES, KEEP, TYPE_LABEL, STATUS_LABEL,
  renterKey, diff, trim, manilaDate, shortDate, longDate, describe, nowLine, historyView
};
