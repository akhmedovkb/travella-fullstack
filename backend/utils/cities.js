// backend/utils/cities.js

// Универсально приводим к массиву строк
function toArray(input) {
  if (input == null) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === "string") return [input];
  if (typeof input === "object") {
    try {
      // на случай { city: "Самарканд" } / {0:"Самарканд",1:"…"}
      return Object.values(input);
    } catch {
      return [];
    }
  }
  return [];
}

// Быстрая транслитерация RU/UZ (кириллица → латиница)
function translitCyrToLat(s) {
  const map = {
    а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"yo",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",
    п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
    қ:"q",ў:"oʻ",ғ:"gʻ",ҳ:"h",йў:"yo", ё̆:"yo",
  };
  return s.replace(/[\u0400-\u04FF]/g, ch => map[ch.toLowerCase()] ?? ch);
}

// Простейший slugify: латиница/цифры, дефис в качестве разделителя
function slugifyCity(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();

  // нормализация типичных вариантов узбекских/русских названий
  const aliases = {
    "samarqand": "samarkand",
    "самарканд": "samarkand",
    "самарқанд": "samarkand",

    "bukhara": "bukhara",
    "buxoro": "bukhara",
    "бухара": "bukhara",
    "бухоро": "bukhara",

    "shahrisabz": "shahrisabz",
    "shakhrisabz": "shahrisabz",
    "шахрисабз": "shahrisabz",
  };
  if (aliases[s]) return aliases[s];

  s = translitCyrToLat(s);
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); // убрать диакритику
  s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); // только [a-z0-9-]
  return s || null;
}

/**
 * Главная функция: принять string|string[]|object|null → вернуть массив slug'ов (уникальных)
 * Сигнатура оставлена совместимой: (pool, inputs), pool не обязателен.
 */
async function resolveCitySlugs(_pool, inputs) {
  const arr = toArray(inputs)
    .map(v => (v == null ? "" : String(v)))
    .map(v => v.trim())
    .filter(Boolean);

  const slugs = arr
    .map(slugifyCity)
    .filter(Boolean);

  // уникализируем
  return Array.from(new Set(slugs));
}

module.exports = {
  resolveCitySlugs,
  slugifyCity,
};
