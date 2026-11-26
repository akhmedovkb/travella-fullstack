const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGalaDinner, galaDinnerText, validateGalaBody } = require('../utils/galaDinner');
const { saveGalaDinner } = require('../utils/galaDinnerService');
const { createGalaDinnerFlow } = require('../telegram/handlers/galaDinnerFlow');
const { buildServiceMessage } = require('../utils/telegramServiceCard');
const { correctionSnapshot } = require('../utils/serviceCorrections');
const paid = { status: 'mandatory', date: '2026-12-31', adultPrice: '120,50', childPrice: 0, currency: 'USD', childConditions: '6–12 лет; до 6 лет бесплатно' };
const dates = { startDate: '2026-12-28', endDate: '2027-01-04' };
function fixture() {
  const service = { id: 42, provider_id: 5, category: 'refused_tour', status: 'draft', moderation_status: 'draft', edit_version: 'v1', title: 'TEST', details: { ...dates, proofImages: ['private-proof'] } };
  const queries = [];
  let snapshot;
  const db = { release() {}, async query(sql, args = []) {
    queries.push({ sql, args });
    if (sql === 'BEGIN') snapshot = structuredClone(service);
    if (sql === 'ROLLBACK') Object.assign(service, snapshot);
    if (sql.startsWith('SELECT *')) return { rows: args[0] === 42 && args[1] === 5 ? [structuredClone(service)] : [] };
    if (sql.startsWith('UPDATE services')) { service.details = JSON.parse(args[2]); service.edit_version = 'v2'; }
    return { rows: [], rowCount: 1 };
  } };
  return { service, queries, pool: { query: db.query, connect: async () => db } };
}
function context(session, data, message) {
  const replies = [];
  return { from: { id: 55 }, chat: { id: 55, type: 'private' }, session, callbackQuery: data ? { data } : undefined, message: message ? { text: message } : undefined, replies, reply: async (text, options) => replies.push({ text, options }), answerCbQuery: async () => {} };
}
test('gala terms distinguish included, mandatory, optional, none and unknown with free children', () => {
  assert.equal(normalizeGalaDinner(undefined), undefined);
  assert.deepEqual(normalizeGalaDinner({ status: 'none', date: 'bad', adultPrice: 100 }), { status: 'none' });
  assert.deepEqual(normalizeGalaDinner({ status: 'unknown' }), { status: 'unknown' });
  const value = normalizeGalaDinner(paid, dates, 'refused_tour');
  assert.equal(value.adultPrice, 120.5);
  assert.equal(value.childPrice, 0);
  assert.match(galaDinnerText(value), /сверх указанной цены/);
  assert.match(galaDinnerText(value), /0 USD/);
  assert.equal(normalizeGalaDinner({ ...paid, status: 'included' }).adultPrice, undefined);
});
test('invalid prices, dates, currency and unsupported category are rejected', () => {
  for (const value of [{ ...paid, date: '2026-02-30' }, { ...paid, date: '2027-02-01' }, { ...paid, adultPrice: -1 }, { ...paid, adultPrice: 0 }, { ...paid, childPrice: -1 }, { ...paid, currency: 'BAD' }]) assert.throws(() => normalizeGalaDinner(value, dates, 'refused_hotel'));
  assert.throws(() => normalizeGalaDinner(paid, dates, 'refused_flight'));
});
test('save preserves unrelated details and audits in one transaction with stale and pending guards', async () => {
  const f = fixture();
  await saveGalaDinner(f.pool, { providerId: 5, serviceId: 42, version: 'v1', value: paid });
  assert.deepEqual(f.service.details.proofImages, ['private-proof']);
  assert.equal(f.service.details.galaDinner.adultPrice, 120.5);
  assert.ok(f.queries.some(q => q.sql.includes('FOR UPDATE')));
  assert.ok(f.queries.some(q => q.sql.startsWith('INSERT INTO service_moderation_events')));
  await assert.rejects(() => saveGalaDinner(f.pool, { providerId: 5, serviceId: 42, version: 'v1', value: paid }), /изменилась/);
  f.service.status = 'pending';
  await assert.rejects(() => saveGalaDinner(f.pool, { providerId: 5, serviceId: 42, version: 'v2', value: paid }), /менять услугу нельзя/);
});
test('web body validation normalizes JSON and reports incomplete mandatory supplement', () => {
  const req = { body: { category: 'refused_tour', details: JSON.stringify({ ...dates, galaDinner: paid }) } };
  validateGalaBody(req, { status: () => assert.fail() }, () => {});
  assert.equal(req.body.details.galaDinner.adultPrice, 120.5);
  let error;
  validateGalaBody({ body: { details: { galaDinner: { status: 'mandatory' } } } }, { status() { return this; }, json(value) { error = value; } }, () => assert.fail());
  assert.ok(error.message);
});
test('Telegram card displays gala date, separate supplement and safely escapes supplier notes', () => {
  const value = normalizeGalaDinner({ ...paid, notes: '<b>not markup</b>' });
  const card = buildServiceMessage({ id: 42, title: 'TEST', category: 'refused_tour', details: { galaDinner: value } }, 'refused_tour', 'provider');
  assert.match(card.text, /31\.12\.2026/);
  assert.match(card.text, /120.5 USD/);
  assert.match(card.text, /&lt;b&gt;/);
  const before = correctionSnapshot({ details: {} });
  const after = correctionSnapshot({ details: { galaDinner: value } });
  assert.notEqual(after.galaDinner.signature, before.galaDinner?.signature);
});
test('Telegram gala editor edits the same owned service, survives validation error and saves', async () => {
  const f = fixture();
  const flow = createGalaDinnerFlow({ pool: f.pool, resolve: async () => ({ id: 5 }) });
  const session = {};
  await flow(context(session, 'gala:open:42'), () => assert.fail());
  const token = session.galaFlow.token;
  const send = (action, value) => flow(context(session, `gala:${action}:42:${token}`), () => assert.fail()).then(() => value === undefined ? undefined : flow(context(session, null, value), () => assert.fail()));
  await send('status_mandatory');
  await send('save');
  assert.ok(session.galaFlow);
  await send('date', '2026-12-31');
  await send('adultPrice', '120');
  await send('childPrice', '60');
  await send('childConditions', '6–12 лет');
  await send('save');
  assert.equal(session.galaFlow, null);
  assert.equal(f.service.details.galaDinner.childPrice, 60);
  assert.deepEqual(f.service.details.proofImages, ['private-proof']);
});
test('Telegram stale fields, foreign services and groups cannot write gala dinner', async () => {
  const f = fixture();
  const flow = createGalaDinnerFlow({ pool: f.pool, resolve: async () => ({ id: 99 }) });
  await flow(context({}, 'gala:open:42'), () => assert.fail());
  const group = context({}, 'gala:open:42'); group.chat.type = 'group';
  await flow(group, () => assert.fail());
  await flow(context({}, 'gala:save:42:old'), () => assert.fail());
  assert.ok(!f.queries.some(q => q.sql.startsWith('UPDATE')));
});

test('Telegram cards omit unspecified or unknown gala terms and keep explicit supplier terms',()=>{
 for(const category of ['refused_tour','refused_hotel']){
  for(const galaDinner of [undefined,{status:'unknown'},{status:'none'}]){
   const card=buildServiceMessage({id:42,title:'TEST',category,details:{galaDinner}},category,'provider');
   assert.doesNotMatch(card.text,/Гала-ужин|Нужно уточнить/);
  }
  const card=buildServiceMessage({id:42,title:'TEST',category,details:{galaDinner:{status:'included'}}},category,'provider');
  assert.match(card.text,/Гала-ужин/);assert.match(card.text,/Включён в цену/);
 }
});
