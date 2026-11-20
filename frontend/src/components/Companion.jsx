import { useTranslation } from 'react-i18next';

const COPY = {
  ru: { title: 'Поиск попутчика', question: 'Для этого предложения нужен попутчик?', no: 'Нет, поиск не нужен', yes: 'Да, ищем попутчика', gender: 'Кого ищут', male: 'Мужчину', female: 'Женщину', any: 'Без предпочтений', room: 'Размещение', shared: 'Подселение в один номер', separate: 'Отдельные номера в совместной поездке', count: 'Сколько человек ищут', travelers: 'Кто уже едет (необязательно)', travelerHint: 'Например: девушка, 28 лет. Без имени и контактов.', preferences: 'Пожелания и что входит в цену (необязательно)', hint: 'Укажите цену услуги за одного попутчика. Отключение поиска не архивирует тур / отель.', price: 'Указанная цена — за одного попутчика.', looking: 'Ищут', people: 'чел.', already: 'Уже едут', choose: 'Выберите', activeMale: 'Нужен попутчик', activeFemale: 'Нужна попутчица', activeAny: 'Ищут попутчика — без предпочтений' },
  en: { title: 'Travel companion', question: 'Does this offer need a travel companion?', no: 'No companion needed', yes: 'Yes, looking for a companion', gender: 'Looking for', male: 'A man', female: 'A woman', any: 'No preference', room: 'Accommodation', shared: 'Sharing one room', separate: 'Separate rooms on the same trip', count: 'Number of companions needed', travelers: 'Who is already travelling (optional)', travelerHint: 'For example: woman, 28. No names or contact details.', preferences: 'Preferences and what the price includes (optional)', hint: 'Enter the service price per companion. Turning the search off does not archive the tour / hotel.', price: 'The listed price is per companion.', looking: 'Looking for', people: 'people', already: 'Already travelling', choose: 'Select', activeMale: 'Looking for a male companion', activeFemale: 'Looking for a female companion', activeAny: 'Looking for a companion — no preference' },
  uz: { title: 'Hamroh qidirish', question: 'Ushbu taklif uchun hamroh kerakmi?', no: 'Yo‘q, hamroh kerak emas', yes: 'Ha, hamroh qidiryapmiz', gender: 'Kimni qidiryapsiz', male: 'Erkak', female: 'Ayol', any: 'Farqi yo‘q', room: 'Joylashish', shared: 'Bitta xonada birga yashash', separate: 'Birgalikdagi safarda alohida xonalar', count: 'Nechta hamroh kerak', travelers: 'Kim ketyapti (ixtiyoriy)', travelerHint: 'Masalan: ayol, 28 yosh. Ism va aloqa ma’lumotlarisiz.', preferences: 'Istaklar va narxga nimalar kirishi (ixtiyoriy)', hint: 'Xizmat narxini bitta hamroh uchun kiriting. Qidiruvni o‘chirish tur / mehmonxonani arxivlamaydi.', price: 'Ko‘rsatilgan narx — bitta hamroh uchun.', looking: 'Qidirilmoqda', people: 'kishi', already: 'Safarga ketayotganlar', choose: 'Tanlang', activeMale: 'Erkak hamroh kerak', activeFemale: 'Ayol hamroh kerak', activeAny: 'Hamroh kerak — farqi yo‘q' },
};
const supported = category => ['refused_tour', 'refused_hotel'].includes(category);
export function companionError(value) {
  if (value === undefined) return '';
  if (!value || typeof value.enabled !== 'boolean') return 'Укажите, нужен ли попутчик.';
  if (!value.enabled) return '';
  if (!['male', 'female', 'any'].includes(value.gender)) return 'Выберите, кого ищут.';
  if (!['shared', 'separate'].includes(value.room)) return 'Выберите размещение попутчиков.';
  if (!/^\d+$/.test(String(value.count)) || Number(value.count) < 1 || Number(value.count) > 20) return 'Укажите количество попутчиков от 1 до 20.';
  if (String(value.travelers || '').length > 500 || String(value.preferences || '').length > 1000) return 'Сократите описание и пожелания попутчиков.';
  return '';
}
export function CompanionEditor({ category, value, onChange }) {
  const { i18n } = useTranslation();
  if (!supported(category)) return null;
  const text = COPY[i18n.language?.slice(0, 2)] || COPY.ru;
  const data = value || { enabled: false };
  const patch = changes => onChange({ ...data, ...changes, priceBasis: 'per_person' });
  const inputClass = 'mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
  return <fieldset className="min-w-0 rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
    <legend className="px-1 font-bold text-slate-900">👥 {text.title}</legend>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm sm:col-span-2">{text.question}<select className={inputClass} value={data.enabled ? 'yes' : 'no'} onChange={event => onChange(event.target.value === 'yes' ? { ...data, enabled: true, count: data.count || 1, priceBasis: 'per_person' } : { ...data, enabled: false })}><option value="no">{text.no}</option><option value="yes">{text.yes}</option></select></label>
      {data.enabled && <>
        <label className="min-w-0 text-sm">{text.gender}<select className={inputClass} value={data.gender || ''} onChange={event => patch({ gender: event.target.value })}><option value="">{text.choose}</option>{['male', 'female', 'any'].map(key => <option key={key} value={key}>{text[key]}</option>)}</select></label>
        <label className="min-w-0 text-sm">{text.room}<select className={inputClass} value={data.room || ''} onChange={event => patch({ room: event.target.value })}><option value="">{text.choose}</option>{['shared', 'separate'].map(key => <option key={key} value={key}>{text[key]}</option>)}</select></label>
        <label className="min-w-0 text-sm">{text.count}<input className={inputClass} type="number" min={1} max={20} step={1} value={data.count ?? ''} onChange={event => patch({ count: event.target.value })} /></label>
        <p className="text-sm font-semibold text-sky-900 sm:col-span-2">{text.hint}</p>
        <label className="min-w-0 text-sm sm:col-span-2">{text.travelers}<input className={inputClass} maxLength={500} placeholder={text.travelerHint} value={data.travelers || ''} onChange={event => patch({ travelers: event.target.value })} /></label>
        <label className="min-w-0 text-sm sm:col-span-2">{text.preferences}<textarea className={inputClass} maxLength={1000} rows={3} value={data.preferences || ''} onChange={event => patch({ preferences: event.target.value })} /></label>
      </>}
    </div>
  </fieldset>;
}
export function CompanionSummary({ category, value }) {
  const { i18n } = useTranslation();
  if (!supported(category) || (!value?.enabled && value?.priceBasis !== 'per_person')) return null;
  const text = COPY[i18n.language?.slice(0, 2)] || COPY.ru;
  if (!value.enabled) return <p className="text-sm font-semibold text-sky-900">{text.price}</p>;
  const title = { male: text.activeMale, female: text.activeFemale, any: text.activeAny }[value.gender] || text.title;
  return <section aria-label={text.title} className="min-w-0 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-slate-900">
    <strong>👥 {title}</strong>
    {value.room && <p>{text[value.room]}</p>}
    <p>{text.looking}: {value.count} {text.people}</p>
    {value.travelers && <p className="mt-1 whitespace-pre-wrap break-words">{text.already}: {value.travelers}</p>}
    <p className="mt-1 font-semibold">{text.price}</p>
    {value.preferences && <p className="mt-1 whitespace-pre-wrap break-words">{value.preferences}</p>}
  </section>;
}
