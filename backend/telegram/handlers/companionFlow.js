const { randomBytes } = require('node:crypto');
const { resolveProviderByTelegramActorId } = require('../../utils/providerTelegramResolver');
const { readCompanionService, saveCompanion } = require('../../utils/companionService');
const { CATEGORIES, GENDERS, ROOMS, normalizeCompanion, normalizeCompanionPrices, companionText } = require('../../utils/companion');

function createCompanionFlow({ pool, resolve = resolveProviderByTelegramActorId, onDraftComplete = async () => {} }) {
  const running = new Map();
  const reply = (ctx, text, rows) => ctx.reply(text, { reply_markup: { inline_keyboard: rows } });
  const button = (state, text, action) => ({ text, callback_data: `comp:${action}:${state.serviceId}:${state.token}` });
  async function show(ctx, state) {
    state.field = null;
    const rows = [[button(state, 'Да, ищем попутчика', 'enabled'), button(state, state.value.enabled ? 'Попутчик найден — отключить' : 'Нет, поиск не нужен', 'disabled')]];
    if (state.value.enabled) {
      rows.push(...Object.entries(GENDERS).map(([key, label]) => [button(state, `${state.value.gender === key ? '✅ ' : ''}${label}`, `gender_${key}`)]));
      rows.push(...Object.entries(ROOMS).map(([key, label]) => [button(state, `${state.value.room === key ? '✅ ' : ''}${label}`, `room_${key}`)]));
      if (!state.draftMode) rows.push([button(state, 'Нетто за одного', 'netPrice'), button(state, 'Клиенту за одного', 'grossPrice')], [button(state, `${state.pricesConfirmed ? '✅ ' : ''}Подтверждаю: цены за одного`, 'confirm_prices')]);
      rows.push([button(state, 'Сколько человек ищут', 'count')], [button(state, 'Кто уже едет', 'travelers')], [button(state, 'Пожелания и что входит в цену', 'preferences')]);
    }
    rows.push([button(state, state.draftMode ? 'Продолжить — указать цену' : '💾 Сохранить поиск', 'save')]);
    rows.push([{ text: state.draftMode ? '⬅️ Назад' : 'Отмена — мои услуги', callback_data: state.draftMode ? 'svc_wiz:back' : 'prov_services:list' }]);
    await reply(ctx, `👥 Поиск попутчика\n\n${state.value.enabled ? companionText(state.value) : state.value.enabled === false ? 'Поиск попутчика отключён.' : 'Для этого предложения нужен попутчик?'}\n\n${state.value.enabled ? 'Выберите, кого ищут и как размещаются, затем заполните количество. Описание и пожелания необязательны. Цена услуги будет указана за одного попутчика.\n' : ''}${!state.draftMode && state.value.enabled ? `\nТекущие цены за одного: нетто ${state.prices.netPrice || 'не указана'}, клиенту ${state.prices.grossPrice || 'не указана'}. Если раньше цена была за весь номер / тур, измените её кнопками выше.\n` : ''}${state.draftMode ? 'После этого перейдём к цене.' : 'Изменения сохранятся в черновик для проверки. Сам тур или отель не архивируется.'}`, rows);
  }
  async function startDraft(ctx) {
    const draft = ctx.session?.serviceDraft;
    if (!draft || !CATEGORIES.has(draft.category)) return;
    ctx.session.galaFlow = null;
    ctx.session.correctionFlow = null;
    const state = { draftMode: true, serviceId: 0, token: randomBytes(5).toString('hex'), value: { count: 1, ...draft.companion } };
    ctx.session.companionFlow = state;
    return show(ctx, state);
  }
  async function handle(ctx, data) {
    if (ctx.chat?.type !== 'private' || String(ctx.chat.id) !== String(ctx.from?.id)) return ctx.reply('Откройте личный чат с ботом.');
    const provider = await resolve(pool, ctx.from.id, { action: 'companion', includeWebChatId: true });
    if (!provider?.id) return ctx.reply('Привяжите аккаунт поставщика через /start.');
    const [, action, id, token] = data.split(':');
    if (action === 'open') {
      const service = await readCompanionService(pool, provider.id, Number(id));
      if (service.status === 'pending' || service.moderation_status === 'pending' || ['archived', 'deleted'].includes(service.status)) return reply(ctx, 'Услуга на проверке или в архиве. Откройте актуальную карточку.', [[{ text: 'Открыть актуальную карточку', callback_data: `svc_current:${service.id}` }]]);
      ctx.session.galaFlow = null;
      ctx.session.correctionFlow = null;
      ctx.session.companionFlow = { serviceId: service.id, version: service.edit_version, token: randomBytes(5).toString('hex'), prices: { netPrice: service.details.netPrice ?? service.price ?? '', grossPrice: service.details.grossPrice ?? '' }, pricesConfirmed: false, value: { enabled: false, count: 1, ...service.details.companion } };
      return show(ctx, ctx.session.companionFlow);
    }
    const state = ctx.session.companionFlow;
    if (!state || (data && (Number(id) !== state.serviceId || token !== state.token))) return reply(ctx, 'Редактор устарел. Откройте поиск попутчика заново.', [[{ text: 'Мои услуги', callback_data: 'prov_services:list' }]]);
    if (state.draftMode && (!ctx.session.serviceDraft || !CATEGORIES.has(ctx.session.serviceDraft.category))) { ctx.session.companionFlow = null; return ctx.reply('Создание услуги завершено. Откройте актуальную карточку.'); }
    if (!data && state.field && ctx.message?.text) {
      const input = ctx.message.text.trim();
      if (input.length > (state.field === 'preferences' ? 1000 : 500)) return ctx.reply('Сократите текст и отправьте ещё раз.');
      if (state.field === 'count' && (!/^\d+$/.test(input) || Number(input) < 1 || Number(input) > 20)) return ctx.reply('Укажите количество от 1 до 20.');
      if (['netPrice', 'grossPrice'].includes(state.field)) { state.prices[state.field] = input; state.pricesConfirmed = false; }
      else state.value[state.field] = input === '-' ? '' : input;
      return show(ctx, state);
    }
    if (action === 'enabled') { state.value = { count: 1, ...state.value, enabled: true }; return show(ctx, state); }
    if (action === 'disabled') { state.value = { ...state.value, enabled: false }; return show(ctx, state); }
    if (action?.startsWith('gender_') && Object.hasOwn(GENDERS, action.slice(7))) { state.value.gender = action.slice(7); return show(ctx, state); }
    if (action?.startsWith('room_') && Object.hasOwn(ROOMS, action.slice(5))) { state.value.room = action.slice(5); return show(ctx, state); }
    if (action === 'confirm_prices' && !state.draftMode) { normalizeCompanionPrices(state.prices); state.pricesConfirmed = true; return show(ctx, state); }
    if (action === 'save') {
      const value = normalizeCompanion(state.value);
      if (state.draftMode) {
        ctx.session.serviceDraft.companion = value;
        ctx.session.companionFlow = null;
        return onDraftComplete(ctx);
      }
      if (value.enabled && !state.pricesConfirmed) throw new Error('Проверьте цены и нажмите «Подтверждаю: цены за одного».');
      await saveCompanion(pool, { providerId: provider.id, serviceId: state.serviceId, version: state.version, value, prices: state.prices });
      ctx.session.companionFlow = null;
      return reply(ctx, `✅ Условия поиска попутчика сохранены в услуге #${state.serviceId}.\nОткройте черновик или замечания и отправьте услугу на проверку. Тур / отель не архивирован.`, [[{ text: 'Мои услуги', callback_data: 'prov_services:list' }]]);
    }
    const prompts = { netPrice: 'Цена поставщика за ОДНОГО попутчика. Отправьте число, например 600.', grossPrice: 'Цена для клиента за ОДНОГО попутчика. Отправьте число, например 650.', count: 'Сколько попутчиков ищут? Отправьте число от 1 до 20.', travelers: 'Кто уже едет? Например: «Девушка, 28 лет». Без имени, телефона и других личных данных. «-» — не указывать.', preferences: 'Пожелания и что входит в цену за одного попутчика. Например: возраст, отношение к курению, перелёт и проживание. «-» — не указывать.' };
    if (state.value.enabled && Object.hasOwn(prompts, action)) { state.field = action; return reply(ctx, prompts[action], [[button(state, 'Назад к условиям', 'back')]]); }
    return show(ctx, state);
  }
  const middleware = async (ctx, next) => {
    const data = String(ctx.callbackQuery?.data || '');
    ctx.session = ctx.session || {};
    if ((data && !data.startsWith('comp:')) || /^\/(start|menu|cancel)\b/.test(ctx.message?.text || '')) { ctx.session.companionFlow = null; return next(); }
    if (!data.startsWith('comp:') && !ctx.session.companionFlow) return next();
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    const actor = String(ctx.from?.id);
    const previous = running.get(actor) || Promise.resolve();
    const work = previous.catch(() => {}).then(async () => {
      try { await handle(ctx, data); }
      catch (error) {
        const state = ctx.session.companionFlow;
        await reply(ctx, `⚠️ ${error.code ? 'Не удалось сохранить условия. Попробуйте ещё раз.' : error.message}`, state ? [[button(state, 'Вернуться к полям', 'back')]] : [[{ text: 'Мои услуги', callback_data: 'prov_services:list' }]]);
      }
    });
    running.set(actor, work);
    try { await work; } finally { if (running.get(actor) === work) running.delete(actor); }
  };
  middleware.startDraft = startDraft;
  return middleware;
}
module.exports = { createCompanionFlow };
