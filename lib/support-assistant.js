// The shared brain for the website widget and the Messenger bot.
//
// A turn is: refuse abuse, stay silent if Michael has the thread, hand off
// on the payment/human rules, otherwise ask the model — which may call
// get_pricing or lookup_game. The model is injected (`complete`) so tests
// never hit the network. With no key, complete is null and the same facts
// drive a short scripted reply.

const factsLib = require('./support-facts');

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_pricing',
      description: 'Live rental tiers, deposit, discounts, PS Plus prices, and which payment methods are enabled. Use this for pricing questions.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'lookup_game',
      description: 'Look up one game by title. Returns public slot counts (Trophy, Non-Trophy, PS4 Primary), waitlist counts, and that game’s current prices. Never includes other customers.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Game title or part of it' }
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'request_human',
      description: 'Hand this same chat to an admin and stop auto-replies. Use when the customer wants a person, replies ADMIN, or the topic is a payment proof, refund, or dispute, or you cannot answer safely. Do not send them to Messenger or tell them to message someone.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            enum: ['asked_for_human', 'payment_or_dispute', 'cannot_help']
          }
        },
        required: ['reason'],
        additionalProperties: false
      }
    }
  }
];

// Production sets ANTHROPIC_API_KEY and no OpenAI key. That name is the same
// one an older, removed keyword-bot design mentioned; nothing else in the
// running app reads it, so the support assistant can take it without
// colliding with another caller.
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

function llmConfig(env) {
  const e = env || {};
  const anthropicKey = String(e.ANTHROPIC_API_KEY || '').trim();
  const openaiKey = String(e.OPENAI_API_KEY || '').trim();
  if (anthropicKey) {
    return {
      provider: 'anthropic',
      apiKey: anthropicKey,
      model: String(e.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL).trim() || DEFAULT_ANTHROPIC_MODEL
    };
  }
  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      model: String(e.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL,
      baseUrl: String(e.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
    };
  }
  return { provider: null, apiKey: '', model: '', baseUrl: '' };
}

