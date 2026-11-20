import { useTranslation } from 'react-i18next';

const COPY = {
  ru: { title: 'Гала-ужин', status: 'Условия', choose: 'Не указано', none: 'Нет гала-ужина', included: 'Включён в цену', mandatory: 'Обязательная доплата', optional: 'По желанию, за доплату', unknown: 'Нужно уточнить', date: 'Дата ужина', adult: 'Доплата за взрослого', child: 'Доплата за ребёнка', currency: 'Валюта', children: 'Возраст и условия для детей', notes: 'Комментарий', extra: 'Доплата сверх цены тура / отеля, за одного человека.', childUnknown: 'Детская цена уточняется', childHint: 'Пустое поле — цену нужно уточнить. 0 — бесплатно.', childrenHint: 'Например, 6–12 лет; до 6 лет бесплатно', perAdult: 'за взрослого', perChild: 'за ребёнка' },
  en: { title: 'Gala dinner', status: 'Terms', choose: 'Not specified', none: 'No gala dinner', included: 'Included in the price', mandatory: 'Mandatory supplement', optional: 'Optional supplement', unknown: 'To be confirmed', date: 'Dinner date', adult: 'Adult supplement', child: 'Child supplement', currency: 'Currency', children: 'Child ages and terms', notes: 'Notes', extra: 'Supplement to the tour / hotel price, per person.', childUnknown: 'Child price to be confirmed', childHint: 'Blank — confirm price. 0 — free.', childrenHint: 'For example, ages 6–12; under 6 free', perAdult: 'per adult', perChild: 'per child' },
  uz: { title: 'Gala-kechki ovqat', status: 'Shartlar', choose: 'Ko‘rsatilmagan', none: 'Gala-kechki ovqat yo‘q', included: 'Narxga kiritilgan', mandatory: 'Majburiy qo‘shimcha to‘lov', optional: 'Ixtiyoriy qo‘shimcha to‘lov', unknown: 'Aniqlashtirish kerak', date: 'Kechki ovqat sanasi', adult: 'Katta kishi uchun to‘lov', child: 'Bola uchun to‘lov', currency: 'Valyuta', children: 'Bolalar yoshi va shartlari', notes: 'Izoh', extra: 'Tur / mehmonxona narxiga qo‘shimcha to‘lov, bir kishi uchun.', childUnknown: 'Bola narxini aniqlashtirish kerak', childHint: 'Bo‘sh maydon — narxni aniqlashtirish kerak. 0 — bepul.', childrenHint: 'Masalan, 6–12 yosh; 6 yoshgacha bepul', perAdult: 'katta kishi uchun', perChild: 'bola uchun' },
};
const statuses = ['none', 'included', 'mandatory', 'optional', 'unknown'];
const supported = category => ['refused_tour', 'refused_hotel'].includes(category);
export function galaDinnerError(value, details = {}) {
  if (value === undefined) return '';
  if (!value || !statuses.includes(value.status)) return 'Выберите условия гала-ужина.';
  if (['none', 'unknown'].includes(value.status)) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date || '') || !Number.isFinite(Date.parse(value.date)) || new Date(value.date).toISOString().slice(0, 10) !== value.date) return 'Укажите корректную дату гала-ужина.';
  const start = details.startDate || details.checkInDate;
  const end = details.endDate || details.checkOutDate;
  if ((start && value.date < start) || (end && value.date > end)) return 'Дата гала-ужина должна попадать в даты поездки.';
  if (['mandatory', 'optional'].includes(value.status)) {
    if (!['USD', 'EUR', 'UZS'].includes(value.currency)) return 'Выберите валюту гала-ужина.';
    const adult = String(value.adultPrice ?? '').replace(',', '.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(adult) || Number(adult) <= 0 || Number(adult) > 1e9) return 'Укажите доплату за взрослого.';
    const child = String(value.childPrice ?? '').replace(',', '.');
    if (child && !value.childConditions?.trim()) return 'Укажите возраст и условия детской цены гала-ужина.';
    if (child && (!/^\d+(?:\.\d{1,2})?$/.test(child) || Number(child) > 1e9)) return 'Проверьте детскую цену гала-ужина.';
  }
  return '';
}
export function GalaDinnerEditor({ category, value, onChange }) {
  const { i18n } = useTranslation();
  if (!supported(category)) return null;
  const text = COPY[i18n.language?.slice(0, 2)] || COPY.ru;
  const gala = value || {};
  const patch = changes => onChange({ ...gala, ...changes });
  const hasDinner = gala.status && !['none', 'unknown'].includes(gala.status);
  const paid = ['mandatory', 'optional'].includes(gala.status);
  const inputClass = 'mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
  return <fieldset className="min-w-0 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
    <legend className="px-1 font-bold text-slate-900">🎉 {text.title}</legend>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm">{text.status}<select className={inputClass} value={gala.status || ''} onChange={event => onChange(event.target.value ? { status: event.target.value, currency: 'USD' } : undefined)}>
        <option value="">{text.choose}</option>{statuses.map(status => <option key={status} value={status}>{text[status]}</option>)}
      </select></label>
      {hasDinner && <label className="min-w-0 text-sm">{text.date}<input className={inputClass} type="date" value={gala.date || ''} onChange={event => patch({ date: event.target.value })} /></label>}
      {paid && <>
        <label className="min-w-0 text-sm">{text.adult}<input className={inputClass} inputMode="decimal" value={gala.adultPrice ?? ''} onChange={event => patch({ adultPrice: event.target.value })} /></label>
        <label className="min-w-0 text-sm">{text.child}<input className={inputClass} inputMode="decimal" value={gala.childPrice ?? ''} onChange={event => patch({ childPrice: event.target.value })} /><span className="mt-1 block text-xs text-slate-600">{text.childHint}</span></label>
        <label className="min-w-0 text-sm">{text.currency}<select className={inputClass} value={gala.currency || 'USD'} onChange={event => patch({ currency: event.target.value })}>{['USD', 'EUR', 'UZS'].map(currency => <option key={currency}>{currency}</option>)}</select></label>
        <p className="text-sm font-semibold text-amber-900 sm:col-span-2">{text.extra}</p>
      </>}
      {hasDinner && <>
        <label className="min-w-0 text-sm sm:col-span-2">{text.children}<input className={inputClass} maxLength={500} placeholder={text.childrenHint} value={gala.childConditions || ''} onChange={event => patch({ childConditions: event.target.value })} /></label>
        <label className="min-w-0 text-sm sm:col-span-2">{text.notes}<textarea className={inputClass} maxLength={1000} rows={2} value={gala.notes || ''} onChange={event => patch({ notes: event.target.value })} /></label>
      </>}
    </div>
  </fieldset>;
}
export function GalaDinnerSummary({ category, value }) {
  const { i18n } = useTranslation();
  if (!supported(category)) return null;
  const text = COPY[i18n.language?.slice(0, 2)] || COPY.ru;
  const gala = value || { status: 'unknown' };
  const paid = ['mandatory', 'optional'].includes(gala.status);
  return <section aria-label={text.title} className="min-w-0 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-slate-900">
    <strong>🎉 {text.title}{gala.date ? ` · ${String(gala.date).split('-').reverse().join('.')}` : ''}</strong>
    <p>{text[gala.status] || text.unknown}</p>
    {paid && <><p>{gala.adultPrice} {gala.currency} {text.perAdult}</p><p>{gala.childPrice !== null && gala.childPrice !== undefined && gala.childPrice !== '' ? `${gala.childPrice} ${gala.currency} ${text.perChild}` : text.childUnknown}</p><p className="mt-1 font-semibold">{text.extra}</p></>}
    {gala.childConditions && <p className="mt-1 whitespace-pre-wrap break-words">{gala.childConditions}</p>}
    {gala.notes && <p className="mt-1 whitespace-pre-wrap break-words">{gala.notes}</p>}
  </section>;
}
