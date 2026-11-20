const { randomBytes } = require('node:crypto');
const { resolveProviderByTelegramActorId } = require('../../utils/providerTelegramResolver');
const { readCompanionService, saveCompanion } = require('../../utils/companionService');
const { CATEGORIES, GENDERS, ROOMS, normalizeCompanion, normalizeCompanionPrices, companionText } = require('../../utils/companion');

const STEPS = ['enabled', 'gender', 'room', 'count', 'travelers', 'preferences', 'review'];
function createCompanionFlow({ pool, resolve = resolveProviderByTelegramActorId, onDraftComplete = async () => {} }) {
  const running = new Map();
  const token = () => randomBytes(5).toString('hex');
  const button = (state, text, action) => ({ text, callback_data: `comp:${action}:${state.serviceId}:${state.token}` });
  const reply = (ctx, text, rows) => ctx.reply(text, { reply_markup: { inline_keyboard: rows } });
  async function clearButtons(ctx, state) {
    if (state?.messageId && ctx.telegram?.editMessageReplyMarkup) {
      await ctx.telegram.editMessageReplyMarkup(ctx.chat.id, state.messageId, undefined, { inline_keyboard: [] }).catch(() => {});
    }
  }
  async function render(ctx, state, text, rows) {
    const options = { reply_markup: { inline_keyboard: rows } };
    // Button choices update the same prompt. Text answers get a new prompt below the answer.
    if (ctx.callbackQuery && state.messageId && ctx.telegram?.editMessageText) {
      try { await ctx.telegram.editMessageText(ctx.chat.id, state.messageId, undefined, text, options); return; }
      catch (error) { if (String(error.message).includes('message is not modified')) return; }
    }
    await clearButtons(ctx, state);
    const message = await ctx.reply(text, options);
    state.messageId = message?.message_id;
  }
  function navigation(state) {
    if (!state.draftMode) return [[button(state, '⬅️ К условиям', 'menu')]];
    return [[state.step === 'enabled' ? { text: '⬅️ Назад', callback_data: 'svc_wiz:back' } : button(state, '⬅️ Назад', 'previous'), { text: '❌ Отмена', callback_data: 'svc_wiz:cancel' }]];
  }
  async function show(ctx, state, error = '') {
    state.token = token();
    state.field = null;
    state.step = state.step || (state.draftMode ? 'enabled' : 'menu');
    const b = (text, action) => button(state, text, action);
    let text;
    let rows;
    if (state.step === 'menu') {
      text = state.value.enabled ? companionText(state.value) : '👥 Поиск попутчика отключён.';
      rows = state.value.enabled ? [
        [b('Кого ищем', 'gender'), b('Размещение', 'room')],
        [b('Количество', 'count'), b('Кто уже едет', 'travelers')],
        [b('Пожелания / что входит', 'preferences')],
        [b('Нетто за одного', 'netPrice'), b('Клиенту за одного', 'grossPrice')],
        [b(`${state.pricesConfirmed ? '✅' : '☑️'} Цены указаны за одного`, 'confirm_prices')],
        [b('💾 Сохранить', 'save')],
        [b('Попутчик найден — отключить', 'disabled')],
      ] : [[b('Начать поиск попутчика', 'enabled')], [b('💾 Сохранить', 'save')]];
      if (state.value.enabled) text += `\n\nНетто: ${state.prices.netPrice || 'не указана'} · Клиенту: ${state.prices.grossPrice || 'не указана'}\nПроверьте, что обе цены — за одного человека.`;
      text += '\n\nИзменения сохранятся в черновик для проверки.';
      rows.push([{ text: 'Отмена — мои услуги', callback_data: 'prov_services:list' }]);
    } else if (state.step === 'enabled') {
      text = '👥 Для этого предложения нужен попутчик?';
      rows = [[b('Да, нужен', 'enabled'), b('Нет', 'disabled')], ...navigation(state)];
    } else if (state.step === 'gender') {
      text = '👥 Кого ищем?';
      rows = [[b('Мужчину', 'gender_male'), b('Женщину', 'gender_female')], [b('Без предпочтений', 'gender_any')], ...navigation(state)];
    } else if (state.step === 'room') {
      text = '🛏 Как будет размещаться попутчик?';
      rows = [[b('В одном номере', 'room_shared')], [b('В отдельном номере', 'room_separate')], ...navigation(state)];
    } else if (state.step === 'count') {
      state.field = 'count';
      text = '👥 Сколько попутчиков ищете?\nВыберите число или отправьте своё — от 1 до 20.';
      rows = [[b('1', 'count_1'), b('2', 'count_2'), b('3', 'count_3')], ...navigation(state)];
    } else if (state.step === 'travelers') {
      state.field = 'travelers';
      text = '👤 Кто уже едет?\nНапример: «Девушка, 28 лет». Без имени и контактов.\nЭто необязательно.';
      rows = [[b('Не указывать', 'skip')], ...navigation(state)];
    } else if (state.step === 'preferences') {
      state.field = 'preferences';
      text = '📝 Есть пожелания или пояснение, что входит в цену?\nНапример: «Не курит. Перелёт и проживание включены».\nЭто необязательно.';
      rows = [[b('Не указывать', 'skip')], ...navigation(state)];
    } else if (['netPrice', 'grossPrice'].includes(state.step)) {
      state.field = state.step;
      text = `${state.step === 'netPrice' ? 'Цена поставщика' : 'Цена для клиента'} за одного попутчика.\nОтправьте число, например ${state.step === 'netPrice' ? '600' : '650'}.`;
      rows = navigation(state);
    } else {
      text = `${companionText(state.value)}\n\nДалее укажите цену за одного человека.`;
      rows = [[b('✅ Всё верно — к цене', 'save')], ...navigation(state)];
    }
    return render(ctx, state, error ? `⚠️ ${error}\n\n${text}` : text, rows);
  }
  async function startDraft(ctx) {
    const draft = ctx.session?.serviceDraft;
    if (!draft || !CATEGORIES.has(draft.category)) return;
    ctx.session.galaFlow = null;
    ctx.session.correctionFlow = null;
    const state = { draftMode: true, serviceId: 0, step: 'enabled', token: token(), value: { count: 1, ...draft.companion } };
    ctx.session.companionFlow = state;
    // Telegram cannot remove a reply keyboard and attach inline buttons in the same message.
    await ctx.reply('👥 Настроим поиск попутчика.', { reply_markup: { remove_keyboard: true } });
    return show(ctx, state);
  }
  async function finishDraft(ctx, state) {
    ctx.session.serviceDraft.companion = normalizeCompanion(state.value);
    await clearButtons(ctx, state);
    ctx.session.companionFlow = null;
    return onDraftComplete(ctx);
  }
  function advance(state, field) {
    state.step = state.draftMode ? STEPS[STEPS.indexOf(field) + 1] : 'menu';
  }
  async function handle(ctx, data) {
    if (ctx.chat?.type !== 'private' || String(ctx.chat.id) !== String(ctx.from?.id)) return ctx.reply('Откройте личный чат с ботом.');
    const provider = await resolve(pool, ctx.from.id, { action: 'companion', includeWebChatId: true });
    if (!provider?.id) return ctx.reply('Привяжите аккаунт поставщика через /start.');
    const [, action, id, callbackToken] = data.split(':');
    if (action === 'open') {
      const service = await readCompanionService(pool, provider.id, Number(id));
      if (service.status === 'pending' || service.moderation_status === 'pending' || ['archived', 'deleted'].includes(service.status)) return reply(ctx, 'Услуга на проверке или в архиве. Откройте актуальную карточку.', [[{ text: 'Открыть актуальную карточку', callback_data: `svc_current:${service.id}` }]]);
      ctx.session.galaFlow = null;
      ctx.session.correctionFlow = null;
      const state = { serviceId: service.id, version: service.edit_version, step: 'menu', token: token(), prices: { netPrice: service.details.netPrice ?? service.price ?? '', grossPrice: service.details.grossPrice ?? '' }, pricesConfirmed: false, value: { enabled: false, count: 1, ...service.details.companion } };
      ctx.session.companionFlow = state;
      await ctx.reply(`👥 Условия поиска · услуга #${service.id}`, { reply_markup: { remove_keyboard: true } });
      return show(ctx, state);
    }
    const state = ctx.session.companionFlow;
    if (!state) return reply(ctx, 'Эта кнопка устарела. Продолжите создание из черновика или откройте услугу заново.', [[{ text: 'Мои услуги', callback_data: 'prov_services:list' }]]);
    if (data && (Number(id) !== state.serviceId || callbackToken !== state.token)) return; // The current prompt already has the valid buttons.
    if (state.draftMode && (!ctx.session.serviceDraft || !CATEGORIES.has(ctx.session.serviceDraft.category))) { ctx.session.companionFlow = null; return ctx.reply('Создание услуги завершено. Откройте актуальную карточку.'); }
    if (!data && state.field && ctx.message?.text) {
      const input = ctx.message.text.trim();
      if (input.length > (state.field === 'preferences' ? 1000 : 500)) return show(ctx, state, 'Сократите текст и отправьте ещё раз.');
      if (state.field === 'count' && (!/^\d+$/.test(input) || Number(input) < 1 || Number(input) > 20)) return show(ctx, state, 'Укажите количество от 1 до 20.');
      if (['netPrice', 'grossPrice'].includes(state.field)) { state.prices[state.field] = input; state.pricesConfirmed = false; }
      else state.value[state.field] = input === '-' ? '' : input;
      advance(state, state.field);
      return show(ctx, state);
    }
    if (action === 'enabled') { state.value = { count: 1, ...state.value, enabled: true }; state.step = 'gender'; return show(ctx, state); }
    if (action === 'disabled') {
      state.value = { ...state.value, enabled: false };
      if (state.draftMode) return finishDraft(ctx, state);
      state.step = 'menu'; return show(ctx, state);
    }
    if (action?.startsWith('gender_') && Object.hasOwn(GENDERS, action.slice(7))) { state.value.gender = action.slice(7); advance(state, 'gender'); return show(ctx, state); }
    if (action?.startsWith('room_') && Object.hasOwn(ROOMS, action.slice(5))) { state.value.room = action.slice(5); advance(state, 'room'); return show(ctx, state); }
    if (/^count_[123]$/.test(action || '')) { state.value.count = Number(action.slice(6)); advance(state, 'count'); return show(ctx, state); }
    if (action === 'skip' && ['travelers', 'preferences'].includes(state.step)) { state.value[state.step] = ''; advance(state, state.step); return show(ctx, state); }
    if (action === 'previous' && state.draftMode) { state.step = STEPS[Math.max(0, STEPS.indexOf(state.step) - 1)]; return show(ctx, state); }
    if (action === 'confirm_prices' && !state.draftMode) { normalizeCompanionPrices(state.prices); state.pricesConfirmed = true; return show(ctx, state); }
    if (action === 'save') {
      if (state.draftMode) {
        if (state.value.enabled && state.step !== 'review') return show(ctx, state);
        return finishDraft(ctx, state);
      }
      const value = normalizeCompanion(state.value);
      if (value.enabled && !state.pricesConfirmed) throw new Error('Проверьте цены и нажмите «Цены указаны за одного».');
      await saveCompanion(pool, { providerId: provider.id, serviceId: state.serviceId, version: state.version, value, prices: state.prices });
      await clearButtons(ctx, state);
      ctx.session.companionFlow = null;
      return reply(ctx, `✅ Условия сохранены в услуге #${state.serviceId}.\nОткройте черновик или замечания и отправьте услугу на проверку.`, [[{ text: 'Мои услуги', callback_data: 'prov_services:list' }]]);
    }
    if (action === 'menu' && !state.draftMode) { state.step = 'menu'; return show(ctx, state); }
    if (!state.draftMode && state.value.enabled && ['gender', 'room', 'count', 'travelers', 'preferences', 'netPrice', 'grossPrice'].includes(action)) { state.step = action; return show(ctx, state); }
    return show(ctx, state);
  }
  const middleware = async (ctx, next) => {
    const data = String(ctx.callbackQuery?.data || '');
    ctx.session = ctx.session || {};
    if ((data && !data.startsWith('comp:')) || /^\/(start|menu|cancel)\b/.test(ctx.message?.text || '')) { await clearButtons(ctx, ctx.session.companionFlow); ctx.session.companionFlow = null; return next(); }
    if (!data.startsWith('comp:') && !ctx.session.companionFlow) return next();
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    const actor = String(ctx.from?.id);
    const previous = running.get(actor) || Promise.resolve();
    const work = previous.catch(() => {}).then(async () => {
      try { await handle(ctx, data); }
      catch (error) {
        const message = error.code ? 'Не удалось сохранить условия. Попробуйте ещё раз.' : error.message;
        const state = ctx.session.companionFlow;
        if (state) await show(ctx, state, message);
        else await reply(ctx, `⚠️ ${message}`, [[{ text: 'Мои услуги', callback_data: 'prov_services:list' }]]);
      }
    });
    running.set(actor, work);
    try { await work; } finally { if (running.get(actor) === work) running.delete(actor); }
  };
  middleware.startDraft = startDraft;
  return middleware;
}
module.exports = { createCompanionFlow };