function systemPrompt(facts) {
  const f = facts || {};
  return [
    'You are the PlayStation Hub support assistant for a PS4/PS5 digital game rental shop in the Philippines.',
    'Tone: friendly, clean, and simple. Short sentences. Use 1 to 3 relevant emoji in a reply, never more. Minimal lists. One clear next step. No headings, no essays.',
    'Language: match the customer. English if they write in English. Filipino (Tagalog) if they write in Filipino. Taglish if they mix the two. Do not switch language in the same reply.',
    'Politeness: in Filipino and Taglish, use po naturally. When a slot is available say “Yes po”. When none are available say “Wala po”. Do not say “Oo”. English replies do not use po.',
    'Admin: the server adds the last line, “Want to chat with an admin? Reply ADMIN.” (Filipino and Taglish: “Gusto mo po bang makausap ang admin? Reply ADMIN.”). Do not write that line yourself. Do not tell the customer to message Michael, and do not send an m.me link. If they reply ADMIN, or ask for an admin, a human, or Michael, call request_human. An admin replies in this same chat.',
    'Rules:',
    '- Quote prices, discounts, deposits, and slot counts only from the shop facts below or from a tool result in this turn. If a number is missing, say the live check failed. Never invent a price or a slot count, and never guess and then correct yourself in a later message.',
    '- weeklyNow and monthlyNow are the checkout totals (what the customer pays). weekly and monthly are the price-category amounts before the promo, the crossed-out figure on the game page. A discount percent is already included in the Now price. Quote the Now price. If you mention the percent, also say the category amount. Never subtract the percent from the Now price.',
    '- Write plain text. No markdown: no asterisks for bold, no # headings. A dash at the start of a line is fine.',
    '- Write ₱ immediately before every price and the deposit. Never write a bare number for money. A percent stays as 10%. The peso sign is required on the website and on Messenger.',
    '- For a specific game’s availability, slots, waitlist, or price, call lookup_game before you answer. The shop facts are the live category sheet, not a substitute for that title. Slot answers are a fixed layout from that lookup: short lines, a blank line between sections. Do not write your own paragraph for slots.',
    '- Reservations: the waitlist is free. The priority fee in the shop facts is optional, moves the customer ahead of the free list, and is taken off the rent when a slot opens. A Coming Soon game can reserve a slot: list price, paid in full now, the monthly promo does not apply, and nothing more is due on release. Paying the checkout price is for an open slot on a released game. Never say you do not know whether they can reserve without paying.',
    '- There is a 3-hour free trial on our account before they commit. Sign-in is a code on their console. Never ask for a PSN password.',
    '- Trophy and PS4 Primary include the refundable deposit. A late return costs lateFeePerDay per day, taken from that deposit. Non-Trophy has no deposit. PS4 Primary is Trophy-style, priced like Non-Trophy, and only when the game runs on PS4. Coming Soon does not offer PS4 Primary.',
    '- Local payment is GCash or Maya QR. International payment is PayPal. Customers order on the website.',
    '- Never mention other customers, their names, order references, PSIDs, or payment account numbers.',
    '- Never ask for a PSN password, a sign-in code, or a payment screenshot. A proof, refund, or dispute is request_human, in this chat.',
    '- If you cannot help, or the customer wants a person, call request_human.',
    '- Promos: offers is every promo that is on right now, with its text, terms, and dates. If offers is empty, say there is no promo running. Never invent a promo, a discount, a free rental, or a date that is not in offers or in the discount percents already in these facts.',
    '- If the customer asks whether there is a promo, including “may promo ba?”, answer from offers only.',
    '- On a price question or a specific game, mention an offer that applies: one with no gameTitle, or one whose gameTitle is that game. Do not mention an offer for a different game.',
    '- If loyaltyNote is set, tell the customer that progress. If it is empty, do not guess how many rentals they have.',
    '',
    'Shop facts (live for this turn):',
    JSON.stringify(factsLib.scrub(f))
  ].join('\n');
}

