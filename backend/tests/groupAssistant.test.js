const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIntent, createGroupAssistantModel, redactQuestion } = require('../ai/groupAssistantModel');
const { buildSearch, searchGroupOffers } = require('../ai/groupAssistantSearch');
const { createGroupAssistantStore } = require('../ai/groupAssistantStore');
const { createGroupAssistantFlow, addressed, formatOffers, offerButtons } = require('../telegram/handlers/groupAssistantFlow');
const filters = { destination: ['Дубай', 'Dubai', 'Dubay'], origin: ['Ташкент', 'Tashkent'], start: '2026-12-01', end: '2026-12-31', budget: 1000, currency: 'USD', priceBasis: 'person', category: 'refused_tour', companion: true, gender: 'female' };
const intent = (patch = {}) => normalizeIntent({ kind: 'search', language: 'ru', filters, ...patch });
function context(text, { actor = 7, chat = -100, type = 'supergroup', topic = 1, data, messageId = 50, admin = false } = {}) {
  const replies = [], answers = [], edits = [];
  return { from: { id: actor }, chat: { id: chat, type }, botInfo: { id: 99, username: 'TravellaBot' }, session: { state: 'svc_create_price', serviceDraft: { title: 'PRIVATE DRAFT' } },
    message: data ? undefined : { text, message_id: 10, message_thread_id: topic, is_topic_message: true },
    callbackQuery: data ? { data, message: { message_id: messageId, message_thread_id: topic, is_topic_message: true } } : undefined,
    replies, answers, edits,
    telegram: { getChatMember: async () => ({ status: admin ? 'administrator' : 'member' }) },
    answerCbQuery: async text => answers.push(text), editMessageReplyMarkup: async value => edits.push(value),
    reply: async (text, options) => { replies.push({ text, options }); return { message_id: messageId }; },
  };
}
function fixture({ output = intent(), enabled = true, ready = true, offers = [], auto = false, now = Date.now } = {}) {
  const calls = [], active = new Map([[-100, enabled]]), autoActive = new Map([[-100, auto]]);
  const flow = createGroupAssistantFlow({ pool: {}, now, model: { ready: () => ready, interpret: async (...args) => { calls.push(['model', ...args]); return output; } },
    store: { autoEnabled: async id => active.get(id) && autoActive.get(id), setAuto: async (id, _actor, value) => { autoActive.set(id, value); if (value) active.set(id, true); }, enabled: async id => active.get(id), activate: async (id, _actor, value) => active.set(id, value), reserve: async () => { calls.push(['reserve']); return true; } },
    search: async f => { calls.push(['search', f]); return offers; },
  });
  return { flow, calls, active, autoActive };
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
  assert.doesNotMatch(message, /https?:\/\//);
  assert.equal(offerButtons(offers, 'ru').reply_markup.inline_keyboard[0][0].url, 'https://travella.uz/marketplace?opened=42');
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

test('short price-basis answers preserve the itinerary and never restart an ambiguous model interpretation', async () => {
  const model = createGroupAssistantModel({ env: { OPENAI_API_KEY: 'test' }, fetchImpl: async () => assert.fail('no extra model call for an exact clarification answer') });
  for (const [answer, basis, language] of [['за одного', 'person', 'ru'], ['за весь тур', 'total', 'ru'], ['bir kishiga', 'person', 'uz'], ['per person', 'person', 'en']]) {
    const result = await model.interpret(answer, { ...filters, priceBasis: null });
    assert.equal(result.kind, 'search');
    assert.equal(result.language, language);
    assert.equal(result.filters.priceBasis, basis);
    assert.equal(result.filters.budget, 1000);
    assert.equal(result.filters.start, '2026-12-01');
    assert.deepEqual(result.filters.destination, filters.destination);
  }
});

test('ordinary group replies do not turn a reply thread into a forum topic and invalidate buttons', async () => {
  const f = fixture();
  const c = context('@TravellaBot дубай');
  delete c.message.message_thread_id;
  delete c.message.is_topic_message;
  await f.flow(c, () => assert.fail());
  const data = c.replies[0].options.reply_markup.inline_keyboard[0][0].callback_data;
  assert.equal(c.replies[0].options.message_thread_id, undefined);
  const click = context(null, { data, topic: 10 });
  delete click.callbackQuery.message.is_topic_message;
  await Promise.all([f.flow(click, () => assert.fail()), f.flow(contextCopy(click), () => assert.fail())]);
  assert.equal(f.calls.filter(c => c[0] === 'search').length, 1);
  function contextCopy(original) { const c = context(null, { data, topic: 10 }); delete c.callbackQuery.message.is_topic_message; return c; }
});

test('compact results use readable dates, correct price units and matching URL buttons', async () => {
  const offers = [
    { id: 1253, title: 'Отказной тур на Фукуок', category: 'refused_tour', origin: 'Ташкент', destination: 'Фукуок', start: '2026-12-04', end: '2026-12-11', price: 3650, currency: 'USD', priceBasis: 'unknown' },
    { id: 1237, title: 'Отказной тур Фукуок', category: 'refused_tour', start: '2026-12-29', end: '2027-01-05', price: 650, currency: 'USD', priceBasis: 'person' },
    { id: 1220, title: 'Отель', category: 'refused_hotel', price: 1200, currency: 'USD', priceBasis: 'total', gala: { status: 'mandatory', adultPrice: '100', currency: 'USD' } },
  ];
  const text = formatOffers(offers, 'ru');
  assert.match(text, /Нашёл в Travella: 3/);
  assert.match(text, /04\.12 — 11\.12\.2026/);
  assert.match(text, /29\.12\.2026 — 05\.01\.2027/);
  assert.match(text, /за сколько человек — нужно уточнить/);
  assert.match(text, /650 USD · за человека/);
  assert.match(text, /за весь номер/);
  assert.match(text, /Обязательная доплата: 100 USD/);
  assert.doesNotMatch(text, /https?:|2026-12-/);
  const f = fixture({ offers });
  const c = context('@TravellaBot фукуок');
  await f.flow(c, () => assert.fail());
  const data = c.replies[0].options.reply_markup.inline_keyboard[0][0].callback_data;
  const click = context(null, { data });
  await f.flow(click, () => assert.fail());
  const buttons = click.replies[0].options.reply_markup.inline_keyboard;
  assert.equal(buttons.length, 3);
  assert.equal(buttons[1][0].text, '2. Открыть карточку · #1237');
  assert.equal(buttons[1][0].url, 'https://travella.uz/marketplace?opened=1237');
  assert.deepEqual(offerButtons([], 'ru'), {});
  assert.match(formatOffers(offers, 'uz'), /necha kishi uchunligini/);
  assert.match(formatOffers(offers, 'en'), /per person/);
});

test('automatic capture is opt-in, costs no model calls and combines only the author’s own refinements', async () => {
  const output = intent({ filters: { ...filters, destination: [], origin: [], anyDestination: true, guests: 2, excludeArab: true, priceBasis: 'total', companion: false, gender: null } });
  const f = fixture({ auto: true, output });
  const first = context('У кого есть на завтра послезавтра на двоих отказной?');
  first.message.message_id = 11;
  await f.flow(first, () => assert.fail());
  assert.equal(first.replies.length, 1);
  const button = first.replies[0].options.reply_markup.inline_keyboard[0][0];
  assert.equal(button.text, '🔎 Подобрать варианты?');
  assert.equal(f.calls.length, 0);
  const other = context('куда', { actor: 8 });
  await f.flow(other, () => assert.fail());
  assert.equal(other.replies.length, 0);
  for (const [id, text] of [[12, 'Разницы нет бюджет 1000$ на двоих'], [13, 'Кроме арабских стран']]) {
    const c = context(text); c.message.message_id = id;
    await f.flow(c, () => assert.fail());
    assert.equal(c.replies.length, 0); // No repeated invitations or model calls for refinements.
  }
  assert.equal(f.calls.length, 0);
  const foreign = context(null, { data: button.callback_data, actor: 8 });
  await f.flow(foreign, () => assert.fail());
  assert.equal(f.calls.length, 0);
  const click = context(null, { data: button.callback_data });
  await f.flow(click, () => assert.fail());
  const question = f.calls.find(c => c[0] === 'model')[1];
  assert.match(question, /на завтра послезавтра/);
  assert.match(question, /1000\$ на двоих/);
  assert.match(question, /Кроме арабских/);
  assert.ok(!question.split('\n').includes('куда'));
  assert.match(click.replies[0].text, /Взрослых: 2/);
  assert.match(click.replies[0].text, /арабские страны/);
  assert.equal(f.calls.filter(c => c[0] === 'search').length, 0);
  const confirmed = click.replies[0].options.reply_markup.inline_keyboard[0][0].callback_data;
  await f.flow(context(null, { data: confirmed }), () => assert.fail());
  assert.equal(f.calls.filter(c => c[0] === 'search').length, 1);
  assert.equal(f.calls.find(c => c[0] === 'search')[1].guests, 2);
});
test('ordinary requests remain silent with auto mode off; only an admin can enable it', async () => {
  const f = fixture();
  const c = context('Коллеги нужен отказной тур на двоих');
  await f.flow(c, () => assert.fail());
  assert.equal(c.replies.length, 0);
  await f.flow(context('/travella_auto_on@TravellaBot'), () => assert.fail());
  assert.equal(f.autoActive.get(-100), false);
  await f.flow(context('/travella_auto_on@TravellaBot', { admin: true }), () => assert.fail());
  assert.ok(f.autoActive.get(-100));
  await f.flow(context('/travella_auto_off@TravellaBot', { admin: true }), () => assert.fail());
  assert.equal(f.autoActive.get(-100), false);
  assert.ok(f.active.get(-100)); // Direct /ask is still on.
});
test('auto mode ignores forwards and conversation, respects dismissal and caps new invitations', async () => {
  const f = fixture({ auto: true });
  const forward = context('Нужен отказной тур'); forward.message.forward_origin = { type: 'user' };
  await f.flow(forward, () => assert.fail());
  assert.equal(forward.replies.length, 0);
  for (const text of ['Привет коллеги', 'Отказной тур Фукуок 3650 USD']) {
    const c = context(text); await f.flow(c, () => assert.fail()); assert.equal(c.replies.length, 0);
  }
  const c = context('Нужен отказной тур на двоих');
  await f.flow(c, () => assert.fail());
  const dismiss = c.replies[0].options.reply_markup.inline_keyboard[1][0].callback_data;
  await f.flow(context(null, { data: dismiss }), () => assert.fail());
  const follow = context('Бюджет 1000 USD'); follow.message.message_id = 20;
  await f.flow(follow, () => assert.fail()); assert.equal(follow.replies.length, 0);
  for (const [actor, expected] of [[8, 1], [9, 0]]) {
    const request = context('Нужен отказной тур на двоих', { actor });
    await f.flow(request, () => assert.fail()); assert.equal(request.replies.length, expected);
  }
  assert.equal(f.calls.length, 0);
});
test('party size and excluded countries are validated and enforced by bound SQL before pagination', () => {
  for (const guests of [0, 1.5, 21, '2']) assert.throws(() => intent({ filters: { ...filters, guests } }));
  const result = buildSearch({ ...filters, destination: [], anyDestination: true, guests: 2, excludedCountries: ['Turkey', 'Турция'], excludeArab: true });
  assert.ok(result.args.includes(2));
  const patterns = result.args.filter(Array.isArray).flat();
  assert.ok(patterns.includes('turkey'));
  assert.ok(patterns.includes('египет'));
  assert.ok(patterns.includes('uae'));
  assert.ok(!result.sql.includes('Египет'));
  assert.match(result.sql, /NOT \(LOWER/);
  assert.match(result.sql, /accommodationADT/);
  assert.match(result.sql, /adults/);
  assert.match(result.sql, /infants/);
});

test('country exclusions use exact normalized country names and do not confuse Oman with Romania', () => {
  const { excludedCountries } = require('../ai/groupAssistantCountries');
  const arab = excludedCountries([], true);
  assert.ok(arab.includes('oman'));
  assert.ok(!arab.includes('romania'));
  assert.ok(!arab.includes('turkey'));
  assert.ok(!arab.includes('south sudan'));
  const named = excludedCountries(['Egipt', 'Турция'], false);
  assert.ok(named.includes('egypt'));
  assert.ok(named.includes('turkey'));
  assert.ok(named.includes('turkiya'));
});

test('refinement arriving during model processing invalidates the stale confirmation without another model call', async () => {
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  const flow = createGroupAssistantFlow({ pool: {}, model: { ready: () => true, interpret: async () => { calls++; entered(); return new Promise(resolve => { finish = resolve; }); } }, store: { enabled: async () => true, autoEnabled: async () => true, reserve: async () => true } });
  const first = context('У кого есть отказной на двоих на завтра?'); first.message.message_id = 11;
  await flow(first, () => assert.fail());
  const data = first.replies[0].options.reply_markup.inline_keyboard[0][0].callback_data;
  const click = context(null, { data });
  const work = flow(click, () => assert.fail());
  await started;
  const follow = context('Кроме арабских стран'); follow.message.message_id = 12;
  await flow(follow, () => assert.fail());
  finish(intent()); await work;
  assert.equal(calls, 1);
  assert.match(click.replies[0].options.reply_markup.inline_keyboard[0][0].callback_data, /^grp_ai:auto:/);
  assert.doesNotMatch(click.replies[0].text, /Правильно понял/);
});
test('local detector keeps the root request when many refinements arrive and redacts documents', () => {
  const { appendAutoText, isTourRequest } = require('../ai/groupAssistantAuto');
  assert.equal(isTourRequest('У кого есть на завтра на двоих отказной?'), true);
  const entry = { texts: [], messageIds: [], revision: 0 };
  appendAutoText(entry, 'У кого есть на завтра отказной?', 1);
  for (let i = 2; i <= 9; i++) appendAutoText(entry, 'Бюджет 1000 USD ' + i, i);
  assert.equal(entry.texts.length, 6);
  assert.match(entry.texts[0], /на завтра/);
  assert.match(entry.texts.at(-1), /9$/);
  appendAutoText(entry, 'Бюджет 1000 USD, телефон +998901234567, паспорт AB1234567', 10);
  assert.doesNotMatch(entry.texts.at(-1), /998901234567|AB1234567/);
});

test('simultaneous author messages produce one invitation and retain all refinements', async () => {
  const f = fixture({ auto: true });
  const messages = ['У кого есть на завтра на двоих отказной?', 'Бюджет 1000$ на двоих, разницы нет', 'Кроме арабских стран'].map((text, i) => { const c = context(text); c.message.message_id = i + 11; return c; });
  await Promise.all(messages.map(c => f.flow(c, () => assert.fail())));
  assert.equal(messages.flatMap(c => c.replies).length, 1);
  const data = messages[0].replies[0].options.reply_markup.inline_keyboard[0][0].callback_data;
  await f.flow(context(null, { data }), () => assert.fail());
  const question = f.calls.find(c => c[0] === 'model')[1];
  assert.match(question, /на завтра/);
  assert.match(question, /1000\$/);
  assert.match(question, /Кроме арабских/);
});

test('an expired automatic invitation does not prevent a new request after fifteen minutes', async () => {
  let time = 0;
  const f = fixture({ auto: true, now: () => time });
  const first = context('У кого есть отказной на двоих?');
  await f.flow(first, () => assert.fail());
  time = 14 * 60000;
  const follow = context('Бюджет 1000 USD'); follow.message.message_id = 12;
  await f.flow(follow, () => assert.fail());
  time = 16 * 60000;
  const next = context('У кого есть отказной на завтра?'); next.message.message_id = 13;
  await f.flow(next, () => assert.fail());
  assert.equal(next.replies.length, 1);
  assert.match(next.replies[0].options.reply_markup.inline_keyboard[0][0].callback_data, /grp_ai:auto:/);
});

test('nearest dates always cover seven Tashkent calendar days including today across year boundaries',async()=>{
 for(const [clock,start,end] of [['2026-11-20T18:45:00Z','2026-11-20','2026-11-26'],['2026-12-30T20:00:00Z','2026-12-31','2027-01-06']]){
  for(const phrase of ['на ближайшие даты','на ближ даты']){
   const model=createGroupAssistantModel({env:{OPENAI_API_KEY:'test'},now:()=>Date.parse(clock),fetchImpl:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...intent(),filters:{...intent().filters,start,end:start}})}}]})})});
   const result=await model.interpret('Найди на Фукуок '+phrase);
   assert.equal(result.filters.start,start);assert.equal(result.filters.end,end);
  }
 }
});
