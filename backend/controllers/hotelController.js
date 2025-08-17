// backend/controllers/hotelController.js
const axios = require("axios");

const TTL_MS = 10 * 60 * 1000; // 10 минут кэш
const cache = new Map();

function k(query, country, lang, maxRows) {
  return `${query}||${country || ""}||${lang || ""}||${maxRows || 20}`;
}

function getCache(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return v.data;
}

function setCache(key, data) {
  cache.set(key, { ts: Date.now(), data });
}

async function searchHotels(req, res) {
  try {
    const queryRaw = (req.query.query || req.query.q || "").trim();
    if (!queryRaw) return res.json([]);

    const username = process.env.GEONAMES_USERNAME;
    if (!username) {
      // Нет ключа — тихо возвращаем пусто, чтобы не ломать фронт
      return res.json([]);
    }

    const country = (req.query.country || "").trim(); // можно передавать ?country=TR (ISO2)
    const lang = (req.query.lang || "ru").trim();
    const maxRows = Math.min(Number(req.query.maxRows) || 20, 100);

    const key = k(queryRaw, country, lang, maxRows);
    const cached = getCache(key);
    if (cached) return res.json(cached);

    // Ищем только отели
    const url = "https://secure.geonames.org/searchJSON";
    const params = {
      name_startsWith: queryRaw,   // автокомплит по началу
      q: queryRaw,                 // + полнотекстовый
      featureClass: "S",
      featureCode: "HTL",          // Hotel
      maxRows,
      lang,
      username,
    };
    if (country) params.country = country;

    const { data } = await axios.get(url, { params });
    const items = Array.isArray(data?.geonames) ? data.geonames : [];

    // Берём только названия, убираем дубли
    const namesSet = new Set(
      items
        .map((x) => String(x.name || "").trim())
        .filter(Boolean)
    );
    const names = Array.from(namesSet);

    // Кэшируем и отдаём. Возвращаем массив строк (как и ожидает фронт).
    setCache(key, names);
    return res.json(names);
  } catch (e) {
    console.error("GeoNames hotel search error:", e?.response?.data || e.message || e);
    return res.json([]); // не валим фронт
  }
}

module.exports = { searchHotels };
