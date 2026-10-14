// Run: node scripts/test-support-assistant.js
//
// The support assistant's core: live prices, public game cards, handoff
// rules, the model tool loop, thread pause, and Messenger signature checks.
// No network and no games.json — every store and model call is injected.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const facts = require('../lib/support-facts');
const threads = require('../lib/support-threads');
const assistant = require('../lib/support-assistant');
const messenger = require('../lib/messenger-webhook');

let passed = 0;
function ok(desc, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ok - ' + desc); });
}

const promo = { enabled: true, discounts: { 7: 0, 30: 10 }, deposit: 100, late_fee_per_day: 20 };
const categories = [{
  id: 1, name: 'New Games',
  nt_price_7d: 349, nt_price_30d: 699,
  tr_price_7d: 399, tr_price_30d: 799
}];

function shopFacts() {
  return facts.faqBundle({
    categories,
    promo,
    paymentMethods: [
      { key: 'gcash', enabled: true },
      { key: 'maya', enabled: true },
      { key: 'paypal', enabled: true }
    ],
    siteUrl: 'https://www.playstation-hub.com',
    pageUsername: 'PlaystationHub00',
    psplusPrices: { nt_price_7d: 159, nt_price_30d: 399, tr_price_7d: 199, tr_price_30d: 499 },
    psplusSlots: { nt_slots: 1, tr_slots: 0, ps4_slots: 0 }
  });
}

const elden = {
  id: 7, title: 'Elden Ring', platform: 'PS5',
  nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799,
  fb_name: 'Ana Cruz', customer_name: 'Ana Cruz', email: 'ana@example.com'
};
const hogwarts = {
  id: 8, title: 'Hogwarts Legacy', platform: 'PS4/PS5',
  nt_price_7d: 249, nt_price_30d: 499, tr_price_7d: 299, tr_price_30d: 599
};

