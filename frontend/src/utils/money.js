//frontend/src/utils/money.js

export function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export function tiyinToSumNumber(x) {
  return Math.round(toNum(x) / 100);
}

export function formatSum(x, locale = "ru-RU") {
  return Math.round(toNum(x)).toLocaleString(locale);
}

export function formatTiyinToSum(x, locale = "ru-RU") {
  return tiyinToSumNumber(x).toLocaleString(locale);
}

export function formatTiyinToSumWithCurrency(x, locale = "ru-RU") {
  return `${formatTiyinToSum(x, locale)} сум`;
}

export function sumToTiyin(x) {
  return Math.round(toNum(x) * 100);
}
