// Unpaid web orders: one nudge about 30 minutes after an order enters
// awaiting_payment, and one last call about 24 hours after. Each stage is
// claimed once in Mongo (see lib/orders.js) so a restart or a second sweep
// cannot send it again.
//
// Messenger only works inside Meta's 24-hour window, and only as a RESPONSE
// with no message tag. Outside that window — or when Graph answers 10 or 551 —
// the owner gets a Telegram alert and follows up by hand.
//
// Pure decisions live here. The timer, the Graph call and the Telegram call
// live in server.js, which passes them in.

const quickAddSettle = require('./quick-add-settle');
const telegram = require('./telegram');

const NUDGE_MS = 30 * 60 * 1000;
const LAST_CALL_MS = 24 * 60 * 60 * 1000;
const MESSENGER_WINDOW_MS = 24 * 60 * 60 * 1000;
// Stop a little early. A send that leaves our server at 23:59 can arrive at
// Meta after the window has closed, and that refusal is the noisy failure.
const MESSENGER_SAFETY_BUFFER_MS = 60 * 60 * 1000;
// A PayMongo checkout the customer is still sitting on. After this the session
// is treated as abandoned — the id itself is kept forever so a webhook can
// still be matched, which is not the same thing as "they are paying right now".
const CHECKOUT_IN_PROGRESS_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_HOLD_HOURS = 24;
const STAGES = Object.freeze(['nudge', 'last_call']);

function atMs(now) {
  if (now instanceof Date) return now.getTime();
  const t = new Date(now || Date.now()).getTime();
  return isNaN(t) ? Date.now() : t;
}

// The latest time the order entered awaiting_payment, not the day it was
// created. A rejected proof walks back into this state, and that return is a
// new wait — the 30 minutes start again. A stage already sent stays sent.
function awaitingSince(order) {
  const hist = order && Array.isArray(order.state_history) ? order.state_history : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i] && hist[i].state === 'awaiting_payment' && hist[i].at) return hist[i].at;
  }
  return (order && order.created_at) || null;
}

function stageTaken(order, stage) {
  const rec = order && order.payment_reminders && order.payment_reminders[stage];
  return !!(rec && rec.status);
}

function stageDue(order, now) {
  if (!order) return null;
  const since = Date.parse(awaitingSince(order) || '');
  if (isNaN(since)) return null;
  const age = atMs(now) - since;
  // The earlier stage first, even when both are already late. One sweep sends
  // one of them; the next sweep sends the other. Cancelling waits until both
  // have had their turn.
  if (age >= NUDGE_MS && !stageTaken(order, 'nudge')) return 'nudge';
  if (age >= LAST_CALL_MS && !stageTaken(order, 'last_call')) return 'last_call';
  return null;
}

function checkoutInProgress(order, now) {
  const started = Date.parse(order && order.checkout_started_at || '');
  if (isNaN(started)) return false;
  return (atMs(now) - started) < CHECKOUT_IN_PROGRESS_MS;
}

function skipReason(order, now) {
  if (!order) return 'missing';
  if (order.is_waitlist || order.state === 'waitlisted') return 'waitlist';
  if (order.state === 'verifying_payment' || order.payment_proof) return 'verifying';
  if (quickAddSettle.isOwnerRecordedUnpaid(order)) return 'owner_recorded';
  if (checkoutInProgress(order, now)) return 'checkout';
  return null;
}

function latestTouch(order, contact) {
  const times = [order && order.psid_linked_at, contact && contact.last_seen]
    .map(s => Date.parse(s || ''))
    .filter(t => !isNaN(t));
  if (!times.length) return null;
  return Math.max.apply(null, times);
}

function messagingWindowOpen(order, contact, now) {
  if (!order || !order.psid) return false;
  const touch = latestTouch(order, contact);
  if (touch == null) return false;
  return (atMs(now) - touch) <= (MESSENGER_WINDOW_MS - MESSENGER_SAFETY_BUFFER_MS);
}

function graphErrorCode(body) {
  let parsed = body;
  if (typeof body === 'string') {
    try { parsed = JSON.parse(body); } catch (e) { return null; }
  }
  const code = parsed && parsed.error ? Number(parsed.error.code) : NaN;
  return Number.isFinite(code) ? code : null;
}

