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

  await ok('the month price is the checkout total, and the category price stays on the sheet', async () => {
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
    const blurb = await facts.fallbackReply('how much for new games', shopFacts(), () => []);
    assert.ok(blurb.text.includes('₱629'), blurb.text);
    assert.ok(blurb.text.includes('₱699'), blurb.text);
    assert.ok(blurb.text.includes('₱719'), blurb.text);
    assert.ok(blurb.text.includes('₱799'), blurb.text);
    assert.ok(blurb.text.includes('already taken off'), blurb.text);
    assert.strictEqual(facts.replyLanguage('how much for new games'), 'en');
    assert.ok(!blurb.text.includes('**'), blurb.text);
    const emoji = (blurb.text.match(/\p{Extended_Pictographic}/gu) || []).length;
    assert.ok(emoji >= 1 && emoji <= 3, 'emoji ' + emoji + ' in ' + blurb.text);
  });

  await ok('the scripted fallback matches English, Filipino, and Taglish', async () => {
    assert.strictEqual(facts.replyLanguage('What is the difference between the accounts?'), 'en');
    assert.strictEqual(facts.replyLanguage('Magkano ang rental?'), 'fil');
    assert.strictEqual(facts.replyLanguage('How much po ang presyo?'), 'mix');
    assert.strictEqual(facts.replyLanguage('Elden Ring'), 'en');

    const en = await facts.fallbackReply('how much for a week', shopFacts(), () => []);
    assert.ok(en.text.includes('Order here:'), en.text);
    assert.ok(en.text.includes('₱349'));
    assert.ok(!en.text.includes('Mag-order'));
    assert.ok(!/^\d+\.\s/m.test(en.text));

    const fil = await facts.fallbackReply('Magkano ang rental?', shopFacts(), () => []);
    assert.ok(fil.text.includes('Mag-order po dito:'), fil.text);
    assert.ok(fil.text.includes('Kasama na'), fil.text);
    assert.ok(fil.text.includes('₱629'), fil.text);
    assert.ok(!fil.text.includes('Order here:'), fil.text);
    const filEmoji = (fil.text.match(/\p{Extended_Pictographic}/gu) || []).length;
    assert.ok(filEmoji >= 1 && filEmoji <= 3, fil.text);

    const mix = await facts.fallbackReply('how much po ang presyo', shopFacts(), () => []);
    assert.strictEqual(facts.replyLanguage('how much po ang presyo'), 'mix');
    assert.ok(mix.text.includes('Order po dito:'), mix.text);
    assert.ok(mix.text.endsWith('Gusto mo po bang makausap ang admin? Reply ADMIN.'), mix.text);
    assert.ok(mix.text.includes('kasama na'), mix.text);
    assert.ok(mix.text.includes('₱699'));

    const filPay = await facts.fallbackReply('paano magbayad', shopFacts(), () => []);
    assert.ok(filPay.text.includes('GCash'), filPay.text);
    assert.ok(filPay.text.includes('Mag-order po dito:'), filPay.text);

    const filHuman = await facts.fallbackReply('kausap naman', shopFacts(), () => []);
    assert.strictEqual(filHuman.handoff, true);
    assert.ok(filHuman.text.includes('admin'), filHuman.text);
    assert.ok(filHuman.text.includes('Sige po'), filHuman.text);
    assert.ok(!/\bOo\b/.test(filHuman.text));
    assert.ok(!/m\.me/i.test(filHuman.text));
    assert.ok(!/Reply ADMIN/i.test(filHuman.text));

    const open = facts.publicGame(elden, { ntSlots: 2, trSlots: 0 }, {}, promo);
    const filGame = await facts.fallbackReply('meron ba Elden Ring', shopFacts(), () => [open]);
    assert.ok(filGame.text.includes('Yes po'), filGame.text);
    assert.ok(filGame.text.includes('Wala pong available slot'), filGame.text);
    assert.ok(!/\bOo\b/.test(filGame.text));
    assert.ok(filGame.text.includes('\n\n'));
    const enGame = await facts.fallbackReply('is Elden Ring available', shopFacts(), () => [open]);
    assert.ok(enGame.text.includes('2 slots available'), enGame.text);
    assert.ok(enGame.text.includes('No slots available'), enGame.text);
    assert.ok(!enGame.text.includes(' po'), enGame.text);
    assert.ok(!/late return/i.test(enGame.text), enGame.text);
    assert.ok(en.text.includes('Want to chat with an admin? Reply ADMIN.'), en.text);
    assert.ok(fil.text.includes('Gusto mo po bang makausap ang admin? Reply ADMIN.'), fil.text);
    assert.ok(!enGame.text.includes('m.me'));
  });

  await ok('bare amounts get a peso sign and plain text keeps it', async () => {
    const bare = 'New Games is 349 weekly. Trophy has a refundable 100 deposit. The 10% promo is already in. Open for 30 days.';
    const fixed = facts.ensurePeso(bare, shopFacts());
    assert.ok(fixed.includes('₱349'), fixed);
    assert.ok(fixed.includes('₱100'), fixed);
    assert.ok(fixed.includes('10%'), fixed);
    assert.ok(!/₱10(?!\d)/.test(fixed), fixed);
    assert.ok(fixed.includes('30 days'), fixed);
    assert.ok(!/₱30(?!\d)/.test(fixed), fixed);
    assert.strictEqual(facts.ensurePeso(fixed, shopFacts()), fixed);
    assert.strictEqual(
      facts.ensurePeso('PS5 is 349. Order PH-1042 has 2 open slots. Already ₱ 100.', shopFacts()),
      'PS5 is ₱349. Order PH-1042 has 2 open slots. Already ₱ 100.'
    );
    assert.strictEqual(facts.toPlainText('**₱349** a week and ₱100'), '₱349 a week and ₱100');
    const result = await assistant.respond({
      message: 'how much for new games',
      facts: shopFacts(),
      complete: async () => ({ content: bare })
    });
    assert.ok(result.reply.includes('₱349'), result.reply);
    assert.ok(result.reply.includes('₱100'), result.reply);
    assert.ok(!/₱10(?!\d)/.test(result.reply), result.reply);
    const stored = facts.toPlainText(result.reply);
    assert.ok(stored.includes('₱349'));
    assert.ok(stored.includes('₱100'));
  });

  await ok('a different category price is what gets quoted', async () => {
    const sheet = facts.pricingSheet(
      [{ name: 'Regular', nt_price_7d: 111, nt_price_30d: 222, tr_price_7d: 150, tr_price_30d: 300 }],
      { enabled: false, discounts: { 30: 10 }, deposit: 100 }
    );
    assert.strictEqual(sheet[0].nonTrophy.weeklyNow, 111);
    assert.strictEqual(sheet[0].nonTrophy.monthlyNow, 222);
    const blurb = await facts.fallbackReply('magkano', facts.faqBundle({
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
    assert.ok(result.reply.includes('reply here'));
    assert.ok(!/m\.me/i.test(result.reply));
    assert.ok(!/message Michael/i.test(result.reply));
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
      message: 'how much is Elden Ring',
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
    assert.ok(result.reply.startsWith('OpenAI reply'), result.reply);
    assert.ok(result.reply.includes('Want to chat with an admin? Reply ADMIN.'), result.reply);
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
    assert.ok(result.reply.startsWith(raw), result.reply);
    assert.ok(result.reply.includes('Want to chat with an admin? Reply ADMIN.'), result.reply);
    const saved = store.get('messenger', 'psid-md').messages.filter(m => m.role === 'assistant').pop();
    assert.ok(saved.text.startsWith(plain), saved.text);
    assert.ok(saved.text.includes('Reply ADMIN'));
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
    assert.ok(prompt.includes('Filipino'));
    assert.ok(prompt.includes('Taglish'));
    assert.ok(prompt.includes('1 to 3'));
    assert.ok(prompt.includes('No markdown'));
    assert.ok(prompt.includes('Yes po'));
    assert.ok(prompt.includes('Wala po'));
    assert.ok(prompt.includes('₱'));
    assert.ok(prompt.includes('Want to chat with an admin? Reply ADMIN.'));
    assert.ok(prompt.includes('Gusto mo po bang makausap ang admin? Reply ADMIN.'));
    assert.ok(prompt.includes('Coming Soon'));
    assert.ok(prompt.includes('waitlist is free'));
    assert.ok(prompt.includes('lookup_game'));
    assert.ok(!/https?:\/\/m\.me/i.test(prompt));
    assert.ok(prompt.includes('do not send an m.me link'));
  });

  await ok('ADMIN hands off in this chat, and reserving without paying is explained', async () => {
    const admin = await assistant.respond({
      message: 'ADMIN',
      facts: shopFacts(),
      complete: async () => { throw new Error('should not run'); }
    });
    assert.strictEqual(admin.handoff, true);
    assert.strictEqual(admin.reason, 'asked_for_human');
    assert.ok(admin.reply.includes('reply here'), admin.reply);
    assert.ok(!/m\.me/i.test(admin.reply));
    assert.ok(!/message Michael/i.test(admin.reply));
    assert.ok(!/Reply ADMIN/i.test(admin.reply));
    const asked = facts.withAdminCta('Prices are on the site.\n\nWant to chat with an admin? Reply ADMIN.', 'en');
    assert.strictEqual(asked, 'Prices are on the site.\n\nWant to chat with an admin? Reply ADMIN.');
    const oldLine = facts.withAdminCta('Prices are on the site.\nReply ADMIN to talk to a person.', 'en');
    assert.strictEqual(oldLine, 'Prices are on the site.\n\nWant to chat with an admin? Reply ADMIN.');

    const reserve = await facts.fallbackReply('can I reserve without paying', shopFacts(), () => []);
    assert.strictEqual(reserve.handoff, false);
    assert.ok(/free waitlist/i.test(reserve.text), reserve.text);
    assert.ok(/Coming Soon/i.test(reserve.text), reserve.text);
    assert.ok(reserve.text.includes('₱100'), reserve.text);
    assert.ok(!/don'?t know|not sure|di ko po sure/i.test(reserve.text), reserve.text);
    assert.ok(reserve.text.includes('Reply ADMIN'), reserve.text);
    assert.ok(!/m\.me/i.test(reserve.text));

    const trial = await facts.fallbackReply('can I try before I pay', shopFacts(), () => []);
    assert.ok(trial.text.includes('3-hour'), trial.text);
    const pw = await facts.fallbackReply('do I need to give my PSN password', shopFacts(), () => []);
    assert.ok(/never ask/i.test(pw.text), pw.text);
    assert.ok(!/m\.me/i.test(pw.text));
  });

  await ok('a game answer waits for the live lookup and does not send the guess', async () => {
    const seen = [];
    const card = facts.publicGame(elden, { ntSlots: 2, trSlots: 0 }, { nonTrophy: 0, trophy: 1 }, promo);
    const result = await assistant.respond({
      message: 'is Elden Ring available',
      facts: shopFacts(),
      invokeTool: async (name, args) => {
        assert.strictEqual(name, 'lookup_game');
        seen.push(args.query);
        return { games: [card] };
      },
      complete: async () => {
        if (!seen.length) return { content: 'Sure, it has 9 slots open.' };
        return { content: 'Elden Ring has 2 Non-Trophy slots open. Trophy is full.' };
      }
    });
    assert.ok(!result.reply.includes('9 slots'), result.reply);
    assert.ok(result.reply.includes('Hello! Yes, we have slots available.'), result.reply);
    assert.ok(result.reply.includes('- Non-Trophy: 2 slots available'), result.reply);
    assert.ok(result.reply.includes('- Trophy Account: No slots available'), result.reply);
    assert.ok(!/on the waitlist/i.test(result.reply), result.reply);
    assert.ok(!/late return/i.test(result.reply), result.reply);
    assert.ok(result.reply.includes('Reply ADMIN'), result.reply);
    assert.strictEqual(result.source, 'template');
    assert.strictEqual(result.handoff, false);
  });

  await ok('a failed lookup does not invent slots', async () => {
    const result = await assistant.respond({
      message: 'is Elden Ring available',
      facts: shopFacts(),
      invokeTool: async () => { throw new Error('mongo down'); },
      complete: async () => ({ content: 'Yes, 4 slots are open.' })
    });
    assert.ok(!/4 slots/.test(result.reply), result.reply);
    assert.ok(result.reply.includes('guess'), result.reply);
    assert.ok(result.reply.includes('Reply ADMIN'), result.reply);
    assert.strictEqual(result.handoff, false);
  });

  await ok('Coming Soon reserves at list price, not the monthly promo', async () => {
    const soon = facts.publicGame(Object.assign({}, elden, {
      comingSoon: true, id: 5, release_date: '2026-11-01'
    }), { ntSlots: 2, trSlots: 0 }, null, promo);
    assert.strictEqual(soon.comingSoon, true);
    assert.strictEqual(soon.prices.nonTrophyMonthly, 699);
    assert.strictEqual(soon.slots.ps4Primary, undefined);
    assert.strictEqual(soon.waitlistKnown, false);
    const blurb = await facts.fallbackReply('reserve Elden Ring', shopFacts(), () => [soon]);
    assert.ok(blurb.text.includes('₱699'), blurb.text);
    assert.ok(!blurb.text.includes('₱629'), blurb.text);
    assert.ok(/Coming Soon/i.test(blurb.text), blurb.text);
    assert.ok(blurb.text.includes('Reply ADMIN'), blurb.text);
    assert.ok(!/m\.me/i.test(blurb.text));
    const hits = facts.searchCatalog([elden], [{ id: 5, title: 'Elden Ring', comingSoon: false }], 'Elden Ring');
    assert.strictEqual(hits.length, 2);
    assert.strictEqual(hits[1].comingSoon, true);
  });

  await ok('a slot reply is the fixed layout, line for line', async () => {
    const wolverine = {
      id: 9, title: "Marvel's Wolverine", platform: 'PS5',
      nt_price_7d: 349, nt_price_30d: 699, tr_price_7d: 399, tr_price_30d: 799
    };
    const shop = shopFacts();
    shop.siteUrl = 'https://playstation-hub.com';
    const open = facts.publicGame(wolverine, { ntSlots: 1, trSlots: 1 }, {}, promo);
    const both = await facts.fallbackReply("May slot pa ba ang Marvel's Wolverine?", shop, () => [open]);
    assert.strictEqual(both.text, [
      'Hello po! Yes po, meron pa po. 🎮',
      '',
      "Marvel's Wolverine (PS5)",
      '',
      '- Non-Trophy: 1 slot available',
      '  ₱349/week | ₱629/month',
      '',
      '- Trophy Account: 1 slot available',
      '  ₱399/week | ₱719/month',
      '  + ₱100 security deposit (refundable upon returning the account)',
      '',
      'Mag-order po dito:',
      'https://playstation-hub.com/game/marvel-s-wolverine',
      '',
      'Gusto mo po bang makausap ang admin? Reply ADMIN.'
    ].join('\n'));
    assert.strictEqual(facts.toPlainText(both.text), both.text);
    assert.ok(!/late/i.test(both.text));
    assert.ok(!/naka-waitlist/i.test(both.text));
    assert.ok(!both.text.includes('₱699'));

    const none = facts.publicGame(wolverine, { ntSlots: 0, trSlots: 0 }, {}, promo);
    const empty = await facts.fallbackReply("May slot pa ba ang Marvel's Wolverine?", shop, () => [none]);
    assert.strictEqual(empty.text, [
      'Hello po! Wala na po munang available slot. 🎮',
      '',
      "Marvel's Wolverine (PS5)",
      '',
      'Libre pong waitlist. Optional na ₱100 priority fee para mauna, at ibabawas iyan sa rent pag may slot.',
      '',
      'Mag-order po dito:',
      'https://playstation-hub.com/game/marvel-s-wolverine',
      '',
      'Gusto mo po bang makausap ang admin? Reply ADMIN.'
    ].join('\n'));

    const ps4 = facts.publicGame(hogwarts, { ntSlots: 0, trSlots: 1, ps4Slots: 2 }, {}, promo);
    const mixed = await facts.fallbackReply('is Hogwarts Legacy available', shopFacts(), () => [ps4]);
    assert.strictEqual(mixed.text, [
      'Hello! Yes, we have slots available. 🎮',
      '',
      'Hogwarts Legacy (PS4/PS5)',
      '',
      '- Non-Trophy: No slots available',
      '  Free waitlist, or an optional ₱100 priority fee.',
      '',
      '- Trophy Account: 1 slot available',
      '  ₱299/week | ₱539/month',
      '  + ₱100 security deposit (refundable upon returning the account)',
      '',
      '- PS4 Primary: 2 slots available',
      '  ₱249/week | ₱449/month',
      '  + ₱100 security deposit (refundable upon returning the account)',
      '',
      'Order here:',
      'https://www.playstation-hub.com/game/hogwarts-legacy',
      '',
      'Want to chat with an admin? Reply ADMIN.'
    ].join('\n'));
    assert.ok(!mixed.text.includes('PS4 Primary: No'));
    assert.ok(!/late return/i.test(mixed.text));

    const viaModel = await assistant.respond({
      message: "May slot pa ba ang Marvel's Wolverine?",
      facts: shop,
      invokeTool: async () => ({ games: [open] }),
      complete: async () => ({ content: 'Marvel\'s Wolverine: Non-Trophy Yes po, may 1 slot. Trophy Yes po, may 1 slot. 4 po ang naka-waitlist.' })
    });
    assert.strictEqual(viaModel.reply, both.text);
    assert.strictEqual(viaModel.source, 'template');
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

  await ok('a refused take keeps the Messenger chat visible and a second failure does not re-alert', () => {
    const store = threads.createStore(threads.memory());
    store.handoff('messenger', 'psid-7', 'asked_for_human');
    const id = store.listHandoffs()[0].id;
    const kept = store.setControlError(id, '(#10) Only Main Receiver can take thread control');
    assert.strictEqual(kept.handed_off, true);
    assert.strictEqual(kept.handoff_reason, 'asked_for_human');
    assert.strictEqual(kept.control_error, '(#10) Only Main Receiver can take thread control');
    assert.strictEqual(kept.external_id, undefined);
    assert.strictEqual(store.lookup(id).external_id, 'psid-7');
    assert.ok(!JSON.stringify(store.listHandoffs()).includes('psid-7'));

    store.resume(id);
    assert.strictEqual(store.isPaused('messenger', 'psid-7'), false);
    assert.strictEqual(store.lookup(id).control_error, null);

    const again = store.noteControlFailure('messenger', 'psid-7', 'Messenger returned HTTP 400.');
    assert.strictEqual(again.changed, true);
    assert.strictEqual(store.isPaused('messenger', 'psid-7'), true);
    assert.strictEqual(store.listHandoffs()[0].handoff_reason, 'thread_control');
    assert.strictEqual(store.listHandoffs()[0].control_error, 'Messenger returned HTTP 400.');
    const second = store.noteControlFailure('messenger', 'psid-7', 'still bad');
    assert.strictEqual(second.changed, false);
    assert.strictEqual(store.listHandoffs().length, 1);
    assert.strictEqual(store.listHandoffs()[0].control_error, 'still bad');
    const cleared = store.resumeExternal('messenger', 'psid-7');
    assert.strictEqual(cleared.cleared, true);
    assert.strictEqual(store.isPaused('messenger', 'psid-7'), false);
    assert.strictEqual(store.listHandoffs().length, 0);
    assert.strictEqual(store.resumeExternal('messenger', 'missing'), null);

    const fresh = store.noteControlFailure('messenger', 'psid-new', 'x'.repeat(400));
    assert.strictEqual(fresh.changed, true);
    assert.strictEqual(fresh.thread.control_error.length, 180);
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

  await ok('standby messages and handover events are not dropped', () => {
    const events = messenger.inboundEvents({
      object: 'page',
      entry: [{
        messaging: [
          { sender: { id: '9' }, pass_thread_control: { new_owner_app_id: '111', metadata: 'back' } }
        ],
        standby: [
          { sender: { id: '2' }, message: { text: "May slot pa ba ang Marvel's Wolverine?" } },
          { sender: { id: '8' }, message: { is_echo: true, text: 'page reply' } },
          { sender: { id: '7' }, take_thread_control: { previous_owner_app_id: '111', metadata: 'inbox' } }
        ]
      }]
    });
    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[0].control, 'pass_thread_control');
    assert.strictEqual(events[0].standby, false);
    assert.strictEqual(events[0].reply, false);
    assert.strictEqual(events[0].newOwnerAppId, '111');
    assert.strictEqual(events[0].metadata, 'back');
    assert.strictEqual(events[1].standby, true);
    assert.strictEqual(events[1].reply, true);
    assert.strictEqual(events[1].text, "May slot pa ba ang Marvel's Wolverine?");
    assert.strictEqual(events[1].control, null);
    assert.strictEqual(events[2].control, 'take_thread_control');
    assert.strictEqual(events[2].standby, true);
    assert.strictEqual(events[2].previousOwnerAppId, '111');

    assert.strictEqual(messenger.decideInbound(events[1], false, true), 'take_then_answer');
    assert.strictEqual(messenger.decideInbound(events[1], true, true), 'record_only');
    assert.strictEqual(messenger.decideInbound(events[1], false, false), 'answer_standby');
    assert.strictEqual(messenger.decideInbound(events[1], true, false), 'answer_standby');
    assert.strictEqual(messenger.decideInbound({ reply: true, standby: false }, true), 'answer');
    assert.strictEqual(messenger.decideInbound(events[0], false), 'note_control');
    assert.strictEqual(messenger.decideInbound({ reply: false, referral: 'PH-1' }, false), 'ignore');
  });

  await ok('a failed take_thread_control is the Graph error, and a website resume skips it', async () => {
    messenger.resetUnsupportedControl();
    let asked = null;
    const okTake = await messenger.resumeMessenger({
      channel: 'messenger',
      handover: true,
      externalId: 'psid-1',
      take: async (psid) => {
        asked = psid;
        return { ok: true, status: 200, body: '{"success":true}' };
      }
    });
    assert.strictEqual(asked, 'psid-1');
    assert.strictEqual(okTake.ok, true);
    assert.strictEqual(okTake.clear, true);
    assert.strictEqual(okTake.send, true);

    const body = JSON.stringify({
      error: {
        message: '(#10) Message failed to send because another app is controlling this thread now. access_token=SECRET',
        code: 10,
        error_subcode: 2018300
      }
    });
    const failed = await messenger.resumeMessenger({
      channel: 'messenger',
      handover: true,
      externalId: 'psid-1',
      take: async () => ({ ok: false, status: 400, body })
    });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.clear, false);
    assert.ok(failed.error.includes('another app is controlling this thread'), failed.error);
    assert.ok(failed.error.includes('10/2018300'), failed.error);
    assert.ok(!failed.error.includes('SECRET'), failed.error);
    assert.strictEqual(messenger.handoverUnsupported(failed), false);
    assert.strictEqual(messenger.graphErrorSummary({ reason: 'no_token' }), 'Page token is missing.');
    assert.strictEqual(messenger.graphErrorSummary({ status: 500, body: 'nope' }), 'Messenger returned HTTP 500.');

    let called = false;
    const web = await messenger.resumeMessenger({
      channel: 'web',
      externalId: 'sess',
      take: async () => { called = true; return { ok: false }; }
    });
    assert.strictEqual(web.ok, true);
    assert.strictEqual(called, false);
  });

  await ok('handover is off unless MESSENGER_HANDOVER=on, and error 27 still resumes', async () => {
    assert.strictEqual(messenger.handoverEnabled({}), false);
    assert.strictEqual(messenger.handoverEnabled({ MESSENGER_HANDOVER: 'off' }), false);
    assert.strictEqual(messenger.handoverEnabled({ MESSENGER_HANDOVER: 'on' }), true);
    assert.strictEqual(messenger.handoverEnabled({ MESSENGER_HANDOVER: ' TRUE ' }), true);
    assert.strictEqual(messenger.config({}).handover, false);
    assert.strictEqual(messenger.config({ MESSENGER_HANDOVER: 'on' }).handover, true);

    const production = {
      error: {
        message: '(#27) Take thread control is not supported when Conversation Routing is not enabled.',
        code: 27,
        error_subcode: 2018464
      }
    };
    assert.strictEqual(messenger.handoverUnsupported({ ok: false, status: 400, body: JSON.stringify(production) }), true);
    messenger.resetUnsupportedControl();
    let released = 0;
    let takes = 0;
    const soft = await messenger.resumeMessenger({
      channel: 'messenger',
      handover: true,
      externalId: 'psid-27',
      take: async () => { takes++; return { ok: false, status: 400, body: JSON.stringify(production) }; },
      release: async (psid) => { released++; assert.strictEqual(psid, 'psid-27'); return { ok: false, status: 400, body: '{"error":{"message":"not owner","code":10}}' }; }
    });
    assert.strictEqual(soft.ok, true);
    assert.strictEqual(soft.clear, true);
    assert.strictEqual(soft.send, true);
    assert.strictEqual(soft.unsupported, true);
    assert.strictEqual(takes, 1);
    assert.strictEqual(released, 1);
    assert.ok(soft.error.includes('Conversation Routing is not enabled'), soft.error);
    assert.ok(soft.error.includes('27/2018464'), soft.error);

    messenger.resetUnsupportedControl();
    takes = 0;
    released = 0;
    const off = await messenger.resumeMessenger({
      channel: 'messenger',
      handover: false,
      externalId: 'psid-off',
      take: async () => { takes++; return { ok: false, status: 400, body: JSON.stringify(production) }; },
      release: async () => { released++; return { ok: true, status: 200, body: '{"success":true}' }; }
    });
    assert.strictEqual(off.ok, true);
    assert.strictEqual(off.clear, true);
    assert.strictEqual(off.send, true);
    assert.strictEqual(takes, 1);
    assert.strictEqual(released, 1);

    const again = await messenger.recoverStuckControl({
      psid: 'psid-off',
      take: async () => { takes++; return { ok: false }; },
      release: async () => { released++; return { ok: true }; },
      forceRelease: true
    });
    assert.strictEqual(again.skipped, true);
    assert.strictEqual(takes, 1);
    assert.strictEqual(released, 1);

    messenger.resetUnsupportedControl();
    let code10Release = 0;
    const hard = await messenger.recoverStuckControl({
      psid: 'psid-10',
      take: async () => ({ ok: false, status: 400, body: JSON.stringify({ error: { message: 'another app', code: 10 } }) }),
      release: async () => { code10Release++; return { ok: true }; }
    });
    assert.strictEqual(hard.unsupported, false);
    assert.strictEqual(hard.released, false);
    assert.strictEqual(code10Release, 0);
    messenger.resetUnsupportedControl();
  });

  await ok('pass and take thread control target the inbox app and the PSID', () => {
    const pass = messenger.passThreadControl('psid-1', '263902037430900');
    assert.strictEqual(pass.recipient.id, 'psid-1');
    assert.strictEqual(pass.target_app_id, '263902037430900');
    const take = messenger.takeThreadControl('psid-1');
    assert.strictEqual(take.recipient.id, 'psid-1');
    const release = messenger.releaseThreadControl('psid-1');
    assert.strictEqual(release.recipient.id, 'psid-1');
    assert.ok(release.metadata);
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
    assert.ok(server.includes('SUPPORT_CHAT_LIMIT'));
    assert.strictEqual(assistant.SUPPORT_CHAT_LIMIT, 40);
    assert.strictEqual(assistant.SUPPORT_CHAT_WINDOW_MS, 10 * 60 * 1000);
    assert.ok(server.includes('x-hub-signature-256'));
    assert.ok(server.includes("app.post('/admin/support/:id/resume'"));
    assert.ok(server.includes('resumeMessenger'));
    assert.ok(server.includes('take_then_answer'));
    assert.ok(server.includes('support_control_failed'));
    assert.ok(server.includes('[messenger take_thread_control] failed'));
    assert.ok(server.includes('answer_standby'));
    assert.ok(server.includes('release_thread_control'));
    assert.ok(server.includes('handoverEnabled'));
    assert.ok(server.includes('[messenger send] failed'));
    assert.ok(server.includes('handover off, paused without pass_thread_control'));
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
        control_error: '<b>bad</b>',
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
    assert.ok(html.includes('Messenger did not hand this chat back'));
    assert.ok(html.includes('&lt;b&gt;bad&lt;/b&gt;'));
    assert.ok(!html.includes('<b>bad</b>'));
    const empty = ejs.render(fs.readFileSync(file, 'utf8'), { supportHandoffs: [] }, { filename: file });
    assert.ok(empty.includes('No chats waiting'));
  });

  await ok('expired and disabled promos never reach the assistant', async () => {
    const promos = require('../lib/promos');
    const stored = [
      { id: 'p1', title: 'Elden week', text: '₱50 off Elden Ring this week.', terms: 'One rental per customer.', starts_on: '2026-10-01', ends_on: '2026-10-20', enabled: true, game_id: 7, badge: 'Promo', featured: true },
      { id: 'old', title: 'Ghost sale', text: 'This ended.', terms: 'Expired terms.', starts_on: '2026-01-01', ends_on: '2026-01-02', enabled: true, game_id: null, badge: '', featured: false },
      { id: 'off', title: 'Secret off', text: 'Disabled offer.', terms: 'Off terms.', starts_on: '', ends_on: '', enabled: false, game_id: null, badge: '', featured: false }
    ];
    const live = promos.liveOffers({
      stored,
      loyaltySettings: { punch_enabled: false, rebook_enabled: true, rebook_amount: 50, rebook_within_days: 7 },
      games: [{ id: 7, title: 'Elden Ring' }],
      today: '2026-10-14'
    });
    const bundle = facts.faqBundle({
      categories, promo,
      offers: promos.publicFacts(live),
      loyaltyNote: "You're 2 rentals away from a free 7-day rental"
    });
    const dumped = JSON.stringify(assistant.systemPrompt(bundle));
    assert.ok(dumped.includes('Elden week'));
    assert.ok(dumped.includes('One rental per customer'));
    assert.ok(dumped.includes('2026-10-20'));
    assert.ok(dumped.includes('₱50 rebook') || dumped.includes('rebook'));
    assert.ok(!dumped.includes('Ghost sale'));
    assert.ok(!dumped.includes('Expired terms'));
    assert.ok(!dumped.includes('Secret off'));
    assert.ok(!dumped.includes('Off terms'));
    assert.ok(dumped.includes('no promo'));

    const asked = await facts.fallbackReply('may promo ba?', bundle, () => []);
    assert.ok(asked.text.includes('Elden week'), asked.text);
    assert.ok(asked.text.includes('One rental per customer'), asked.text);
    assert.ok(asked.text.includes('Oct 20, 2026'), asked.text);
    assert.ok(asked.text.includes("You're 2 rentals away"), asked.text);
    assert.ok(!asked.text.includes('Ghost'));
    assert.ok(!asked.text.includes('Secret'));

    const quietFacts = facts.faqBundle({ categories, promo, offers: [], loyaltyNote: '' });
    const quiet = await facts.fallbackReply('may promo ba?', quietFacts, () => []);
    assert.ok(quiet.text.includes('Wala pong promo'), quiet.text);
    assert.ok(!quiet.text.includes('Elden'));
    assert.ok(!quiet.text.includes('Ghost'));

    const price = await facts.fallbackReply('how much for a week', bundle, () => []);
    assert.ok(price.text.includes('rebook'), price.text);
    assert.ok(price.text.includes("You're 2 rentals away"), price.text);
    assert.ok(!price.text.includes('Elden week'), price.text);
    assert.ok(!price.text.includes('Ghost'));

    const open = facts.publicGame(elden, { ntSlots: 2, trSlots: 1, ps4Slots: 0 }, {}, promo);
    const other = facts.publicGame(hogwarts, { ntSlots: 1, trSlots: 1, ps4Slots: 1 }, {}, promo);
    const onGame = await facts.fallbackReply('is Elden Ring available', bundle, () => [open]);
    assert.ok(onGame.text.includes('Elden week'), onGame.text);
    assert.ok(onGame.text.includes("You're 2 rentals away"), onGame.text);
    const elsewhere = await facts.fallbackReply('is Hogwarts Legacy available', bundle, () => [other]);
    assert.ok(!elsewhere.text.includes('Elden week'), elsewhere.text);
    assert.ok(elsewhere.text.includes('rebook') || elsewhere.text.includes('₱50'), elsewhere.text);
  });

  console.log('\n' + passed + ' assertions passed\n');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
