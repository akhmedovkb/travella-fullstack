const { normalizeIntent } = require('./groupAssistantModel');
const EMPTY = { destination: [], origin: [], anyDestination: false, guests: null, excludedCountries: [], excludeArab: false, start: null, end: null, budget: null, currency: null, priceBasis: null, category: null, companion: false, gender: null };
const DESTINATIONS = { turkey: ['Турция','Turkey','Turkiya'], uae: ['ОАЭ','UAE','United Arab Emirates'], vietnam: ['Вьетнам','Vietnam','Vyetnam'] };
const ORIGINS = { tashkent: ['Ташкент','Tashkent','Toshkent'], samarkand: ['Самарканд','Samarkand','Samarqand'] };
function today(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const get = type => parts.find(x => x.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
const shift = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0,10);
function dateChoice(choice, now) {
  const date = today(now);
  if (choice === 'tomorrow') return [shift(date, 1), shift(date, 1)];
  if (choice === 'weekend') { const day = new Date(date + 'T00:00:00Z').getUTCDay(); const first = shift(date, (6 - day + 7) % 7); return [first, shift(first, 1)]; }
  if (choice === 'month') {
    const d = new Date(date + 'T00:00:00Z');
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 1));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+2, 0));
    return [first.toISOString().slice(0,10), last.toISOString().slice(0,10)];
  }
  return [null, null];
}
const humanDate = value => value ? value.split('-').reverse().join('.') : '';
function steps(ui) { return [...(ui.filters.companion ? ['gender'] : []), 'destination', ...(ui.filters.category === 'refused_hotel' ? [] : ['origin']), 'dates', 'guests', 'budget']; }
function next(ui, field) { ui.awaiting = null; ui.step = ui.editing ? 'review' : steps(ui)[steps(ui).indexOf(field)+1] || 'review'; ui.editing = false; }
function startSearchUi(sourceMessageId) { return { step: 'home', filters: { ...EMPTY }, sourceMessageId, awaiting: null }; }
function selections(f) {
  return [f.destination.length || f.anyDestination ? `✓ ${f.destination[0] || 'Любое направление'}` : '', f.origin.length ? `✓ Из ${f.origin[0]}` : '', f.start ? `✓ ${humanDate(f.start)}${f.end && f.end !== f.start ? ' — ' + humanDate(f.end) : ''}` : '', f.guests ? `✓ Взрослых: ${f.guests}` : '', f.budget !== null ? `✓ До ${f.budget} ${f.currency}${f.priceBasis ? (f.priceBasis === 'person' ? ' за человека' : ' на всех') : ''}` : '', f.companion ? `✓ ${f.gender === 'female' ? 'Ищем попутчицу' : f.gender === 'male' ? 'Ищем попутчика' : 'Поиск попутчика'}` : ''].filter(Boolean).join('\n');
}
function renderSearchUi(ui, now = Date.now()) {
  const b = (text, action) => ({ text, action: `ui_${action}` });
  const nav = [[b('← Назад', 'back'), b('✕ Закрыть', 'close')]];
  const f = ui.filters;
  let text, rows;
  if (ui.awaiting) return { text: '✍️ Свой вариант\n\n' + inputPrompt(ui.awaiting) + '\n\nОтветьте на отдельное сообщение ниже.', rows: nav };
  if (ui.step === 'home') return { text: '✈️ Найдём подходящий тур\n\nВыберите, что ищете, или ответьте на это сообщение пожеланиями.\nНапример: «На двоих, на выходные, до 1000 $».', rows: [[b('🔎 Подобрать тур','tour')], [b('👥 Найти попутчика','companion'),b('🏨 Найти отель','hotel')], [b('💡 Примеры запросов','examples')]] };
  if (ui.step === 'results') return { text: 'Подбор завершён. Можно начать новый поиск.', rows: [[b('✏️ Изменить условия','edit'),b('🔄 Новый поиск','home')]] };
  if (ui.step === 'examples') return { text: '💡 Можно написать по-своему\n\n«Ташкент — Дубай, декабрь, до 1000 USD за человека»\n«На завтра–послезавтра, на двоих, до 1000 $ на всех»\n«Нужна попутчица в Турцию»\n\nПонимаю опечатки, русский и узбекский.', rows: [[b('✍️ Написать запрос','custom_full')], [b('← К выбору','home')]] };
  if (ui.step === 'edit') return { text: 'Что изменить?\n\n' + selections(f), rows: [[b('🌍 Направление','edit_destination'),b('📅 Даты','edit_dates')], [b('👤 Туристы','edit_guests'),b('💰 Бюджет','edit_budget')], ...(f.category !== 'refused_hotel' ? [[b('✈️ Откуда','edit_origin')]] : []), ...(f.companion ? [[b('👥 Кого ищем','edit_gender')]] : []), [b('← К сводке','review')]] };
  if (ui.step === 'review') {
    text = '✅ Проверьте условия\n\n' + [
      `🌍 ${f.destination[0] || 'Любое направление'}`,
      f.category !== 'refused_hotel' && `✈️ Откуда: ${f.origin[0] || 'Любой город'}`,
      `📅 ${f.start ? humanDate(f.start) + (f.end && f.end !== f.start ? ' — ' + humanDate(f.end) : '') : 'Любые даты'}`,
      `👤 ${f.guests ? f.guests + ' взрослых, без детей' : 'Количество взрослых не задано'}`,
      `💰 ${f.budget !== null ? 'До ' + f.budget + ' ' + f.currency + (f.priceBasis === 'person' ? ' за человека' : ' на всех') : 'Без ограничения бюджета'}`,
      f.companion && `👥 ${f.gender === 'female' ? 'Попутчица' : f.gender === 'male' ? 'Попутчик' : 'Без предпочтений'}`,
      f.excludeArab && 'Исключены арабские страны',
      f.excludedCountries.length && 'Исключить: ' + f.excludedCountries.join(', '),
    ].filter(Boolean).join('\n') + '\n\nДоплаты, если есть, покажу отдельно.';
    return { text, rows: [[b('🔎 Найти варианты','search')], [b('✏️ Изменить условия','edit'), b('✕ Закрыть','close')]] };
  }

  if (ui.step === 'gender') { text='👥 Кого ищем?'; rows=[[b('Мужчину','gender_male'),b('Женщину','gender_female')],[b('Без предпочтений','gender_any')]]; }
  if (ui.step === 'destination') { text='🌍 Куда хотите поехать?'; rows=[[b('🇹🇷 Турция','dest_turkey'),b('🇦🇪 ОАЭ','dest_uae')],[b('🇻🇳 Вьетнам','dest_vietnam'),b('🌍 Куда угодно','dest_any')],[b('✍️ Другое направление','custom_destination')]]; }
  if (ui.step === 'origin') { text='✈️ Откуда вылетаете?'; rows=[[b('Ташкент','origin_tashkent'),b('Самарканд','origin_samarkand')],[b('Любой город','origin_any'),b('✍️ Другой город','custom_origin')]]; }
  if (ui.step === 'dates') {
    const month = dateChoice('month',now)[0]; const label = new Intl.DateTimeFormat('ru-RU',{month:'long',timeZone:'UTC'}).format(new Date(month+'T00:00:00Z'));
    text=f.category === 'refused_hotel' ? '📅 Когда планируете заселиться?' : '📅 Когда хотите поехать?';
    rows=[[b('Завтра','date_tomorrow'),b('На выходные','date_weekend')],[b('📅 '+label[0].toUpperCase()+label.slice(1),'date_month'),b('Любые даты','date_any')],[b('✍️ Указать даты','custom_dates')]];
  }
  if (ui.step === 'guests') { text='👤 Сколько взрослых едут?\n\nПодбор по этим кнопкам — без детей. Для семьи с детьми напишите запрос текстом, чтобы уточнить состав.'; rows=[[b('1 взрослый','guests_1'),b('2 взрослых','guests_2')],[b('3 взрослых','guests_3'),b('4 взрослых','guests_4')],[b('Не указывать','guests_any'),b('✍️ Другое количество','custom_guests')]]; }
  if (ui.step === 'budget') { text='💰 Какой бюджет?\n\nМожно выбрать предел или оставить без ограничения.'; rows=[[b('До 500 $','budget_500'),b('До 1000 $','budget_1000')],[b('До 1500 $','budget_1500'),b('Без ограничения','budget_any')],[b('✍️ Другая сумма / валюта','custom_budget')]]; }
  if (ui.step === 'basis') { text=`💰 ${f.budget} ${f.currency} — это бюджет на одного или на всех?`; rows=[[b('За человека','basis_person'),b('На всех','basis_total')]]; }
  const order=steps(ui); const index=order.indexOf(ui.step);
  return { text: `${index >= 0 ? `Шаг ${index+1} из ${order.length}\n\n` : ''}${text}\n\n${selections(f)}`.trim(), rows:[...rows,...nav] };
}
function uiHtml(text) {
  const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let heading=false;
  return String(text).split('\n').map(line=>{
    const safe=escape(line);
    if(/^Шаг \d+ из \d+$/.test(line))return `<i>${safe}</i>`;
    if(line.trim()&&!heading){heading=true;return `<b>${safe}</b>`;}
    return safe;
  }).join('\n');
}
function inputPrompt(field) {
  return { full:'Напишите пожелания: направление, даты, сколько человек и бюджет — как удобно.', destination:'Напишите направление, например «Анталья».', origin:'Напишите город вылета, например «Бухара».', dates:'Напишите даты, например «с 5 по 10 декабря» или «в январе».', guests:'Введите число взрослых от 1 до 20 (без детей).', budget:'Напишите сумму и валюту, например «1200 USD» или «800 EUR». Если валюта не указана, считаем USD.' }[field];
}
function uiAction(ui, action, now) {
  const value = action.replace(/^ui_/,''); const f=ui.filters;
  if (value === 'close') return { close:true };
  if (value === 'search' && ui.step === 'review') return { search:true };
  if (value === 'home') { Object.assign(ui,startSearchUi(ui.sourceMessageId)); return {}; }
  if (value === 'examples') { ui.step='examples'; return {}; }
  if (value === 'edit') { ui.step='edit'; return {}; }
  if (value === 'review') { ui.step='review'; return {}; }
  if (['tour','hotel','companion'].includes(value)) {
    ui.filters={...EMPTY,category:value==='hotel'?'refused_hotel':value==='tour'?'refused_tour':null,companion:value==='companion'};
    ui.step=value==='companion'?'gender':'destination'; return {};
  }
  if (value.startsWith('edit_') && steps(ui).includes(value.slice(5))) { ui.editing=true;ui.step=value.slice(5);ui.awaiting=null;return {}; }
  if (value.startsWith('custom_') && ['full',...steps(ui)].includes(value.slice(7))) { ui.awaiting=value.slice(7);return { input:true }; }
  if (value === 'back') {
    if(ui.awaiting){ui.awaiting=null;return {};}
    if(ui.editing){ui.editing=false;ui.step='review';return {};}
    if(ui.step==='basis'){ui.step='budget';return {};}
    const order=steps(ui);ui.step=order[Math.max(-1,order.indexOf(ui.step)-1)] || 'home';return {};
  }
  if(ui.step==='gender' && ['gender_male','gender_female','gender_any'].includes(value)){f.gender=value.slice(7);next(ui,'gender');}
  else if(ui.step==='destination' && (value==='dest_any'||DESTINATIONS[value.slice(5)])){f.destination=DESTINATIONS[value.slice(5)]||[];f.anyDestination=value==='dest_any';next(ui,'destination');}
  else if(ui.step==='origin' && (value==='origin_any'||ORIGINS[value.slice(7)])){f.origin=ORIGINS[value.slice(7)]||[];next(ui,'origin');}
  else if(ui.step==='dates' && ['date_tomorrow','date_weekend','date_month','date_any'].includes(value)){[f.start,f.end]=dateChoice(value.slice(5),now);next(ui,'dates');}
  else if(ui.step==='guests' && /^guests_([1-4]|any)$/.test(value)){f.guests=value==='guests_any'?null:Number(value.slice(7));next(ui,'guests');}
  else if(ui.step==='budget' && /^budget_(500|1000|1500|any)$/.test(value)){f.budget=value==='budget_any'?null:Number(value.slice(7));f.currency=f.budget===null?null:'USD';if(f.budget===null){f.priceBasis=null;next(ui,'budget');}else ui.step='basis';}
  else if(ui.step==='basis' && ['basis_person','basis_total'].includes(value)){f.priceBasis=value.slice(6);next(ui,'budget');}
  return {};
}
function uiText(ui,text) {
  if(ui.awaiting==='guests'){
    if(!/^\d{1,2}$/.test(text.trim()) || Number(text)<1||Number(text)>20)return {error:'Укажите число взрослых от 1 до 20.'};
    ui.filters.guests=Number(text);next(ui,'guests');return {};
  }
  if(ui.awaiting==='budget'){
    const match=text.trim().match(/^(\d+(?:[.,]\d{1,2})?)\s*(USD|EUR|UZS|\$|€)?$/i);
    if(!match||Number(match[1].replace(',','.'))<=0||Number(match[1].replace(',','.'))>1e9)return {error:'Напишите сумму и валюту, например «1200 USD».'};
    ui.filters.budget=Number(match[1].replace(',','.'));ui.filters.currency=match[2]==='€'?'EUR':!match[2]||match[2]==='$'?'USD':match[2].toUpperCase();ui.awaiting=null;ui.step='basis';return {};
  }
  return {interpret:true, field:ui.awaiting};
}
function uiIntent(ui) { return normalizeIntent({kind:'search',language:'ru',filters:ui.filters}); }
module.exports = { startSearchUi, renderSearchUi, uiAction, uiText, uiIntent, inputPrompt, dateChoice, uiHtml };
