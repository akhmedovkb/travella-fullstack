const CATEGORIES = new Set(['refused_tour', 'refused_hotel']);
const STATUSES = new Set(['none', 'included', 'mandatory', 'optional', 'unknown']);
const STATUS_LABELS = {
  none: 'Нет гала-ужина', included: 'Включён в цену', mandatory: 'Обязательная доплата',
  optional: 'По желанию, за доплату', unknown: 'Нужно уточнить',
};
function fail(message) {
  throw Object.assign(new Error(message), { status: 400 });
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function normalizeGalaDinner(value, details = {}, category) {
  if (value === undefined) return undefined;
  if (category && !CATEGORIES.has(category)) fail('Гала-ужин доступен для отказного тура и отеля.');
  if (!value || typeof value !== 'object' || Array.isArray(value) || !STATUSES.has(value.status)) fail('Выберите условия гала-ужина.');
  if (['none', 'unknown'].includes(value.status)) return { status: value.status };
  const date = String(value.date || '');
  if (!validDate(date)) fail('Укажите дату гала-ужина в формате YYYY-MM-DD.');
  const start = details.startDate || details.checkInDate;
  const end = details.endDate || details.checkOutDate;
  if ((validDate(String(start)) && date < start) || (validDate(String(end)) && date > end)) fail('Дата гала-ужина должна попадать в даты поездки или проживания.');
  const result = { status: value.status, date, childConditions: String(value.childConditions || '').trim(), notes: String(value.notes || '').trim() };
  if (result.childConditions.length > 500 || result.notes.length > 1000) fail('Сократите условия гала-ужина (детские условия до 500 символов, комментарий до 1000).');
  if (value.status === 'included') return result;
  result.currency = String(value.currency || '').toUpperCase();
  if (!['USD', 'EUR', 'UZS'].includes(result.currency)) fail('Выберите валюту гала-ужина — USD, EUR или UZS.');
  function price(input, required) {
    if (input === '' || input === undefined || input === null) {
      if (required) fail('Укажите доплату за взрослого.');
      return null;
    }
    const text = String(input).trim().replace(',', '.');
    const number = Number(text);
    if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(number) || number < 0 || number > 1000000000 || (required && number === 0)) fail('Укажите корректную цену гала-ужина.');
    return number;
  }
  result.adultPrice = price(value.adultPrice, true);
  result.childPrice = price(value.childPrice, false);
  if (result.childPrice !== null && !result.childConditions) fail("Укажите возраст и условия, для которых действует детская цена гала-ужина.");
  return result;
}
function galaDinnerText(value) {
  const gala = value || { status: 'unknown' };
  const lines = [`🎉 Гала-ужин${gala.date ? ` ${String(gala.date).split('-').reverse().join('.')}` : ''} — ${STATUS_LABELS[gala.status] || STATUS_LABELS.unknown}`];
  if (['mandatory', 'optional'].includes(gala.status)) {
    lines.push(`За взрослого ${gala.adultPrice} ${gala.currency}. ${gala.childPrice === null || gala.childPrice === undefined || gala.childPrice === '' ? 'Детская цена уточняется.' : `За ребёнка ${gala.childPrice} ${gala.currency}.`}`);
    lines.push('Доплата сверх указанной цены тура / отеля, за одного человека.');
  }
  if (gala.childConditions) lines.push(`Условия для детей — ${gala.childConditions}`);
  if (gala.notes) lines.push(gala.notes);
  return lines.join('\n');
}
function validateGalaBody(req, res, next) {
  try {
    const details = typeof req.body?.details === 'string' ? JSON.parse(req.body.details) : req.body?.details;
    if (details?.galaDinner !== undefined) {
      details.galaDinner = normalizeGalaDinner(details.galaDinner, details, req.body.category);
      req.body.details = details;
    }
    next();
  } catch (error) {
    res.status(400).json({ message: error.message, error: error.message });
  }
}
module.exports = { CATEGORIES, STATUS_LABELS, normalizeGalaDinner, galaDinnerText, validateGalaBody };
