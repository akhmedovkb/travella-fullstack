const { randomBytes } = require('node:crypto');
const { createGroupAssistantModel } = require('../../ai/groupAssistantModel');
const { createGroupAssistantStore } = require('../../ai/groupAssistantStore');
const { searchGroupOffers } = require('../../ai/groupAssistantSearch');
const { groupAssistantHelp } = require('../../ai/groupAssistantHelp');

function addressed(ctx) {
  const text = ctx.message?.text || '';
  const username = String(ctx.botInfo?.username || '').toLowerCase();
  const command = text.match(/^\/(ask|travella_help|travella_on|travella_off)(?:@([a-z0-9_]+))?(?:\s|$)/i);
  if (command) return !command[2] || command[2].toLowerCase() === username;
  if (username && new RegExp(`@${username}\\b`, 'i').test(text)) return true;
  return Boolean(ctx.message?.reply_to_message?.from?.id === ctx.botInfo?.id && text);
}
const words = {
  ru: { confirm: 'Правильно понял запрос?', destination: 'Куда', origin: 'Откуда', dates: 'Даты начала', any: 'любые', budget: 'Бюджет', person: 'за человека', total: 'за весь тур / номер', companion: 'Ищем попутчика', yes: '✅ Да, найти', no: 'Изменить', noOffers: 'Подходящих актуальных предложений с подтверждёнными условиями цены не нашёл. Можно изменить даты, бюджет или направление.', found: 'Нашёл в Travella', priceUnknown: 'Цена уточняется', unitUnknown: 'условия цены уточняйте в карточке', open: 'Открыть карточку', female: 'Нужна попутчица', male: 'Нужен попутчик', anyGender: 'Попутчик без предпочтений', shared: 'Один номер', separate: 'Отдельные номера' },
  uz: { confirm: 'So‘rovni to‘g‘ri tushundimmi?', destination: 'Qayerga', origin: 'Qayerdan', dates: 'Boshlanish sanalari', any: 'istalgan', budget: 'Budjet', person: 'bir kishi uchun', total: 'butun tur / xona uchun', companion: 'Hamroh qidirish', yes: '✅ Ha, qidirish', no: 'O‘zgartirish', noOffers: 'Narx shartlari tasdiqlangan mos dolzarb taklif topilmadi. Sana, budjet yoki yo‘nalishni o‘zgartirish mumkin.', found: 'Travella takliflari', priceUnknown: 'Narxni aniqlashtiring', unitUnknown: 'narx shartlarini kartada tekshiring', open: 'Kartani ochish', female: 'Ayol hamroh kerak', male: 'Erkak hamroh kerak', anyGender: 'Hamroh kerak, farqi yo‘q', shared: 'Bitta xona', separate: 'Alohida xonalar' },
  en: { confirm: 'Did I understand correctly?', destination: 'To', origin: 'From', dates: 'Start dates', any: 'any', budget: 'Budget', person: 'per person', total: 'whole tour / room', companion: 'Looking for a companion', yes: '✅ Yes, search', no: 'Change', noOffers: 'No current offers with confirmed matching price terms found. Try different dates, budget or destination.', found: 'Found on Travella', priceUnknown: 'Price to be confirmed', unitUnknown: 'confirm price basis in the card', open: 'Open offer', female: 'Female companion needed', male: 'Male companion needed', anyGender: 'Companion needed, no preference', shared: 'Sharing a room', separate: 'Separate rooms' },
};
function summary(intent) {
  const w = words[intent.language] || words.ru, f = intent.filters;
  return [w.confirm, `${w.destination}: ${f.destination[0] || w.any}`, `${w.origin}: ${f.origin[0] || w.any}`, `${w.dates}: ${f.start || w.any}${f.end && f.end !== f.start ? ` — ${f.end}` : ''}`, f.budget !== null && `${w.budget}: ${f.budget} ${f.currency || '?'} · ${w[f.priceBasis] || '?'}`, f.budget !== null && ({ru: 'Это основная цена; возможные доплаты проверяйте в карточке.',uz: 'Bu asosiy narx; qo‘shimcha to‘lovlarni kartada tekshiring.',en: 'This is the base price; check supplements in the offer.'}[intent.language] || ''), f.companion && `${w.companion}${f.gender ? ` · ${{ female: w.female, male: w.male, any: w.anyGender }[f.gender]}` : ''}`].filter(Boolean).join('\n');
}
function formatOffers(offers, language) {
  const w = words[language] || words.ru;
  if (!offers.length) return w.noOffers;
  return `${w.found}:\n\n` + offers.map((offer, i) => [
    `${i + 1}. #${offer.id} · ${offer.title}`,
    [offer.origin, offer.destination].filter(Boolean).join(' → '),
    offer.start && `${offer.start}${offer.end ? ` — ${offer.end}` : ''}`,
    offer.price === null ? w.priceUnknown : `${offer.price} ${offer.currency} · ${w[offer.priceBasis] || w.unitUnknown}`,
    offer.companion && `${{ female: w.female, male: w.male, any: w.anyGender }[offer.gender] || w.companion}${offer.room ? ` · ${w[offer.room] || ''}` : ''}`,
    offer.gala && `🎉 ${offer.gala.status === 'mandatory' ? ({ru:'Обязательная доплата',uz:'Majburiy qo‘shimcha to‘lov',en:'Mandatory supplement'}[language] || '') : ({ru:'Доплата по желанию',uz:'Ixtiyoriy to‘lov',en:'Optional supplement'}[language] || '')}: ${offer.gala.adultPrice} ${offer.gala.currency} / ${w.person}`,
    offer.url,
  ].filter(Boolean).join('\n')).join('\n\n');
}
function clarification(intent) {
  const prompts = {
    ru: ['Какое направление ищем?', 'Уточните валюту и бюджет: за человека или за весь тур / номер?', 'Уточните направление, даты или бюджет.'],
    uz: ['Qaysi yo‘nalishni qidiramiz?', 'Valyutani aniqlashtiring. Budjet bir kishi uchunmi yoki butun tur / xona uchunmi?', 'Yo‘nalish, sana yoki budjetni aniqlashtiring.'],
    en: ['Which destination are you looking for?', 'What currency is the budget in, and is it per person or for the whole tour / room?', 'Please clarify the destination, dates or budget.'],
  };
  const f = intent.filters;
  return (prompts[intent.language] || prompts.ru)[!f.destination.length ? 0 : f.budget !== null && (!f.currency || !f.priceBasis) ? 1 : 2];
}
function createGroupAssistantFlow({ pool, env = process.env, model = createGroupAssistantModel({ env }), store = createGroupAssistantStore(pool), search = filters => searchGroupOffers(pool, filters), now = Date.now } = {}) {
  const sessions = new Map(), busy = new Set(), rates = new Map();
  const key = ctx => `${ctx.chat.id}:${ctx.message?.message_thread_id || ctx.callbackQuery?.message?.message_thread_id || 0}:${ctx.from.id}`;
  const reply = (ctx, text, extra = {}) => ctx.reply(text, {
    parse_mode: undefined, disable_web_page_preview: true,
    ...(ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true } } : {}),
    ...(ctx.message?.message_thread_id || ctx.callbackQuery?.message?.message_thread_id ? { message_thread_id: ctx.message?.message_thread_id || ctx.callbackQuery?.message?.message_thread_id } : {}), ...extra,
  });
  function prune() {
    for (const [id, value] of sessions) if (value.expires <= now()) sessions.delete(id);
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
  const middleware = async (ctx, next) => {
    if (!['group', 'supergroup'].includes(ctx.chat?.type)) return next();
    // Every group update stops here, before per-user private sessions and service editors.
    if (!ctx.from || ctx.from.is_bot || ctx.message?.sender_chat) return;
    const data = String(ctx.callbackQuery?.data || '');
    if (ctx.callbackQuery && !data.startsWith('grp_ai:')) return ctx.answerCbQuery('Откройте эту услугу в личном чате с ботом.').catch(() => {});
    if (!ctx.callbackQuery && !addressed(ctx)) return;
    try {
      const username = ctx.botInfo?.username || env.TELEGRAM_CLIENT_BOT_USERNAME || 'bot';
      const text = String(ctx.message?.text || '');
      const command = text.match(/^\/(ask|travella_help|travella_on|travella_off)(?:@[a-z0-9_]+)?(?:\s|$)/i)?.[1]?.toLowerCase();
      if (command === 'travella_help') return reply(ctx, `Я помогаю искать предложения Travella и отвечаю на вопросы по платформе.\n\nВключить в этой группе: /travella_on@${username}\nОтключить: /travella_off@${username}\n\nОбращайтесь по @${username} или /ask@${username}. Например: «таш дубай декабр до 1000 USD за человека». Уточнения можно писать ответом на моё сообщение. Документы и личные данные отправляйте только в личный чат.`);
      if (['travella_on', 'travella_off'].includes(command)) {
        if (!await admin(ctx)) return reply(ctx, 'Включить или отключить помощника может администратор группы.');
        if (command === 'travella_on' && !model.ready()) return reply(ctx, 'ИИ-помощник пока не подключён. Владелец Travella должен настроить подключение к ИИ на сервере.');
        await store.activate(ctx.chat.id, ctx.from.id, command === 'travella_on');
        for (const id of sessions.keys()) if (id.startsWith(`${ctx.chat.id}:`)) sessions.delete(id);
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
        const [, action, token] = data.split(':');
        if (!state?.pending || state.token !== token || state.messageId !== ctx.callbackQuery.message?.message_id) return ctx.answerCbQuery('Эта кнопка доступна автору запроса в течение 15 минут.').catch(() => {});
        await ctx.answerCbQuery().catch(() => {});
        if (action === 'change') { state.pending = false; return reply(ctx, 'Напишите уточнение ответом на это сообщение или снова обратитесь ко мне по @имени.'); }
        if (action !== 'search') return;
        busy.add(sessionKey);
        try {
          state.pending = false;
          const offers = await search(state.intent.filters);
          await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
          return reply(ctx, formatOffers(offers, state.intent.language));
        } finally { busy.delete(sessionKey); }
      }
      const question = text.replace(/^\/ask(?:@[a-z0-9_]+)?\s*/i, '').replace(new RegExp(`@${username}\\b`, 'gi'), '').trim();
      if (!question) return reply(ctx, groupAssistantHelp('ru', 'search'));
      if (question.length > 1500) return reply(ctx, 'Сократите запрос до 1500 символов.');
      if (!model.ready()) return reply(ctx, 'Подключение к ИИ сейчас недоступно. Попробуйте позже.');
      if (limited(ctx) || sessions.size >= 1000 || !await store.reserve(ctx.chat.id)) return reply(ctx, 'Лимит запросов к помощнику достигнут. Попробуйте позже.');
      busy.add(sessionKey);
      try {
        const previous = sessions.get(sessionKey);
        const intent = await model.interpret(question, previous?.intent?.filters || null);
        const state = { intent, expires: now() + 15 * 60000, pending: false };
        sessions.set(sessionKey, state);
        if (intent.kind === 'help') return reply(ctx, groupAssistantHelp(intent.language, intent.helpTopic));
        if (intent.kind === 'other') return reply(ctx, groupAssistantHelp(intent.language, 'support'));
        if (intent.kind === 'clarify' || !intent.filters.destination.length || (intent.filters.budget !== null && (!intent.filters.currency || !intent.filters.priceBasis))) {
          return reply(ctx, clarification(intent));
        }
        state.token = randomBytes(8).toString('hex'); state.pending = true;
        const w = words[intent.language] || words.ru;
        const message = await reply(ctx, summary(intent), { reply_markup: { inline_keyboard: [[{ text: w.yes, callback_data: `grp_ai:search:${state.token}` }, { text: w.no, callback_data: `grp_ai:change:${state.token}` }]] } });
        state.messageId = message?.message_id;
      } finally { busy.delete(sessionKey); }
    } catch (error) {
      // Never log request bodies, credentials, raw group messages or private service data.
      console.warn('[group-assistant] request failed', { code: error.status || error.code || 'UNAVAILABLE' });
      return reply(ctx, 'Не удалось обработать запрос. Попробуйте чуть позже.');
    }
  };
  middleware.initialize = async () => {
    await store.initialize?.();
    await search({ destination: ['__travella_group_assistant_probe__'], origin: [], start: null, end: null, budget: null, currency: null, priceBasis: null, category: null, companion: false, gender: null });
  };
  return middleware;
}
module.exports = { createGroupAssistantFlow, addressed, summary, formatOffers };