function priorMessages(history) {
  return (history || [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.text)
    .slice(-8)
    .map(m => ({ role: m.role, content: String(m.text).slice(0, 900) }));
}

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// complete(payload) -> { content, tool_calls } in OpenAI's message shape.
// invokeTool(name, args) -> public JSON. request_human is handled here and
// never forwarded, so a tool implementation cannot be talked into a handoff
// side effect it doesn't own.
async function respond(input) {
  const result = await composeReply(input);
  // The model sees prices as numbers in the tool JSON and often drops the
  // peso sign. Plain-text cleanup does not remove ₱; this puts it back on
  // any amount the shop actually charges. The admin line is added after that
  // so a handoff confirmation is not told to reply ADMIN again.
  if (result && typeof result.reply === 'string') {
    result.reply = factsLib.ensurePeso(result.reply, input && input.facts);
    if (!result.handoff) {
      result.reply = factsLib.withAdminCta(result.reply, factsLib.replyLanguage(input && input.message));
    }
  }
  return result;
}

async function readLookup(invokeTool, lookup, query) {
  try {
    if (typeof invokeTool === 'function') {
      const payload = factsLib.scrub(await invokeTool('lookup_game', { query }));
      if (!payload || payload.error) return { error: (payload && payload.error) || 'failed' };
      return { games: Array.isArray(payload.games) ? payload.games : [] };
    }
    if (typeof lookup === 'function') {
      const hits = await lookup(query);
      return { games: hits || [] };
    }
    return { error: 'unavailable' };
  } catch (e) {
    return { error: 'failed' };
  }
}

function failedCheck(message) {
  return {
    ok: true,
    reply: factsLib.toolFailure(factsLib.replyLanguage(message)),
    handoff: false,
    reason: null,
    source: 'rule'
  };
}

function slotResult(message, facts, card) {
  const lang = factsLib.replyLanguage(message);
  return {
    ok: true,
    reply: card ? factsLib.slotReply(card, facts, lang) : factsLib.missingTitle(lang),
    handoff: false,
    reason: null,
    source: 'template'
  };
}

async function composeReply({ message, history, complete, invokeTool, facts, lookup }) {
  const clipped = factsLib.clip(message, 1000);
  const abuse = factsLib.abuseReason(message);
  if (abuse) return { ok: false, error: abuse };

  const ruled = factsLib.handoffReason(clipped);
  if (ruled) {
    return {
      ok: true,
      reply: factsLib.handoffText(ruled, factsLib.replyLanguage(clipped)),
      handoff: true,
      reason: ruled,
      source: 'rule'
    };
  }

  if (typeof complete !== 'function') {
    const fb = await factsLib.fallbackReply(clipped, facts, lookup);
    return { ok: true, reply: fb.text, handoff: !!fb.handoff, reason: fb.reason, source: 'fallback' };
  }

  const messages = [{ role: 'system', content: systemPrompt(facts) }]
    .concat(priorMessages(history))
    .concat([{ role: 'user', content: clipped }]);
  const needsGame = factsLib.needsLiveGame(clipped);
  let lookedUp = false;
  let forcedCard = null;

  try {
    for (let round = 0; round < 3; round++) {
      const msg = await complete({ messages, tools: TOOLS });
      const calls = msg && Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      if (!calls.length) {
        const text = factsLib.clip(msg && msg.content, 900);
        if (!text) break;
        // A first draft that names slots before the lookup ran is not sent.
        // The customer only sees the reply written after the live result.
        if (needsGame && !lookedUp) {
          const live = await readLookup(invokeTool, lookup, clipped);
          if (live.error) return failedCheck(clipped);
          lookedUp = true;
          forcedCard = live.games[0] || null;
          if (factsLib.asksSlots(clipped)) return slotResult(clipped, facts, forcedCard);
          messages.push({
            role: 'user',
            content: 'Live lookup for this turn. Answer only from this JSON. If games is empty, say the title was not in the live list and do not invent slots or prices. Do not say you do not know how reserving works. ' + JSON.stringify({ games: live.games }).slice(0, 6000)
          });
          continue;
        }
        if (factsLib.asksSlots(clipped) && lookedUp) return slotResult(clipped, facts, forcedCard);
        const rescued = factsLib.rescueReply(clipped, facts, text, forcedCard);
        return { ok: true, reply: factsLib.clip(rescued, 1200), handoff: false, reason: null, source: 'llm' };
      }
      const assistantTurn = {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: calls
      };
      // Haiku 5.5 thinks by default. The next Messages request has to send
      // those blocks back unchanged beside the tool_use blocks.
      if (Array.isArray(msg.anthropic_content) && msg.anthropic_content.length) {
        assistantTurn.anthropic_content = msg.anthropic_content;
      }
      messages.push(assistantTurn);
      for (const call of calls) {
        const fn = call && call.function ? call.function : {};
        const name = fn.name;
        const args = parseArgs(fn.arguments);
        let payload;
        if (name === 'request_human') {
          const reason = args && ['asked_for_human', 'payment_or_dispute', 'cannot_help'].includes(args.reason)
            ? args.reason
            : 'cannot_help';
          return {
            ok: true,
            reply: factsLib.handoffText(reason, factsLib.replyLanguage(clipped)),
            handoff: true,
            reason,
            source: 'llm'
          };
        }
        if (!args) payload = { error: 'bad_arguments' };
        else if (name !== 'get_pricing' && name !== 'lookup_game') payload = { error: 'unknown_tool' };
        else if (typeof invokeTool !== 'function') payload = { error: 'unavailable' };
        else payload = factsLib.scrub(await invokeTool(name, args));
        if (name === 'lookup_game' && payload && payload.error) return failedCheck(clipped);
        if (name === 'lookup_game') {
          lookedUp = true;
          if (payload && Array.isArray(payload.games) && payload.games[0]) forcedCard = payload.games[0];
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(payload).slice(0, 6000)
        });
      }
      if (factsLib.asksSlots(clipped) && lookedUp) return slotResult(clipped, facts, forcedCard);
    }
  } catch (e) {
    const fb = await factsLib.fallbackReply(clipped, facts, lookup);
    return {
      ok: true,
      reply: fb.text,
      handoff: !!fb.handoff,
      reason: fb.reason,
      source: 'fallback',
      llmError: true
    };
  }

  const fb = await factsLib.fallbackReply(clipped, facts, lookup);
  return { ok: true, reply: fb.text, handoff: !!fb.handoff, reason: fb.reason, source: 'fallback' };
}

