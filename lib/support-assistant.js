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
      description: 'Hand the chat to Michael and stop auto-replies. Use when you cannot answer safely, the customer wants a person, or the topic is a payment proof, refund, or dispute.',
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

function llmConfig(env) {
  const e = env || {};
  const base = String(e.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  return {
    apiKey: String(e.OPENAI_API_KEY || '').trim(),
    model: String(e.OPENAI_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini',
    baseUrl: base
  };
}

function systemPrompt(facts) {
  const f = facts || {};
  return [
    'You are the PlayStation Hub support assistant for a PS4/PS5 digital game rental shop in the Philippines.',
    'Tone: short, friendly, Taglish-friendly (English and Filipino mixed naturally). One clear call to action. No headings, no essays.',
    'Rules:',
    '- Quote prices, discounts, deposits, and slot counts only from the shop facts below or from a tool result in this turn. If a number is missing, say Michael will confirm it. Never invent a price or a slot count.',
    '- For a specific game, call lookup_game before you say whether a slot is open or how many people are waiting.',
    '- Trophy accounts have a refundable deposit. Non-Trophy does not. PS4 Primary is a Trophy-style account (deposit applies), priced like Non-Trophy, and only exists for games that run on PS4.',
    '- Local payment is GCash or Maya QR. International payment is PayPal. Customers order on the website.',
    '- Never mention other customers, their names, order references, PSIDs, or payment account numbers.',
    '- Never ask for a PSN password, a sign-in code, or a payment screenshot. Those go to Michael.',
    '- If you cannot help, the customer wants a human, or it is a payment proof, refund, or dispute, call request_human.',
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
async function respond({ message, history, complete, invokeTool, facts, lookup }) {
  const clipped = factsLib.clip(message, 1000);
  const abuse = factsLib.abuseReason(message);
  if (abuse) return { ok: false, error: abuse };

  const ruled = factsLib.handoffReason(clipped);
  if (ruled) {
    return {
      ok: true,
      reply: factsLib.handoffText(ruled),
      handoff: true,
      reason: ruled,
      source: 'rule'
    };
  }

  if (typeof complete !== 'function') {
    const fb = factsLib.fallbackReply(clipped, facts, lookup);
    return { ok: true, reply: fb.text, handoff: !!fb.handoff, reason: fb.reason, source: 'fallback' };
  }

  const messages = [{ role: 'system', content: systemPrompt(facts) }]
    .concat(priorMessages(history))
    .concat([{ role: 'user', content: clipped }]);

  try {
    for (let round = 0; round < 3; round++) {
      const msg = await complete({ messages, tools: TOOLS });
      const calls = msg && Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      if (!calls.length) {
        const text = factsLib.clip(msg && msg.content, 900);
        if (!text) break;
        return { ok: true, reply: text, handoff: false, reason: null, source: 'llm' };
      }
      messages.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: calls
      });
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
            reply: factsLib.handoffText(reason),
            handoff: true,
            reason,
            source: 'llm'
          };
        }
        if (!args) payload = { error: 'bad_arguments' };
        else if (name !== 'get_pricing' && name !== 'lookup_game') payload = { error: 'unknown_tool' };
        else if (typeof invokeTool !== 'function') payload = { error: 'unavailable' };
        else payload = factsLib.scrub(await invokeTool(name, args));
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(payload).slice(0, 6000)
        });
      }
    }
  } catch (e) {
    const fb = factsLib.fallbackReply(clipped, facts, lookup);
    return {
      ok: true,
      reply: fb.text,
      handoff: !!fb.handoff,
      reason: fb.reason,
      source: 'fallback',
      llmError: true
    };
  }

  const fb = factsLib.fallbackReply(clipped, facts, lookup);
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
      reply: factsLib.handoffText(forceReason),
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
  if (result.reply) store.append(channel, externalId, 'assistant', result.reply);
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

function createComplete(env, fetchImpl) {
  const cfg = llmConfig(env);
  if (!cfg.apiKey) return null;
  const fetchFn = fetchImpl || global.fetch;
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
    const raw = await res.text();
    if (!res.ok) {
      // Status only. The body can echo part of the request, and the key is
      // already on the request — neither belongs in a log line or an error
      // the route might surface.
      throw new Error('llm_http_' + res.status);
    }
    const data = JSON.parse(raw);
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new Error('llm_empty');
    return msg;
  };
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

module.exports = {
  TOOLS, llmConfig, systemPrompt, respond, runTurn, createComplete, createLimiter
};