function needsOwnerFallback(code) {
  return code === 10 || code === 551;
}

function firstName(full) {
  const s = String(full == null ? '' : full).trim();
  if (!s) return 'there';
  return s.split(/\s+/)[0];
}

// No hold_expires_at means the timer was never set, so the line stays the
// ordinary "still on hold". A hold that has already passed must not keep
// saying that — the page is already showing Hold ended.
function holdStillOn(order, now) {
  const t = Date.parse(order && order.hold_expires_at || '');
  if (isNaN(t)) return true;
  return t > (now == null ? Date.now() : atMs(now));
}

function customerText(order, stage, link, now) {
  const o = order || {};
  const first = firstName(o.fb_name);
  const game = String(o.game_title || '').trim() || 'your order';
  const ref = o.ref || 'your order';
  const url = link || '';
  const held = holdStillOn(o, now);
  if (stage === 'last_call') {
    const middle = held
      ? 'di pa tapos yung payment, and the hold is running out'
      : 'the hold has ended and di pa tapos yung payment';
    return 'Hi ' + first + '! 👋 Last call for ' + game + ' (' + ref + ') — ' + middle + '. Pay here para ma-lock pa rin natin: ' + url + ' — any questions, just reply here!';
  }
  const middle = held ? 'Your slot\'s still on hold.' : 'The hold on it has ended.';
  return 'Hi ' + first + '! 👋 Napansin namin di pa tapos yung payment for ' + game + ' (' + ref + '). ' + middle + ' Pay here para ma-lock na natin: ' + url + ' — any questions, just reply here!';
}

// Unset means on, same rule as the Telegram alerts. Auto-cancel is the
// opposite: it drops an order, so only a literal true turns it on.
function normalizeSettings(raw) {
  const s = raw || {};
  let hours = s.hold_hours;
  if (hours === undefined || hours === null || hours === '') hours = DEFAULT_HOLD_HOURS;
  else hours = Math.round(Number(hours));
  if (!Number.isFinite(hours) || hours < 0) hours = DEFAULT_HOLD_HOURS;
  return {
    enabled: s.enabled !== false,
    hold_hours: hours,
    auto_cancel: s.auto_cancel === true
  };
}

function holdPlan(order, settings) {
  const s = normalizeSettings(settings);
  if (!s.hold_hours) return null;
  if (!order || order.state !== 'awaiting_payment') return null;
  if (order.is_waitlist || order.state === 'waitlisted') return null;
  if (quickAddSettle.isOwnerRecordedUnpaid(order)) return null;
  const anchor = awaitingSince(order);
  if (!anchor || isNaN(Date.parse(anchor))) return null;
  return {
    anchor,
    expires: new Date(Date.parse(anchor) + s.hold_hours * 60 * 60 * 1000).toISOString()
  };
}

function holdDisplay(order, now) {
  if (!order || !order.hold_expires_at) return null;
  if (order.state !== 'awaiting_payment' && order.state !== 'payment_rejected') return null;
  const t = Date.parse(order.hold_expires_at);
  if (isNaN(t)) return null;
  return t <= atMs(now) ? 'expired' : 'countdown';
}

function holdExpired(order, now) {
  return holdDisplay(order, now) === 'expired';
}

