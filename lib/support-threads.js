// One row per website visitor or Messenger PSID.
//
// handed_off is the pause flag. While it is set, both channels stop
// auto-replying and the row shows up in admin until Michael resumes it.
// The Messenger handover protocol is optional (MESSENGER_HANDOVER=on).
// Off, this flag is the whole handoff: the bot stays quiet and Resume
// clears it. On, a refusal that is not "unsupported" keeps the row here
// and stores control_error. Error 27 still clears, so a Page without
// Conversation Routing cannot leave a card stuck.
//
// external_id is a session cookie or a PSID. It stays in the store so a
// resume can call the Graph API, and it is not part of the admin view.

const MAX_MESSAGES = 24;
const MAX_THREADS = 400;
const INBOX_OWNER_NOTE = "Meta Inbox owns this thread, bot can't reply";

function clone(t) {
  return {
    id: t.id,
    channel: t.channel,
    external_id: t.external_id,
    handed_off: !!t.handed_off,
    handoff_reason: t.handoff_reason || null,
    handoff_at: t.handoff_at || null,
    resumed_at: t.resumed_at || null,
    control_error: t.control_error || null,
    inbox_note: t.inbox_note || null,
    inbox_note_at: t.inbox_note_at || null,
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
    control_error: t.control_error || null,
    inbox_note: t.inbox_note || null,
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
    const open = rows.filter(r => r.handed_off || r.inbox_note);
    const rest = rows.filter(r => !r.handed_off && !r.inbox_note);
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
      control_error: null,
      inbox_note: null,
      inbox_note_at: null,
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

  function lookup(id) {
    const t = all().find(r => r.id === id);
    return t ? clone(t) : null;
  }

  function clearPause(t) {
    t.handed_off = false;
    t.control_error = null;
    t.resumed_at = new Date().toISOString();
    t.updated_at = t.resumed_at;
  }

  function resume(id) {
    const rows = all();
    const t = rows.find(r => r.id === id);
    if (!t) return null;
    clearPause(t);
    save(rows);
    return { thread: view(t), external_id: t.external_id, channel: t.channel };
  }

  // A standby message for a PSID whose card is still up. Clearing by id is
  // the admin button; this is the same clear when the customer writes again.
  function resumeExternal(channel, externalId) {
    const rows = all();
    const t = findRow(rows, channel, externalId);
    if (!t) return null;
    if (!t.handed_off && !t.control_error) return { cleared: false, thread: view(t) };
    clearPause(t);
    save(rows);
    return { cleared: true, thread: view(t), external_id: t.external_id, channel: t.channel };
  }

  // Meta refused to hand the thread back. Keep the chat visible. A row that
  // was already paused keeps its original reason; one that was live is paused
  // again so the failure is not only a log line.
  function setControlError(id, summary) {
    const rows = all();
    const t = rows.find(r => r.id === id);
    if (!t) return null;
    const now = new Date().toISOString();
    if (!t.handed_off) {
      t.handed_off = true;
      t.handoff_reason = 'thread_control';
      t.handoff_at = now;
      t.resumed_at = null;
    }
    t.control_error = String(summary || 'Messenger did not return this chat.').slice(0, 180);
    t.updated_at = now;
    save(rows);
    return view(t);
  }

  // Page Inbox still owns the thread after the pause flag was cleared, and
  // take_thread_control failed. changed is false when it was already waiting,
  // so a second standby message does not send another alert.
  function noteControlFailure(channel, externalId, summary) {
    const rows = all();
    let t = findRow(rows, channel, externalId);
    if (!t) {
      t = fresh(channel, externalId);
      rows.push(t);
    }
    const changed = !t.handed_off;
    const now = new Date().toISOString();
    if (changed) {
      t.handed_off = true;
      t.handoff_reason = 'thread_control';
      t.handoff_at = now;
      t.resumed_at = null;
    }
    t.control_error = String(summary || 'Messenger did not return this chat.').slice(0, 180);
    t.updated_at = now;
    save(rows);
    return { changed, thread: view(t) };
  }

  function listHandoffs() {
    return all()
      .filter(t => t.handed_off)
      .sort((a, b) => String(b.handoff_at || '').localeCompare(String(a.handoff_at || '')))
      .map(view);
  }

  // Page Inbox still owns the thread, so Send API returned #10. Visible on
  // the admin card. Does not set handed_off — a failed send is not a handoff.
  function noteInboxOwner(channel, externalId) {
    const rows = all();
    let t = findRow(rows, channel, externalId);
    if (!t) {
      t = fresh(channel, externalId);
      rows.push(t);
    }
    const changed = t.inbox_note !== INBOX_OWNER_NOTE;
    const now = new Date().toISOString();
    t.inbox_note = INBOX_OWNER_NOTE;
    if (!t.inbox_note_at) t.inbox_note_at = now;
    t.updated_at = now;
    save(rows);
    return { changed, thread: view(t) };
  }

  function clearInboxOwner(channel, externalId) {
    const rows = all();
    const t = findRow(rows, channel, externalId);
    if (!t || !t.inbox_note) return null;
    t.inbox_note = null;
    t.inbox_note_at = null;
    t.updated_at = new Date().toISOString();
    save(rows);
    return view(t);
  }

  function listInboxNotes() {
    return all()
      .filter(t => t.inbox_note && !t.handed_off)
      .sort((a, b) => String(b.inbox_note_at || '').localeCompare(String(a.inbox_note_at || '')))
      .map(view);
  }

  return {
    get, isPaused, append, handoff, lookup, resume, resumeExternal,
    setControlError, noteControlFailure, noteInboxOwner, clearInboxOwner,
    listHandoffs, listInboxNotes
  };
}

module.exports = { createStore, memory, bind, view, INBOX_OWNER_NOTE };
