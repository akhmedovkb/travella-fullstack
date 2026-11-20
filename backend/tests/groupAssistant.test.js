const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIntent, createGroupAssistantModel, redactQuestion } = require('../ai/groupAssistantModel');
const { buildSearch, searchGroupOffers } = require('../ai/groupAssistantSearch');
const { createGroupAssistantStore } = require('../ai/groupAssistantStore');
const { createGroupAssistantFlow, addressed, formatOffers } = require('../telegram/handlers/groupAssistantFlow');
const filters = { destination: ['Дубай', 'Dubai', 'Dubay'], origin: ['Ташкент', 'Tashkent'], start: '2026-12-01', end: '2026-12-31', budget: 1000, currency: 'USD', priceBasis: 'person', category: 'refused_tour', companion: true, gender: 'female' };
const intent = (patch = {}) => normalizeIntent({ kind: 'search', language: 'ru', filters, ...patch });
function context(text, { actor = 7, chat = -100, type = 'supergroup', topic = 1, data, messageId = 50, admin = false } = {}) {
  const replies = [], answers = [], edits = [];
  return { from: { id: actor }, chat: { id: chat, type }, botInfo: { id: 99, username: 'TravellaBot' }, session: { state: 'svc_create_price', serviceDraft: { title: 'PRIVATE DRAFT' } },
    message: data ? undefined : { text, message_id: 10, message_thread_id: topic },
    callbackQuery: data ? { data, message: { message_id: messageId, message_thread_id: topic } } : undefined,
    replies, answers, edits,
    telegram: { getChatMember: async () => ({ status: admin ? 'administrator' : 'member' }) },
    answerCbQuery: async text => answers.push(text), editMessageReplyMarkup: async value => edits.push(value),
    reply: async (text, options) => { replies.push({ text, options }); return { message_id: messageId }; },
  };
}
function fixture({ output = intent(), enabled = true, ready = true, offers = [] } = {}) {
  const calls = [], active = new Map([[-100, enabled]]);
  const flow = createGroupAssistantFlow({ pool: {}, model: { ready: () => ready, interpret: async (...args) => { calls.push(['model', ...args]); return output; } },
    store: { enabled: async id => active.get(id), activate: async (id, _actor, value) => active.set(id, value), reserve: async () => { calls.push(['reserve']); return true; } },
    search: async f => { calls.push(['search', f]); return offers; },
  });
  return { flow, calls, active };
}
test('addressing accepts own mentions, explicit commands and replies, but not other bots', () => {
  assert.ok(addressed(context('@TravellaBot таш дубай')));
  assert.ok(addressed(context('/ask@TravellaBot найди тур')));
  assert.equal(addressed(context('/ask@OtherBot найди тур')), false);
  assert.equal(addressed(context('Обсуждаем туры с коллегой')), false);
  const c = context('На одного'); c.message.reply_to_message = { from: { id: 99 } };
  assert.ok(addressed(c));
});
test('all group traffic stops before personal sessions; private chat passes unchanged', async () => {
  const f = fixture();
  const c = context('Привет коллеги');
  const before = JSON.stringify(c.session);
  await f.flow(c, () => assert.fail('must not enter private wizard'));
  assert.equal(JSON.stringify(c.session), before);
  assert.equal(f.calls.length, 0);
  const privateCtx = context('/ask test', { type: 'private', chat: 7 });
  let passed = false;
  await f.flow(privateCtx, () => { passed = true; });
  assert.ok(passed);
  const proof = context(null, { data: 'proof:view:1211' });
  await f.flow(proof, () => assert.fail());
  assert.match(proof.answers[0], /личном/);
});
test('group activation requires a real group administrator and a configured model', async () => {
  const f = fixture({ enabled: false });
  const member = context('/travella_on@TravellaBot');
  await f.flow(member, () => assert.fail());
  assert.equal(f.active.get(-100), false);
  const admin = context('/travella_on@TravellaBot', { admin: true });
  await f.flow(admin, () => assert.fail());
  assert.ok(f.active.get(-100));
  assert.match(admin.replies[0].text, /Текст обращения обрабатывается ИИ/);
  await f.flow(context('/travella_off@TravellaBot', { admin: true }), () => assert.fail());
  assert.equal(f.active.get(-100), false);
  const missing = fixture({ enabled: false, ready: false });
  const c = context('/travella_on@TravellaBot', { admin: true });
  await missing.flow(c, () => assert.fail());
  assert.equal(missing.active.get(-100), false);
  assert.match(c.replies[0].text, /не подключён/);
});
test('search requires filter confirmation, isolates user/topic and prevents replay', async () => {
  const f = fixture();
  const c = context('@TravellaBot таш дубай декабр до 1000 дол за человека');
  await f.flow(c, () => assert.fail());
  assert.equal(f.calls.filter(c => c[0] === 'search').length, 0);
  assert.match(c.replies[0].text, /Правильно понял/);
  const data = c.replies[0].options.reply_markup.inline_keyboard[0][0].callback_data;
  const foreign = context(null, { data, actor: 8 });
  await f.flow(foreign, () => assert.fail());
  assert.match(foreign.answers[0], /автору/);
  await f.flow(context(null, { data, topic: 2 }), () => assert.fail());
  assert.equal(f.calls.filter(c => c[0] === 'search').length, 0);
  await f.flow(context(null, { data }), () => assert.fail());
  assert.equal(f.calls.filter(c => c[0] === 'search').length, 1);
  await f.flow(context(null, { data }), () => assert.fail());
  assert.equal(f.calls.filter(c => c[0] === 'search').length, 1);
  assert.equal(c.replies[0].options.message_thread_id, 1);
});
test('budget ambiguity is clarified, with context confined to the same user and group', async () => {
  const f = fixture({ output: intent({ filters: { ...filters, priceBasis: null } }) });
  const c = context('/ask@TravellaBot дубай до 1000 долларов');
  await f.flow(c, () => assert.fail());
  assert.match(c.replies[0].text, /за человека или за весь/);
  assert.equal(f.calls.filter(c => c[0] === 'search').length, 0);
  const follow = context('за человека'); follow.message.reply_to_message = { from: { id: 99 } };
  await f.flow(follow, () => assert.fail());
  assert.equal(f.calls.filter(c => c[0] === 'model').at(-1)[2].budget, 1000);
  await f.flow(context('@TravellaBot другой запрос', { actor: 8 }), () => assert.fail());
  assert.equal(f.calls.filter(c => c[0] === 'model').at(-1)[2], null);
});
test('platform help uses approved instructions instead of invented model prose', async () => {
  const f = fixture({ output: intent({ kind: 'help', helpTopic: 'companion', clarification: 'Invented price and private proof' }) });
  const c = context('@TravellaBot как папутчика добавить');
  await f.flow(c, () => assert.fail());
  assert.match(c.replies[0].text, /перед ценой/);
  assert.doesNotMatch(c.replies[0].text, /Invented|PRIVATE/);
});
test('unavailable model and request limits do not fall back to fake AI or search', async () => {
  const missing = fixture({ ready: false });
  const c = context('/ask@TravellaBot турция');
  await missing.flow(c, () => assert.fail());
  assert.equal(missing.calls.length, 0);
  assert.match(c.replies[0].text, /недоступно/);
  const f = fixture();
  for (let i = 0; i < 7; i++) await f.flow(context('@TravellaBot турция'), () => assert.fail());
  assert.equal(f.calls.filter(c => c[0] === 'model').length, 6);
});
test('model requests use strict bounded output, no storage, redacted contacts and no chat identity', async () => {
  let request;
  const env = { OPENAI_API_KEY: 'test-only-key' };
  const ai = createGroupAssistantModel({ env, fetchImpl: async (url, options) => { request = { url, ...options, body: JSON.parse(options.body) }; return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(intent()) } }] }) }; } });
  const result = await ai.interpret('таш дубай до 1000 USD +998 90 123 45 67 test@example.com');
  assert.equal(result.filters.budget, 1000);
  assert.equal(request.body.store, false);
  assert.equal(request.body.response_format.json_schema.strict, true);
  assert.equal(request.body.max_completion_tokens, 900);
  const question = request.body.messages[1].content;
  assert.doesNotMatch(question, /123 45 67|test@example.com|chat_id|user_id/);
  assert.match(request.url, /^https:\/\/api.openai.com\//);
  assert.match(redactQuestion('https://example.com/file'), /ссылка/);
});
test('model refusals, HTTP failures, invalid currency and impossible dates cannot drive searches', async () => {
  for (const patch of [{ start: '2026-02-30' }, { end: '2026-11-01' }, { budget: -1 }, { category: 'private_documents' }, { currency: 'RUB' }]) assert.throws(() => intent({ filters: { ...filters, ...patch } }));
  for (const response of [{ ok: false, status: 429 }, { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { refusal: 'no' } }] }) }]) {
    const ai = createGroupAssistantModel({ env: { OPENAI_API_KEY: 'test' }, fetchImpl: async () => response });
    await assert.rejects(() => ai.interpret('test'));
  }
});
test('catalog query enforces publication, moderation, expiry, gross price and bound filters before limit', () => {
  const { sql, args } = buildSearch(filters);
  assert.match(sql, /deleted_at IS NULL/);
  assert.match(sql, /moderation_status/);
  assert.match(sql, /expiration_at>NOW/);
  assert.match(sql, /companion.*enabled/);
  assert.ok(sql.indexOf('public_price') < sql.indexOf('LIMIT 30'));
  assert.doesNotMatch(sql, /s\.\*|netPrice|proofImages|telegram_chat_id|provider_phone|p\.social/);
  assert.ok(args.includes(1000));
  const attack = buildSearch({ ...filters, destination: ["Dubai%' OR TRUE --"] });
  assert.ok(!attack.sql.includes('OR TRUE'));
  assert.ok(attack.args.flat().some(x => typeof x === 'string' && x.includes('\\%')));
  assert.throws(() => buildSearch({ ...filters, priceBasis: null }), /CLARIFICATION/);
});
test('public results omit private properties even if a mocked DB returns them', async () => {
  const offers = await searchGroupOffers({ query: async () => ({ rows: [{ id: 42, title: 'TEST', category: 'refused_tour', public_price: '650', currency: 'USD', price_basis: 'person', details: { startDate: '2099-12-01', endDate: '2099-12-10', proofImages: ['SECRET_PROOF'] }, provider_phone: 'SECRET_PHONE', netPrice: 600 }] }) }, filters);
  assert.equal(offers[0].price, 650);
  assert.doesNotMatch(JSON.stringify(offers), /SECRET|netPrice|proofImages|provider_phone/);
  const message = formatOffers(offers, 'ru');
  assert.match(message, /650 USD/);
  assert.match(message, /за человека/);
  assert.match(message, /marketplace\?opened=42/);
});
test('daily quota rollback covers both global and group counters and releases the connection', async () => {
  for (const blocked of ['global', 'group', null]) {
    const calls = [];
    const db = { release() { calls.push('release'); }, async query(sql) {
      calls.push(sql);
      if (sql.startsWith('INSERT INTO telegram_group_assistant_usage')) return { rowCount: blocked === 'global' ? 0 : 1 };
      if (sql.startsWith('UPDATE telegram_group_assistant_chats')) return { rowCount: blocked === 'group' ? 0 : 1 };
      return { rows: [] };
    } };
    const store = createGroupAssistantStore({ query: db.query, connect: async () => db });
    assert.equal(await store.reserve(-100), blocked === null);
    assert.ok(calls.includes(blocked ? 'ROLLBACK' : 'COMMIT'));
    assert.equal(calls.at(-1), 'release');
  }
});
