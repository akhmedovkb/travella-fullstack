export function parseEditorDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parts = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (!parts) return NaN;
  const [, year, month, day] = parts.map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return NaN;
  return Date.parse(text);
}
function first(...values) { return values.find((v) => v !== undefined && v !== null && String(v).trim() !== ""); }
function money(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const raw = String(value).replace(/\s/g, "").replace(",", ".");
  return /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
}
export function validateModerationEditor(form = {}, details = {}) {
  const errors = {};
  const values = { price: form.price, netPrice: first(details.netPrice, details.net_price, form.net_price), grossPrice: first(details.grossPrice, details.gross_price, details.price, form.gross_price, form.price) };
  for (const [key, value] of Object.entries(values)) if (money(value) !== null && !Number.isFinite(money(value))) errors[key] = "Введите неотрицательное число, например 1250.50";
  const net = money(values.netPrice), gross = money(values.grossPrice);
  if (net !== null && gross !== null && Number.isFinite(net) && Number.isFinite(gross) && gross < net) errors.grossPrice = "Gross не должен быть ниже Netto";
  const dates = { startDate: first(details.startDate, details.departureDate, details.departureFlightDate), endDate: first(details.endDate, details.returnFlightDate, details.returnDate), expiration_at: form.expiration_at };
  for (const [key, value] of Object.entries(dates)) if (value && !Number.isFinite(parseEditorDate(value))) errors[key] = "Укажите существующую дату в формате ГГГГ-ММ-ДД";
  if (!errors.startDate && !errors.endDate && dates.startDate && dates.endDate && parseEditorDate(dates.endDate) < parseEditorDate(dates.startDate)) errors.endDate = "Дата окончания не может быть раньше начала";
  return errors;
}
export function changedProviderContacts(form, original = {}) {
  return Object.fromEntries(["telegram_refused_chat_id", "telegram_web_chat_id", "telegram_chat_id"].filter((key) => String(form[key] ?? "") !== String(original[key] ?? "")).map((key) => [key, form[key]]));
}
