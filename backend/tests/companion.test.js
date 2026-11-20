const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCompanion, normalizeCompanionPrices, companionText, validateCompanionBody } = require('../utils/companion');
const { saveCompanion } = require('../utils/companionService');
const { createCompanionFlow } = require('../telegram/handlers/companionFlow');
const { buildServiceMessage } = require('../utils/telegramServiceCard');
const { correctionSnapshot } = require('../utils/serviceCorrections');
const searching = { enabled: true, gender: 'female', room: 'shared', count: '1', travelers: 'Девушка, 28 лет', preferences: 'Перелёт и проживание включены' };
const prices = { netPrice: '600,50', grossPrice: '650' };
function fixture() {
  const service = { id: 42, provider_id: 5, category: 'refused_tour', status: 'draft', moderation_status: 'draft', edit_version: 'v1', title: 'TEST', details: { proofImages: ['private-proof'], galaDinner: { status: 'none' }, netPrice: 1200, grossPrice: 1300 } };
  const queries = [];
  let snapshot;
  const db = { release() {}, async query(sql, args = []) {
    queries.push({ sql, args });
    if (sql === 'BEGIN') snapshot = structuredClone(service);
    if (sql === 'ROLLBACK') Object.assign(service, snapshot);
    if (sql.startsWith('SELECT *')) return { rows: args[0] === 42 && args[1] === 5 ? [structuredClone(service)] : [] };
    if (sql.startsWith('UPDATE services')) { service.details = JSON.parse(args[2]); service.edit_version = 'v2'; service.status = 'draft'; service.moderation_status = 'draft'; if (args[3] != null) service.price = args[3]; }
    return { rows: [], rowCount: 1 };
  } };
  return { service, queries, pool: { query: db.query, connect: async () => db } };
}
function context(session, data, message) {
  const replies = [];
  return { from: { id: 55 }, chat: { id: 55, type: 'private' }, session, callbackQuery: data ? { data } : undefined, message: message ? { text: message } : undefined, replies, reply: async (text, options) => replies.push({ text, options }), answerCbQuery: async () => {} };
}
function sender(flow, session) {
  return async (action, value) => {
    const state = session.companionFlow;
    const ctx = context(session, `comp:${action}:${state.serviceId}:${state.token}`);
    await flow(ctx, () => assert.fail());
    if (value !== undefined) await flow(context(session, null, value), () => assert.fail());
    return ctx;
  };
}
test('companion normalization supports genders, room types and legacy services', () => {
  assert.equal(normalizeCompanion(undefined), undefined);
  assert.deepEqual(normalizeCompanion({ enabled: false }), { enabled: false });
  for (const gender of ['male', 'female', 'any']) for (const room of ['shared', 'separate']) {
    const value = normalizeCompanion({ ...searching, gender, room }, 'refused_hotel');
    assert.equal(value.count, 1);
    assert.equal(value.priceBasis, 'per_person');
  }
  assert.deepEqual(normalizeCompanionPrices(prices), { netPrice: 600.5, grossPrice: 650 });
});
test('invalid companion settings and prices cannot be saved', () => {
  for (const value of [null, {}, { ...searching, gender: 'invalid' }, { ...searching, room: 'invalid' }, { ...searching, count: 0 }, { ...searching, count: 1.5 }, { ...searching, count: 21 }, { ...searching, travelers: 'x'.repeat(501) }]) assert.throws(() => normalizeCompanion(value));
  assert.throws(() => normalizeCompanion(searching, 'refused_flight'));
  for (const value of [null, { netPrice: -1, grossPrice: 2 }, { netPrice: 2, grossPrice: 1 }, { netPrice: 1, grossPrice: 0 }, { netPrice: '1e3', grossPrice: 1001 }]) assert.throws(() => normalizeCompanionPrices(value));
});
test('web validates and normalizes both JSON and object details', () => {
  for (const details of [{ companion: searching }, JSON.stringify({ companion: searching })]) {
    const req = { body: { category: 'refused_tour', details } };
    let called = false;
    validateCompanionBody(req, { status: () => assert.fail() }, () => { called = true; });
    assert.ok(called);
    assert.equal(req.body.details.companion.count, 1);
  }
  let error;
  validateCompanionBody({ body: { details: { companion: { enabled: true } } } }, { status() { return this; }, json(v) { error = v; } }, () => assert.fail());
  assert.ok(error.message);
});
test('transactional edit preserves proof and gala, changes the actual prices and audits', async () => {
  const f = fixture();
  await saveCompanion(f.pool, { providerId: 5, serviceId: 42, version: 'v1', value: searching, prices });
  assert.equal(f.service.price, 600.5);
  assert.equal(f.service.details.grossPrice, 650);
  assert.deepEqual(f.service.details.proofImages, ['private-proof']);
  assert.deepEqual(f.service.details.galaDinner, { status: 'none' });
  assert.ok(f.queries.some(q => q.sql.includes('FOR UPDATE')));
  const audit = f.queries.find(q => q.sql.startsWith('INSERT INTO service_moderation_events'));
  assert.ok(JSON.parse(audit.args[2]).changes.some(change => change.field === 'details.companion'));
  await assert.rejects(() => saveCompanion(f.pool, { providerId: 5, serviceId: 42, version: 'v1', value: searching, prices }), /изменилась/);
});
test('turning search off keeps per-person price and never archives the service', async () => {
  const f = fixture();
  f.service.details.companion = normalizeCompanion(searching);
  await saveCompanion(f.pool, { providerId: 5, serviceId: 42, version: 'v1', value: { ...f.service.details.companion, enabled: false } });
  assert.equal(f.service.details.companion.enabled, false);
  assert.equal(f.service.details.companion.priceBasis, 'per_person');
  assert.equal(f.service.details.grossPrice, 1300);
  assert.equal(f.service.status, 'draft');
  assert.match(companionText(f.service.details.companion), /за одного человека/);
});
test('pending, archived and foreign services cannot be changed', async () => {
  for (const status of ['pending', 'archived']) {
    const f = fixture(); f.service.status = status;
    await assert.rejects(() => saveCompanion(f.pool, { providerId: 5, serviceId: 42, version: 'v1', value: searching, prices }), /менять услугу нельзя/);
    assert.ok(!f.queries.some(q => q.sql.startsWith('UPDATE')));
  }
  const f = fixture();
  await assert.rejects(() => saveCompanion(f.pool, { providerId: 99, serviceId: 42, version: 'v1', value: searching, prices }), /не найдена/);
});
test('bot creation records companion requirements before continuing to price without creating a service early', async () => {
  const f = fixture();
  let continued = false;
  const flow = createCompanionFlow({ pool: f.pool, resolve: async () => ({ id: 5 }), onDraftComplete: async () => { continued = true; } });
  const session = { serviceDraft: { category: 'refused_tour', title: 'TEST' }, state: 'svc_create_price' };
  await flow.startDraft(context(session));
  const send = sender(flow, session);
  await send('enabled');
  await send('save'); // Missing gender/room stays in the editor.
  assert.equal(continued, false);
  await send('gender_female');
  await send('room_shared');
  await flow(context(session, null, '2'), () => assert.fail());
  await flow(context(session, null, 'Девушка, 28 лет'), () => assert.fail());
  await send('skip');
  await send('save');
  assert.ok(continued);
  assert.equal(session.companionFlow, null);
  assert.equal(session.serviceDraft.companion.count, 2);
  assert.equal(session.serviceDraft.title, 'TEST');
  assert.ok(!f.queries.some(q => /UPDATE|INSERT/.test(q.sql)));
});
test('bot no-companion creation skips extra fields and continues', async () => {
  let continued = false;
  const flow = createCompanionFlow({ pool: {}, resolve: async () => ({ id: 5 }), onDraftComplete: async () => { continued = true; } });
  const session = { serviceDraft: { category: 'refused_hotel' } };
  await flow.startDraft(context(session));
  const send = sender(flow, session);
  await send('disabled');
  assert.ok(continued);
  assert.deepEqual(session.serviceDraft.companion, { enabled: false });
});
test('bot editing requires per-person confirmation, persists all fields and reopens', async () => {
  const f = fixture();
  const flow = createCompanionFlow({ pool: f.pool, resolve: async () => ({ id: 5 }) });
  const session = {};
  await flow(context(session, 'comp:open:42'), () => assert.fail());
  const send = sender(flow, session);
  await send('enabled'); await send('gender_female'); await send('room_shared');
  await send('travelers', 'Девушка, 28 лет');
  await send('preferences', 'Не курит');
  await send('netPrice', '600'); await send('grossPrice', '650');
  await send('save');
  assert.ok(!f.queries.some(q => q.sql.startsWith('UPDATE')));
  await send('confirm_prices'); await send('save');
  assert.equal(session.companionFlow, null);
  await flow(context(session, 'comp:open:42'), () => assert.fail());
  assert.equal(session.companionFlow.value.travelers, 'Девушка, 28 лет');
  assert.equal(session.companionFlow.value.preferences, 'Не курит');
  assert.equal(session.companionFlow.prices.grossPrice, 650);
});
test('foreign actors, groups, stale buttons and navigation cannot accidentally write', async () => {
  const f = fixture();
  const foreign = createCompanionFlow({ pool: f.pool, resolve: async () => ({ id: 99 }) });
  await foreign(context({}, 'comp:open:42'), () => assert.fail());
  const flow = createCompanionFlow({ pool: f.pool, resolve: async () => ({ id: 5 }) });
  const group = context({}, 'comp:open:42'); group.chat.type = 'group';
  await flow(group, () => assert.fail());
  await flow(context({}, 'comp:save:42:old'), () => assert.fail());
  const session = {};
  await flow(context(session, 'comp:open:42'), () => assert.fail());
  await flow(context(session, 'prov_services:list'), () => {});
  assert.equal(session.companionFlow, null);
  assert.ok(!f.queries.some(q => q.sql.startsWith('UPDATE')));
});
test('Telegram public card escapes supplier text and corrections detect edits', () => {
  const value = normalizeCompanion({ ...searching, travelers: '<b>Text</b>' });
  for (const category of ['refused_tour', 'refused_hotel']) {
    const card = buildServiceMessage({ id: 42, title: 'TEST', category, details: { companion: value } }, category, 'provider');
    assert.match(card.text, /Нужна попутчица/);
    assert.match(card.text, /за одного попутчика/);
    assert.match(card.text, /&lt;b&gt;/);
  }
  assert.notEqual(correctionSnapshot({ details: { companion: value } }).companion.signature, correctionSnapshot({ details: {} }).companion?.signature);
});

