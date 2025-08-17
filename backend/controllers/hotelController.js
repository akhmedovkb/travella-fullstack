// backend/controllers/hotelController.js
// Версия без axios — используем встроенный fetch (Node 18+)

const TTL_MS = 10 * 60 * 1000; // кэш 10 минут
const cache = new Map();

function cacheKey(query, country, lang, maxRows) {
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
    const queryRaw = String(req.query.query || req.query.q || "").trim();
    if (!queryRaw) return res.json([]);

    const username = process.env.GEONAMES_USERNAME;
    if (!username) {
      // Нет ключа — тихо возвращаем пустой массив, фронт это умеет пережить
      return res.json([]);
    }

    const country = String(req.query.country || "").trim();      // ISO2 (напр. TR), необязательно
    const lang    = String(req.query.lang || "ru").trim();
    const maxRows = Math.min(Number(req.query.maxRows) || 20, 100);

    const key = cacheKey(queryRaw, country, lang, maxRows);
    const cached = getCache(key);
    if (cached) return res.json(cached);

    // Собираем URL для GeoNames: ищем только отели (featureCode=HTL)
    const url = new URL("https://secure.geonames.org/searchJSON");
    url.searchParams.set("name_startsWith", queryRaw);
    url.searchParams.set("q", queryRaw);
    url.searchParams.set("featureClass", "S");
    url.searchParams.set("featureCode", "HTL");
    url.searchParams.set("maxRows", String(maxRows));
    url.searchParams.set("lang", lang);
    url.searchParams.set("username", username);
    if (country) url.searchParams.set("country", country);

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      // Не валим фронт — просто возвращаем пусто
      console.error("GeoNames error:", resp.status, await resp.text());
      return res.json([]);
    }

    const data = await resp.json();
    const items = Array.isArray(data?.geonames) ? data.geonames : [];

    // Уникальные названия отелей
    const names = Array.from(
      new Set(
        items
          .map((x) => String(x.name || "").trim())
          .filter(Boolean)
      )
    );

    setCache(key, names);
    return res.json(names);
  } catch (e) {
    console.error("GeoNames hotel search error:", e?.message || e);
    return res.json([]); // безопасно для UI
  }
}

module.exports = { searchHotels };
