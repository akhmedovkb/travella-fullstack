const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const { isConfigured, searchFlightOffers } = require("../services/flightSearchClient");

const router = express.Router();
const IATA_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const searchWindows = new Map();

function flightSearchRateLimit(req, res, next) {
  const key = String(req.user?.id || req.ip || "anonymous");
  const now = Date.now();
  if (searchWindows.size > 1000) {
    for (const [entryKey, entry] of searchWindows) {
      if (now - entry.startedAt >= 60_000) searchWindows.delete(entryKey);
    }
  }
  const current = searchWindows.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    searchWindows.set(key, { startedAt: now, count: 1 });
    return next();
  }
  if (current.count >= 20) {
    return res.status(429).json({ error: "rate_limited", message: "Слишком много поисковых запросов. Повторите через минуту." });
  }
  current.count += 1;
  return next();
}

router.use(authenticateToken);

router.get("/status", (_req, res) => {
  res.json({
    flights: { provider: "serpapi_google_flights", configured: isConfigured() },
    trains: { provider: "manual", configured: true },
  });
});

router.get("/flights", flightSearchRateLimit, async (req, res) => {
  const origin = String(req.query.origin || "").trim().toUpperCase();
  const destination = String(req.query.destination || "").trim().toUpperCase();
  const departureDate = String(req.query.departure_date || "").trim();
  const returnDate = String(req.query.return_date || "").trim();
  const adults = Math.min(9, Math.max(1, Number.parseInt(req.query.adults || "1", 10) || 1));
  const children = Math.min(9, Math.max(0, Number.parseInt(req.query.children || "0", 10) || 0));
  const max = Math.min(20, Math.max(1, Number.parseInt(req.query.max || "8", 10) || 8));
  const travelClass = String(req.query.travel_class || "").trim().toUpperCase();

  if (!IATA_RE.test(origin) || !IATA_RE.test(destination) || origin === destination) {
    return res.status(400).json({ error: "invalid_route", message: "Укажите разные аэропорты в формате IATA." });
  }
  if (!DATE_RE.test(departureDate) || (returnDate && !DATE_RE.test(returnDate))) {
    return res.status(400).json({ error: "invalid_date", message: "Проверьте даты перелёта." });
  }
  if (!isConfigured()) {
    return res.status(503).json({
      error: "flight_search_not_configured",
      message: "Поиск авиабилетов ещё не настроен. Добавьте SERPAPI_API_KEY.",
    });
  }

  try {
    const offers = await searchFlightOffers({
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate,
      ...(returnDate ? { returnDate } : {}),
      adults,
      ...(children ? { children } : {}),
      ...(travelClass ? { travelClass } : {}),
      language: req.query.lang || "ru",
      currencyCode: String(req.query.currency || "USD").toUpperCase(),
      max,
    });
    return res.json({ provider: "serpapi_google_flights", offers });
  } catch (error) {
    const status = Number(error?.response?.status || 502);
    const apiError = error?.response?.data?.errors?.[0];
    console.error("[travel-search] flight search failed:", apiError || error?.message || error);
    return res.status(status >= 400 && status < 500 ? status : 502).json({
      error: "flight_search_failed",
      message: apiError?.detail || apiError?.title || error?.message || "Не удалось получить предложения авиакомпаний.",
    });
  }
});

module.exports = router;