// Store + respond. A paused thread records the new line and sends nothing.
// forceReason covers a photo with no caption: that is a proof until Michael
// says otherwise, and it must not be shown to the model.
async function runTurn({ store, channel, externalId, message, forceReason, complete, invokeTool, facts, lookup }) {
  const abuse = factsLib.abuseReason(message);
  if (abuse && !forceReason) return { ok: false, error: abuse };

  if (store.isPaused(channel, externalId)) {
    store.append(channel, externalId, 'user', factsLib.clip(message, 1000) || '[attachment]');
    const row = store.get(channel, externalId);
    return {
      ok: true,
      paused: true,
      reply: null,
      handoff: false,
      reason: row && row.handoff_reason,
      preview: row && row.preview,
      channel
    };
  }

  const existing = store.get(channel, externalId);
  let result;
  if (forceReason) {
    result = {
      ok: true,
      reply: factsLib.handoffText(forceReason, factsLib.replyLanguage(message)),
      handoff: true,
      reason: forceReason,
      source: 'rule'
    };
  } else {
    result = await respond({
      message,
      history: existing && existing.messages,
      complete,
      invokeTool,
      facts,
      lookup
    });
  }
  if (!result.ok) return result;

  store.append(channel, externalId, 'user', factsLib.clip(message, 1000) || '[attachment]');
  // The thread and the admin card keep the plain wording. The website
  // response still carries the model's text so the widget can draw bold;
  // Messenger strips it again at send time.
  if (result.reply) store.append(channel, externalId, 'assistant', factsLib.toPlainText(result.reply));
  let newlyHandedOff = false;
  if (result.handoff) {
    const flagged = store.handoff(channel, externalId, result.reason);
    newlyHandedOff = !!(flagged && flagged.changed);
  }
  const row = store.get(channel, externalId);
  return {
    ok: true,
    paused: false,
    reply: result.reply,
    handoff: !!result.handoff,
    newlyHandedOff,
    reason: result.reason || null,
    source: result.source || null,
    preview: row && row.preview,
    channel,
    llmError: !!result.llmError
  };
}

function anthropicTools(tools) {
  return (tools || []).map(t => {
    const fn = (t && t.function) || t || {};
    return {
      name: fn.name,
      description: fn.description || '',
      input_schema: fn.parameters || { type: 'object', properties: {} }
    };
  });
}

// respond() speaks OpenAI's message shape. Claude's Messages API wants the
// system prompt on its own field, tool results as user blocks, and any
// thinking blocks from the previous assistant turn copied back verbatim.
function toAnthropicBody(model, messages, tools) {
  let system = '';
  const out = [];
  (messages || []).forEach(m => {
    if (!m) return;
    if (m.role === 'system') {
      system += (system ? '\n' : '') + String(m.content || '');
      return;
    }
    if (m.role === 'assistant') {
      if (Array.isArray(m.anthropic_content) && m.anthropic_content.length) {
        out.push({ role: 'assistant', content: m.anthropic_content });
        return;
      }
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: String(m.content) });
      (m.tool_calls || []).forEach(call => {
        const fn = (call && call.function) || {};
        let input = {};
        if (fn.arguments && typeof fn.arguments === 'object') input = fn.arguments;
        else if (fn.arguments) {
          try { input = JSON.parse(fn.arguments); } catch (e) { input = {}; }
        }
        if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
        blocks.push({ type: 'tool_use', id: call.id, name: fn.name, input });
      });
      if (blocks.length) out.push({ role: 'assistant', content: blocks });
      return;
    }
    if (m.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: String(m.content || '')
      };
      const last = out[out.length - 1];
      const lastIsResults = last && last.role === 'user' && Array.isArray(last.content)
        && last.content.every(b => b && b.type === 'tool_result');
      if (lastIsResults) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
      return;
    }
    if (m.role === 'user') out.push({ role: 'user', content: String(m.content || '') });
  });
  const body = {
    model,
    // Thinking tokens count against this cap. 4096 leaves room for a short
    // tool round without sending temperature (Haiku 5.5 rejects it).
    max_tokens: 4096,
    messages: out,
    tools: anthropicTools(tools),
    tool_choice: { type: 'auto' }
  };
  if (system) body.system = system;
  return body;
}