async function main() {
  console.log('\npricing from live categories, not a hardcoded sheet');

  await ok('New Games weekly stays 349 and monthly takes the live 10% off', () => {
    const sheet = facts.pricingSheet(categories, promo);
    assert.strictEqual(sheet[0].name, 'New Games');
    assert.strictEqual(sheet[0].nonTrophy.weeklyNow, 349);
    assert.strictEqual(sheet[0].nonTrophy.monthlyNow, 629);
    assert.strictEqual(sheet[0].trophy.weeklyNow, 399);
    assert.strictEqual(sheet[0].trophy.monthlyNow, 719);
  });

  await ok('the month price is the checkout total, and the category price stays on the sheet', () => {
    // POST /order/create charges base - round(base * pct / 100) when a promo percent is on.
    function checkout(base, pct) {
      return pct > 0 ? base - Math.round(base * pct / 100) : base;
    }
    const sheet = facts.pricingSheet(categories, promo);
    assert.strictEqual(sheet[0].nonTrophy.weekly, 349);
    assert.strictEqual(sheet[0].nonTrophy.monthly, 699);
    assert.strictEqual(sheet[0].trophy.weekly, 399);
    assert.strictEqual(sheet[0].trophy.monthly, 799);
    assert.strictEqual(sheet[0].nonTrophy.monthlyNow, checkout(699, 10));
    assert.strictEqual(sheet[0].trophy.monthlyNow, checkout(799, 10));
    assert.strictEqual(sheet[0].nonTrophy.weeklyNow, checkout(349, 0));
    const blurb = facts.fallbackReply('how much for new games', shopFacts(), () => []);
    assert.ok(blurb.text.includes('₱629'), blurb.text);
    assert.ok(blurb.text.includes('₱699'), blurb.text);
    assert.ok(blurb.text.includes('₱719'), blurb.text);
    assert.ok(blurb.text.includes('₱799'), blurb.text);
    assert.ok(blurb.text.includes('already taken off'), blurb.text);
  });

  await ok('a different category price is what gets quoted', () => {
    const sheet = facts.pricingSheet(
      [{ name: 'Regular', nt_price_7d: 111, nt_price_30d: 222, tr_price_7d: 150, tr_price_30d: 300 }],
      { enabled: false, discounts: { 30: 10 }, deposit: 100 }
    );
    assert.strictEqual(sheet[0].nonTrophy.weeklyNow, 111);
    assert.strictEqual(sheet[0].nonTrophy.monthlyNow, 222);
    const blurb = facts.fallbackReply('magkano', facts.faqBundle({
      categories: [{ name: 'Regular', nt_price_7d: 111, nt_price_30d: 222, tr_price_7d: 150, tr_price_30d: 300 }],
      promo: { enabled: false, deposit: 80 },
      siteUrl: 'https://www.playstation-hub.com'
    }), () => []);
    assert.ok(blurb.text.includes('₱111'), blurb.text);
    assert.ok(!blurb.text.includes('₱349'), blurb.text);
    assert.ok(blurb.text.includes('₱80'), 'deposit comes from promo: ' + blurb.text);
  });

  await ok('deposit, payments, and PS Plus come from the settings objects', () => {
    const f = shopFacts();
    assert.strictEqual(f.deposit, 100);
    assert.strictEqual(f.monthlyDiscountPct, 10);
    assert.deepStrictEqual(f.payments.enabledKeys.sort(), ['gcash', 'maya', 'paypal']);
    assert.strictEqual(f.psplus.nonTrophyMonthly, 399 - Math.round(399 * 0.1));
    assert.ok(f.ps4Primary.toLowerCase().includes('ps4'));
    assert.ok(f.orderUrl.includes('/browse'));
  });

  await ok('a disabled payment method is not advertised', () => {
    const p = facts.paymentFacts([
      { key: 'gcash', enabled: false },
      { key: 'maya', enabled: true },
      { key: 'paypal', enabled: false }
    ]);
    assert.strictEqual(p.gcash, false);
    assert.strictEqual(p.maya, true);
    assert.strictEqual(p.paypal, false);
  });

  console.log('\ngame cards stay public');

  await ok('a question that only contains the title still finds that game', () => {
    const hits = facts.searchGames([elden, hogwarts], 'Hogwarts Legacy slots?');
    assert.strictEqual(hits[0].title, 'Hogwarts Legacy');
    assert.strictEqual(facts.searchGames([elden, hogwarts], 'how much').length, 0);
  });

  await ok('a PS5 game has Trophy and Non-Trophy slots and no PS4 Primary', () => {
    const card = facts.publicGame(elden, { ntSlots: 2, trSlots: 0, ps4Slots: 9 }, { nonTrophy: 1, trophy: 3, ps4Primary: 4 }, promo);
    assert.strictEqual(card.slots.nonTrophy, 2);
    assert.strictEqual(card.slots.trophy, 0);
    assert.strictEqual(card.slots.ps4Primary, undefined);
    assert.strictEqual(card.waitlist.nonTrophy, 1);
    const dumped = JSON.stringify(card);
    assert.ok(!dumped.includes('Ana'));
    assert.ok(!dumped.includes('example.com'));
    assert.ok(!dumped.includes('ps4Primary'));
  });

  await ok('PS4 Primary is offered only when the game runs on PS4, at the Non-Trophy price', () => {
    const card = facts.publicGame(hogwarts, { ntSlots: 0, trSlots: 1, ps4Slots: 2 }, { nonTrophy: 0, trophy: 0, ps4Primary: 5 }, promo);
    assert.strictEqual(card.slots.ps4Primary, 2);
    assert.ok(card.ps4Primary.toLowerCase().includes('deposit'));
    assert.strictEqual(card.prices.nonTrophyWeekly, 249);
  });

  await ok('a per-game discount replaces the site promo on that title', () => {
    const game = Object.assign({}, elden, { discounts: { 30: 50 } });
    const prices = facts.quotedPrices(game, promo);
    assert.strictEqual(prices.nonTrophyMonthly, 349);
    assert.strictEqual(prices.nonTrophyWeekly, 349);
  });

  await ok('waitlist summary is counts, even when the rows carry names', () => {
    const summary = facts.waitlistSummary({
      nt: [{ name: 'A***', ref: 'PH-1001' }],
      tr: [{ name: 'B***' }, { name: 'C***' }],
      ps4: []
    });
    assert.deepStrictEqual(summary, { nonTrophy: 1, trophy: 2, ps4Primary: 0 });
    assert.ok(!JSON.stringify(summary).includes('PH-'));
    assert.ok(!JSON.stringify(summary).includes('A***'));
  });

  await ok('scrub drops customer fields and order refs before the model sees them', () => {
    const clean = facts.scrub({
      title: 'Elden Ring',
      fb_name: 'Ana Cruz',
      note: 'see PH-1042',
      name: 'New Games'
    });
    assert.strictEqual(clean.fb_name, undefined);
    assert.strictEqual(clean.note, 'see [order]');
    assert.strictEqual(clean.name, 'New Games');
  });

  console.log('\nhandoff rules');

  await ok('asking for a person hands off without calling the model', async () => {
    let called = false;
    const result = await assistant.respond({
      message: 'Can I talk to a human?',
      facts: shopFacts(),
      complete: async () => { called = true; return { content: 'no' }; }
    });
    assert.strictEqual(called, false);
    assert.strictEqual(result.handoff, true);
    assert.strictEqual(result.reason, 'asked_for_human');
    assert.ok(result.reply.includes('Michael'));
  });

  await ok('a payment proof or dispute hands off', async () => {
    const result = await assistant.respond({
      message: "I already paid, here's my GCash screenshot",
      facts: shopFacts(),
      complete: async () => { throw new Error('should not run'); }
    });
    assert.strictEqual(result.reason, 'payment_or_dispute');
    assert.strictEqual(result.handoff, true);
  });

  await ok('how to pay is a normal answer, not a dispute', async () => {
    const result = await assistant.respond({
      message: 'how do I pay',
      facts: shopFacts(),
      lookup: () => []
    });
    assert.strictEqual(result.handoff, false);
    assert.ok(result.reply.includes('GCash'));
    assert.ok(result.reply.includes('Maya'));
    assert.ok(result.reply.includes('PayPal'));
  });

  console.log('\nmodel tool loop');

  await ok('lookup_game results are scrubbed, then the model’s text is the reply', async () => {
    let toolBody = '';
    let round = 0;
    const result = await assistant.respond({
      message: 'meron ba Elden Ring',
      facts: shopFacts(),
      history: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'Hello!' }],
      invokeTool: async (name, args) => {
        assert.strictEqual(name, 'lookup_game');
        assert.strictEqual(args.query, 'Elden');
        return { title: 'Elden Ring', slots: { nonTrophy: 2 }, fb_name: 'Ana Cruz', note: 'order PH-1042' };
      },
      complete: async ({ messages }) => {
        round += 1;
        if (round === 1) {
          return {
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'lookup_game', arguments: '{"query":"Elden"}' } }]
          };
        }
        const toolMsg = messages.filter(m => m.role === 'tool').pop();
        toolBody = toolMsg.content;
        return { content: 'Elden Ring has 2 Non-Trophy slots open. Rent it on the site.' };
      }
    });
    assert.ok(!toolBody.includes('Ana'));
    assert.ok(!toolBody.includes('PH-1042'));
    assert.ok(toolBody.includes('Elden Ring'));
    assert.strictEqual(result.source, 'llm');
    assert.strictEqual(result.handoff, false);
    assert.ok(result.reply.includes('2 Non-Trophy'));
  });

  await ok('request_human from the model pauses the bot', async () => {
    const result = await assistant.respond({
      message: 'my rental end date looks wrong',
      facts: shopFacts(),
      complete: async () => ({
        content: null,
        tool_calls: [{ id: 'c2', type: 'function', function: { name: 'request_human', arguments: '{"reason":"cannot_help"}' } }]
      })
    });
    assert.strictEqual(result.handoff, true);
    assert.strictEqual(result.reason, 'cannot_help');
    assert.strictEqual(result.source, 'llm');
  });

  await ok('a model failure falls back to the scripted price answer', async () => {
    const result = await assistant.respond({
      message: 'how much for new games',
      facts: shopFacts(),
      complete: async () => { throw new Error('llm_http_500'); }
    });
    assert.strictEqual(result.source, 'fallback');
    assert.strictEqual(result.llmError, true);
    assert.ok(result.reply.includes('₱349'), result.reply);
    assert.ok(result.reply.includes('10%'), result.reply);
  });

  function jsonResponse(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body)
    };
  }

  await ok('Claude is used when ANTHROPIC_API_KEY is set, and thinking blocks go back with the tool result', async () => {
    const seen = [];
    const fetchImpl = async (url, opts) => {
      seen.push({ url, opts, body: JSON.parse(opts.body) });
      if (seen.length === 1) {
        return jsonResponse(200, {
          content: [
            { type: 'thinking', thinking: 'look up the live sheet', signature: 'sig-1' },
            { type: 'tool_use', id: 'toolu_1', name: 'get_pricing', input: {} }
          ]
        });
      }
      return jsonResponse(200, {
        content: [{ type: 'text', text: 'New Games is ₱349 for a week.' }]
      });
    };
    const env = {
      ANTHROPIC_API_KEY: 'sk-ant-test',
      OPENAI_API_KEY: 'sk-openai-also',
      ANTHROPIC_MODEL: 'claude-haiku-5-5'
    };
    const cfg = assistant.llmConfig(env);
    assert.strictEqual(cfg.provider, 'anthropic');
    assert.strictEqual(cfg.model, 'claude-haiku-5-5');
    assert.strictEqual(cfg.apiKey, 'sk-ant-test');
    const result = await assistant.respond({
      message: 'how much for new games please',
      facts: shopFacts(),
      complete: assistant.createComplete(env, fetchImpl),
      invokeTool: async (name) => {
        assert.strictEqual(name, 'get_pricing');
        return { tiers: [{ name: 'New Games' }] };
      }
    });
    assert.strictEqual(result.source, 'llm');
    assert.ok(result.reply.includes('₱349'));
    assert.strictEqual(seen.length, 2);
    assert.strictEqual(seen[0].url, 'https://api.anthropic.com/v1/messages');
    assert.strictEqual(seen[0].opts.headers['x-api-key'], 'sk-ant-test');
    assert.strictEqual(seen[0].opts.headers['anthropic-version'], '2023-06-01');
    assert.strictEqual(seen[0].body.model, 'claude-haiku-5-5');
    assert.strictEqual(seen[0].body.temperature, undefined);
    assert.ok(seen[0].body.system.includes('PlayStation Hub'));
    assert.ok(seen[0].body.messages.every(m => m.role !== 'system'));
    const pricing = seen[0].body.tools.find(t => t.name === 'get_pricing');
    assert.strictEqual(pricing.input_schema.type, 'object');
    assert.strictEqual(pricing.parameters, undefined);
    assert.deepStrictEqual(seen[0].body.tool_choice, { type: 'auto' });
    const echoed = seen[1].body.messages.find(m => m.role === 'assistant');
    assert.ok(echoed.content.some(b => b.type === 'thinking' && b.signature === 'sig-1'));
    assert.ok(echoed.content.some(b => b.type === 'tool_use' && b.id === 'toolu_1' && b.name === 'get_pricing'));
    const toolMsg = seen[1].body.messages.filter(m => m.role === 'user').pop();
    assert.ok(toolMsg.content.some(b => b.type === 'tool_result' && b.tool_use_id === 'toolu_1'));
    assert.ok(!JSON.stringify(seen).includes('sk-openai-also'));
  });

  await ok('ANTHROPIC_MODEL overrides the default, and a blank key does not win', () => {
    const custom = assistant.llmConfig({ ANTHROPIC_API_KEY: 'sk-ant', ANTHROPIC_MODEL: 'claude-sonnet-5' });
    assert.strictEqual(custom.model, 'claude-sonnet-5');
    const blank = assistant.llmConfig({ ANTHROPIC_API_KEY: '   ', OPENAI_API_KEY: 'sk-o' });
    assert.strictEqual(blank.provider, 'openai');
    assert.strictEqual(assistant.llmConfig({}).provider, null);
    assert.strictEqual(assistant.createComplete({}), null);
    assert.strictEqual(assistant.createComplete({ ANTHROPIC_API_KEY: '  ' }), null);
  });

  await ok('OpenAI is the fallback only when the Anthropic key is absent', async () => {
    let seen;
    const fetchImpl = async (url, opts) => {
      seen = { url, body: JSON.parse(opts.body), auth: opts.headers.Authorization };
      return jsonResponse(200, { choices: [{ message: { content: 'OpenAI reply', tool_calls: [] } }] });
    };
    const cfg = assistant.llmConfig({ OPENAI_API_KEY: 'sk-openai', OPENAI_MODEL: 'gpt-4o-mini' });
    assert.strictEqual(cfg.provider, 'openai');
    const result = await assistant.respond({
      message: 'hello there',
      facts: shopFacts(),
      complete: assistant.createComplete({ OPENAI_API_KEY: 'sk-openai' }, fetchImpl)
    });
    assert.strictEqual(result.reply, 'OpenAI reply');
    assert.strictEqual(seen.url, 'https://api.openai.com/v1/chat/completions');
    assert.strictEqual(seen.auth, 'Bearer sk-openai');
    assert.strictEqual(seen.body.model, 'gpt-4o-mini');
    assert.strictEqual(seen.body.temperature, 0.4);
    assert.strictEqual(seen.body.tool_choice, 'auto');
  });

  await ok('an Anthropic HTTP error falls back without the response body or the key', async () => {
    const fetchImpl = async () => jsonResponse(401, { error: { message: 'bad key sk-ant-secret leaked' } });
    const complete = assistant.createComplete({ ANTHROPIC_API_KEY: 'sk-ant-secret' }, fetchImpl);
    let thrown;
    try {
      await complete({ messages: [{ role: 'user', content: 'hi' }], tools: assistant.TOOLS });
    } catch (e) { thrown = e; }
    assert.ok(thrown);
    assert.strictEqual(thrown.message, 'llm_http_401');
    assert.ok(!thrown.message.includes('sk-ant-secret'));
    assert.ok(!thrown.message.includes('leaked'));
    const result = await assistant.respond({
      message: 'how much for new games',
      facts: shopFacts(),
      complete
    });
    assert.strictEqual(result.source, 'fallback');
    assert.strictEqual(result.llmError, true);
    assert.ok(result.reply.includes('₱349'));
  });

  await ok('Messenger and the saved thread get plain text, and the widget still receives the model wording', async () => {
    const raw = [
      'Ang main difference ay yung **deposit** at **presyo**:',
      '',
      '- **Non-Trophy:** walang deposit.',
      '* **Trophy:** may **₱100 refundable deposit**.'
    ].join('\n');
    const plain = facts.toPlainText(raw);
    assert.ok(!plain.includes('**'), plain);
    assert.ok(plain.includes('- Non-Trophy:'));
    assert.ok(plain.includes('- Trophy:'));
    assert.ok(plain.includes('₱100'));
    const store = threads.createStore(threads.memory());
    const result = await assistant.runTurn({
      store, channel: 'messenger', externalId: 'psid-md',
      message: 'what is the difference between accounts',
      facts: shopFacts(),
      complete: async () => ({ content: raw })
    });
    assert.strictEqual(result.reply, raw);
    const saved = store.get('messenger', 'psid-md').messages.filter(m => m.role === 'assistant').pop();
    assert.strictEqual(saved.text, plain);
  });

  await ok('the system prompt carries the live tier, not a fixed 349', () => {
    const prompt = assistant.systemPrompt(facts.faqBundle({
      categories: [{ name: 'Regular', nt_price_7d: 111, nt_price_30d: 222, tr_price_7d: 1, tr_price_30d: 2 }],
      promo: { enabled: false, deposit: 80 },
      siteUrl: 'https://www.playstation-hub.com'
    }));
    assert.ok(prompt.includes('111'));
    assert.ok(!prompt.includes('349'));
    assert.ok(prompt.includes('lookup_game'));
    assert.ok(prompt.includes('already included'));
    assert.ok(prompt.includes('Never subtract the percent'));
  });

  console.log('\nthreads');

  await ok('handoff pauses the thread until resume, and a second flag does not re-notify', async () => {
    const store = threads.createStore(threads.memory());
    const first = await assistant.runTurn({
      store, channel: 'web', externalId: 'sess-1',
      message: 'talk to a human',
      facts: shopFacts()
    });
    assert.strictEqual(first.newlyHandedOff, true);
    assert.strictEqual(first.handoff, true);
    assert.ok(store.isPaused('web', 'sess-1'));
    assert.strictEqual(store.get('web', 'sess-1').external_id, undefined);

    const second = await assistant.runTurn({
      store, channel: 'web', externalId: 'sess-1',
      message: 'hello are you there',
      facts: shopFacts(),
      complete: async () => { throw new Error('paused threads must not call the model'); }
    });
    assert.strictEqual(second.paused, true);
    assert.strictEqual(second.reply, null);
    const waiting = store.listHandoffs();
    assert.strictEqual(waiting.length, 1);
    assert.ok(!JSON.stringify(waiting).includes('sess-1'));

    const resumed = store.resume(waiting[0].id);
    assert.strictEqual(resumed.external_id, 'sess-1');
    assert.strictEqual(store.isPaused('web', 'sess-1'), false);
    assert.strictEqual(store.listHandoffs().length, 0);

    const third = await assistant.runTurn({
      store, channel: 'web', externalId: 'sess-1',
      message: 'prices',
      facts: shopFacts()
    });
    assert.strictEqual(third.paused, false);
    assert.ok(third.reply.includes('₱349'));
  });

  await ok('a photo with no caption is a handoff and is not sent to the model', async () => {
    let called = false;
    const store = threads.createStore(threads.memory());
    const result = await assistant.runTurn({
      store, channel: 'messenger', externalId: 'psid-9',
      message: '[attachment]',
      forceReason: 'attachment',
      facts: shopFacts(),
      complete: async () => { called = true; return { content: 'no' }; }
    });
    assert.strictEqual(called, false);
    assert.strictEqual(result.reason, 'attachment');
    assert.strictEqual(result.newlyHandedOff, true);
  });

  console.log('\nabuse and rate limit');

  await ok('empty, huge, and spam messages are refused', () => {
    assert.strictEqual(facts.abuseReason(''), 'empty');
    assert.strictEqual(facts.abuseReason('   '), 'empty');
    assert.strictEqual(facts.abuseReason('x'.repeat(1001)), 'too_long');
    assert.strictEqual(facts.abuseReason('a'.repeat(41)), 'spam');
    assert.strictEqual(facts.abuseReason('how much is elden ring'), null);
  });

  await ok('the limiter trips on the message after the max', () => {
    let t = 1000;
    const hit = assistant.createLimiter(3, 10000, () => t);
    assert.strictEqual(hit('1.2.3.4'), false);
    assert.strictEqual(hit('1.2.3.4'), false);
    assert.strictEqual(hit('1.2.3.4'), false);
    assert.strictEqual(hit('1.2.3.4'), true);
    assert.strictEqual(hit('9.9.9.9'), false);
    t += 10001;
    assert.strictEqual(hit('1.2.3.4'), false);
  });

  console.log('\nMessenger webhook');

  await ok('verify handshake accepts only the configured token', () => {
    const env = messenger.config({ FB_VERIFY_TOKEN: 'secret-token', MESSENGER_VERIFY_TOKEN: 'old' });
    assert.strictEqual(env.verifyToken, 'secret-token');
    const okChallenge = messenger.verifyChallenge({
      mode: 'subscribe', token: 'secret-token', challenge: 'abc', expected: env.verifyToken
    });
    assert.deepStrictEqual(okChallenge, { ok: true, challenge: 'abc' });
    const bad = messenger.verifyChallenge({
      mode: 'subscribe', token: 'nope', challenge: 'abc', expected: env.verifyToken
    });
    assert.strictEqual(bad.ok, false);
  });

  await ok('page token and app secret fall back to the names this app already used', () => {
    const env = messenger.config({
      MESSENGER_PAGE_TOKEN: 'page-tok',
      MESSENGER_APP_SECRET: 'app-secret'
    });
    assert.strictEqual(env.pageToken, 'page-tok');
    assert.strictEqual(env.appSecret, 'app-secret');
    assert.strictEqual(env.inboxAppId, '263902037430900');
  });

  await ok('production MESSENGER_VERIFY_TOKEN and MESSENGER_PAGE_TOKEN are what the webhook reads', () => {
    const env = messenger.config({
      MESSENGER_VERIFY_TOKEN: 'prod-verify',
      MESSENGER_PAGE_TOKEN: 'prod-page'
    });
    assert.strictEqual(env.verifyToken, 'prod-verify');
    assert.strictEqual(env.pageToken, 'prod-page');
    const handshake = messenger.verifyChallenge({
      mode: 'subscribe', token: 'prod-verify', challenge: '12345', expected: env.verifyToken
    });
    assert.deepStrictEqual(handshake, { ok: true, challenge: '12345' });
    const wrong = messenger.verifyChallenge({
      mode: 'subscribe', token: 'playstation_hub_verify', challenge: '12345', expected: env.verifyToken
    });
    assert.strictEqual(wrong.ok, false);
  });

  await ok('signature matches the raw body and rejects a tampered one', () => {
    const secret = 'app-secret';
    const body = '{"object":"page","entry":[]}';
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    assert.deepStrictEqual(messenger.verifySignature(secret, body, sig), { ok: true });
    assert.strictEqual(messenger.verifySignature(secret, body, 'sha256=deadbeef').ok, false);
    assert.strictEqual(messenger.verifySignature('', body, sig).reason, 'no_secret');
  });

  await ok('echoes are ignored, a photo is flagged, and a referral still comes through', () => {
    const events = messenger.inboundEvents({
      object: 'page',
      entry: [{
        messaging: [
          { sender: { id: '1' }, message: { is_echo: true, text: 'our reply' } },
          { sender: { id: '2' }, message: { text: 'magkano elden' } },
          { sender: { id: '3' }, message: { attachments: [{ type: 'image' }] } },
          { sender: { id: '4' }, referral: { ref: 'PH-1001' } }
        ]
      }]
    });
    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[0].text, 'magkano elden');
    assert.strictEqual(events[1].attachments, true);
    assert.strictEqual(events[1].text, '');
    assert.strictEqual(events[2].referral, 'PH-1001');
    assert.strictEqual(events[2].reply, false);
  });

  await ok('pass and take thread control target the inbox app and the PSID', () => {
    const pass = messenger.passThreadControl('psid-1', '263902037430900');
    assert.strictEqual(pass.recipient.id, 'psid-1');
    assert.strictEqual(pass.target_app_id, '263902037430900');
    const take = messenger.takeThreadControl('psid-1');
    assert.strictEqual(take.recipient.id, 'psid-1');
    const sent = messenger.sendText('psid-1', 'x'.repeat(3000));
    assert.strictEqual(sent.message.text.length, 2000);
  });

  console.log('\nwidget is on the public footer');

  await ok('the footer includes the chat widget and posts to the shared endpoint', () => {
    const footer = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), 'utf8');
    const widget = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'support-chat.ejs'), 'utf8');
    const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'support-chat.js'), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(footer.includes("include('support-chat')"));
    assert.ok(widget.includes('phsLauncher'));
    assert.ok(widget.includes('/js/support-plain.js'));
    assert.ok(client.includes("fetch('/api/support/chat'"));
    assert.ok(client.includes('textContent'));
    assert.ok(client.includes('supportPlain.fill'));
    assert.ok(!client.includes('innerHTML'));
    assert.ok(server.includes('supportFacts.toPlainText'));
    assert.ok(server.includes("app.post('/api/support/chat'"));
    assert.ok(server.includes("rateLimited('support_chat'"));
    assert.ok(server.includes('x-hub-signature-256'));
    assert.ok(server.includes("app.post('/admin/support/:id/resume'"));
  });

  await ok('the admin card escapes the transcript and offers resume', () => {
    const file = path.join(__dirname, '..', 'views', 'partials', 'admin', 'support-handoffs.ejs');
    const html = ejs.render(fs.readFileSync(file, 'utf8'), {
      supportHandoffs: [{
        id: 'web_abc123',
        label: 'Website',
        channel: 'web',
        handoff_reason: 'asked_for_human',
        handoff_at: '2026-10-13T19:00:00.000Z',
        messages: [
          { role: 'user', text: '<script>alert(1)</script>' },
          { role: 'assistant', text: 'Flagged.' }
        ]
      }]
    }, { filename: file });
    assert.ok(html.includes('Asked for a person'));
    assert.ok(html.includes('/admin/support/web_abc123/resume'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!html.includes('<script>alert'));
    const empty = ejs.render(fs.readFileSync(file, 'utf8'), { supportHandoffs: [] }, { filename: file });
    assert.ok(empty.includes('No chats waiting'));
  });

  console.log('\n' + passed + ' assertions passed\n');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