test('creation shows one compact question at a time and removes the main reply keyboard', async () => {
  const flow = createCompanionFlow({ pool: {}, resolve: async () => ({ id: 5 }) });
  const session = { serviceDraft: { category: 'refused_tour' } };
  const first = context(session);
  await flow.startDraft(first);
  assert.equal(first.replies[0].options.reply_markup.remove_keyboard, true);
  assert.equal(first.replies[1].options.reply_markup.inline_keyboard.flat().length, 4);
  const send = sender(flow, session);
  const gender = await send('enabled');
  assert.match(gender.replies[0].text, /Кого ищем/);
  assert.equal(gender.replies[0].options.reply_markup.inline_keyboard.length, 3);
  assert.doesNotMatch(gender.replies[0].text, /Ищут:|Указанная цена/);
  const room = await send('gender_female');
  assert.match(room.replies[0].text, /Как будет размещаться/);
  assert.equal(room.replies[0].options.reply_markup.inline_keyboard.length, 3);
  await send('room_shared');
  assert.equal(session.companionFlow.field, 'count');
  await send('skip');
  assert.equal(session.companionFlow.step, 'count'); // Required count cannot be skipped.
  await send('count_1');
  assert.equal(session.companionFlow.field, 'travelers');
  await send('previous');
  assert.equal(session.companionFlow.step, 'count');
  await send('count_2'); await send('skip'); await send('skip');
  assert.equal(session.companionFlow.step, 'review');
  assert.equal(session.companionFlow.value.count, 2);
});
test('callback selections edit one message and old buttons cannot alter a later step', async () => {
  const session = { serviceDraft: { category: 'refused_hotel' } };
  const messages = [], edits = [], clears = [];
  const flow = createCompanionFlow({ pool: {}, resolve: async () => ({ id: 5 }) });
  function ctx(data, text) {
    const value = context(session, data, text);
    value.reply = async (body, options) => { messages.push({ body, options }); return { message_id: messages.length }; };
    value.telegram = {
      editMessageText: async (...args) => edits.push(args),
      editMessageReplyMarkup: async (...args) => clears.push(args),
    };
    return value;
  }
  await flow.startDraft(ctx());
  const firstId = session.companionFlow.messageId;
  const oldToken = session.companionFlow.token;
  await flow(ctx(`comp:enabled:0:${oldToken}`), () => assert.fail());
  assert.equal(messages.length, 2); // Intro hides keyboard; the second message is the single question.
  assert.equal(edits.length, 1);
  assert.equal(edits[0][1], firstId);
  assert.notEqual(session.companionFlow.token, oldToken);
  await flow(ctx(`comp:disabled:0:${oldToken}`), () => assert.fail());
  assert.equal(session.companionFlow.step, 'gender');
  for (const action of ['gender_any', 'room_separate', 'count_1']) {
    await flow(ctx(`comp:${action}:0:${session.companionFlow.token}`), () => assert.fail());
  }
  await flow(ctx(null, 'Пара, 30 лет'), () => assert.fail());
  assert.equal(messages.length, 3); // Text answer gets the next prompt below it.
  assert.equal(session.companionFlow.step, 'preferences');
  assert.ok(clears.length);
  assert.deepEqual(clears.at(-1)[3], { inline_keyboard: [] });
});