function fromAnthropic(data) {
  const blocks = data && Array.isArray(data.content) ? data.content : [];
  const text = blocks
    .filter(b => b && b.type === 'text' && b.text)
    .map(b => String(b.text))
    .join('\n')
    .trim();
  const tool_calls = blocks
    .filter(b => b && b.type === 'tool_use' && b.name)
    .map(b => ({
      id: b.id,
      type: 'function',
      function: {
        name: b.name,
        arguments: JSON.stringify(b.input == null ? {} : b.input)
      }
    }));
  if (!text && !tool_calls.length) throw new Error('llm_empty');
  const msg = { content: text || null, tool_calls };
  if (tool_calls.length) msg.anthropic_content = blocks;
  return msg;
}

async function readLlm(res) {
  const raw = await res.text();
  if (!res.ok) {
    // Status only. The body can echo part of the request, and the key is
    // already on the request — neither belongs in a log line or an error
    // the route might surface.
    throw new Error('llm_http_' + res.status);
  }
  return JSON.parse(raw);
}

function createAnthropicComplete(cfg, fetchFn) {
  return async function complete(payload) {
    const res = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(toAnthropicBody(cfg.model, payload.messages, payload.tools))
    });
    return fromAnthropic(await readLlm(res));
  };
}

function createOpenAIComplete(cfg, fetchFn) {
  return async function complete(payload) {
    const res = await fetchFn(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + cfg.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.4,
        messages: payload.messages,
        tools: payload.tools,
        tool_choice: 'auto'
      })
    });
    const data = await readLlm(res);
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new Error('llm_empty');
    return msg;
  };
}

function createComplete(env, fetchImpl) {
  const cfg = llmConfig(env);
  if (!cfg.apiKey) return null;
  const fetchFn = fetchImpl || global.fetch;
  if (cfg.provider === 'anthropic') return createAnthropicComplete(cfg, fetchFn);
  return createOpenAIComplete(cfg, fetchFn);
}

// Per-key counter. The website route keys this by IP; Messenger keys it by
// PSID. Separate from the order limiter so a chatty customer cannot lock
// themselves out of checkout, and a checkout burst cannot lock out chat.
function createLimiter(max, windowMs, nowFn) {
  const map = new Map();
  const now = typeof nowFn === 'function' ? nowFn : (() => Date.now());
  return function hit(key) {
    const t = now();
    let b = map.get(key);
    if (!b || t >= b.resetAt) {
      b = { count: 0, resetAt: t + windowMs };
      map.set(key, b);
    }
    b.count += 1;
    return b.count > max;
  };
}

// A normal back-and-forth is more than a dozen lines. Abuse (length, repeats,
// link dumps) is still refused before this counter. Website keys by IP,
// Messenger keys by PSID, same window.
const SUPPORT_CHAT_LIMIT = 40;
const SUPPORT_CHAT_WINDOW_MS = 10 * 60 * 1000;

module.exports = {
  TOOLS, llmConfig, systemPrompt, respond, runTurn, createComplete, createLimiter,
  SUPPORT_CHAT_LIMIT, SUPPORT_CHAT_WINDOW_MS
};
