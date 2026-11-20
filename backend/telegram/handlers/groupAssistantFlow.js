const { startSearchUi, renderSearchUi, uiAction, uiText, uiIntent, inputPrompt } = require('../../ai/groupAssistantUi');
const { isTourRequest, isClarification, appendAutoText } = require('../../ai/groupAssistantAuto');
const { randomBytes } = require('node:crypto');
const { createGroupAssistantModel } = require('../../ai/groupAssistantModel');
const { createGroupAssistantStore } = require('../../ai/groupAssistantStore');
const { searchGroupOffers } = require('../../ai/groupAssistantSearch');
const { groupAssistantHelp } = require('../../ai/groupAssistantHelp');

function addressed(ctx) {
  const text = ctx.message?.text || '';
  const username = String(ctx.botInfo?.username || '').toLowerCase();
  const command = text.match(/^\/(ask|travella_help|travella_on|travella_off|travella_auto_on|travella_auto_off)(?:@([a-z0-9_]+))?(?:\s|$)/i);
  if (command) return !command[2] || command[2].toLowerCase() === username;
  if (username && new RegExp(`@${username}\\b`, 'i').test(text)) return true;
  return Boolean(ctx.message?.reply_to_message?.from?.id === ctx.botInfo?.id && text);
}
const words = {
  ru: { confirm: 'Правильно понял запрос?', destination: 'Куда', origin: 'Откуда', dates: 'Даты начала', any: 'любые', budget: 'Бюджет', person: 'за человека', total: 'за весь тур / номер', companion: 'Ищем попутчика', yes: '✅ Да, найти', no: 'Изменить', noOffers: 'Подходящих актуальных предложений с подтверждёнными условиями цены не нашёл. Можно изменить даты, бюджет или направление.', found: 'Нашёл в Travella', priceUnknown: 'Цена уточняется', unitUnknown: 'за сколько человек — нужно уточнить', open: 'Открыть карточку', female: 'Нужна попутчица', male: 'Нужен попутчик', anyGender: 'Попутчик без предпочтений', shared: 'Один номер', separate: 'Отдельные номера' },
  uz: { confirm: 'So‘rovni to‘g‘ri tushundimmi?', destination: 'Qayerga', origin: 'Qayerdan', dates: 'Boshlanish sanalari', any: 'istalgan', budget: 'Budjet', person: 'bir kishi uchun', total: 'butun tur / xona uchun', companion: 'Hamroh qidirish', yes: '✅ Ha, qidirish', no: 'O‘zgartirish', noOffers: 'Narx shartlari tasdiqlangan mos dolzarb taklif topilmadi. Sana, budjet yoki yo‘nalishni o‘zgartirish mumkin.', found: 'Travella takliflari', priceUnknown: 'Narxni aniqlashtiring', unitUnknown: 'necha kishi uchunligini aniqlashtiring', open: 'Kartani ochish', female: 'Ayol hamroh kerak', male: 'Erkak hamroh kerak', anyGender: 'Hamroh kerak, farqi yo‘q', shared: 'Bitta xona', separate: 'Alohida xonalar' },
  en: { confirm: 'Did I understand correctly?', destination: 'To', origin: 'From', dates: 'Start dates', any: 'any', budget: 'Budget', person: 'per person', total: 'whole tour / room', companion: 'Looking for a companion', yes: '✅ Yes, search', no: 'Change', noOffers: 'No current offers with confirmed matching price terms found. Try different dates, budget or destination.', found: 'Found on Travella', priceUnknown: 'Price to be confirmed', unitUnknown: 'confirm how many people the price covers', open: 'Open offer', female: 'Female companion needed', male: 'Male companion needed', anyGender: 'Companion needed, no preference', shared: 'Sharing a room', separate: 'Separate rooms' },
};
function summary(intent) {
  const w = words[intent.language] || words.ru, f = intent.filters;
  return [w.confirm, `${w.destination}: ${f.destination[0] || w.any}`, `${w.origin}: ${f.origin[0] || w.any}`, f.guests && `${{ru:'Взрослых',uz:'Kattalar',en:'Adults'}[intent.language] || 'Взрослых'}: ${f.guests}`, (f.excludeArab || f.excludedCountries?.length) && `${{ru:'Исключить',uz:'Istisno',en:'Exclude'}[intent.language] || 'Исключить'}: ${[f.excludeArab && ({ru:'арабские страны',uz:'arab mamlakatlari',en:'Arab countries'}[intent.language] || ''), ...(f.excludedCountries || [])].filter(Boolean).join(', ')}`, `${w.dates}: ${f.start || w.any}${f.end && f.end !== f.start ? ` — ${f.end}` : ''}`, f.budget !== null && `${w.budget}: ${f.budget} ${f.currency || '?'} · ${w[f.priceBasis] || '?'}`, f.budget !== null && ({ru: 'Это основная цена; возможные доплаты проверяйте в карточке.',uz: 'Bu asosiy narx; qo‘shimcha to‘lovlarni kartada tekshiring.',en: 'This is the base price; check supplements in the offer.'}[intent.language] || ''), f.companion && `${w.companion}${f.gender ? ` · ${{ female: w.female, male: w.male, any: w.anyGender }[f.gender]}` : ''}`].filter(Boolean).join('\n');
}
function displayText(value, max = 85) {
  const text = String(value || '').replace(/https?:\/\/\S+/gi, '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}
function offerDates(start, end) {
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
  const date = value => value.split('-').reverse().join('.');
  if (!valid(start)) return '';
  if (!valid(end) || end === start) return date(start);
  const first = start.slice(0, 4) === end.slice(0, 4) ? date(start).slice(0, 5) : date(start);
  return `${first} — ${date(end)}`;
}
function priceUnit(offer, language) {
  const w = words[language] || words.ru;
  if (offer.priceBasis === 'person') return w.person;
  if (offer.priceBasis !== 'total') return w.unitUnknown;
  if (offer.guests) return ({ ru: `за ${offer.guests} взрослых`, uz: `${offer.guests} katta kishi uchun`, en: `for ${offer.guests} adults` }[language] || `за ${offer.guests} взрослых`);
  const key = offer.category === 'refused_hotel' ? 'hotel' : ['refused_tour', 'author_tour'].includes(offer.category) ? 'tour' : 'service';
  return ({ ru: { hotel: 'за весь номер', tour: 'за весь тур', service: 'за услугу целиком' }, uz: { hotel: 'butun xona uchun', tour: 'butun tur uchun', service: 'butun xizmat uchun' }, en: { hotel: 'for the whole room', tour: 'for the whole tour', service: 'for the whole service' } }[language] || { hotel: 'за весь номер', tour: 'за весь тур', service: 'за услугу целиком' })[key];
}
function formatOffers(offers, language) {
  const w = words[language] || words.ru;
  if (!offers.length) return w.noOffers;
  const locale = { ru: 'ru-RU', uz: 'uz-UZ', en: 'en-US' }[language] || 'ru-RU';
  return `${w.found}: ${offers.length}\n\n` + offers.map((offer, i) => [
    `${i + 1}. ${displayText(offer.title) || '#' + offer.id}`,
    `📍 ${[displayText(offer.origin, 45), displayText(offer.destination, 45)].filter(Boolean).join(' → ')}`,
    offer.start && `📅 ${offerDates(offer.start, offer.end)}`,
    offer.price === null || !Number.isFinite(offer.price) ? `💰 ${w.priceUnknown}` : `💰 ${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(offer.price)} ${offer.currency} · ${priceUnit(offer, language)}`,
    offer.companion && `👥 ${{ female: w.female, male: w.male, any: w.anyGender }[offer.gender] || w.companion}${offer.room ? ` · ${w[offer.room] || ''}` : ''}`,
    offer.gala && `🎉 ${offer.gala.status === 'mandatory' ? ({ru:'Обязательная доплата',uz:'Majburiy qo‘shimcha to‘lov',en:'Mandatory supplement'}[language] || '') : ({ru:'Доплата по желанию',uz:'Ixtiyoriy to‘lov',en:'Optional supplement'}[language] || '')}: ${offer.gala.adultPrice} ${offer.gala.currency} / ${w.person}`,
  ].filter(line => line && line !== '📍 ').join('\n')).join('\n\n');
}
function offerButtons(offers, language) {
  const w = words[language] || words.ru;
  return offers.length ? { reply_markup: { inline_keyboard: offers.map((offer, i) => [{
    text: `${i + 1}. ${w.open} · #${offer.id}`,
    url: `https://travella.uz/marketplace?opened=${Number(offer.id)}`,
  }]) } } : {};
}
function clarification(intent) {
  const prompts = {
    ru: ['Какое направление ищем?', 'Уточните валюту и бюджет: за человека или за весь тур / номер?', 'Уточните направление, даты или бюджет.'],
    uz: ['Qaysi yo‘nalishni qidiramiz?', 'Valyutani aniqlashtiring. Budjet bir kishi uchunmi yoki butun tur / xona uchunmi?', 'Yo‘nalish, sana yoki budjetni aniqlashtiring.'],
    en: ['Which destination are you looking for?', 'What currency is the budget in, and is it per person or for the whole tour / room?', 'Please clarify the destination, dates or budget.'],
  };
  const f = intent.filters;
  return (prompts[intent.language] || prompts.ru)[!f.destination.length && !f.anyDestination ? 0 : f.budget !== null && (!f.currency || !f.priceBasis) ? 1 : 2];
}
function createGroupAssistantFlow({ pool, env = process.env, model = createGroupAssistantModel({ env }), store = createGroupAssistantStore(pool), search = filters => searchGroupOffers(pool, filters), now = Date.now } = {}) {
  const sessions = new Map(), busy = new Set(), rates = new Map(), autoEntries = new Map(), autoRates = new Map(), captureWork = new Map();
  const topic = ctx => { const message = ctx.message || ctx.callbackQuery?.message; return message?.is_topic_message ? message.message_thread_id || 0 : 0; };
  const key = ctx => `${ctx.chat.id}:${topic(ctx)}:${ctx.from.id}`;
  const reply = (ctx, text, extra = {}) => ctx.reply(text, {
    parse_mode: undefined, disable_web_page_preview: true,
    ...(ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true } } : {}),
    ...(topic(ctx) ? { message_thread_id: topic(ctx) } : {}), ...extra,
  });
  function prune() {
    for (const [id, value] of sessions) if (value.expires <= now()) sessions.delete(id);
    for (const [id, value] of autoEntries) if (value.expires <= now()) autoEntries.delete(id);
    for (const [id, value] of autoRates) if (value.at + 60000 <= now()) autoRates.delete(id);
    for (const [id, value] of rates) if (value.at + 60000 <= now()) rates.delete(id);
  }
  function limited(ctx) {
    prune();
    const ids = [`u:${ctx.from.id}`, `g:${ctx.chat.id}`];
    if (ids.some((id, index) => (rates.get(id)?.count || 0) >= (index ? 8 : 6)) || rates.size > 5000) return true;
    for (const id of ids) { const entry = rates.get(id) || { at: now(), count: 0 }; entry.count++; rates.set(id, entry); }
    return false;
  }
  async function admin(ctx) {
    try {
      const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
      return ['administrator', 'creator'].includes(member?.status);
    } catch {
      const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
      return admins.some(member => member.user?.id === ctx.from.id);
    }
  }
  async function showUi(ctx, state, error = '') {
    state.token = randomBytes(8).toString('hex'); state.pending = true; state.expires = now() + 15 * 60000;
    state.intent = uiIntent(state.ui);
    const view = renderSearchUi(state.ui, now());
    const text = error ? `⚠️ ${error}\n\n${view.text}` : view.text;
    const options = { reply_markup: { inline_keyboard: view.rows.map(row => row.map(b => ({ text: b.text, callback_data: `grp_ai:${b.action}:${state.token}` }))) } };
    if (ctx.callbackQuery && state.messageId && ctx.telegram?.editMessageText) {
      try { await ctx.telegram.editMessageText(ctx.chat.id, state.messageId, undefined, text, options); return; }
      catch (error) { if (String(error.message).includes('message is not modified')) return; }
    }
    if(state.messageId && ctx.telegram?.editMessageReplyMarkup) await ctx.telegram.editMessageReplyMarkup(ctx.chat.id,state.messageId,undefined,{inline_keyboard:[]}).catch(()=>{});
    const message = await reply(ctx, text, options); state.messageId = message?.message_id;
  }
  async function openUi(ctx, existing) {
    const id = key(ctx);
    const previous = sessions.get(id);
    if (previous?.autoEntry) previous.autoEntry.dismissed = true;
    autoEntries.delete(id);
    const state = { ui: startSearchUi(ctx.message?.message_id || ctx.callbackQuery?.message?.reply_to_message?.message_id), messageId: ctx.callbackQuery ? previous?.messageId : null };
    if (existing) { state.ui.filters = { ...existing }; state.ui.step = 'edit'; }
    sessions.set(id, state);
    return showUi(ctx, state);
  }
  async function askUiInput(ctx,state) {
    return reply(ctx,inputPrompt(state.ui.awaiting),{
      reply_markup:{force_reply:true,selective:true,input_field_placeholder:'Ваш вариант'},
      ...(state.ui.sourceMessageId ? {reply_parameters:{message_id:state.ui.sourceMessageId,allow_sending_without_reply:true}} : {}),
    });
  }
  async function acceptUiText(ctx,state,text) {
    const result=uiText(state.ui,text);
    if(result.error){await showUi(ctx,state,result.error);return askUiInput(ctx,state);}
    if(result.interpret){
      if(result.field==='full') return processQuestion(ctx,text,key(ctx));
      if(!model.ready())return showUi(ctx,state,'Подключение к ИИ сейчас недоступно.');
      const id=key(ctx);if(busy.has(id))return;busy.add(id);
      try{
        if(limited(ctx)||!await store.reserve(ctx.chat.id))return showUi(ctx,state,'Лимит запросов достигнут. Попробуйте позже.');
        if(ctx.sendChatAction)await ctx.sendChatAction('typing').catch(()=>{});
        const labels={destination:'Направление',origin:'Город вылета',dates:'Даты начала поездки'};
        const intent=await model.interpret(`Уточняю только поле «${labels[result.field]}»: ${text}. Остальные выбранные условия из previousFilters сохранить.`,state.ui.filters);
        if(result.field==='destination'){
          if(!intent.filters.destination.length&&!intent.filters.anyDestination){await showUi(ctx,state,'Уточните направление.');return askUiInput(ctx,state);}
          state.ui.filters.destination=intent.filters.destination;state.ui.filters.anyDestination=intent.filters.anyDestination;
        }else if(result.field==='origin'){
          if(!intent.filters.origin.length){await showUi(ctx,state,'Уточните город вылета.');return askUiInput(ctx,state);}
          state.ui.filters.origin=intent.filters.origin;
        }
        else if(result.field==='dates'){
          if(!intent.filters.start){await showUi(ctx,state,'Уточните даты поездки.');return askUiInput(ctx,state);}
          state.ui.filters.start=intent.filters.start;state.ui.filters.end=intent.filters.end;
        }
        state.ui.awaiting=null;
        // Advance through the same button path, preserving all other chosen fields.
        const field=result.field, f=state.ui.filters;
        if(state.ui.editing){state.ui.step='review';state.ui.editing=false;}
        else state.ui.step=field==='destination'?(f.category==='refused_hotel'?'dates':'origin'):field==='origin'?'dates':'guests';
      }finally{busy.delete(id);}
    }
    return showUi(ctx,state);
  }
  async function processQuestion(ctx, question, sessionKey, autoEntry = null) {
      if (!question) return openUi(ctx);
      if (question.length > 1500) return reply(ctx, 'Сократите запрос до 1500 символов.');
      if (!model.ready()) return reply(ctx, 'Подключение к ИИ сейчас недоступно. Попробуйте позже.');
      if (busy.has(sessionKey)) return;
      busy.add(sessionKey);
      try {
        if (limited(ctx) || sessions.size >= 1000 || !await store.reserve(ctx.chat.id)) return reply(ctx, 'Лимит запросов к помощнику достигнут. Попробуйте позже.');
        if(ctx.sendChatAction)await ctx.sendChatAction('typing').catch(()=>{});
        const previous = sessions.get(sessionKey);
        const revision = autoEntry?.revision;
        const intent = await model.interpret(question, previous?.autoEntry === autoEntry || !autoEntry ? previous?.intent?.filters || null : null);
        if (!await store.enabled(ctx.chat.id) || (autoEntry && !await store.autoEnabled?.(ctx.chat.id))) return;
        if (autoEntry && revision !== autoEntry.revision) return await publishInvitation(ctx, autoEntry, sessionKey);
        const state = { intent, autoEntry, expires: now() + 15 * 60000, pending: false };
        sessions.set(sessionKey, state);
        if (intent.kind === 'help') return reply(ctx, groupAssistantHelp(intent.language, intent.helpTopic));
        if (intent.kind === 'other') return reply(ctx, groupAssistantHelp(intent.language, 'support'));
        if (intent.kind === 'clarify' || (!intent.filters.destination.length && !intent.filters.anyDestination) || (intent.filters.budget !== null && (!intent.filters.currency || !intent.filters.priceBasis))) {
          const message = await reply(ctx, clarification(intent));
          if (autoEntry) autoEntry.messageId = message?.message_id;
          return;
        }
        state.token = randomBytes(8).toString('hex'); state.pending = true;
        const w = words[intent.language] || words.ru;
        const message = await reply(ctx, summary(intent), { reply_markup: { inline_keyboard: [[{ text: w.yes, callback_data: `grp_ai:search:${state.token}` }, { text: w.no, callback_data: `grp_ai:change:${state.token}` }]] } });
        state.messageId = message?.message_id;
        if (autoEntry) autoEntry.messageId = state.messageId;
      } finally { busy.delete(sessionKey); }
  }
  async function publishInvitation(ctx, entry, sessionKey) {
    const state = { autoEntry: entry, expires: entry.expires, pending: true, token: randomBytes(8).toString('hex') };
    const keyboard = { inline_keyboard: [[{ text: '🔎 Подобрать варианты?', callback_data: `grp_ai:auto:${state.token}` }], [{ text: 'Не предлагать', callback_data: `grp_ai:dismiss:${state.token}` }]] };
    const text = 'Вижу запрос на подбор тура. Могу поискать предложения в Travella.\n\nУточнения того же автора учту вместе. Запрос передам ИИ только после нажатия кнопки.';
    let message;
    if (entry.messageId && ctx.telegram?.editMessageText) {
      try { message = await ctx.telegram.editMessageText(ctx.chat.id, entry.messageId, undefined, text, { reply_markup: keyboard }); }
      catch {}
    }
    if (!message) message = await reply(ctx, text, { reply_markup: keyboard });
    entry.messageId = message?.message_id || entry.messageId;
    state.messageId = entry.messageId;
    entry.invitationPending = true;
    sessions.set(sessionKey, state);
  }
  async function captureAuto(ctx) {
    if (!ctx.message?.text) return;
    const id = key(ctx);
    const previous = captureWork.get(id) || Promise.resolve();
    const work = previous.catch(() => {}).then(() => captureAutoNow(ctx));
    captureWork.set(id, work);
    try { return await work; } finally { if (captureWork.get(id) === work) captureWork.delete(id); }
  }
  async function captureAutoNow(ctx) {
    const text = ctx.message?.text;
    if (!text || text.length > 1500 || ctx.message.forward_origin || ctx.message.forward_from || ctx.message.via_bot) return;
    prune();
    const sessionKey = key(ctx);
    if(sessions.get(sessionKey)?.ui)return;
    let entry = autoEntries.get(sessionKey);
    const candidate = isTourRequest(text);
    if ((!entry && !candidate) || (entry && !candidate && !isClarification(text)) || entry?.dismissed || !model.ready()) return;
    try {
      if (!await store.autoEnabled?.(ctx.chat.id)) return;
      if (!entry) {
        if (autoEntries.size >= 1000) return;
        const count = autoRates.get(ctx.chat.id) || { at: now(), count: 0 };
        if (count.count >= 2) return;
        count.count++; autoRates.set(ctx.chat.id, count);
        entry = { texts: [], messageIds: [], revision: 0, expires: now() + 15 * 60000 };
        autoEntries.set(sessionKey, entry);
      }
      appendAutoText(entry, text, ctx.message.message_id);
      if (entry.invitationPending || busy.has(sessionKey)) return;
      return await publishInvitation(ctx, entry, sessionKey);
    } catch { console.warn('[group-assistant] auto capture unavailable'); }
  }
  const middleware = async (ctx, next) => {
    if (!['group', 'supergroup'].includes(ctx.chat?.type)) return next();
    // Every group update stops here, before per-user private sessions and service editors.
    if (!ctx.from || ctx.from.is_bot || ctx.message?.sender_chat) return;
    const data = String(ctx.callbackQuery?.data || '');
    if (ctx.callbackQuery && !data.startsWith('grp_ai:')) return ctx.answerCbQuery('Откройте эту услугу в личном чате с ботом.').catch(() => {});
    prune();
    const uiInput = sessions.get(key(ctx))?.ui?.awaiting;
    if (!ctx.callbackQuery && !addressed(ctx) && !uiInput) return captureAuto(ctx);
    try {
      const username = ctx.botInfo?.username || env.TELEGRAM_CLIENT_BOT_USERNAME || 'bot';
      const text = String(ctx.message?.text || '');
      const command = text.match(/^\/(ask|travella_help|travella_on|travella_off|travella_auto_on|travella_auto_off)(?:@[a-z0-9_]+)?(?:\s|$)/i)?.[1]?.toLowerCase();
      if (command === 'travella_help') return reply(ctx, `Я помогаю искать предложения Travella и отвечаю на вопросы по платформе.\n\nВключить в этой группе: /travella_on@${username}\nОтключить: /travella_off@${username}\n\nОбращайтесь по @${username} или /ask@${username}. Например: «таш дубай декабр до 1000 USD за человека». Уточнения можно писать ответом на моё сообщение. Автоподбор обычных запросов: /travella_auto_on@${username} (администратор). Отключить автоподбор: /travella_auto_off@${username}. Документы и личные данные отправляйте только в личный чат.`);
      if (['travella_auto_on', 'travella_auto_off'].includes(command)) {
        if (!await admin(ctx)) return reply(ctx, 'Автоподбор включает и отключает администратор группы.');
        if (command === 'travella_auto_on' && !model.ready()) return reply(ctx, 'Подключение к ИИ сейчас недоступно.');
        await store.setAuto(ctx.chat.id, ctx.from.id, command === 'travella_auto_on');
        for (const id of autoEntries.keys()) if (id.startsWith(`${ctx.chat.id}:`)) autoEntries.delete(id);
        for (const [id, value] of sessions) if (id.startsWith(`${ctx.chat.id}:`) && value.autoEntry) sessions.delete(id);
        return reply(ctx, command === 'travella_auto_on' ? '✅ Автоподбор включён. Замечаю запросы на туры и предлагаю кнопку «Подобрать варианты?». Уточнения собираю только от автора. Передаю текст его запроса ИИ только после нажатия.\n\nЧтобы видеть обычные сообщения, бот должен быть администратором группы либо иметь выключенный Group Privacy у BotFather. Права удаления сообщений и блокировки участников не нужны.' : 'Автоподбор отключён. Поиск по команде /ask остаётся доступен.');
      }
      if (['travella_on', 'travella_off'].includes(command)) {
        if (!await admin(ctx)) return reply(ctx, 'Включить или отключить помощника может администратор группы.');
        if (command === 'travella_on' && !model.ready()) return reply(ctx, 'ИИ-помощник пока не подключён. Владелец Travella должен настроить подключение к ИИ на сервере.');
        await store.activate(ctx.chat.id, ctx.from.id, command === 'travella_on');
        for (const id of sessions.keys()) if (id.startsWith(`${ctx.chat.id}:`)) sessions.delete(id);
        for (const id of autoEntries.keys()) if (id.startsWith(`${ctx.chat.id}:`)) autoEntries.delete(id);
        return reply(ctx, command === 'travella_on' ? `✅ Помощник включён. Обращайтесь по @${username} или /ask@${username}. Отвечаю только на обращения ко мне и показываю публичные предложения Travella. Текст обращения обрабатывается ИИ; документы и личные данные присылайте в личный чат.` : 'Помощник отключён в этой группе.');
      }
      if (!await store.enabled(ctx.chat.id)) {
        if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
        return reply(ctx, `Помощник выключен. Администратор группы может включить его командой /travella_on@${username}.`);
      }
      prune();
      const sessionKey = key(ctx);
      if (busy.has(sessionKey)) { if (ctx.callbackQuery) await ctx.answerCbQuery('Уже обрабатываю запрос.').catch(() => {}); return; }
      if (ctx.callbackQuery) {
        const state = sessions.get(sessionKey);
        let [, action, token] = data.split(':');
        let uiSearch = false;
        if (!state?.pending || state.token !== token || state.messageId !== ctx.callbackQuery.message?.message_id) return ctx.answerCbQuery('Эта кнопка доступна автору запроса в течение 15 минут.').catch(() => {});
        if(action.startsWith('ui_')&&state.ui){
          if(!renderSearchUi(state.ui,now()).rows.flat().some(b=>b.action===action))return ctx.answerCbQuery('Выберите действие на текущем экране.').catch(()=>{});
          busy.add(sessionKey);let continueSearch=false;
          try{
            await ctx.answerCbQuery().catch(()=>{});
            const result=uiAction(state.ui,action,now());
            if(result.close){state.pending=false;state.ui=null;sessions.delete(sessionKey);return ctx.editMessageText('Подбор закрыт. Начать заново можно командой /ask.',{reply_markup:{inline_keyboard:[]}}).catch(()=>{});}
            if(result.search){state.intent=uiIntent(state.ui);action='search';uiSearch=true;continueSearch=true;}
            else{await showUi(ctx,state);if(result.input)await askUiInput(ctx,state);return;}
          }finally{if(!continueSearch)busy.delete(sessionKey);}
        }
        if (action === 'dismiss') {
          state.pending = false;
          if (state.autoEntry) state.autoEntry.dismissed = true;
          await ctx.answerCbQuery('Не буду предлагать подбор для этого запроса.').catch(() => {});
          return ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
        }
        if (action === 'auto' && state.autoEntry) {
          state.pending = false;
          state.autoEntry.invitationPending = false;
          await ctx.answerCbQuery().catch(() => {});
          await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
          return await processQuestion(ctx, state.autoEntry.texts.join('\n'), sessionKey, state.autoEntry);
        }
        if (action === 'change') { state.pending = false; await ctx.answerCbQuery().catch(() => {}); return openUi(ctx,state.intent.filters); }
        if (action !== 'search') return;
        busy.add(sessionKey);
        state.pending = false;
        try {
          if(!uiSearch)await ctx.answerCbQuery().catch(() => {});
          if(ctx.sendChatAction)await ctx.sendChatAction('typing').catch(()=>{});
          if(uiSearch&&ctx.editMessageText)await ctx.editMessageText('🔎 Ищу подходящие предложения…',{reply_markup:{inline_keyboard:[]}}).catch(()=>{});
          const offers = await search(state.intent.filters);
          await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
          if(uiSearch){
            const options=offerButtons(offers,state.intent.language);
            options.reply_markup=options.reply_markup||{inline_keyboard:[]};
            state.token=randomBytes(8).toString('hex');state.pending=true;state.ui.step='results';
            options.reply_markup.inline_keyboard.push([{text:'✏️ Изменить условия',callback_data:`grp_ai:ui_edit:${state.token}`},{text:'🔄 Новый поиск',callback_data:`grp_ai:ui_home:${state.token}`}]);
            if(ctx.telegram?.editMessageText){
              try{await ctx.telegram.editMessageText(ctx.chat.id,state.messageId,undefined,formatOffers(offers,state.intent.language),options);return;}catch{}
            }
            const message=await reply(ctx,formatOffers(offers,state.intent.language),options);state.messageId=message?.message_id;return;
          }
          return reply(ctx, formatOffers(offers, state.intent.language), offerButtons(offers, state.intent.language));
        } finally { busy.delete(sessionKey); }
      }
      const question = text.replace(/^\/ask(?:@[a-z0-9_]+)?\s*/i, '').replace(new RegExp(`@${username}\\b`, 'gi'), '').trim();
      const uiState=sessions.get(sessionKey);
      if(uiState?.ui?.awaiting && question) return await acceptUiText(ctx,uiState,question);
      return await processQuestion(ctx, question, sessionKey);
    } catch (error) {
      // Never log request bodies, credentials, raw group messages or private service data.
      console.warn('[group-assistant] request failed', { code: error.status || error.code || 'UNAVAILABLE' });
      const current=sessions.get(key(ctx));
      if(current?.ui){await showUi(ctx,current,'Не удалось выполнить действие. Попробуйте ещё раз.');if(current.ui.awaiting)return askUiInput(ctx,current);return;}
      return reply(ctx, 'Не удалось обработать запрос. Попробуйте чуть позже.');
    }
  };
  middleware.initialize = async () => {
    await store.initialize?.();
    await search({ destination: ['__travella_group_assistant_probe__'], origin: [], start: null, end: null, budget: null, currency: null, priceBasis: null, category: null, companion: false, gender: null, guests: 2, excludeArab: true, excludedCountries: ['Turkey'] });
  };
  return middleware;
}
module.exports = { createGroupAssistantFlow, addressed, summary, formatOffers, offerButtons };
