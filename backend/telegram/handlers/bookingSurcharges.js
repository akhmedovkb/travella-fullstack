const { amount, validateFee, feeText, quoteChange } = require('../../ai/bookingPricing');
const { checkpoint } = require('../../ai/bookingRecovery');
const templates = {
  baggage: { name: 'Багаж', label: '🧳 Багаж', categories: ['refused_tour', 'refused_flight'] },
  tax: { name: 'Туристический сбор', label: '🏛 Туристический сбор', categories: ['refused_tour', 'refused_hotel'] },
  transfer: { name: 'Трансфер', label: '🚐 Трансфер', categories: ['refused_tour', 'refused_hotel'] },
  gala: { name: 'Гала-ужин', label: '🎉 Гала-ужин', categories: ['refused_tour', 'refused_hotel'] },
};
const fields = { name: '✍️ Название', amount: '💰 Сумма', currency: '💱 Валюта', required: '📌 Обязательность', basis: '👥 За кого', period: '⏱ Как часто' };
function createBookingSurcharges({ render, keyboard, onDone }) {
  const editing = s => Number.isInteger(s.feeEditIndex);
  function clear(s) { for (const key of ['feeDraft', 'feeStep', 'feeEditIndex', 'feeEditVersion']) delete s[key]; }
  function invalidate(s) { for (const key of ['previewConfirmed', 'previewShown', 'duplicateAck', 'checksAck']) delete s[key]; }
  function changed(s, before, label) {
    const delta = quoteChange(before, s.draft);
    s.changeLines = [label, ...(delta ? [delta] : (s.changeLines || []).filter(x => x.startsWith('🧮 Итог:')))];
    s.manualFields = [...new Set([...(s.manualFields || []), 'surchargesStatus', 'surcharges'])];
    invalidate(s);
  }
  function show(ctx, s) {
    s.stage = 'surcharges'; delete s.field; clear(s);
    const list = s.draft.surcharges || [];
    const delta = (s.changeLines || []).filter(x => x.startsWith('🧮 Итог:')).join('\n');
    return render(ctx, s, '➕ Доплаты сверх основной цены\n\nУкажите все известные доплаты. Гала-ужин, если он уже заполнен отдельно, повторно не добавляйте.\n' + list.map((f, i) => (i + 1) + '. ' + feeText(f)).join('\n') + (delta ? '\n\n' + delta : '') + '\n\nВыберите доплату для изменения или добавьте новую.', keyboard(s.token, [
      [['✅ Доплат нет', 'fee_none']], [['➕ Добавить доплату', 'fee_add']], [['❔ Нужно уточнить', 'fee_unknown']],
      ...(list.length ? [[['✅ Все доплаты указаны', 'fee_done']], ...list.map((f, i) => [['✏️ Изменить ' + (i + 1), 'fee_edit_' + i], ['🗑 Убрать ' + (i + 1), 'fee_remove_' + i]])] : []),
      [['⬅️ К сводке', 'review']],
    ]));
  }
  function step(ctx, s) {
    const f = s.feeDraft, rows = []; let text;
    switch (s.feeStep) {
      case 'name':
        text = '✍️ Как называется доплата?\nВыберите шаблон или напишите своё название — до 80 символов. Шаблон подставит только название.';
        if (!editing(s)) for (const [key, value] of Object.entries(templates)) if (value.categories.includes(s.category)) rows.push([[value.label, 'fee_template_' + key]]);
        break;
      case 'amount': text = '💰 ' + f.name + '\nНапишите сумму доплаты. Например: 25.50.'; break;
      case 'currency': text = '💱 В какой валюте указана доплата?'; rows.push([['USD', 'fee_currency_USD'], ['EUR', 'fee_currency_EUR'], ['UZS', 'fee_currency_UZS']]); break;
      case 'required': text = '📌 Эту доплату нужно платить обязательно?'; rows.push([['✅ Обязательно', 'fee_required_yes'], ['☑️ По желанию', 'fee_required_no']]); break;
      case 'basis': text = '👥 За кого указана сумма доплаты?'; rows.push([['👥 За всех', 'fee_basis_total'], ['👤 За человека', 'fee_basis_person']], ...(s.category === 'refused_flight' ? [] : [[['🛏 За номер', 'fee_basis_room']]])); break;
      case 'period': text = '⏱ Как часто платится доплата?'; rows.push([['1️⃣ Однократно', 'fee_period_once']], ...(s.category === 'refused_flight' ? [] : [[['🌙 За каждую ночь', 'fee_period_night']]])); break;
      default:
        text = (editing(s) ? '✏️ Изменить доплату ' + (s.feeEditIndex + 1) : '🔎 Проверьте доплату') + '\n\n' + feeText(f);
        if (editing(s)) {
          const buttons = Object.entries(fields).map(([key, label]) => [label, 'fee_field_' + key]);
          for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
        }
        rows.push([[editing(s) ? '💾 Сохранить изменения' : '✅ Добавить', 'fee_confirm']]);
    }
    if (editing(s) && s.feeStep !== 'edit') rows.push([['⬅️ К изменению доплаты', 'fee_editback']]);
    rows.push([['↩️ К доплатам', 'fee_menu']]);
    return render(ctx, s, text, keyboard(s.token, rows));
  }
  function next(s, value) { s.feeStep = editing(s) ? 'edit' : value; }
  async function done(ctx, s, status) {
    const before = structuredClone(s.draft); checkpoint(s, 'условия доплат');
    s.draft.surchargesStatus = status; if (status !== 'known') s.draft.surcharges = [];
    changed(s, before, '➕ Условия доплат сохранены.'); clear(s); delete s.pricing; s.stage = 'review';
    return onDone(ctx, s);
  }
  async function handle(ctx, s, action, text) {
    try {
      if (action === 'fee_menu') return show(ctx, s);
      if (action === 'fee_none' || action === 'fee_unknown') return done(ctx, s, action === 'fee_none' ? 'none' : 'unknown');
      if (action === 'fee_done') return s.draft.surcharges?.length ? done(ctx, s, 'known') : show(ctx, s);
      if (action?.startsWith('fee_edit_')) {
        const i = Number(action.slice(9)); if (!Number.isInteger(i) || !s.draft.surcharges?.[i]) return show(ctx, s);
        s.feeEditIndex = i; s.feeEditVersion = JSON.stringify(s.draft.surcharges[i]); s.feeDraft = structuredClone(s.draft.surcharges[i]); s.feeStep = 'edit'; s.stage = 'surcharges'; return step(ctx, s);
      }
      if (action?.startsWith('fee_remove_')) {
        const i = Number(action.slice(11)); if (!Number.isInteger(i) || !s.draft.surcharges?.[i]) return show(ctx, s);
        const before = structuredClone(s.draft); checkpoint(s, 'удаление доплаты'); s.draft.surcharges.splice(i, 1); s.draft.surchargesStatus = s.draft.surcharges.length ? 'known' : 'unknown'; changed(s, before, '🗑 Доплата удалена.'); return show(ctx, s);
      }
      if (action === 'fee_add') {
        if ((s.draft.surcharges || []).length >= 10) return ctx.reply('➕ Можно добавить до 10 доплат.');
        clear(s); s.feeDraft = {}; s.feeStep = 'name'; s.stage = 'surcharges'; return step(ctx, s);
      }
      const f = s.feeDraft; if (!f) return show(ctx, s);
      if (action === 'fee_editback' && editing(s)) { s.feeStep = 'edit'; return step(ctx, s); }
      if (action?.startsWith('fee_field_') && editing(s) && Object.hasOwn(fields, action.slice(10))) { s.feeStep = action.slice(10); return step(ctx, s); }
      if (action?.startsWith('fee_template_') && !editing(s) && s.feeStep === 'name') {
        const template = templates[action.slice(13)]; if (!template?.categories.includes(s.category)) return step(ctx, s);
        f.name = template.name; s.feeStep = 'amount'; return step(ctx, s);
      }
      if (text) {
        if (s.feeStep === 'name') { const name = text.trim(); if (!name || name.length > 80) throw Error('✍️ Назовите доплату: от 1 до 80 символов.'); f.name = name; next(s, 'amount'); }
        else if (s.feeStep === 'amount') { f.amount = amount(text); next(s, 'currency'); }
        else return ctx.reply('👇 Выберите условие доплаты кнопкой под текущим вопросом. Введённые данные сохранены.');
      } else if (s.feeStep === 'currency' && /^fee_currency_(USD|EUR|UZS)$/.test(action)) { f.currency = action.slice(13); next(s, 'required'); }
      else if (s.feeStep === 'required' && /^fee_required_(yes|no)$/.test(action)) { f.required = action.endsWith('_yes'); next(s, 'basis'); }
      else if (s.feeStep === 'basis' && /^fee_basis_(total|person|room)$/.test(action)) {
        const basis = action.slice(10); if (s.category === 'refused_flight' && basis === 'room') throw Error('✈️ Для авиабилета выберите «За всех» или «За человека».'); f.basis = basis; next(s, 'period');
      } else if (s.feeStep === 'period' && /^fee_period_(once|night)$/.test(action)) {
        const period = action.slice(11); validateFee({ ...f, period }, s.draft); f.period = period; next(s, 'confirm');
      } else if (['confirm', 'edit'].includes(s.feeStep) && action === 'fee_confirm') {
        const fee = validateFee(f, s.draft), before = structuredClone(s.draft);
        if (editing(s) && JSON.stringify(s.draft.surcharges?.[s.feeEditIndex]) !== s.feeEditVersion) throw Error('🔄 Доплата изменилась. Откройте её заново из списка.');
        checkpoint(s, editing(s) ? 'изменение доплаты' : 'добавление доплаты');
        if (editing(s)) s.draft.surcharges[s.feeEditIndex] = fee; else s.draft.surcharges = [...(s.draft.surcharges || []), fee];
        s.draft.surchargesStatus = 'known'; changed(s, before, editing(s) ? '✏️ Доплата изменена.' : '➕ Доплата добавлена.'); return show(ctx, s);
      }
      return step(ctx, s);
    } catch (e) { return ctx.reply(e.message); }
  }
  return { show, handle, step };
}
module.exports = { createBookingSurcharges, templates };
