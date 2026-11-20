const { randomBytes } = require('node:crypto');
const { resolveProviderByTelegramActorId } = require('../../utils/providerTelegramResolver');
const { readGalaService, saveGalaDinner } = require('../../utils/galaDinnerService');
const { STATUS_LABELS, galaDinnerText } = require('../../utils/galaDinner');

function createGalaDinnerFlow({ pool, resolve = resolveProviderByTelegramActorId }) {
  const running = new Map();
  const reply = (ctx, text, rows) => ctx.reply(text, { parse_mode: undefined, reply_markup: { inline_keyboard: rows } });
  function button(state, text, action) {
    return { text, callback_data: `gala:${action}:${state.serviceId}:${state.token}` };
  }
  async function show(ctx, state) {
    const rows = Object.entries(STATUS_LABELS).map(([status, label]) => [button(state, `${state.value.status === status ? '✅ ' : ''}${label}`, `status_${status}`)]);
    if (!['none', 'unknown'].includes(state.value.status)) {
      rows.push([button(state, '📅 Дата ужина', 'date')]);
      if (['mandatory', 'optional'].includes(state.value.status)) {
        rows.push([button(state, 'Цена за взрослого', 'adultPrice'), button(state, 'Цена за ребёнка', 'childPrice')]);
        rows.push([button(state, 'Валюта', 'currency')]);
      }
      rows.push([button(state, 'Возраст и условия для детей', 'childConditions')], [button(state, 'Комментарий', 'notes')]);
    }
    rows.push([button(state, '💾 Сохранить гала-ужин', 'save')], [{ text: 'Отмена — мои услуги', callback_data: 'prov_services:list' }]);
    state.field = null;
    await reply(ctx, `Услуга #${state.serviceId}\n\n${galaDinnerText(state.value)}\n\nВыберите условия и заполните нужные поля. Нажмите «Сохранить гала-ужин», когда закончите. Изменённая услуга сохранится в черновик для проверки.`, rows);
  }
  async function handle(ctx, data) {
    if (ctx.chat?.type !== 'private' || String(ctx.chat.id) !== String(ctx.from?.id)) return ctx.reply('Откройте личный чат с ботом.');
    const provider = await resolve(pool, ctx.from.id, { action: 'gala_dinner', includeWebChatId: true });
    if (!provider?.id) return ctx.reply('Привяжите аккаунт поставщика через /start.');
    const parts = data.split(':');
    const action = parts[1];
    if (action === 'open') {
      const service = await readGalaService(pool, provider.id, Number(parts[2]));
      if (service.status === 'pending' || service.moderation_status === 'pending' || service.status === 'archived') return reply(ctx, 'Услуга на проверке или в архиве. Откройте её текущую карточку.', [[{ text: 'Открыть актуальную карточку', callback_data: `svc_current:${service.id}` }]]);
      ctx.session.galaFlow = { serviceId: service.id, version: service.edit_version, token: randomBytes(5).toString('hex'), value: { status: 'unknown', currency: 'USD', ...service.details.galaDinner } };
      return show(ctx, ctx.session.galaFlow);
    }
    const state = ctx.session.galaFlow;
    if (!state || (data && (Number(parts[2]) !== state.serviceId || parts[3] !== state.token))) return reply(ctx, 'Редактор устарел. Откройте гала-ужин заново.', [[{ text: 'Мои услуги', callback_data: 'prov_services:list' }]]);
    if (!data && state.field && ctx.message?.text) {
      const input = ctx.message.text.trim();
      if (input.length > (state.field === 'notes' ? 1000 : 500)) return ctx.reply('Сократите текст и отправьте ещё раз.');
      state.value[state.field] = input === '-' ? '' : input;
      return show(ctx, state);
    }
    if (action?.startsWith('status_')) {
      const status = action.slice(7);
      if (!Object.hasOwn(STATUS_LABELS, status)) return;
      if (state.value.status !== status) state.value = { status, currency: 'USD' };
      return show(ctx, state);
    }
    if (action === 'save') {
      await saveGalaDinner(pool, { providerId: provider.id, serviceId: state.serviceId, version: state.version, value: state.value });
      ctx.session.galaFlow = null;
      return reply(ctx, `✅ Гала-ужин сохранён в услуге #${state.serviceId}.\nОткройте черновик или замечания и отправьте услугу на проверку.`, [[{ text: 'Мои услуги', callback_data: 'prov_services:list' }]]);
    }
    const prompts = { date: 'Дата ужина в формате YYYY-MM-DD, например 2026-12-31.', adultPrice: 'Доплата за одного взрослого. Отправьте число, например 120.', childPrice: 'Доплата за одного ребёнка. 0 — бесплатно. «-» — цена уточняется.', currency: 'Валюта доплаты — USD, EUR или UZS.', childConditions: 'Укажите возраст и условия, например «6–12 лет; до 6 лет бесплатно». «-» — очистить.', notes: 'Дополнительные условия гала-ужина. «-» — очистить.' };
    if (Object.hasOwn(prompts, action)) {
      state.field = action;
      return reply(ctx, prompts[action], [[button(state, 'Назад к гала-ужину', 'back')]]);
    }
    return show(ctx, state);
  }
  return async (ctx, next) => {
    const data = String(ctx.callbackQuery?.data || '');
    ctx.session = ctx.session || {};
    if ((data && !data.startsWith('gala:')) || /^\/(start|menu|cancel)\b/.test(ctx.message?.text || '')) { ctx.session.galaFlow = null; return next(); }
    if (!data.startsWith('gala:') && !ctx.session.galaFlow) return next();
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    const actor = String(ctx.from?.id);
    const previous = running.get(actor) || Promise.resolve();
    const work = previous.catch(() => {}).then(async () => {
      try { await handle(ctx, data); }
      catch (error) {
        const state = ctx.session.galaFlow;
        await reply(ctx, `⚠️ ${error.code ? 'Не удалось сохранить гала-ужин. Попробуйте ещё раз.' : error.message}`, state ? [[button(state, 'Вернуться к полям', 'back')]] : [[{ text: 'Мои услуги', callback_data: 'prov_services:list' }]]);
      }
    });
    running.set(actor, work);
    try { await work; } finally { if (running.get(actor) === work) running.delete(actor); }
  };
}
module.exports = { createGalaDinnerFlow };
