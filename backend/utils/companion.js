const CATEGORIES = new Set(['refused_tour', 'refused_hotel']);
const GENDERS = { male: 'Нужен попутчик', female: 'Нужна попутчица', any: 'Ищут попутчика — без предпочтений' };
const ROOMS = { shared: 'Подселение в один номер', separate: 'Отдельные номера в совместной поездке' };
function fail(message) { throw Object.assign(new Error(message), { status: 400 }); }
function normalizeCompanion(value, category) {
  if (value === undefined) return undefined;
  if (category && !CATEGORIES.has(category)) fail('Поиск попутчика доступен для отказного тура и отеля.');
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.enabled !== 'boolean') fail('Укажите, нужен ли попутчик.');
  if (!value.enabled) return { enabled: false, ...(value.priceBasis === 'per_person' ? { priceBasis: 'per_person' } : {}) };
  if (!Object.hasOwn(GENDERS, value.gender)) fail('Выберите, кого ищут: мужчину, женщину или без предпочтений.');
  if (!Object.hasOwn(ROOMS, value.room)) fail('Укажите размещение: один номер или отдельные номера.');
  const count = Number(value.count);
  if (!/^\d+$/.test(String(value.count)) || !Number.isInteger(count) || count < 1 || count > 20) fail('Укажите, сколько попутчиков ищут: от 1 до 20.');
  const travelers = String(value.travelers || '').trim();
  const preferences = String(value.preferences || '').trim();
  if (travelers.length > 500 || preferences.length > 1000) fail('Сократите описание попутчиков до 500 символов и пожелания до 1000.');
  return { enabled: true, gender: value.gender, room: value.room, count, travelers, preferences, priceBasis: 'per_person' };
}
function companionText(value) {
  if (!value?.enabled) return value?.priceBasis === 'per_person' ? 'Указанная цена — за одного человека.' : '';
  return [`👥 ${GENDERS[value.gender] || 'Поиск попутчика'}`, ROOMS[value.room], `Ищут: ${value.count} чел.`, value.travelers && `Уже едут: ${value.travelers}`, 'Указанная цена — за одного попутчика.', value.preferences && `Пожелания: ${value.preferences}`].filter(Boolean).join('\n');
}
function normalizeCompanionPrices(prices) {
  const result = {};
  for (const field of ['netPrice', 'grossPrice']) {
    const text = String(prices?.[field] ?? '').trim().replace(',', '.');
    const number = Number(text);
    if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(number) || number <= 0 || number > 1e9) fail('Укажите корректные цены нетто и для клиента за одного попутчика.');
    result[field] = number;
  }
  if (result.grossPrice < result.netPrice) fail('Цена для клиента не может быть меньше цены нетто.');
  return result;
}
function validateCompanionBody(req, res, next) {
  try {
    const details = typeof req.body?.details === 'string' ? JSON.parse(req.body.details) : req.body?.details;
    if (details?.companion !== undefined) {
      details.companion = normalizeCompanion(details.companion, req.body.category);
      req.body.details = details;
    }
    next();
  } catch (error) { res.status(400).json({ message: error.message, error: error.message }); }
}
module.exports = { CATEGORIES, GENDERS, ROOMS, normalizeCompanion, normalizeCompanionPrices, companionText, validateCompanionBody };
