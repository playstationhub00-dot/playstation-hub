// The admin Accounts tab's slot logic, kept pure so it can be tested: which
// slots are urgent, what their pill says, and the stat-card counts.
//
// days_left here is whole calendar days from `today` (a YYYY-MM-DD date in
// Asia/Manila, passed in by the caller) to the slot's end date: 0 = ends
// today, 1 = tomorrow, -1 = ended yesterday.

const TYPE_ORDER = { trophy: 0, non_trophy: 1, ps4_primary: 2 };
const TYPES = Object.keys(TYPE_ORDER);
const STATUS_LABEL = { open: 'OPEN', rented: 'RENTED', buyed: 'BOUGHT', maintenance: 'MAINTENANCE', na: 'NOT AVAILABLE' };
const ENDING_WITHIN_DAYS = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysUntil(end, today) {
  if (!DATE_RE.test(String(end || '')) || !DATE_RE.test(String(today || ''))) return null;
  return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
}

// Only a rented slot with an end date can be overdue or ending.
function dueState(slot) {
  const s = slot || {};
  if (s.status !== 'rented' || s.days_left == null) return '';
  if (s.days_left < 0) return 'overdue';
  if (s.days_left <= ENDING_WITHIN_DAYS) return 'ending';
  return '';
}

function slotUrgency(slot) {
  const s = slot || {};
  if (s.status === 'rented') {
    if (s.days_left == null) return 3;
    return s.days_left < 0 ? 1 : 2;
  }
  if (s.status === 'open') return 4;
  if (s.status === 'buyed') return 5;
  if (s.status === 'maintenance') return 6;
  return 7;
}

function slotPillLabel(slot) {
  const s = slot || {};
  if (s.status === 'rented' && s.days_left != null) {
    if (s.days_left < 0) return 'OVERDUE ' + (-s.days_left) + 'd';
    if (s.days_left === 0) return 'ENDS TODAY';
    return s.days_left + 'd left';
  }
  return STATUS_LABEL[s.status] || STATUS_LABEL.na;
}

function decorateSlot(slot, today) {
  const s = Object.assign({}, slot);
  s.days_left = s.status === 'rented' ? daysUntil(s.end, today) : null;
  s.due = dueState(s);
  s.urgency = slotUrgency(s);
  s.pill = slotPillLabel(s);
  return s;
}

function compareSlotRows(a, b) {
  if (a.urgency !== b.urgency) return a.urgency - b.urgency;
  if (a.urgency <= 2 && a.days_left !== b.days_left) return a.days_left - b.days_left;
  const byLabel = String(a.account_label).localeCompare(String(b.account_label));
  if (byLabel) return byLabel;
  if (a.type !== b.type) return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
  return a.account_id - b.account_id;
}

function flattenSlots(accounts) {
  const rows = [];
  (accounts || []).forEach(a => {
    TYPES.forEach(type => {
      const s = a && a.slotView && a.slotView[type];
      if (!s || !s.enabled) return;
      rows.push({
        account_id: a.id,
        account_label: a.label || '',
        type,
        status: s.status,
        enabled: true,
        end: s.end || '',
        days_left: s.days_left,
        due: s.due,
        urgency: s.urgency,
        pill: s.pill,
        renter_id: s.renter_id || null,
        renter_name: s.renter_name || ''
      });
    });
  });
  return rows.sort(compareSlotRows);
}

function slotStats(accounts) {
  const stats = { total: 0, open: 0, rented: 0, ending: 0, overdue: 0 };
  (accounts || []).forEach(a => TYPES.forEach(type => {
    const s = a && a.slotView && a.slotView[type];
    if (!s || !s.enabled) return;
    stats.total++;
    if (s.status === 'open') stats.open++;
    if (s.status === 'rented') {
      stats.rented++;
      if (s.due === 'ending') stats.ending++;
      if (s.due === 'overdue') stats.overdue++;
    }
  }));
  return stats;
}

module.exports = { daysUntil, dueState, slotUrgency, slotPillLabel, decorateSlot, flattenSlots, slotStats, TYPES };