function manilaDay(iso) {
  const t = Date.parse(iso || '');
  if (isNaN(t)) return '';
  return new Date(t + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function inRange(day, range) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  if (!range) return true;
  if (range.from && day < range.from) return false;
  if (range.to && day > range.to) return false;
  return true;
}

function sentReminders(order) {
  const pr = (order && order.payment_reminders) || {};
  return STAGES.map(s => pr[s]).filter(r => r && r.status === 'sent' && r.sent_at);
}

function recoveryStats(orders, range) {
  let reminded = 0, recovered = 0, pesos = 0;
  (orders || []).forEach(o => {
    if (!o) return;
    const sent = sentReminders(o);
    if (sent.some(r => inRange(manilaDay(r.sent_at), range))) reminded++;
    if (sent.length && o.reminder_recovered_at && inRange(manilaDay(o.reminder_recovered_at), range)) {
      recovered++;
      pesos += Number(o.reminder_recovered_amount) || 0;
    }
  });
  return { reminded, recovered, pesos };
}

function reminderBadge(order) {
  const pr = (order && order.payment_reminders) || {};
  if (pr.last_call && pr.last_call.status === 'sent') return 'last_call';
  if (pr.nudge && pr.nudge.status === 'sent') return 'nudge';
  return null;
}

let sweeping = false;

function blankSummary() {
  return { examined: 0, messenger: 0, telegram: 0, skipped: 0, cancelled: 0, released: 0, overlapped: false };
}

async function runSweep(deps) {
  const d = deps || {};
  if (sweeping) return Object.assign(blankSummary(), { overlapped: true });
  sweeping = true;
  const summary = blankSummary();
  try {
    const now = d.now instanceof Date ? d.now : new Date(d.now || Date.now());
    const settings = normalizeSettings(d.settings);
    const list = await d.listAwaiting();
    for (const order of list || []) {
      summary.examined++;
      const plan = holdPlan(order, settings);
      if (plan && (order.hold_anchor !== plan.anchor || order.hold_expires_at !== plan.expires)) {
        await d.setHold(order.ref, plan);
        order.hold_expires_at = plan.expires;
        order.hold_anchor = plan.anchor;
      }
      if (!settings.enabled) { summary.skipped++; continue; }
      const skip = skipReason(order, now);
      const stage = stageDue(order, now);
      if (skip || !stage) {
        if (settings.auto_cancel && !skip && holdExpired(order, now)) {
          const ok = await d.cancel(order.ref);
          if (ok) summary.cancelled++;
          else summary.skipped++;
        } else {
          summary.skipped++;
        }
        continue;
      }
      const claimed = await d.claim(order.ref, stage);
      if (!claimed) { summary.skipped++; continue; }
      const fresh = await d.get(order.ref);
      if (!fresh || fresh.state !== 'awaiting_payment' || skipReason(fresh, now)) {
        await d.release(order.ref, stage);
        summary.released++;
        continue;
      }
      const link = d.orderLink(fresh);
      const text = customerText(fresh, stage, link, now);
      const contact = fresh.psid && d.contactFor ? await d.contactFor(fresh.psid) : null;
      let outcome;
      if (messagingWindowOpen(fresh, contact, now)) {
        const sent = await d.sendMessenger(fresh.psid, text);
        if (sent && sent.ok) outcome = { channel: 'messenger', reason: null };
        else if (sent && (needsOwnerFallback(sent.code) || sent.reason === 'not_configured')) {
          outcome = {
            channel: 'telegram',
            reason: sent.code ? ('graph_' + sent.code) : 'messenger_not_configured'
          };
        } else {
          await d.release(fresh.ref, stage);
          summary.released++;
          continue;
        }
      } else {
        outcome = { channel: 'telegram', reason: fresh.psid ? 'outside_window' : 'no_psid' };
      }
      if (outcome.channel === 'telegram') {
        if (!d.alertEnabled) {
          await d.complete(fresh.ref, stage, {
            status: 'unsent', channel: 'none', reason: 'alert_off', sent_at: now.toISOString()
          });
          summary.skipped++;
          continue;
        }
        const tg = await d.sendTelegram(telegram.formatPaymentReminderAlert(fresh, {
          stage, reason: outcome.reason, link, adminUrl: d.adminUrl || ''
        }));
        if (tg && tg.ok === false && tg.reason === 'not_configured') {
          await d.release(fresh.ref, stage);
          summary.released++;
          continue;
        }
        summary.telegram++;
      } else {
        summary.messenger++;
      }
      await d.complete(fresh.ref, stage, {
        status: 'sent',
        channel: outcome.channel,
        reason: outcome.reason,
        sent_at: now.toISOString()
      });
    }
    return summary;
  } finally {
    sweeping = false;
  }
}

module.exports = {
  NUDGE_MS, LAST_CALL_MS, MESSENGER_WINDOW_MS, MESSENGER_SAFETY_BUFFER_MS,
  CHECKOUT_IN_PROGRESS_MS, SWEEP_INTERVAL_MS, DEFAULT_HOLD_HOURS, STAGES,
  awaitingSince, stageDue, skipReason, messagingWindowOpen,
  graphErrorCode, needsOwnerFallback, customerText, normalizeSettings,
  holdPlan, holdDisplay, recoveryStats, reminderBadge, runSweep
};
