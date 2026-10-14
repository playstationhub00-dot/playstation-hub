// One row per website visitor or Messenger PSID.
//
// handed_off is the pause flag. While it is set, both channels stop
// auto-replying and the row shows up in admin until Michael resumes it.
// The Messenger handover protocol is attempted as well, but this flag is
// what the app itself obeys — a failed pass_thread_control must not leave
// the bot talking over him.
//
// external_id is a session cookie or a PSID. It stays in the store so a
// resume can call the Graph API, and it is not part of the admin view.

const MAX_MESSAGES = 24;
const MAX_THREADS = 400;

function clone(t) {
  return {
    id: t.id,
    channel: t.channel,
    external_id: t.external_id,
    handed_off: !!t.handed_off,
    handoff_reason: t.handoff_reason || null,
    handoff_at: t.handoff_at || null,
    resumed_at: t.resumed_at || null,
    preview: t.preview || '',
    messages: (t.messages || []).map(m => ({ role: m.role, text: m.text, at: m.at })),
    created_at: t.created_at,
    updated_at: t.updated_at
  };
}

function view(t) {
  return {
    id: t.id,
    channel: t.channel,
    label: t.channel === 'messenger' ? 'Messenger' : 'Website',
    handed_off: !!t.handed_off,
    handoff_reason: t.handoff_reason || null,
    handoff_at: t.handoff_at || null,
    preview: t.preview || '',
    messages: (t.messages || []).map(m => ({ role: m.role, text: m.text, at: m.at })),
    updated_at: t.updated_at
  };
}

function memory() {
  let rows = [];
  return {
    read: () => rows,
    write: (next) => { rows = next; }
  };
}

function bind(db) {
  if (!db.get('support_threads').value()) db.set('support_threads', []).write();
  return {
    read: () => db.get('support_threads').value() || [],
    write: (next) => db.set('support_threads', next).write()
  };
}

function createStore(io) {
  function all() {
    return (io.read() || []).map(clone);
  }
  function save(rows) {
    const open = rows.filter(r => r.handed_off);
    const rest = rows.filter(r => !r.handed_off);
    const kept = open.concat(rest.slice(-MAX_THREADS));
    io.write(kept.map(clone));
  }
  function findRow(rows, channel, externalId) {
    return rows.find(t => t.channel === channel && t.external_id === String(externalId));
  }
  function fresh(channel, externalId) {
    const now = new Date().toISOString();
    const prefix = channel === 'messenger' ? 'mes' : 'web';
    return {
      id: prefix + '_' + Math.random().toString(36).slice(2, 10),
      channel,
      external_id: String(externalId),
      handed_off: false,
      handoff_reason: null,
      handoff_at: null,
      resumed_at: null,
      preview: '',
      messages: [],
      created_at: now,
      updated_at: now
    };
  }

  function get(channel, externalId) {
    const t = findRow(all(), channel, externalId);
    return t ? view(t) : null;
  }

  function isPaused(channel, externalId) {
    const t = findRow(all(), channel, externalId);
    return !!(t && t.handed_off);
  }

  function append(channel, externalId, role, text) {
    const rows = all();
    let t = findRow(rows, channel, externalId);
    if (!t) {
      t = fresh(channel, externalId);
      rows.push(t);
    }
    const now = new Date().toISOString();
    t.messages.push({ role, text: String(text || '').slice(0, 1000), at: now });
    if (t.messages.length > MAX_MESSAGES) t.messages = t.messages.slice(-MAX_MESSAGES);
    if (role === 'user') t.preview = String(text || '').slice(0, 180);
    t.updated_at = now;
    save(rows);
    return view(t);
  }

  // changed is false when the thread was already paused, so a second
  // "human" message does not fire another notification.
  function handoff(channel, externalId, reason) {
    const rows = all();
    let t = findRow(rows, channel, externalId);
    if (!t) {
      t = fresh(channel, externalId);
      rows.push(t);
    }
    const changed = !t.handed_off;
    if (changed) {
      t.handed_off = true;
      t.handoff_reason = reason || 'cannot_help';
      t.handoff_at = new Date().toISOString();
      t.resumed_at = null;
      t.updated_at = t.handoff_at;
    }
    save(rows);
    return { changed, thread: view(t) };
  }

  function resume(id) {
    const rows = all();
    const t = rows.find(r => r.id === id);
    if (!t) return null;
    t.handed_off = false;
    t.resumed_at = new Date().toISOString();
    t.updated_at = t.resumed_at;
    save(rows);
    return { thread: view(t), external_id: t.external_id, channel: t.channel };
  }

  function listHandoffs() {
    return all()
      .filter(t => t.handed_off)
      .sort((a, b) => String(b.handoff_at || '').localeCompare(String(a.handoff_at || '')))
      .map(view);
  }

  return { get, isPaused, append, handoff, resume, listHandoffs };
}

module.exports = { createStore, memory, bind, view };
